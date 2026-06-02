// REVOKE enforcement integration tests (RED path — written before 0001_roles.sql / 0002_grants.sql exist).
// Per D-39: db.app pool connects as aprumo_app; db.migration pool connects as container superuser.
// Per FND-08: aprumo_app must receive SQLSTATE 42501 on UPDATE or DELETE against postings / raw_events.
// Per CLAUDE.md Invariant #1: these tables are append-only; the role boundary enforces immutability.
//
// INSERT policy (per CLAUDE.md role spec + CR-01 fix):
//   - postings: INSERT revoked (sole write path = post_transaction SECURITY DEFINER, migration 0007)
//   - raw_events: INSERT GRANTED (restored by migration 0014 per "SELECT/INSERT em todas" spec)
//
// Wave dependency: createTestDb helper from Plan 08 (completed). Migrations 0001/0002 from Plan 03 (this plan).
// Tests are RED until 0001_roles.sql + 0002_grants.sql are applied via createTestDb.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../helpers/createTestDb.js";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb(import.meta.url);
});

afterAll(async () => {
  await db.cleanup();
});

describe("REVOKE enforcement — aprumo_app cannot mutate append-only tables (FND-08)", () => {
  describe("postings table", () => {
    it("aprumo_app UPDATE postings → SQLSTATE 42501", async () => {
      await expect(
        db.app.query("UPDATE postings SET amount_cents = 0 WHERE id = gen_random_uuid()"),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("aprumo_app DELETE postings → SQLSTATE 42501", async () => {
      await expect(
        db.app.query("DELETE FROM postings WHERE id = gen_random_uuid()"),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  describe("raw_events table", () => {
    it("aprumo_app UPDATE raw_events → SQLSTATE 42501", async () => {
      await expect(
        db.app.query("UPDATE raw_events SET status = 'failed' WHERE id = gen_random_uuid()"),
      ).rejects.toMatchObject({ code: "42501" });
    });

    it("aprumo_app DELETE raw_events → SQLSTATE 42501", async () => {
      await expect(
        db.app.query("DELETE FROM raw_events WHERE id = gen_random_uuid()"),
      ).rejects.toMatchObject({ code: "42501" });
    });
  });

  describe("aprumo_migration role retains read access", () => {
    it("aprumo_migration can SELECT from accounts", async () => {
      const result = await db.migration.query<{ count: string }>("SELECT COUNT(*) FROM accounts");
      expect(result.rows[0]).toBeDefined();
      expect(Number(result.rows[0]?.count)).toBeGreaterThanOrEqual(0);
    });
  });
});

describe("INSERT privilege enforcement — sole write path (migration 0007 + 0014)", () => {
  // These tests verify the INSERT privilege model per CLAUDE.md role spec:
  //   "aprumo_app: SELECT/INSERT em todas; sem UPDATE/DELETE em postings/raw_events"
  // postings is the exception: INSERT is also revoked because the sole write path
  // is the post_transaction() SECURITY DEFINER function (migration 0007).
  // raw_events INSERT was incorrectly revoked by 0007 and restored by 0014.

  it("aprumo_app INSERT into postings → SQLSTATE 42501 (sole write path = post_transaction)", async () => {
    // postings INSERT is revoked from aprumo_app (migration 0007).
    // Only post_transaction() SECURITY DEFINER can INSERT into postings.
    // Per CLAUDE.md Invariant #1: direct INSERT by aprumo_app must be denied at DB layer.
    await expect(
      db.app.query(
        `INSERT INTO postings (id, transaction_id, account_id, amount_cents, direction)
         VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1, 'debit')`,
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });

  it("aprumo_app INSERT into raw_events → succeeds (SELECT/INSERT on all tables per CLAUDE.md)", async () => {
    // raw_events INSERT is GRANTED to aprumo_app per CLAUDE.md role spec (migration 0014).
    // Per CLAUDE.md Invariant #4: aprumo_app must INSERT raw_events in the same Postgres
    // transaction as pg-boss job enqueueing — this is the exact-once webhook pattern.
    // See ADR-003 for rationale.
    const eventId = randomUUID();
    await expect(
      db.app.query(
        `INSERT INTO raw_events (provider, provider_event_id, payload_jsonb)
         VALUES ('test', $1, '{}'::jsonb)`,
        [eventId],
      ),
    ).resolves.toBeDefined();
  });
});
