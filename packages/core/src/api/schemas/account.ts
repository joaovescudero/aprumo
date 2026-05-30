// account.ts — TypeBox schemas for POST/GET /v1/accounts and GET /v1/accounts/:id/postings.
//
// balance field in AccountResponseSchema (API-08):
//   - Type.Union([Type.String(), Type.Null()]) — null when no account_balance row yet
//     (balance worker hasn't run for this account).
//
// Cursor pagination (D-04 to D-06):
//   - GET /v1/accounts/:id/postings ordered by created_at DESC
//   - default limit 50, hard max 200; >200 → 400 (Fastify Ajv enforces maximum:200 automatically)
//   - cursor is an opaque base64 string encoding the ISO timestamp

import { Type } from "@sinclair/typebox";

import { PostingResponseSchema } from "./transaction.js";

// ---------------------------------------------------------------------------
// Account type union (mirrors DB CHECK constraint)
// ---------------------------------------------------------------------------

const AccountTypeSchema = Type.Union(
  [
    Type.Literal("asset"),
    Type.Literal("liability"),
    Type.Literal("revenue"),
    Type.Literal("expense"),
    Type.Literal("equity"),
  ],
  { description: "Standard accounting account type" },
);

// ---------------------------------------------------------------------------
// Request schemas
// ---------------------------------------------------------------------------

/**
 * POST /v1/accounts request body.
 * owner_ref: external reference for the account owner (never logged per D-10).
 */
export const PostAccountBodySchema = Type.Object({
  type: AccountTypeSchema,
  owner_ref: Type.String({
    minLength: 1,
    description: "External owner reference (e.g. customer ID). Not logged.",
  }),
  metadata: Type.Optional(
    Type.Object({}, { additionalProperties: true, description: "Arbitrary metadata. Not logged." }),
  ),
});

// ---------------------------------------------------------------------------
// Response schemas
// ---------------------------------------------------------------------------

/**
 * GET /v1/accounts/:id response body.
 * balance: string when account_balance row exists; null when balance worker hasn't run yet (API-08).
 */
export const AccountResponseSchema = Type.Object({
  id: Type.String({ format: "uuid", description: "Account UUID" }),
  type: AccountTypeSchema,
  owner_ref: Type.String({ description: "External owner reference" }),
  metadata: Type.Optional(
    Type.Object({}, { additionalProperties: true, description: "Arbitrary metadata" }),
  ),
  created_at: Type.String({ format: "date-time", description: "Creation timestamp (UTC)" }),
  balance: Type.Union(
    [
      Type.String({ description: "Current balance in cents, BigInt serialized as decimal string" }),
      Type.Null(),
    ],
    { description: "Materialized balance (null if balance worker has not run yet)" },
  ),
});

/**
 * GET /v1/accounts/:id/postings cursor-paginated response envelope (D-05).
 */
export const PostingsPageResponseSchema = Type.Object({
  data: Type.Array(PostingResponseSchema, { description: "Posting lines for this page" }),
  next_cursor: Type.Union(
    [Type.String({ description: "Opaque cursor for next page" }), Type.Null()],
    {
      description: "Null when there are no more pages",
    },
  ),
});

// ---------------------------------------------------------------------------
// Parameter / query-string schemas
// ---------------------------------------------------------------------------

/**
 * GET /v1/accounts/:id path parameters.
 */
export const GetAccountParamsSchema = Type.Object({
  id: Type.String({ format: "uuid", description: "Account UUID" }),
});

/**
 * GET /v1/accounts/:id/postings path parameters.
 */
export const GetPostingsParamsSchema = Type.Object({
  id: Type.String({ format: "uuid", description: "Account UUID" }),
});

/**
 * GET /v1/accounts/:id/postings query string.
 * limit: default 50, max 200; Ajv rejects >200 automatically with 400 (D-06).
 * cursor: opaque base64 string encoding created_at timestamp (D-05).
 */
export const GetPostingsQuerySchema = Type.Object({
  cursor: Type.Optional(
    Type.String({ description: "Opaque cursor from previous page's next_cursor" }),
  ),
  limit: Type.Optional(
    Type.Integer({
      minimum: 1,
      maximum: 200,
      default: 50,
      description: "Number of postings per page (max 200; default 50 per D-06)",
    }),
  ),
});
