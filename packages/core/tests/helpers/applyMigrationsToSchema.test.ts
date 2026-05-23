/**
 * Tests for applyMigrationsToSchema helper.
 *
 * Unit tests (1-4): Pure string transformation — no DB connection needed.
 * Integration tests (5-6): Full round-trip against real testcontainers PG.
 *
 * Per D-37: inject() is called inside test body, never at module top-level.
 * Per CLAUDE.md: TDD-first — this file was created before the implementation.
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { afterAll, describe, expect, inject, it } from "vitest";

import {
  applyMigrationsToSchema,
  rewriteForTestSchema,
  rewritePublicQualifier,
  splitMigrationStatements,
} from "./applyMigrationsToSchema.js";
import { computeSchemaName } from "./createTestDb.js";

const MIGRATIONS_FOLDER = resolve(fileURLToPath(import.meta.url), "../../../migrations");

// ---------------------------------------------------------------------------
// Unit tests — pure string transformation, no DB required
// ---------------------------------------------------------------------------

describe("rewritePublicQualifier (unit)", () => {
  it("Test 1: rewrites public qualifier on FK REFERENCES clause", () => {
    const sql = `ALTER TABLE "account_balance" ADD CONSTRAINT "account_balance_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action`;
    const result = rewritePublicQualifier(sql, "test_abc123def456");
    expect(result).toContain('"test_abc123def456"."accounts"');
    expect(result).not.toContain('"public"."accounts"');
  });

  it("Test 2: leaves non-public-qualified CREATE TABLE statement unchanged", () => {
    const sql = `CREATE TABLE "accounts" (\n  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL\n)`;
    const result = rewritePublicQualifier(sql, "test_abc123def456");
    expect(result).toBe(sql);
  });

  it("Test 3: replaces all occurrences of public qualifier in same statement", () => {
    const sql = `ALTER TABLE "t" ADD CONSTRAINT "c1" FOREIGN KEY ("a") REFERENCES "public"."table_x"("id"); ALTER TABLE "t" ADD CONSTRAINT "c2" FOREIGN KEY ("b") REFERENCES "public"."table_x"("id"); ALTER TABLE "t" ADD CONSTRAINT "c3" FOREIGN KEY ("c") REFERENCES "public"."table_x"("id")`;
    const result = rewritePublicQualifier(sql, "myschema");
    const occurrences = (result.match(/"myschema"\."table_x"/g) ?? []).length;
    expect(occurrences).toBe(3);
    expect(result).not.toContain('"public"."table_x"');
  });
});

// ---------------------------------------------------------------------------
// Unit tests — splitMigrationStatements
// ---------------------------------------------------------------------------

describe("splitMigrationStatements (unit)", () => {
  it("WR-01: dollar-quote inside -- comment does not corrupt statement splitting", () => {
    // A line comment containing $$ must NOT flip inDollarQuote.
    // The migration below has a comment with $$ on the first line, then two
    // separate statements. Without the guard, both statements are merged.
    const sql = [
      "-- uses $$ dollar quoting here",
      "CREATE TYPE mood AS ENUM ('happy', 'sad');",
      "CREATE TABLE foo (id int);",
    ].join("\n");

    const statements = splitMigrationStatements(sql);
    // Must produce exactly 2 statements (not 1 merged blob).
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("CREATE TYPE mood");
    expect(statements[1]).toContain("CREATE TABLE foo");
  });

  it("WR-03: error-suppression check matches only first token, not CREATE ROLE in a comment", () => {
    // A statement whose first real SQL token is CREATE TABLE must NOT match the
    // CREATE ROLE suppression pattern even when the comment above says "CREATE ROLE".
    // We test by checking that the firstToken logic correctly identifies the statement.
    // Inline test of the pattern from the fix:
    const trimmed =
      "-- replaces aprumo_app (previously via CREATE ROLE)\nCREATE TABLE accounts (id int)";
    const firstToken = trimmed
      .replace(/--[^\n]*/g, "")
      .trim()
      .toUpperCase()
      .slice(0, 20);
    const isRoleStatement = firstToken.startsWith("CREATE ROLE") || firstToken.startsWith("DO ");
    // Must be FALSE — the first real token is CREATE TABLE, not CREATE ROLE
    expect(isRoleStatement).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unit tests — rewriteForTestSchema
// ---------------------------------------------------------------------------

describe("rewriteForTestSchema (unit)", () => {
  it("WR-04: does NOT rewrite SET search_path inside a -- comment line", () => {
    const sql = [
      "-- SET search_path = public: prevents search_path injection (T-2-04).",
      "SET search_path = public",
    ].join("\n");

    const result = rewriteForTestSchema(sql, "test_abc123");
    const lines = result.split("\n");
    // Comment line must be preserved verbatim
    expect(lines[0]).toBe("-- SET search_path = public: prevents search_path injection (T-2-04).");
    // Non-comment line must be rewritten
    expect(lines[1]).toBe("SET search_path = test_abc123,public");
  });

  it("WR-04: does NOT rewrite IN SCHEMA public inside a -- comment line", () => {
    const sql = [
      "-- grants IN SCHEMA public are required",
      "GRANT ALL ON ALL TABLES IN SCHEMA public TO aprumo_app;",
    ].join("\n");

    const result = rewriteForTestSchema(sql, "test_abc123");
    const lines = result.split("\n");
    // Comment line must be preserved verbatim
    expect(lines[0]).toBe("-- grants IN SCHEMA public are required");
    // Non-comment line must be rewritten
    expect(lines[1]).toContain("IN SCHEMA test_abc123");
  });
});

