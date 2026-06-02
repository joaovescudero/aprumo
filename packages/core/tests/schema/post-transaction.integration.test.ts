// post_transaction integration tests (RED path — written before 0003_post_transaction.sql exists).
// Per D-39: db.app pool connects as aprumo_app; db.migration pool connects as container superuser.
// Per FND-09: post_transaction is the sole INSERT path into postings; validates double-entry balance.
// Per CLAUDE.md Invariant #2: every accounting transaction must have SUM(signed amount) = 0.
// Per CLAUDE.md Invariant #3: duplicate idempotency_key returns existing tx without error.
// Per CLAUDE.md Invariant #1: aprumo_app must not INSERT into postings directly (only via function).
//
// Wave dependency: createTestDb helper from Plan 08 (completed). Migration 0003 from Plan 04 (this plan).
// Tests are RED until 0003_post_transaction.sql is applied via createTestDb.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../helpers/createTestDb.js";

let db: TestDb;

// UUIDs for test accounts — seeded in beforeAll via db.migration
let account1Id: string;
let account2Id: string;

beforeAll(async () => {
  db = await createTestDb(import.meta.url);

  // IN-03 guard: verify that migration 0007_revoke_insert_append_only was applied.
  // The immutability tests below depend on aprumo_app having INSERT revoked on
  // postings/raw_events (SQLSTATE 42501). Without 0007, those INSERT calls would
  // succeed (not fail), causing confusing "Expected promise to reject, but it resolved"
  // failures. This guard surfaces the missing migration as the root cause.
  try {
    await db.app.query(
      `INSERT INTO postings (id, transaction_id, account_id, amount_cents, direction)
       VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'debit')`,
    );
    throw new Error(
      "beforeAll guard: aprumo_app could INSERT directly into postings — " +
        "migration 0007_revoke_insert_append_only has not been applied. " +
        "The immutability tests will fail or produce incorrect results.",
    );
  } catch (err: unknown) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code !== "42501"
    ) {
      // Re-throw unexpected errors (e.g. connection failure or our sentinel Error above).
      throw err;
    }
    // code === "42501" is expected — 0007 is applied and the guard passes.
  }

  // Seed 2 accounts via migration role (aprumo_app cannot INSERT into accounts directly
  // until grants are confirmed, but migration role always can).
  // Using gen_random_uuid() inside the query for PG-side UUID generation.
  const result = await db.migration.query<{ id: string }>(
    `INSERT INTO accounts (id, type, metadata, owner_ref, created_at)
     VALUES
       (gen_random_uuid(), 'asset',     '{}'::jsonb, 'test', now()),
       (gen_random_uuid(), 'liability', '{}'::jsonb, 'test', now())
     RETURNING id`,
  );

  const rows = result.rows;
  if (rows.length !== 2) {
    throw new Error(`Expected 2 accounts, got ${rows.length}`);
  }
  account1Id = rows[0]!.id;
  account2Id = rows[1]!.id;
});

afterAll(async () => {
  await db.cleanup();
});

