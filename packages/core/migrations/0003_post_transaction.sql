-- 0003_post_transaction.sql
-- Defines the composite input type and the post_transaction SECURITY DEFINER function.
-- See: CLAUDE.md Invariant #2 (double-entry balanced) + Invariant #3 (idempotency)
-- See: FND-09 — post_transaction is the sole INSERT path into postings
-- See: RESEARCH.md Pattern 2 — SECURITY DEFINER function skeleton
--
-- SECURITY DEFINER: function runs as its owner (aprumo_migration, which has INSERT on postings)
-- even when called by aprumo_app (which has EXECUTE on the function but NO direct INSERT on postings).
-- This is the sole write path — closing the INSERT path at the DB layer (not just convention).
--
-- SET search_path = public: prevents search_path injection by a malicious caller (T-2-04).

-- ─────────────────────────────────────────────────────────────────────────────
-- Section A: Composite input type
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE posting_input AS (
  account_id    uuid,
  amount_cents  bigint,
  direction     text    -- 'debit' | 'credit'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- Section B: post_transaction function
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- Idempotency guard: if key already exists, return the existing transaction_id.
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
  v_tx_id := gen_random_uuid();
  INSERT INTO transactions (id, idempotency_key, ts, description, source, metadata)
  VALUES (v_tx_id, p_idempotency_key, now(), p_description, p_source, p_metadata);

  -- Atomically insert all postings.
  -- SECURITY DEFINER ensures this INSERT succeeds even though aprumo_app has no
  -- direct INSERT privilege on postings — the function runs as aprumo_migration.
  FOREACH v_rec IN ARRAY p_postings LOOP
    INSERT INTO postings (id, transaction_id, account_id, amount_cents, direction)
    VALUES (gen_random_uuid(), v_tx_id, v_rec.account_id, v_rec.amount_cents, v_rec.direction);
  END LOOP;

  RETURN v_tx_id;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Section C: Ownership + grants
-- ─────────────────────────────────────────────────────────────────────────────

-- Function must be owned by aprumo_migration so SECURITY DEFINER runs with its rights.
-- (The role that created it via migration is the superuser, so we explicitly transfer.)
ALTER FUNCTION post_transaction(text, text, text, jsonb, posting_input[])
  OWNER TO aprumo_migration;

-- Grant EXECUTE to aprumo_app — this is the only privilege aprumo_app needs on postings.
-- DO NOT grant INSERT ON postings to aprumo_app here or anywhere (sole write path invariant).
GRANT EXECUTE ON FUNCTION post_transaction(text, text, text, jsonb, posting_input[])
  TO aprumo_app;
