// Per D-37: schema-per-test-file isolation via SHA1 hash naming.
// Per D-39: returns { app: Pool, migration: Pool, schema, cleanup }.
// Per Pitfall 3: inject() is called inside function body, never at module top-level.
// Per Plan 02-12: uses applyMigrationsToSchema instead of drizzle migrate() to fix
//   the FK "public" qualifier issue — drizzle's migrate() applies SQL verbatim which
//   breaks when FK REFERENCES "public"."accounts" is run in a per-test isolated schema.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import postgres from "postgres";
import { inject } from "vitest";

import { applyMigrationsToSchema } from "./applyMigrationsToSchema.js";

const MIGRATIONS_FOLDER = resolve(fileURLToPath(import.meta.url), "../../../migrations");

export interface TestDb {
  /** Pool connecting as aprumo_app — the production application role. */
  app: Pool;
  /** Pool connecting as the container superuser — for migration-level operations. */
  migration: Pool;
  /** The isolated test schema name (e.g. 'test_abc123def456'). */
  schema: string;
  /** Drop the test schema and close all pools. Call in afterAll. */
  cleanup: () => Promise<void>;
}

/**
 * Compute a deterministic, collision-resistant schema name from a test file path.
 * Format: 'test_' + first 12 hex chars of SHA1(testPath).
 * Exported separately for unit testing without DB dependency.
 */
export function computeSchemaName(testPath: string): string {
  return `test_${createHash("sha1").update(testPath).digest("hex").slice(0, 12)}`;
}

/**
 * Create an isolated Postgres schema for a single test file.
 * Runs all migrations into that schema; returns typed connection pools.
 *
 * Usage in test files:
 *   const db = await createTestDb(import.meta.url)
 *   // ... tests using db.app or db.migration pools
 *   afterAll(() => db.cleanup())
 */
export async function createTestDb(testPath: string): Promise<TestDb> {
  // inject() is only valid inside Vitest lifecycle — call here, not at module top-level.
  const pgUri = inject("pgUri");

  const schema = computeSchemaName(testPath);

  // Step 1: Create the test schema using a temporary migration connection.
  const schemaSql = postgres(pgUri, { max: 1 });
  // Use identifier escaping via postgres-js tagged template to prevent injection.
  await schemaSql`CREATE SCHEMA IF NOT EXISTS ${schemaSql(schema)}`;
  await schemaSql.end();

  // Step 2: Run migrations into the isolated schema using the custom runner.
  // Per D-38: each test file runs migrations fresh (no cache).
  // applyMigrationsToSchema rewrites "public". FK qualifiers and SET search_path in
  // function definitions so all DDL targets the test schema, not public.
  // The tracking table (schema.__drizzle_migrations) is isolated per-schema.
  await applyMigrationsToSchema(pgUri, MIGRATIONS_FOLDER, schema);

  // Step 3: Set up role credentials for aprumo_app in the test container.
  // Roles have NOLOGIN in production; in test container we enable LOGIN + password
  // so the app pool can connect with the correct role (required for FND-08 REVOKE tests).
  // Note: aprumo_app is guaranteed to exist after migrations (created by 0001_roles.sql).
  //
  // GRANT USAGE for aprumo_app: required so aprumo_app's search_path resolves
  // objects in test_xxx (PostgreSQL silently skips schemas without USAGE privilege).
  //
  // GRANT USAGE for aprumo_migration: required so SECURITY DEFINER functions that run
  // as aprumo_migration can resolve types (like posting_input) in the test schema.
  // Without this, PL/pgSQL function body compilation fails with 42704 "type not found"
  // because PostgreSQL skips schemas in search_path where the effective user lacks USAGE.
  // Step 3: Set up role credentials and schema privileges.
  // ALTER ROLE is cluster-level — concurrent forks all execute it simultaneously, which
  // causes "tuple concurrently updated" (PostgreSQL row-lock on pg_authid).
  // Use pg_advisory_xact_lock(hash) to serialize cluster-level role operations across
  // concurrent forks. All forks hash to the same advisory lock key so they queue up.
  // The advisory lock is released at transaction end (xact variant, not session variant).
  const setupSql = postgres(pgUri, { max: 1 });

  // Serialize ALTER ROLE via advisory lock. The lock key is a fixed 64-bit integer
  // derived from the string "aprumo_test_setup" — same across all forks.
  // pg_advisory_xact_lock blocks until it can acquire the lock, then releases at tx end.
  await setupSql.begin(async (tx) => {
    await tx.unsafe("SELECT pg_advisory_xact_lock(hashtext('aprumo_test_role_setup'))");
    await tx.unsafe(`ALTER ROLE aprumo_app LOGIN PASSWORD 'test-only'`);
  });

  // GRANT USAGE and GRANT ALL PRIVILEGES are schema-specific — each fork targets a
  // different schema, so these statements don't conflict across forks. No lock needed.
  await setupSql`GRANT USAGE ON SCHEMA ${setupSql(schema)} TO aprumo_app`;
  await setupSql`GRANT USAGE ON SCHEMA ${setupSql(schema)} TO aprumo_migration`;
  // In production, aprumo_migration OWNS all tables (it creates them), so it has
  // implicit ALL PRIVILEGES. In the test schema, the container superuser owns the
  // tables. Grant only SELECT + INSERT to aprumo_migration — matching the minimum
  // needed for SECURITY DEFINER functions (e.g. post_transaction) and preventing
  // test grants from masking the production privilege boundary (WR-04).
  // UPDATE and DELETE on postings/raw_events are intentionally NOT granted so
  // tests accurately reflect the append-only constraint from 0007_revoke_insert_append_only.
  await setupSql`GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA ${setupSql(schema)} TO aprumo_migration`;
  await setupSql`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${setupSql(schema)} TO aprumo_migration`;
  await setupSql.end();

  // Parse host/port/db from container URI for role-specific connection.
  const url = new URL(pgUri);

  // app pool: connects as aprumo_app — mirrors production application path.
  // options uses PostgreSQL startup GUC format: `-c search_path=schema,public`
  // (not `--search_path=` which is a pg_dump/psql CLI flag, not a connection option).
  const app = new Pool({
    host: url.hostname,
    port: Number(url.port),
    database: url.pathname.slice(1),
    user: "aprumo_app",
    password: "test-only",
    options: `-c search_path=${schema},public`,
  });

  // migration pool: connects as container superuser — for setup and schema-level queries.
  const migration = new Pool({
    connectionString: pgUri,
    options: `-c search_path=${schema},public`,
  });

  const cleanup = async () => {
    await app.end();
    await migration.end();
    const cleanupSql = postgres(pgUri, { max: 1 });
    await cleanupSql`DROP SCHEMA IF EXISTS ${cleanupSql(schema)} CASCADE`;
    await cleanupSql.end();
  };

  return { app, migration, schema, cleanup };
}