describe("post_transaction — FND-09 + CLAUDE.md Invariants #1, #2, #3", () => {
  describe("success path", () => {
    it("balanced postings return a UUID transaction id", async () => {
      const idempotencyKey = randomUUID();
      const result = await db.app.query<{ post_transaction: string }>(
        `SELECT post_transaction(
          $1,
          'test transaction',
          'manual',
          '{}'::jsonb,
          ARRAY[
            ROW($2, 100, 'debit')::posting_input,
            ROW($3, 100, 'credit')::posting_input
          ]
        )`,
        [idempotencyKey, account1Id, account2Id],
      );

      const txId = result.rows[0]?.post_transaction;
      expect(txId).toBeDefined();
      // UUID v4 regex
      expect(txId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });
  });

  describe("idempotency", () => {
    it("duplicate idempotency_key returns the same UUID without error", async () => {
      const idempotencyKey = randomUUID();
      const sql = `SELECT post_transaction(
        $1,
        'idempotency test',
        'manual',
        '{}'::jsonb,
        ARRAY[
          ROW($2, 50, 'debit')::posting_input,
          ROW($3, 50, 'credit')::posting_input
        ]
      )`;
      const params = [idempotencyKey, account1Id, account2Id];

      const first = await db.app.query<{ post_transaction: string }>(sql, params);
      const second = await db.app.query<{ post_transaction: string }>(sql, params);

      const firstId = first.rows[0]?.post_transaction;
      const secondId = second.rows[0]?.post_transaction;

      expect(firstId).toBeDefined();
      expect(secondId).toBeDefined();
      expect(firstId).toBe(secondId);
    });
  });

  describe("error paths — ERRCODE P0001", () => {
    it("unbalanced postings (debit 100, credit 50) → P0001 with 'do not balance'", async () => {
      await expect(
        db.app.query(
          `SELECT post_transaction(
            $1,
            'unbalanced test',
            'manual',
            '{}'::jsonb,
            ARRAY[
              ROW($2, 100, 'debit')::posting_input,
              ROW($3, 50, 'credit')::posting_input
            ]
          )`,
          [randomUUID(), account1Id, account2Id],
        ),
      ).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining("do not balance"),
      });
    });

    it("empty postings array → P0001 with 'must not be empty'", async () => {
      await expect(
        db.app.query(
          `SELECT post_transaction(
            $1,
            'empty array test',
            'manual',
            '{}'::jsonb,
            ARRAY[]::posting_input[]
          )`,
          [randomUUID()],
        ),
      ).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining("must not be empty"),
      });
    });

    it("invalid direction → P0001 with 'invalid direction'", async () => {
      await expect(
        db.app.query(
          `SELECT post_transaction(
            $1,
            'invalid direction test',
            'manual',
            '{}'::jsonb,
            ARRAY[
              ROW($2, 100, 'invalid')::posting_input,
              ROW($3, 100, 'credit')::posting_input
            ]
          )`,
          [randomUUID(), account1Id, account2Id],
        ),
      ).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining("invalid direction"),
      });
    });

    it("zero amount_cents → P0001 with 'must be positive'", async () => {
      await expect(
        db.app.query(
          `SELECT post_transaction(
            $1,
            'zero amount test',
            'manual',
            '{}'::jsonb,
            ARRAY[
              ROW($2, 0, 'debit')::posting_input,
              ROW($3, 0, 'credit')::posting_input
            ]
          )`,
          [randomUUID(), account1Id, account2Id],
        ),
      ).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining("must be positive"),
      });
    });

    it("negative amount_cents as CREDIT → P0001 before arithmetic overflow (CR-01 validation order)", async () => {
      // CR-01: Without the validation-order fix, a negative amount_cents on a CREDIT
      // posting causes `v_signed_sum - amount_cents` to be computed BEFORE the
      // amount_cents <= 0 check runs. For BIGINT_MIN (-9223372036854775808) as a credit,
      // `0 - (-9223372036854775808)` overflows BIGINT and raises a PostgreSQL numeric
      // error instead of the expected P0001.
      //
      // Migration 0010_fix_validation_order moves the positivity check BEFORE
      // accumulation so any negative input raises P0001 "must be positive" cleanly.
      //
      // RED before 0010 is applied: may get an arithmetic error (22003) instead of P0001.
      // GREEN after 0010: raises P0001 with 'must be positive'.
      const BIGINT_MIN = "-9223372036854775808";
      await expect(
        db.app.query(
          `SELECT post_transaction(
            $1,
            'bigint overflow guard test',
            'manual',
            '{}'::jsonb,
            ARRAY[
              ROW($2, ${BIGINT_MIN}::bigint, 'credit')::posting_input,
              ROW($3, 100, 'debit')::posting_input
            ]
          )`,
          [randomUUID(), account1Id, account2Id],
        ),
      ).rejects.toMatchObject({
        code: "P0001",
        message: expect.stringContaining("must be positive"),
      });
    });
  });

  describe("immutability — sole write path enforcement (CLAUDE.md Invariant #1)", () => {
    it("aprumo_app direct INSERT into postings → permission denied (42501)", async () => {
      // aprumo_app has INSERT revoked on postings (migration 0007_revoke_insert_append_only).
      // The sole write path invariant is enforced at the DB privilege layer:
      // only post_transaction (SECURITY DEFINER, owned by aprumo_migration) can INSERT.
      // Attempting a direct INSERT as aprumo_app must raise 42501 (insufficient_privilege).
      await expect(
        db.app.query(
          `INSERT INTO postings (id, transaction_id, account_id, amount_cents, direction)
           VALUES (gen_random_uuid(), gen_random_uuid(), $1, 100, 'debit')`,
          [account1Id],
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("aprumo_app direct INSERT into raw_events → permission denied (42501)", async () => {
      // aprumo_app has INSERT revoked on raw_events (migration 0007_revoke_insert_append_only).
      // Only application code running as aprumo_migration (or via a SECURITY DEFINER function)
      // may insert into raw_events. Direct INSERT as aprumo_app must raise 42501.
      await expect(
        db.app.query(
          `INSERT INTO raw_events (id, provider, provider_event_id, received_at, payload_jsonb)
           VALUES (gen_random_uuid(), 'test', 'evt-001', now(), '{}'::jsonb)`,
        ),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });
});
