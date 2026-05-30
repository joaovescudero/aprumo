// REVOKE enforcement integration tests (RED path — written before 0001_roles.sql / 0002_grants.sql exist).
// Per D-39: db.app pool connects as aprumo_app; db.migration pool connects as container superuser.
// Per FND-08: aprumo_app must receive SQLSTATE 42501 on UPDATE or DELETE against postings / raw_events.
// Per CLAUDE.md Invariant #1: these tables are append-only; the role boundary enforces immutability.
//
// Wave dependency: createTestDb helper from Plan 08 (completed). Migrations 0001/0002 from Plan 03 (this plan).
// Tests are RED until 0001_roles.sql + 0002_grants.sql are applied via createTestDb.
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
