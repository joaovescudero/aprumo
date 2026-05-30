// transaction.ts — TypeBox schemas for POST /v1/transactions and GET /v1/transactions/:id.
//
// amount_cents conventions (CLAUDE.md Invariant #8, RESEARCH.md Pattern 1):
//   - Request body:  Type.Integer({ minimum: 1 }) — validated as positive integer from caller
//   - Response body: Type.String()                 — BigInt serialized as decimal string by
//                                                    setSerializerCompiler (Pitfall 1 prevention)
//
// idempotency-key header: lowercase (Fastify lowercases all incoming HTTP headers).

import { Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// Request schemas (inbound — amount_cents as Integer)
// ---------------------------------------------------------------------------

/**
 * Single posting line in the POST /v1/transactions request body.
 * amount_cents: positive integer (minimum 1) — Fastify validates; handler converts to BigInt
 *               before calling post_transaction.
 */
export const PostingInputSchema = Type.Object({
  account_id: Type.String({ format: "uuid", description: "Account UUID" }),
  amount_cents: Type.Integer({ minimum: 1, description: "Amount in cents, positive integer" }),
  direction: Type.Union([Type.Literal("debit"), Type.Literal("credit")], {
    description: "Debit or credit direction",
  }),
});

/**
 * POST /v1/transactions request body.
 * postings must have at least 2 entries (double-entry requires debit + credit).
 */
export const PostTransactionBodySchema = Type.Object({
  postings: Type.Array(PostingInputSchema, {
    minItems: 2,
    description: "Posting lines (minimum 2 for double-entry)",
  }),
  description: Type.Optional(
    Type.String({ maxLength: 500, description: "Human-readable description" }),
  ),
  metadata: Type.Optional(
    Type.Object(
      {},
      { additionalProperties: true, description: "Arbitrary metadata (pass-through, not logged)" },
    ),
  ),
});

/**
 * POST /v1/transactions required request headers.
 * idempotency-key is lowercased (Fastify lowercases all headers; D-08).
 */
export const PostTransactionHeadersSchema = Type.Object({
  "idempotency-key": Type.String({
    minLength: 1,
    maxLength: 255,
    description: "Caller-supplied deduplication key (D-08)",
  }),
});

// ---------------------------------------------------------------------------
// Response schemas (outbound — amount_cents as String)
// ---------------------------------------------------------------------------

/**
 * Single posting in the GET /v1/transactions/:id response.
 * amount_cents: Type.String() — BigInt returned by Drizzle is serialized as decimal string
 *               by setSerializerCompiler. Declared as string here for correct OpenAPI docs.
 */
export const PostingResponseSchema = Type.Object({
  id: Type.String({ format: "uuid", description: "Posting UUID" }),
  transaction_id: Type.String({ format: "uuid", description: "Parent transaction UUID" }),
  account_id: Type.String({ format: "uuid", description: "Account UUID" }),
  amount_cents: Type.String({
    description: "Amount in cents, BigInt serialized as decimal string (API-02)",
  }),
  direction: Type.Union([Type.Literal("debit"), Type.Literal("credit")], {
    description: "Debit or credit direction",
  }),
  created_at: Type.String({ format: "date-time", description: "Insertion timestamp (UTC)" }),
});

/**
 * Full transaction response (transaction row + its postings).
 */
export const TransactionResponseSchema = Type.Object({
  id: Type.String({ format: "uuid", description: "Transaction UUID" }),
  idempotency_key: Type.String({ description: "Caller-supplied deduplication key" }),
  ts: Type.String({ format: "date-time", description: "Transaction timestamp (UTC)" }),
  description: Type.Optional(Type.String({ description: "Human-readable description" })),
  source: Type.Optional(Type.String({ description: "Source system or event type" })),
  metadata: Type.Optional(
    Type.Object({}, { additionalProperties: true, description: "Arbitrary metadata" }),
  ),
  postings: Type.Array(PostingResponseSchema, { description: "Posting lines" }),
});

// ---------------------------------------------------------------------------
// Parameter schemas
// ---------------------------------------------------------------------------

/**
 * GET /v1/transactions/:id path parameters.
 */
export const GetTransactionParamsSchema = Type.Object({
  id: Type.String({ format: "uuid", description: "Transaction UUID" }),
});
