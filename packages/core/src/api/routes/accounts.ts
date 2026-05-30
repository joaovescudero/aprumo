// accounts.ts — Route plugin for POST /v1/accounts, GET /v1/accounts/:id,
// and GET /v1/accounts/:id/postings (cursor-paginated).
//
// Threat mitigations wired here (STRIDE register 03-06):
//   T-03-06a: cursor decode inside try/catch → any failure returns 400, never 500
//   T-03-06b: cursor values passed via Drizzle sql template (parameterized, not interpolated)
//   T-03-06c: TypeBox maximum:200 on limit rejects >200 before handler; Math.min as belt-and-suspenders
//   T-03-06d: TypeBox AccountTypeSchema enum rejects invalid type strings before handler
//
// Cursor pagination decisions (D-04, D-05, D-06):
//   D-04: ORDER BY created_at DESC, id DESC (tiebreaker on same-millisecond inserts — Pitfall 5)
//   D-05: opaque cursor = base64url(JSON({ created_at: ISO string, id: UUID }))
//   D-06: default limit=50, hard max=200; handler uses limit+1 to detect next page
//
// balance in GET /v1/accounts/:id (API-08):
//   - Returned from materialized account_balance table via LEFT JOIN
//   - Null when no account_balance row exists (balance worker hasn't run for this account)
//   - Never compute from postings directly — always read from account_balance
//
// amount_cents in GET /v1/accounts/:id/postings (API-02):
//   - Drizzle returns BigInt; setSerializerCompiler converts to decimal string at reply.send()
//   - Declared as Type.String() in PostingResponseSchema for correct OpenAPI docs

import { and, desc, eq, or, sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import { accountBalance, accounts, postings } from "../../db/schema.js";
import {
  AccountResponseSchema,
  GetAccountParamsSchema,
  GetPostingsParamsSchema,
  GetPostingsQuerySchema,
  PostAccountBodySchema,
  PostingsPageResponseSchema,
} from "../schemas/account.js";
import type { AnyDrizzleDb } from "../server.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Plugin options — receives db from createServer caller. */
export interface AccountRouteOptions {
  db: AnyDrizzleDb;
}

/** Decoded opaque cursor payload (D-05). */
interface CursorPayload {
  created_at: string;
  id: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Decode a base64url opaque cursor string into { created_at, id }.
 * Returns null on any decode/parse failure (T-03-06a).
 */
function decodeCursor(cursor: string): CursorPayload | null {
  try {
    // "base64url" is valid at runtime (Node 18+) but some @types/node versions omit it.
    // Cast to BufferEncoding to satisfy the compiler while preserving runtime correctness.
    const decoded = JSON.parse(
      Buffer.from(cursor, "base64url" as BufferEncoding).toString("utf-8"),
    ) as unknown;
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof (decoded as Record<string, unknown>).created_at !== "string" ||
      typeof (decoded as Record<string, unknown>).id !== "string"
    ) {
      return null;
    }
    return decoded as CursorPayload;
  } catch {
    return null;
  }
}

/**
 * Encode (created_at Date, id UUID) into an opaque base64url cursor string (D-05).
 */
function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ created_at: createdAt.toISOString(), id }), "utf-8").toString(
    "base64url",
  );
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin registering:
 *   POST   /accounts
 *   GET    /accounts/:id
 *   GET    /accounts/:id/postings
 *
 * Must be registered with a prefix (e.g. '/v1') via:
 *   app.register(accountRoutes, { prefix: '/v1', db })
 */
