// constraint trigger integration tests (RED path — written before 0005_double_entry_trigger.sql exists).
// Per D-39: db.migration pool connects as container superuser — can query pg_constraint catalog.
// Per FND-10: assert_double_entry is a CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED.
// Per FND-11: CI queries pg_constraint and asserts condeferrable=true AND condeferred=true.
// Per CLAUDE.md Invariant #2: every accounting transaction must have SUM(signed amount) = 0.
//
// Note on migration numbering: plan originally specified 0004_double_entry_trigger.sql, but plan 02-06
// (audit triggers) landed at idx=4 during parallel execution. This migration lands at idx=5 as
// 0005_double_entry_trigger.sql.
//
// Wave dependency: createTestDb helper from Plan 08 (completed). Migration 0005 from Plan 05 (this plan).
// Tests are RED until 0005_double_entry_trigger.sql is applied via createTestDb.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../helpers/createTestDb.js";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb(import.meta.url);
});

afterAll(async () => {
  await db.cleanup();
});

describe("assert_double_entry constraint trigger — FND-10 + FND-11", () => {
  describe("pg_constraint catalog — FND-11", () => {
    it("assert_double_entry trigger row exists in pg_constraint for postings table", async () => {
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

      // Row must exist — trigger was created by migration
      expect(result.rows[0]).toBeDefined();
    });

    it("assert_double_entry has condeferrable=true AND condeferred=true (DEFERRABLE INITIALLY DEFERRED)", async () => {
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
      // DEFERRABLE INITIALLY DEFERRED means both flags must be true.
      // condeferrable=true: the constraint can be deferred.
      // condeferred=true: it is deferred by default (fires at COMMIT, not at statement end).
      expect(row?.condeferrable).toBe(true);
      expect(row?.condeferred).toBe(true);
    });
  });
});
