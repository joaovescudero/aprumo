-- 0009_account_balance_last_posting_fk.sql
-- Adds a foreign key from account_balance.last_posting_id to postings.id.
--
-- Context: last_posting_id is the incremental balance worker's cursor column.
-- Without a FK, a bug that writes a wrong UUID as the cursor would be accepted
-- silently by Postgres, causing the worker to compute balances from an invalid
-- anchor position. Since postings is append-only (no DELETE), the FK carries no
-- risk of cascade-delete side effects.
--
-- NOT VALID: Added because existing rows have NULL in this column (normal in v0.1
-- before the balance worker has run), and NOT VALID avoids a full-table scan on
-- an empty table, while still enforcing the constraint on future INSERTs/UPDATEs.
-- Run VALIDATE CONSTRAINT when the worker is implemented to backfill and validate.
--
-- See: CLAUDE.md Invariant #1 (append-only postings)
-- See: WR-03 review finding

ALTER TABLE "account_balance"
  ADD CONSTRAINT "account_balance_last_posting_id_postings_id_fk"
  FOREIGN KEY ("last_posting_id") REFERENCES "public"."postings"("id")
  ON DELETE no action ON UPDATE no action NOT VALID;
