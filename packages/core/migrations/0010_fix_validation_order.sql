-- 0010_fix_validation_order.sql
-- Fixes validation ordering in post_transaction to check amount_cents > 0 BEFORE
-- accumulating the signed sum.
--
-- Problem (CR-01): In 0008_post_transaction_idempotency_race.sql the FOREACH loop
-- first accumulates v_signed_sum and then checks amount_cents <= 0. For a CREDIT
-- posting with amount_cents = BIGINT_MIN (-9223372036854775808), the accumulation
-- `v_signed_sum - amount_cents` = `0 - (-9223372036854775808)` overflows BIGINT and
-- raises a PostgreSQL numeric error (SQLSTATE 22003) instead of the expected P0001
-- "must be positive" validation error.
--
-- Fix: Move the positivity check BEFORE the direction branch so any non-positive
-- amount_cents raises P0001 immediately, before any arithmetic is performed.
--
-- Supersedes: 0003_post_transaction.sql, 0008_post_transaction_idempotency_race.sql
-- See: CLAUDE.md Invariant #2 (double-entry), Invariant #3 (idempotency)
-- See: CR-01 review finding in 02-REVIEW.md

CREATE OR REPLACE FUNCTION post_transaction(
  p_idempotency_key  text,
  p_description      text,
  p_source           text,
  p_metadata         jsonb,
  p_postings         posting_input[]
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id       uuid;
  v_signed_sum  bigint := 0;
  v_rec         posting_input;
BEGIN
  -- Idempotency guard: fast path — if key already committed, return immediately.
  -- Per CLAUDE.md Invariant #3 + API-05: duplicate key must NOT raise an error.
  SELECT id INTO v_tx_id
    FROM transactions
   WHERE idempotency_key = p_idempotency_key;

  IF FOUND THEN
    RETURN v_tx_id;
  END IF;

  -- Validate postings array is not empty.
  IF array_length(p_postings, 1) IS NULL THEN
    RAISE EXCEPTION 'post_transaction: postings array must not be empty'
      USING ERRCODE = 'P0001';
  END IF;

  -- Validate each posting and accumulate signed sum (debit = +, credit = -).
  -- Per CLAUDE.md Invariant #2: SUM must be 0 before any INSERT.
  --
  -- CR-01 fix: validate amount_cents > 0 BEFORE the direction branch so no
  -- arithmetic is performed on invalid inputs. This prevents a credit posting
  -- with amount_cents = BIGINT_MIN from causing `0 - BIGINT_MIN` to overflow.
  FOREACH v_rec IN ARRAY p_postings LOOP
    -- Validate amount_cents FIRST — before any arithmetic.
    IF v_rec.amount_cents <= 0 THEN
      RAISE EXCEPTION
        'post_transaction: amount_cents must be positive, got %',
        v_rec.amount_cents
        USING ERRCODE = 'P0001';
    END IF;

    -- Now safe to accumulate.
    IF v_rec.direction = 'debit' THEN
      v_signed_sum := v_signed_sum + v_rec.amount_cents;
    ELSIF v_rec.direction = 'credit' THEN
      v_signed_sum := v_signed_sum - v_rec.amount_cents;
    ELSE
      RAISE EXCEPTION
        'post_transaction: invalid direction %, must be debit or credit',
        v_rec.direction
        USING ERRCODE = 'P0001';
    END IF;
  END LOOP;

  -- Validate double-entry balance (belt-and-suspenders with Plan 05 CONSTRAINT TRIGGER).
  IF v_signed_sum <> 0 THEN
    RAISE EXCEPTION
      'post_transaction: postings do not balance (signed sum = %)',
      v_signed_sum
      USING ERRCODE = 'P0001';
  END IF;

  -- Atomically insert the transaction record.
  -- Race handler: two concurrent calls with the same key can both pass the SELECT
  -- guard above (FOUND = false) and race here. The loser catches the unique_violation
  -- and returns the winner's transaction id — satisfying CLAUDE.md Invariant #3.
  v_tx_id := gen_random_uuid();
  BEGIN
    INSERT INTO transactions (id, idempotency_key, ts, description, source, metadata)
    VALUES (v_tx_id, p_idempotency_key, now(), p_description, p_source, p_metadata);
  EXCEPTION WHEN unique_violation THEN
    -- Concurrent call won the INSERT race; re-fetch and return the winner's id.
    SELECT id INTO v_tx_id
      FROM transactions
     WHERE idempotency_key = p_idempotency_key;
    RETURN v_tx_id;
  END;

  -- Atomically insert all postings (only the call that won the INSERT race reaches here).
  -- SECURITY DEFINER ensures this INSERT succeeds even though aprumo_app has no
  -- direct INSERT privilege on postings — the function runs as aprumo_migration.
  FOREACH v_rec IN ARRAY p_postings LOOP
    INSERT INTO postings (id, transaction_id, account_id, amount_cents, direction)
    VALUES (gen_random_uuid(), v_tx_id, v_rec.account_id, v_rec.amount_cents, v_rec.direction);
  END LOOP;

  RETURN v_tx_id;
END;
$$;

-- Re-assert ownership + grant (CREATE OR REPLACE retains them, but be explicit for clarity).
ALTER FUNCTION post_transaction(text, text, text, jsonb, posting_input[])
  OWNER TO aprumo_migration;

GRANT EXECUTE ON FUNCTION post_transaction(text, text, text, jsonb, posting_input[])
  TO aprumo_app;
