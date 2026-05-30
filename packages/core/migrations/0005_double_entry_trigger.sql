-- 0005_double_entry_trigger.sql
-- Third immutability layer: CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED on postings.
-- This is the belt-and-suspenders complement to post_transaction's inline balance check (0003).
-- If post_transaction's application-level check is ever bypassed (direct INSERT by superuser,
-- migration script, bug), this trigger catches any unbalanced transaction at COMMIT time.
--
-- IMPORTANT: Do NOT add SET CONSTRAINTS ALL IMMEDIATE anywhere. This trigger fires at COMMIT.
-- IMPORTANT: AFTER INSERT only — postings is append-only (no UPDATE/DELETE on postings).
-- Per CLAUDE.md Invariant #2: every accounting transaction must have SUM(signed amount) = 0.
-- Per FND-10 + FND-11: trigger is DEFERRABLE INITIALLY DEFERRED; CI asserts pg_constraint flags.

-- Section A: Trigger function
-- Runs ONCE per inserted posting row, but at COMMIT time (deferred firing).
-- At COMMIT, the table is fully visible: all postings for this transaction are present.
CREATE OR REPLACE FUNCTION check_double_entry_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_signed_sum bigint;
BEGIN
  -- Compute signed sum for this transaction_id across ALL postings committed so far.
  -- debit postings increase the sum; credit postings decrease it.
  -- A balanced transaction has SUM = 0.
  SELECT COALESCE(SUM(
    CASE direction
      WHEN 'debit'  THEN  amount_cents
      WHEN 'credit' THEN -amount_cents
      ELSE 0
    END
  ), 0)
  INTO v_signed_sum
  FROM postings
  WHERE transaction_id = NEW.transaction_id;

  IF v_signed_sum <> 0 THEN
    RAISE EXCEPTION
      'double_entry_violation: transaction % has unbalanced postings (signed sum = %)',
      NEW.transaction_id, v_signed_sum
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NULL; -- AFTER triggers ignore return value; NULL is conventional
END;
$$;

-- Section B: Constraint trigger
-- CONSTRAINT TRIGGER is the only trigger type that supports DEFERRABLE.
-- DEFERRABLE INITIALLY DEFERRED: the trigger fires at COMMIT, not at statement end.
-- This allows multiple unbalanced INSERTs within a transaction that are collectively balanced.
-- FOR EACH ROW: required for CONSTRAINT TRIGGER (statement-level constraint triggers are not supported).
-- AFTER INSERT only: postings is append-only (REVOKE UPDATE/DELETE in 0002_grants.sql).
CREATE CONSTRAINT TRIGGER assert_double_entry
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_double_entry_balance();
