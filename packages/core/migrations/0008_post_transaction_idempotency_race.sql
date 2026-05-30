-- 0008_post_transaction_idempotency_race.sql
-- Replaces post_transaction with a race-safe idempotency implementation.
--
-- Problem: 0003_post_transaction.sql uses a SELECT-then-INSERT pattern with no
-- concurrent-duplicate handler. Two simultaneous calls with the same
-- p_idempotency_key can both pass the SELECT guard (FOUND = false), both race
-- to INSERT into transactions, and the loser raises SQLSTATE 23505
-- (unique_violation). This violates CLAUDE.md Invariant #3: "Duplicatas retornam
-- 200 OK sem reprocessar — nunca falham com erro."
--
-- Fix: Wrap the transactions INSERT in a nested BEGIN/EXCEPTION WHEN
-- unique_violation block. The losing concurrent call catches the exception,
-- re-fetches the winner's row, and returns that id — exactly as if it had won.
-- Postings are only inserted by the call that wins the INSERT race; the loser
-- returns early with the winner's transaction id.
--
-- See: CLAUDE.md Invariant #3 (idempotency)
-- See: 0003_post_transaction.sql (replaced by this migration)

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
  FOREACH v_rec IN ARRAY p_postings LOOP
    -- Validate direction first (P0001 if unknown direction).
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

    -- Validate amount_cents is strictly positive (no zero or negative amounts).
    IF v_rec.amount_cents <= 0 THEN
      RAISE EXCEPTION
        'post_transaction: amount_cents must be positive, got %',
        v_rec.amount_cents
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
