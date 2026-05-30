-- DEV SEED ONLY. Do NOT run as part of pnpm db:migrate production path.
-- Run via: pnpm db:seed
-- Creates: 1 owner ref ('seed-owner'), 2 accounts (asset + liability), 1 balanced transaction
--          via post_transaction — never direct INSERT into postings.
--
-- See: CLAUDE.md Invariant #1 (append-only postings — sole write path via post_transaction)
-- See: CLAUDE.md Invariant #2 (double-entry balance enforced by post_transaction)
-- See: FND-14 (dev seed script)

DO $$
DECLARE
  v_asset_id     uuid := gen_random_uuid();
  v_liability_id uuid := gen_random_uuid();
  v_tx_id        uuid;
BEGIN
  -- Insert two accounts: 1 asset (Cash) + 1 liability (Revenue Payable) for owner 'seed-owner'.
  INSERT INTO accounts (id, type, metadata, owner_ref, created_at)
  VALUES (
    v_asset_id,
    'asset',
    '{"name":"Cash"}'::jsonb,
    'seed-owner',
    now()
  ),
  (
    v_liability_id,
    'liability',
    '{"name":"Revenue Payable"}'::jsonb,
    'seed-owner',
    now()
  );

  -- NEVER INSERT INTO postings DIRECTLY. Always use post_transaction.
  -- Per CLAUDE.md Invariant #1: post_transaction is the sole write path into postings.
  SELECT post_transaction(
    'seed-tx-001',
    'Initial seed transaction',
    'seed',
    '{"note":"dev seed"}'::jsonb,
    ARRAY[
      ROW(v_asset_id,     1000::bigint, 'debit' )::posting_input,
      ROW(v_liability_id, 1000::bigint, 'credit')::posting_input
    ]
  ) INTO v_tx_id;

  RAISE NOTICE 'Seed complete. asset_account_id=%, liability_account_id=%, transaction_id=%',
    v_asset_id, v_liability_id, v_tx_id;
END $$;
