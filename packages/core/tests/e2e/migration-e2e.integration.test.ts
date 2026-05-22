// E2E Migration Integration Test — Phase 2 Gate (Plan 02-10, BLOCKING)
//
// Purpose: Prove that ALL migrations (0000–0005) apply correctly against a real Postgres
// container via createTestDb(), producing the correct schema, function, trigger, and
// permissions. This is Success Criterion 1 of Phase 2. If this test is red, Phase 2 is not done.
//
// Coverage:
//   - All 10 expected tables exist (FND-01..FND-06, FND-12, FND-16)
//   - REVOKE enforcement: aprumo_app cannot UPDATE/DELETE postings/raw_events (FND-08)
//   - Constraint trigger is DEFERRABLE INITIALLY DEFERRED (FND-11)
//   - post_transaction works end-to-end with balanced postings (FND-09)
//   - post_transaction rejects unbalanced postings with P0001 (CLAUDE.md Invariant #2)
//   - post_transaction is idempotent on duplicate idempotency_key (CLAUDE.md Invariant #3)
//
// Per D-39: db.app connects as aprumo_app (production path); db.migration as superuser.
// Per D-37: schema-per-file isolation via createTestDb(import.meta.url).
// Per CLAUDE.md: these invariants are non-negotiable — immutability, double-entry, idempotency.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../helpers/createTestDb.js";

let db: TestDb;

// Account UUIDs seeded in beforeAll for post_transaction tests
let assetAccountId: string;
let liabilityAccountId: string;

beforeAll(async () => {
  db = await createTestDb(import.meta.url);

  // Seed 2 accounts via the migration (superuser) pool for use in post_transaction tests.
  // Using migration role because aprumo_app needs GRANT to insert into accounts
  // (verifying its grant is done via other tests — here we use superuser for simplicity).
  const result = await db.migration.query<{ id: string }>(
    `INSERT INTO accounts (id, type, metadata, created_at)
     VALUES
       (gen_random_uuid(), 'asset',     '{}'::jsonb, now()),
       (gen_random_uuid(), 'liability', '{}'::jsonb, now())
     RETURNING id`,
  );

  const rows = result.rows;
  if (rows.length !== 2) {
    throw new Error(`E2E setup: expected 2 accounts, got ${rows.length}`);
  }
  assetAccountId = rows[0]!.id;
  liabilityAccountId = rows[1]!.id;
});

