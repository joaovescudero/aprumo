// common.ts — Shared TypeBox schemas for the Aprumo Ledger API.
//
// RFC 9457 problem+json shape (D-02):
//   { type, title, status, detail, code, instance }
//
// Cursor pagination envelope (D-05):
//   { data: T[], next_cursor: string | null }

import { Type } from "@sinclair/typebox";

/**
 * RFC 9457 problem+json response schema.
 * Used by the error handler and documented in OpenAPI via route response schemas.
 */
export const ProblemSchema = Type.Object({
  type: Type.String({ description: "URN identifying the problem type" }),
  title: Type.String({ description: "Short, human-readable summary of the problem" }),
  status: Type.Integer({ description: "HTTP status code" }),
  detail: Type.String({ description: "Human-readable explanation specific to this occurrence" }),
  code: Type.String({ description: "Machine-readable error code" }),
  instance: Type.String({ description: "Request ID correlating this error to the log" }),
});

/**
 * Opaque base64 cursor for keyset pagination (D-05).
 * next_cursor is null when there are no more pages.
 */
export const PaginationCursorSchema = Type.Optional(
  Type.String({ description: "Opaque cursor for the next page" }),
);
