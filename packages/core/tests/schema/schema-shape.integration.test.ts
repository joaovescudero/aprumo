// Schema-shape integration tests (RED path — written before schema.ts implementation).
// Per D-37: schema-per-file isolation via createTestDb(import.meta.url).
// Per plan 02-02: these tests verify the DDL produced by drizzle-kit generate
// against a real Postgres container. They will be RED until schema.ts + migrations exist.
//
// Wave dependency: createTestDb helper provided by Plan 08 (already completed).
// These tests will be GREEN after Plan 02-02 Task 2 generates 0000_init_tables.sql.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../helpers/createTestDb.js";

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb(import.meta.url);
});

afterAll(async () => {
  await db.cleanup();
});

describe("accounts table", () => {
  it("has correct columns", async () => {
    const result = await db.migration.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'accounts'
      ORDER BY column_name
    `);
    const columns = result.rows.map((r) => r.column_name);
    expect(columns).toContain("id");
    expect(columns).toContain("type");
    expect(columns).toContain("metadata");
    expect(columns).toContain("owner_ref");
    expect(columns).toContain("created_at");
  });

  it("has account_type CHECK constraint", async () => {
    const result = await db.migration.query<{ conname: string; contype: string }>(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = (
        SELECT oid FROM pg_class
        WHERE relname = 'accounts' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
      )
        AND contype = 'c'
    `);
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    const constraintNames = result.rows.map((r) => r.conname);
    // At least one CHECK constraint on accounts (for the type enum)
    expect(
      constraintNames.some(
        (n) => n.includes("type") || n.includes("check") || n.includes("accounts"),
      ),
    ).toBe(true);
  });
});

describe("transactions table", () => {
  it("has idempotency_key that is NOT NULL", async () => {
    const result = await db.migration.query<{ column_name: string; is_nullable: string }>(`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'transactions'
        AND column_name = 'idempotency_key'
    `);
    expect(result.rows.length).toBe(1);
    const col = result.rows[0];
    expect(col).toBeDefined();
    expect(col!.is_nullable).toBe("NO");
  });

  it("has UNIQUE constraint on idempotency_key", async () => {
    const result = await db.migration.query<{ conname: string; contype: string }>(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = (
        SELECT oid FROM pg_class
        WHERE relname = 'transactions' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
      )
        AND contype = 'u'
    `);
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("postings table", () => {
  it("has amount_cents with bigint data type", async () => {
    const result = await db.migration.query<{ column_name: string; data_type: string }>(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'postings'
        AND column_name = 'amount_cents'
    `);
    expect(result.rows.length).toBe(1);
    const col = result.rows[0];
    expect(col).toBeDefined();
    expect(col!.data_type).toBe("bigint");
  });

  it("has direction CHECK constraint", async () => {
    const result = await db.migration.query<{ conname: string; contype: string }>(`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = (
        SELECT oid FROM pg_class
        WHERE relname = 'postings' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
      )
        AND contype = 'c'
    `);
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
  });
});

describe("raw_events table", () => {
  it("has UNIQUE constraint on (provider, provider_event_id)", async () => {
    const result = await db.migration.query<{
      columns: string[];
      conname: string;
      contype: string;
    }>(`
      SELECT c.conname, c.contype, array_agg(a.attname ORDER BY a.attnum) AS columns
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.conrelid = (
        SELECT oid FROM pg_class
        WHERE relname = 'raw_events' AND relnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema())
      )
        AND c.contype = 'u'
      GROUP BY c.conname, c.contype
    `);
    expect(result.rows.length).toBeGreaterThanOrEqual(1);
    // The composite unique should include provider and provider_event_id
    const hasComposite = result.rows.some(
      (r) => r.columns.includes("provider") && r.columns.includes("provider_event_id"),
    );
    expect(hasComposite).toBe(true);
  });
});

describe("account_balance table", () => {
  it("has pending_balance as nullable bigint", async () => {
    const result = await db.migration.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'account_balance'
        AND column_name = 'pending_balance'
    `);
    expect(result.rows.length).toBe(1);
    const col = result.rows[0];
    expect(col).toBeDefined();
    expect(col!.data_type).toBe("bigint");
    expect(col!.is_nullable).toBe("YES");
  });

  it("has available_balance as nullable bigint", async () => {
    const result = await db.migration.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
    }>(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = 'account_balance'
        AND column_name = 'available_balance'
    `);
    expect(result.rows.length).toBe(1);
    const col = result.rows[0];
    expect(col).toBeDefined();
    expect(col!.data_type).toBe("bigint");
    expect(col!.is_nullable).toBe("YES");
  });
});

describe("audit shadow tables", () => {
  it("all three audit tables exist", async () => {
    const result = await db.migration.query<{ table_name: string }>(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = current_schema()
        AND table_name IN ('accounts_audit', 'outbound_endpoints_audit', 'outbound_events_audit')
      ORDER BY table_name
    `);
    expect(result.rows.length).toBe(3);
    const names = result.rows.map((r) => r.table_name);
    expect(names).toContain("accounts_audit");
    expect(names).toContain("outbound_endpoints_audit");
    expect(names).toContain("outbound_events_audit");
  });
});
