// transactions.ts — Route plugin for POST /v1/transactions and GET /v1/transactions/:id.
//
// CRITICAL INVARIANTS (CLAUDE.md):
//   Invariant #1: postings are append-only. NEVER insert into postings directly — only via post_transaction().
//   Invariant #2: balanced double-entry enforced by post_transaction() in PG (SQLSTATE P0001 on failure).
//   Invariant #3: idempotency — SELECT-first before post_transaction; duplicate key returns existing tx (200).
//   Invariant #5: SERIALIZABLE isolation for all ledger writes; SQLSTATE 40001 retried by withRetryOnSerializationFailure.
//
// post_transaction SQL function signature (migration 0008):
//   post_transaction(p_idempotency_key, p_description, p_source, p_metadata::jsonb, p_postings posting_input[])
//   posting_input composite type field order: (account_id, amount_cents, direction)
//
// amount_cents convention:
//   - Inbound (body): integer — TypeBox Type.Integer({minimum:1}) validates; handler converts to BigInt for SQL
//   - Outbound (response): string — setSerializerCompiler converts BigInt to decimal string at reply.send()
//                          (Pitfall 1 in RESEARCH.md; Invariant #8 in CLAUDE.md)
//
// See: D-08 (Idempotency-Key required), D-09 (X-Request-Id), T-03-05a/b/c/d (threat mitigations)

