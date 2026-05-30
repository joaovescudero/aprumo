// audit trigger integration tests (RED path — written before 0005_audit_triggers.sql exists).
// Per D-39: db.app pool connects as aprumo_app; db.migration pool connects as container superuser.
// Per CLAUDE.md Invariant #6: any mutable table has a shadow *_audit table populated by AFTER UPDATE/DELETE trigger.
// Per 02-06-PLAN.md must_haves: audit_row_change() function + triggers on accounts, outbound_endpoints, outbound_events.
// postings and raw_events are append-only — they must NOT have audit triggers.
//
// Wave dependency: createTestDb helper from Plan 08 (completed). Migration 0005 from Plan 06 (this plan).
// Tests are RED until 0005_audit_triggers.sql is applied via createTestDb.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../helpers/createTestDb.js";

let db: TestDb;

// UUID of an account created in beforeAll for UPDATE/DELETE tests
let accountId: string;
// UUID of an outbound_endpoint created in beforeAll
let endpointId: string;

beforeAll(async () => {
  db = await createTestDb(import.meta.url);

  // Seed 1 account via migration role
  const accountResult = await db.migration.query<{ id: string }>(
    `INSERT INTO accounts (id, type, metadata, owner_ref, created_at)
     VALUES (gen_random_uuid(), 'asset', '{}'::jsonb, 'test-owner', now())
     RETURNING id`,
  );
  const firstAccount = accountResult.rows[0];
  if (!firstAccount) {
    throw new Error("Failed to seed test account");
  }
  accountId = firstAccount.id;

  // Seed 1 outbound_endpoint via migration role
  const endpointResult = await db.migration.query<{ id: string }>(
    `INSERT INTO outbound_endpoints (id, customer_id, url, secret_hash, active, created_at)
     VALUES (gen_random_uuid(), 'cust-001', 'https://example.com/hook', 'sha256-abc', true, now())
     RETURNING id`,
  );
  const firstEndpoint = endpointResult.rows[0];
  if (!firstEndpoint) {
    throw new Error("Failed to seed test outbound_endpoint");
  }
  endpointId = firstEndpoint.id;
});

afterAll(async () => {
  await db.cleanup();
});

describe("audit triggers — FND-06 + CLAUDE.md Invariant #6", () => {
  describe("accounts audit trigger — AFTER UPDATE", () => {
    it("UPDATE on accounts creates a row in accounts_audit with operation=UPDATE, changed_by, changed_at, old_data", async () => {
      // Perform the UPDATE using migration role (superuser can mutate accounts)
      await db.migration.query(
        `UPDATE accounts SET metadata = '{"updated": true}'::jsonb WHERE id = $1`,
        [accountId],
      );

      const result = await db.migration.query<{
        operation: string;
        changed_by: string;
        changed_at: string;
        old_data: Record<string, unknown>;
        new_data: Record<string, unknown>;
        table_name: string;
      }>(
        `SELECT table_name, operation, changed_by, changed_at, old_data, new_data
         FROM accounts_audit
         WHERE old_data->>'id' = $1
           AND operation = 'UPDATE'
         LIMIT 1`,
        [accountId],
      );

      const row = result.rows[0];
      expect(row).toBeDefined();
      expect(row?.table_name).toBe("accounts");
      expect(row?.operation).toBe("UPDATE");
      expect(row?.changed_by).not.toBeNull();
      expect(row?.changed_by).toBeTruthy();
      expect(row?.changed_at).not.toBeNull();
      expect(row?.old_data).not.toBeNull();
    });
  });

  describe("accounts audit trigger — AFTER DELETE", () => {
    it("DELETE on accounts creates a row in accounts_audit with operation=DELETE and old_data", async () => {
      // Create a separate account to delete (we don't want to delete accountId used in other tests)
      const deleteResult = await db.migration.query<{ id: string }>(
        `INSERT INTO accounts (id, type, metadata, owner_ref, created_at)
         VALUES (gen_random_uuid(), 'expense', '{}'::jsonb, 'delete-test-owner', now())
         RETURNING id`,
      );
      const toDelete = deleteResult.rows[0];
      if (!toDelete) {
        throw new Error("Failed to create account for delete test");
      }
      const deleteId = toDelete.id;

      // Perform the DELETE
      await db.migration.query(`DELETE FROM accounts WHERE id = $1`, [deleteId]);

      const result = await db.migration.query<{
        operation: string;
        changed_by: string;
        changed_at: string;
        old_data: Record<string, unknown>;
        new_data: unknown;
      }>(
        `SELECT operation, changed_by, changed_at, old_data, new_data
         FROM accounts_audit
         WHERE old_data->>'id' = $1
           AND operation = 'DELETE'
         LIMIT 1`,
        [deleteId],
      );

      const row = result.rows[0];
      expect(row).toBeDefined();
      expect(row?.operation).toBe("DELETE");
      expect(row?.changed_by).toBeTruthy();
      expect(row?.changed_at).not.toBeNull();
      expect(row?.old_data).not.toBeNull();
      // For DELETE, new_data should be NULL
      expect(row?.new_data).toBeNull();
    });
  });

  describe("accounts audit trigger — INSERT does NOT create audit row", () => {
    it("INSERT on accounts does NOT create a row in accounts_audit", async () => {
      // Count audit rows before
      const before = await db.migration.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM accounts_audit WHERE operation = 'INSERT'`,
      );
      const countBefore = Number(before.rows[0]?.count ?? 0);

      // Perform the INSERT
      await db.migration.query(
        `INSERT INTO accounts (id, type, metadata, owner_ref, created_at)
         VALUES (gen_random_uuid(), 'revenue', '{}'::jsonb, 'insert-test-owner', now())`,
      );

      // Count audit rows after — should remain the same (no INSERT trigger)
      const after = await db.migration.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM accounts_audit WHERE operation = 'INSERT'`,
      );
      const countAfter = Number(after.rows[0]?.count ?? 0);

      expect(countAfter).toBe(countBefore);
    });
  });

  describe("outbound_endpoints audit trigger exists", () => {
    it("outbound_endpoints_audit_trigger exists in pg_trigger", async () => {
      const result = await db.migration.query<{ tgname: string }>(
        `SELECT tgname
         FROM pg_trigger
         WHERE tgname = 'outbound_endpoints_audit_trigger'
           AND tgrelid = 'outbound_endpoints'::regclass`,
      );

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0]?.tgname).toBe("outbound_endpoints_audit_trigger");
    });
  });

  describe("postings has NO audit trigger — append-only table", () => {
    it("postings table has zero audit triggers (CLAUDE.md Invariant #6: only mutable tables)", async () => {
      const result = await db.migration.query<{ count: string }>(
        `SELECT COUNT(*) AS count
         FROM pg_trigger
         WHERE tgrelid = 'postings'::regclass
           AND tgname LIKE '%audit%'`,
      );

      const count = Number(result.rows[0]?.count ?? 0);
      expect(count).toBe(0);
    });
  });
});
