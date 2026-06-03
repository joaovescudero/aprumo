-- 0015_set_search_path_double_entry.sql
-- Adds SET search_path = public to check_double_entry_balance() trigger function.
--
-- Problem (CR-02): 0005_double_entry_trigger.sql defines check_double_entry_balance()
-- without SET search_path, leaving it vulnerable to search-path injection. Every other
-- privilege-sensitive function in the codebase sets SET search_path = public:
--   - post_transaction   (0003, 0008, 0010, 0012): SET search_path = public
--   - audit_row_change   (0004): SET search_path = public
--
-- The trigger is DEFERRABLE INITIALLY DEFERRED — it fires at COMMIT time, not at
-- statement end. This means the session search_path in effect at COMMIT is used for
-- name resolution. Without a fixed search_path, a session that sets:
--   SET search_path = attacker_schema, public;
-- before COMMIT could cause the trigger's FROM clause ("FROM postings WHERE ...") to
-- resolve to a shadow table in attacker_schema rather than public.postings, allowing
-- an attacker to manufacture a fraudulent zero sum and bypass the double-entry check.
-- This would violate CLAUDE.md Invariant #2 (every transaction must have SUM = 0).
--
-- Fix: CREATE OR REPLACE the function identically plus SET search_path = public,
-- consistent with the pattern used by post_transaction and audit_row_change.
-- The trigger registration (Section B of 0005) is unchanged — CREATE OR REPLACE
-- replaces only the function body; the constraint trigger that references it remains.
--
-- See: CLAUDE.md Invariant #2 (double-entry balanced)
-- See: CR-02 review finding in 02-REVIEW.md
-- See: 0005_double_entry_trigger.sql (original — immutable)
-- See: 0004_audit_triggers.sql (audit_row_change pattern)

CREATE OR REPLACE FUNCTION check_double_entry_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
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