import { desc, eq, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import { postings, transactions } from "../../db/schema.js";
import { withRetryOnSerializationFailure } from "../../lib/with-retry.js";
import {
  GetTransactionParamsSchema,
  PostTransactionBodySchema,
  PostTransactionHeadersSchema,
  TransactionResponseSchema,
} from "../schemas/transaction.js";
import type { AnyDrizzleDb } from "../server.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Drizzle row returned from the transactions table. */
type TransactionRow = typeof transactions.$inferSelect;

/** Drizzle row returned from the postings table. */
type PostingRow = typeof postings.$inferSelect;

/**
 * Plugin options — receives db from createServer caller.
 * prefix is handled by Fastify register options (not in this type).
 */
export interface TransactionRouteOptions {
  db: AnyDrizzleDb;
}

// ---------------------------------------------------------------------------
// Response builder
// ---------------------------------------------------------------------------

/**
 * Build the TransactionResponseSchema-shaped object from DB rows.
 * amount_cents is returned as BigInt — setSerializerCompiler converts to string at reply.send().
 * created_at / ts are Date objects — JSON.stringify converts to ISO string.
 */
function buildTransactionResponse(tx: TransactionRow, txPostings: PostingRow[]) {
  return {
    id: tx.id,
    idempotency_key: tx.idempotency_key,
    ts: tx.ts.toISOString(),
    description: tx.description ?? undefined,
    source: tx.source ?? undefined,
    metadata: (tx.metadata as Record<string, unknown>) ?? undefined,
    postings: txPostings.map((p) => ({
      id: p.id,
      transaction_id: p.transaction_id,
      account_id: p.account_id,
      amount_cents: p.amount_cents, // BigInt — serialized to string by setSerializerCompiler
      direction: p.direction as "debit" | "credit",
      created_at: p.created_at.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin registering POST /transactions and GET /transactions/:id.
 * Must be registered with a prefix (e.g. '/v1') via app.register(..., { prefix: '/v1', db }).
 */
export const transactionRoutes: FastifyPluginAsync<TransactionRouteOptions> = async (
  fastify,
  opts,
) => {
  const { db } = opts;

  // -----------------------------------------------------------------------
  // POST /transactions
  // -----------------------------------------------------------------------

  fastify.post(
    "/transactions",
    {
      schema: {
        body: PostTransactionBodySchema,
        headers: PostTransactionHeadersSchema,
        response: {
          201: TransactionResponseSchema,
          200: TransactionResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const idempotencyKey = request.headers["idempotency-key"] as string;
      const body = request.body as {
        postings: Array<{ account_id: string; amount_cents: number; direction: string }>;
        description?: string;
        metadata?: Record<string, unknown>;
      };

      // Step 1: SELECT-first idempotency check (D-08, Pattern 6 RESEARCH.md)
      // Run outside of any transaction — just a plain read to detect existing keys.
      const existing = await db
        .select()
        .from(transactions)
        .where(eq(transactions.idempotency_key, idempotencyKey))
        .limit(1);

      if (existing[0]) {
        // Idempotent response — return existing transaction without calling post_transaction
        const existingPostings = await db
          .select()
          .from(postings)
          .where(eq(postings.transaction_id, existing[0].id))
          .orderBy(desc(postings.created_at));

        return reply.status(200).send(buildTransactionResponse(existing[0], existingPostings));
      }

      // Step 2: Call post_transaction via SERIALIZABLE transaction wrapped in retry.
      // withRetryOnSerializationFailure retries the full db.transaction() factory on SQLSTATE 40001.
      // NEVER insert into postings directly — post_transaction() is the sole write path (Invariant #1).
      //
      // Concurrent duplicate handling: two simultaneous requests with the same idempotency key can
      // both pass the SELECT-first check above (race window), then race at post_transaction().
      // Inside post_transaction(), the loser catches unique_violation and returns the winner's tx_id.
      // BUT: with SERIALIZABLE isolation, the loser's transaction may still get 40001 at COMMIT.
      // withRetryOnSerializationFailure retries up to 3 times; on each retry, post_transaction's
      // SELECT guard finds the committed row and returns early (no write conflict on retry).
      // If all retries exhaust (extremely rare under load), we fall back to a plain SELECT to check
      // whether a concurrent request already committed — and return 200 if found (Invariant #3).
      let txId: string;
      try {
        txId = await withRetryOnSerializationFailure(() =>
          db.transaction(
            async (tx) => {
              // Build posting_input ROW fragments — all scalars parameterized via sql template (T-03-05a)
              const postingRows = body.postings.map(
                (p) =>
                  // ROW field order matches posting_input composite type: (account_id, amount_cents, direction)
                  sql`ROW(${p.account_id}, ${BigInt(p.amount_cents)}, ${p.direction})::posting_input`,
              );

              const result = await tx.execute(
                sql`SELECT post_transaction(
                  ${idempotencyKey},
                  ${body.description ?? null},
                  ${"api"},
                  ${JSON.stringify(body.metadata ?? {})}::jsonb,
                  ARRAY[${sql.join(postingRows, sql`, `)}]
                )`,
              );

              // For node-postgres driver, db.execute() returns a QueryResult object with a .rows array.
              // For postgres-js driver, db.execute() returns the rows array directly.
              // Normalise: handle both shapes via the AnyDrizzleDb union.
              const resultRows = Array.isArray(result)
                ? result
                : (result as { rows: unknown[] }).rows;

              // post_transaction returns the new transaction UUID
              const row = resultRows[0] as { post_transaction: string } | undefined;
              if (!row?.post_transaction) {
                throw new Error("post_transaction returned no UUID");
              }
              return row.post_transaction;
            },
            { isolationLevel: "serializable", accessMode: "read write" },
          ),
        );
      } catch (err) {
        // If serialization retries exhausted AND a concurrent request already committed
        // the same idempotency key, return 200 (Invariant #3: never error on duplicate).
        // This is the last-resort fallback for the extremely rare case where all 3 retries
        // also encounter serialization failures (e.g. very high concurrency under load).
        const errCode =
          (err as { code?: string }).code ?? (err as { cause?: { code?: string } }).cause?.code;
        if (errCode === "40001") {
          const fallback = await db
            .select()
            .from(transactions)
            .where(eq(transactions.idempotency_key, idempotencyKey))
            .limit(1);
          if (fallback[0]) {
            const fallbackPostings = await db
              .select()
              .from(postings)
              .where(eq(postings.transaction_id, fallback[0].id))
              .orderBy(desc(postings.created_at));
            return reply.status(200).send(buildTransactionResponse(fallback[0], fallbackPostings));
          }
        }
        // Non-40001 or genuinely not found after exhaustion — re-throw for pgErrorHandler
        throw err;
      }

      // Step 3: Fetch the newly created transaction + its postings for the 201 response
      const newTx = await db.select().from(transactions).where(eq(transactions.id, txId)).limit(1);

      if (!newTx[0]) {
        throw new Error(`Transaction ${txId} not found after post_transaction`);
      }

      const newPostings = await db
        .select()
        .from(postings)
        .where(eq(postings.transaction_id, txId))
        .orderBy(desc(postings.created_at));

      return reply.status(201).send(buildTransactionResponse(newTx[0], newPostings));
    },
  );

  // -----------------------------------------------------------------------
  // GET /transactions/:id
  // -----------------------------------------------------------------------

  fastify.get(
    "/transactions/:id",
    {
      schema: {
        params: GetTransactionParamsSchema,
        response: {
          200: TransactionResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      const txRows = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);

      if (!txRows[0]) {
        // Throw a NotFoundError — pgErrorHandler maps statusCode=404 to 404 not_found.
        // We cannot use reply.status(404).send() directly here because the route schema only
        // declares a 200 response, and TypeScript (with TypeBoxTypeProvider) rejects other codes.
        const notFoundErr = Object.assign(new Error(`Transaction ${id} not found`), {
          statusCode: 404,
          code: "not_found",
          resourceId: id,
        });
        throw notFoundErr;
      }

      const txPostings = await db
        .select()
        .from(postings)
        .where(eq(postings.transaction_id, id))
        .orderBy(desc(postings.created_at));

      return reply.status(200).send(buildTransactionResponse(txRows[0], txPostings));
    },
  );
};

export default transactionRoutes;