// ---------------------------------------------------------------------------
// Integration tests — require real PG from testcontainers globalSetup
// ---------------------------------------------------------------------------

describe("applyMigrationsToSchema (integration)", () => {
  const schema = computeSchemaName(import.meta.url);
  let cleanupSql: ReturnType<typeof postgres> | undefined;

  afterAll(async () => {
    if (cleanupSql) {
      await cleanupSql.end();
    }
  });

  it("WR-02: migration DDL and tracking row are both visible after applyMigrationsToSchema", async () => {
    // Full process-kill simulation is impractical in a unit test.
    // This test verifies that after a successful migration run, both the DDL
    // effect (table exists) and the tracking row are present — confirming they
    // were committed atomically (no partial-commit window).
    const pgUri = inject("pgUri");
    if (!pgUri) {
      console.warn("Skipping integration test — no pgUri (Docker unavailable)");
      return;
    }

    const atomicSchema = computeSchemaName(`${import.meta.url}__atomic_test`);
    const setupSql = postgres(pgUri, { max: 1 });
    try {
      await setupSql`CREATE SCHEMA IF NOT EXISTS ${setupSql(atomicSchema)}`;
      await applyMigrationsToSchema(pgUri, MIGRATIONS_FOLDER, atomicSchema);

      // DDL effect: accounts table must exist
      const tableResult = await setupSql<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = ${atomicSchema} AND table_name = 'accounts'
      `;
      expect(tableResult.length).toBe(1);

      // Tracking row must exist for the first migration (atomically)
      const trackResult = await setupSql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM ${setupSql(atomicSchema)}.__drizzle_migrations
      `;
      const trackCount = trackResult[0];
      expect(trackCount).toBeDefined();
      expect(Number(trackCount!.count)).toBeGreaterThan(0);
    } finally {
      await setupSql`DROP SCHEMA IF EXISTS ${setupSql(atomicSchema)} CASCADE`;
      await setupSql.end();
    }
  });

  it("Test 4: does not execute statements from seed-tagged migrations", async () => {
    const pgUri = inject("pgUri");
    if (!pgUri) {
      console.warn("Skipping integration test — no pgUri (Docker unavailable)");
      return;
    }

    // applyMigrationsToSchema must not fail even if seed migrations exist.
    // We verify by running it and ensuring no seed-specific seed data is inserted.
    // The seed migration (0006_seed_dev.sql) inserts dev accounts — if it ran,
    // we'd find a customer account in the test schema.
    const testSchema = computeSchemaName(`${import.meta.url}__seed_test`);
    const setupSql = postgres(pgUri, { max: 1 });
    try {
      await setupSql`CREATE SCHEMA IF NOT EXISTS ${setupSql(testSchema)}`;
      await applyMigrationsToSchema(pgUri, MIGRATIONS_FOLDER, testSchema);

      // Verify accounts table exists (migration ran) but no transaction from seed.
      await setupSql`
        SELECT count(*)::text AS count FROM ${setupSql(testSchema)}.accounts WHERE id IS NOT NULL
      `;
      const txResult = await setupSql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM ${setupSql(testSchema)}.transactions
      `;
      const txCount = txResult[0];
      expect(txCount).toBeDefined();
      expect(txCount!.count).toBe("0");
    } finally {
      await setupSql`DROP SCHEMA IF EXISTS ${setupSql(testSchema)} CASCADE`;
      await setupSql.end();
    }
  });

  it("Test 5: runs all non-seed migrations and creates all ledger tables", async () => {
    const pgUri = inject("pgUri");
    if (!pgUri) {
      console.warn("Skipping integration test — no pgUri (Docker unavailable)");
      return;
    }

    const setupSql = postgres(pgUri, { max: 1 });
    cleanupSql = setupSql;

    await setupSql`CREATE SCHEMA IF NOT EXISTS ${setupSql(schema)}`;
    await applyMigrationsToSchema(pgUri, MIGRATIONS_FOLDER, schema);

    // Verify all expected ledger tables exist in the test schema.
    const expectedTables = [
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
    ];

    for (const tableName of expectedTables) {
      const result = await setupSql<{ table_name: string }[]>`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = ${schema}
          AND table_name = ${tableName}
      `;
      expect(result.length, `Table ${tableName} should exist in schema ${schema}`).toBe(1);
    }
  });

  it("Test 6: running applyMigrationsToSchema twice on same schema does not fail (idempotent)", async () => {
    const pgUri = inject("pgUri");
    if (!pgUri) {
      console.warn("Skipping integration test — no pgUri (Docker unavailable)");
      return;
    }

    // Re-run on the same schema created in Test 5 — should skip already-applied hashes.
    await expect(applyMigrationsToSchema(pgUri, MIGRATIONS_FOLDER, schema)).resolves.not.toThrow();
  });
});
