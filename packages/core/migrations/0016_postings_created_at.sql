-- 0010_postings_created_at.sql
-- Adds a created_at TIMESTAMPTZ column and DESC index to the postings table.
--
-- Context: UUIDv4 primary keys are random and cannot serve as cursor pagination keys
-- (RESEARCH.md Pitfall 5 — non-monotonic UUIDs break keyset/cursor pagination).
-- The created_at column is the only semantically meaningful sort key for the
-- GET /v1/accounts/:id/postings cursor pagination endpoint (D-04 from CONTEXT.md).
-- DEFAULT now() is applied by Postgres at INSERT time; the post_transaction()
-- function does not accept a created_at parameter, so no application code can
-- inject arbitrary timestamps (T-03-02-02).
--
-- See: CLAUDE.md Invariant #1 (append-only postings — this migration only ADDs a
--      column with a server-side default; no existing posting rows are rewritten)
-- See: D-04 (cursor pagination sort key requirement, CONTEXT.md)

ALTER TABLE "postings" ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT now();

-- Index supports ORDER BY created_at DESC queries in cursor pagination with O(log N) lookup.
CREATE INDEX "postings_created_at_idx" ON "postings" ("created_at" DESC);
