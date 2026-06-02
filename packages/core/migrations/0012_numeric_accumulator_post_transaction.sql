-- 0012_numeric_accumulator_post_transaction.sql
-- Fixes potential BIGINT overflow in post_transaction accumulator.
--
-- Problem (WR-02): In 0010_fix_validation_order.sql the accumulator variable
-- v_signed_sum is declared as BIGINT. While the per-posting positivity check (0010)
-- prevents BIGINT_MIN from reaching the accumulator, two individually valid large
-- postings can still overflow: e.g. two debit postings of 4_611_686_018_427_387_904
-- cents each sum to 9_223_372_036_854_775_808 which exceeds BIGINT_MAX (…807).
-- PostgreSQL raises SQLSTATE 22003 (numeric_value_out_of_range) rather than P0001,
-- breaking the invariant that all post_transaction validation errors use ERRCODE P0001.
--
-- Fix: Use NUMERIC for the accumulator (intermediate calculation only; BIGINT storage
-- in postings is unchanged). NUMERIC has no fixed overflow limit, so accumulation
-- cannot raise 22003. The final balance check (v_signed_sum <> 0) is unaffected —
-- zero is representable in both types. No range check on the sum is needed because
-- the only semantically valid result is zero (any non-zero sum is a balance error).
--
-- Supersedes: 0003_post_transaction.sql, 0008_post_transaction_idempotency_race.sql,
--             0010_fix_validation_order.sql
-- See: CLAUDE.md Invariant #2 (double-entry), Invariant #5 (isolation)
-- See: WR-02 review finding in 02-REVIEW.md

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
  v_signed_sum  numeric := 0;   -- WR-02: numeric accumulator prevents BIGINT overflow
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
  -- CR-01 fix (0010): validate amount_cents > 0 BEFORE the direction branch so no
  -- arithmetic is performed on invalid inputs (prevents BIGINT_MIN overflow).
  -- WR-02 fix (0012): accumulator is numeric so large-but-individually-valid
  -- amounts cannot overflow during accumulation.
  FOREACH v_rec IN ARRAY p_postings LOOP
    -- Validate amount_cents FIRST — before any arithmetic.
    IF v_rec.amount_cents <= 0 THEN
      RAISE EXCEPTION
        'post_transaction: amount_cents must be positive, got %',
        v_rec.amount_cents
        USING ERRCODE = 'P0001';
    END IF;

    -- Now safe to accumulate (numeric; no overflow possible).
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