export const accountRoutes: FastifyPluginAsync<AccountRouteOptions> = async (fastify, opts) => {
  const { db } = opts;

  // ─────────────────────────────────────────────────────────────────────────
  // POST /accounts
  // ─────────────────────────────────────────────────────────────────────────

  fastify.post(
    "/accounts",
    {
      schema: {
        body: PostAccountBodySchema,
        response: {
          201: AccountResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const body = request.body as {
        type: string;
        owner_ref: string;
        metadata?: Record<string, unknown>;
      };

      const rows = await db
        .insert(accounts)
        .values({
          type: body.type,
          owner_ref: body.owner_ref,
          metadata: body.metadata ?? null,
        })
        .returning();

      const account = rows[0];
      if (!account) {
        throw new Error("INSERT into accounts returned no row");
      }

      // balance: null — no account_balance row has been created yet (API-07)
      return reply.status(201).send({
        id: account.id,
        type: account.type,
        owner_ref: account.owner_ref,
        metadata: account.metadata ?? undefined,
        created_at: account.created_at.toISOString(),
        balance: null,
      });
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // GET /accounts/:id
  // ─────────────────────────────────────────────────────────────────────────

  fastify.get(
    "/accounts/:id",
    {
      schema: {
        params: GetAccountParamsSchema,
        response: {
          200: AccountResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };

      // LEFT JOIN: account_balance row may not exist yet (API-08)
      const rows = await db
        .select({
          id: accounts.id,
          type: accounts.type,
          owner_ref: accounts.owner_ref,
          metadata: accounts.metadata,
          created_at: accounts.created_at,
          balance: accountBalance.balance,
        })
        .from(accounts)
        .leftJoin(accountBalance, eq(accountBalance.account_id, accounts.id))
        .where(eq(accounts.id, id))
        .limit(1);

      if (!rows[0]) {
        // Resource not found — throw so pgErrorHandler maps to 404 problem+json
        const notFoundErr = Object.assign(new Error(`Account ${id} not found`), {
          statusCode: 404,
          code: "not_found",
          resourceId: id,
        });
        throw notFoundErr;
      }

      const row = rows[0];

      return reply.status(200).send({
        id: row.id,
        type: row.type,
        owner_ref: row.owner_ref,
        metadata: row.metadata ?? undefined,
        created_at: row.created_at.toISOString(),
        // balance is BigInt from DB (setSerializerCompiler converts to string) or null
        balance: row.balance ?? null,
      });
    },
  );

  // ─────────────────────────────────────────────────────────────────────────
  // GET /accounts/:id/postings
  // ─────────────────────────────────────────────────────────────────────────

  fastify.get(
    "/accounts/:id/postings",
    {
      schema: {
        params: GetPostingsParamsSchema,
        querystring: GetPostingsQuerySchema,
        response: {
          200: PostingsPageResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params as { id: string };
      const query = request.query as { cursor?: string; limit?: number };

      // Default limit 50, TypeBox maximum:200 enforces upper bound via Ajv before handler (D-06)
      // Math.min is belt-and-suspenders (T-03-06c)
      const effectiveLimit = Math.min(query.limit ?? 50, 200);

      // Decode cursor if present (T-03-06a: any failure → 400 problem+json, never 500)
      let cursorPayload: CursorPayload | null = null;
      if (query.cursor !== undefined && query.cursor !== "") {
        cursorPayload = decodeCursor(query.cursor);
        if (cursorPayload === null) {
          // Throw so pgErrorHandler maps code='invalid_cursor' → 400 problem+json (T-03-06a).
          // Route schema only declares 200 so reply.status(400) would be a TypeScript error;
          // throwing is the same pattern transactions.ts uses for not_found → 404.
          throw Object.assign(
            new Error("The cursor parameter is malformed or expired. Fetch the first page again."),
            { code: "invalid_cursor" },
          );
        }
      }

      // Base WHERE: filter by account_id
      const baseWhere = eq(postings.account_id, id);

      // Keyset WHERE (D-04, D-05):
      //   (created_at < cursorDate) OR (created_at = cursorDate AND id < cursorId)
      // Values are Drizzle-parameterized via sql template (T-03-06b)
      const keysetWhere =
        cursorPayload !== null
          ? sql`(${postings.created_at} < ${new Date(cursorPayload.created_at)} OR (${postings.created_at} = ${new Date(cursorPayload.created_at)} AND ${postings.id} < ${cursorPayload.id}))`
          : null;

      const whereClause = keysetWhere !== null ? and(baseWhere, keysetWhere) : baseWhere;

      // Fetch limit+1 rows to detect whether another page exists (D-06 pattern)
      const rows = await db
        .select()
        .from(postings)
        .where(whereClause)
        .orderBy(desc(postings.created_at), desc(postings.id))
        .limit(effectiveLimit + 1);

      // Determine pagination state
      const hasNextPage = rows.length > effectiveLimit;
      const pageRows = hasNextPage ? rows.slice(0, effectiveLimit) : rows;

      // Encode cursor for last item on this page (D-05)
      const lastRow = pageRows[pageRows.length - 1];
      const nextCursor =
        hasNextPage && lastRow !== undefined ? encodeCursor(lastRow.created_at, lastRow.id) : null;

      return reply.status(200).send({
        data: pageRows.map((p) => ({
          id: p.id,
          transaction_id: p.transaction_id,
          account_id: p.account_id,
          amount_cents: p.amount_cents, // BigInt — serialized to string by setSerializerCompiler
          direction: p.direction as "debit" | "credit",
          created_at: p.created_at.toISOString(),
        })),
        next_cursor: nextCursor,
      });
    },
  );
};

export default accountRoutes;