afterAll(async () => {
  await db.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 1: All tables exist after migration
// ─────────────────────────────────────────────────────────────────────────────
describe("All tables exist after migration (FND-01..FND-06)", () => {
  const EXPECTED_TABLES = [
    "accounts",
    "transactions",
    "postings",
    "raw_events",
    "account_balance",
    "outbound_endpoints",
    "outbound_events",
    "accounts_audit",
    "outbound_endpoints_audit",
    "outbound_events_audit",
  ] as const;

  it("all 10 ledger tables are present in the test schema", async () => {
    const result = await db.migration.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_type = 'BASE TABLE'
       ORDER BY table_name`,
    );
    const presentTables = result.rows.map((r) => r.table_name);

    for (const expected of EXPECTED_TABLES) {
      expect(presentTables, `Table '${expected}' is missing after migration`).toContain(expected);
    }
  });

  it("exactly the 10 expected tables exist (no unexpected tables)", async () => {
    const result = await db.migration.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = current_schema()
         AND table_type = 'BASE TABLE'
         AND table_name NOT LIKE '__drizzle%'
       ORDER BY table_name`,
    );
    const presentTables = result.rows.map((r) => r.table_name).sort();
    const expectedSorted = [...EXPECTED_TABLES].sort();
    expect(presentTables).toEqual(expectedSorted);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 2: FND-08 — REVOKE enforcement (aprumo_app cannot mutate append-only tables)
// ─────────────────────────────────────────────────────────────────────────────
describe("FND-08: REVOKE enforcement — aprumo_app cannot mutate append-only tables", () => {
  it("aprumo_app UPDATE postings → SQLSTATE 42501 (permission denied)", async () => {
    await expect(
      db.app.query("UPDATE postings SET amount_cents = 0 WHERE id = gen_random_uuid()"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("aprumo_app DELETE FROM raw_events → SQLSTATE 42501 (permission denied)", async () => {
    await expect(
      db.app.query("DELETE FROM raw_events WHERE id = gen_random_uuid()"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("aprumo_app DELETE FROM postings → SQLSTATE 42501 (permission denied)", async () => {
    await expect(
      db.app.query("DELETE FROM postings WHERE id = gen_random_uuid()"),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("aprumo_app UPDATE raw_events → SQLSTATE 42501 (permission denied)", async () => {
    await expect(
      db.app.query("UPDATE raw_events SET status = 'failed' WHERE id = gen_random_uuid()"),
    ).rejects.toMatchObject({ code: "42501" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 3: FND-11 — assert_double_entry trigger is DEFERRABLE INITIALLY DEFERRED
// ─────────────────────────────────────────────────────────────────────────────
describe("FND-11: assert_double_entry trigger is DEFERRABLE INITIALLY DEFERRED", () => {
  it("assert_double_entry row exists in pg_constraint for postings table", async () => {
    const result = await db.migration.query<{
      condeferrable: boolean;
      condeferred: boolean;
    }>(
      `SELECT condeferrable, condeferred
       FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       WHERE c.conname = 'assert_double_entry'
         AND r.relname = 'postings'`,
    );

    expect(
      result.rows[0],
      "assert_double_entry constraint must exist in pg_constraint for the postings table",
    ).toBeDefined();
  });

  it("assert_double_entry has condeferrable=true AND condeferred=true", async () => {
    const result = await db.migration.query<{
      condeferrable: boolean;
      condeferred: boolean;
    }>(
      `SELECT condeferrable, condeferred
       FROM pg_constraint c
       JOIN pg_class r ON r.oid = c.conrelid
       WHERE c.conname = 'assert_double_entry'
         AND r.relname = 'postings'`,
    );

    const row = result.rows[0];
    expect(row).toBeDefined();
    // DEFERRABLE INITIALLY DEFERRED:
    //   condeferrable=true  → constraint CAN be deferred
    //   condeferred=true    → constraint IS deferred by default (fires at COMMIT, not at statement end)
    expect(row?.condeferrable).toBe(true);
    expect(row?.condeferred).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 4: FND-09 — post_transaction works end-to-end
// ─────────────────────────────────────────────────────────────────────────────
describe("FND-09: post_transaction works end-to-end", () => {
  it("balanced postings insert a transaction and return a UUID", async () => {
    const idempotencyKey = randomUUID();
    const result = await db.app.query<{ post_transaction: string }>(
      `SELECT post_transaction(
        $1,
        'e2e migration test',
        'test',
        '{}'::jsonb,
        ARRAY[
          ROW($2, 100, 'debit')::posting_input,
          ROW($3, 100, 'credit')::posting_input
        ]
      )`,
      [idempotencyKey, assetAccountId, liabilityAccountId],
    );

    const txId = result.rows[0]?.post_transaction;
    expect(txId, "post_transaction must return a UUID").toBeDefined();
    expect(txId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  });

  it("postings are persisted to the postings table after a successful call", async () => {
    const idempotencyKey = randomUUID();
    const txResult = await db.app.query<{ post_transaction: string }>(
      `SELECT post_transaction(
        $1,
        'e2e persistence check',
        'test',
        '{}'::jsonb,
        ARRAY[
          ROW($2, 250, 'debit')::posting_input,
          ROW($3, 250, 'credit')::posting_input
        ]
      )`,
      [idempotencyKey, assetAccountId, liabilityAccountId],
    );

    const txId = txResult.rows[0]?.post_transaction;
    expect(txId).toBeDefined();

    // Verify exactly 2 postings were persisted (via migration/superuser pool)
    const postingsResult = await db.migration.query<{
      id: string;
      amount_cents: string;
      direction: string;
    }>(
      `SELECT id, amount_cents, direction
       FROM postings
       WHERE transaction_id = $1
       ORDER BY direction`,
      [txId],
    );

    expect(postingsResult.rows).toHaveLength(2);
    const amounts = postingsResult.rows.map((r) => Number(r.amount_cents));
    expect(amounts).toContain(250);
    const directions = postingsResult.rows.map((r) => r.direction);
    expect(directions).toContain("debit");
    expect(directions).toContain("credit");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 5: FND-09 — post_transaction rejects unbalanced postings
// ─────────────────────────────────────────────────────────────────────────────
describe("FND-09: post_transaction rejects unbalanced postings (CLAUDE.md Invariant #2)", () => {
  it("unbalanced postings (debit 100, credit 50) → rejects with ERRCODE P0001", async () => {
    await expect(
      db.app.query(
        `SELECT post_transaction(
          $1,
          'unbalanced e2e test',
          'test',
          '{}'::jsonb,
          ARRAY[
            ROW($2, 100, 'debit')::posting_input,
            ROW($3, 50,  'credit')::posting_input
          ]
        )`,
        [randomUUID(), assetAccountId, liabilityAccountId],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
  });

  it("empty postings array → rejects with ERRCODE P0001", async () => {
    await expect(
      db.app.query(
        `SELECT post_transaction(
          $1,
          'empty array e2e test',
          'test',
          '{}'::jsonb,
          ARRAY[]::posting_input[]
        )`,
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: "P0001" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Group 6: FND-11 — post_transaction idempotency
// ─────────────────────────────────────────────────────────────────────────────
describe("FND-11 / CLAUDE.md Invariant #3: post_transaction idempotency", () => {
  it("calling post_transaction twice with the same idempotency_key returns the same UUID and does not error", async () => {
    const idempotencyKey = randomUUID();
    const sql = `SELECT post_transaction(
      $1,
      'idempotency e2e test',
      'test',
      '{}'::jsonb,
      ARRAY[
        ROW($2, 75, 'debit')::posting_input,
        ROW($3, 75, 'credit')::posting_input
      ]
    )`;
    const params = [idempotencyKey, assetAccountId, liabilityAccountId];

    const first = await db.app.query<{ post_transaction: string }>(sql, params);
    const second = await db.app.query<{ post_transaction: string }>(sql, params);

    const firstId = first.rows[0]?.post_transaction;
    const secondId = second.rows[0]?.post_transaction;

    expect(firstId).toBeDefined();
    expect(secondId).toBeDefined();
    // Idempotent: same UUID returned both times — no duplicate transaction created.
    expect(firstId).toBe(secondId);

    // Verify only ONE transaction exists for this idempotency key
    const txCount = await db.migration.query<{ count: string }>(
      `SELECT COUNT(*) AS count FROM transactions WHERE idempotency_key = $1`,
      [idempotencyKey],
    );
    expect(Number(txCount.rows[0]?.count)).toBe(1);
  });
});
