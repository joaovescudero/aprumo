// Per D-37: schema-per-test-file isolation via SHA1 hash naming.
// Per D-39: returns { app: Pool, migration: Pool, schema, cleanup }.
// Per Pitfall 3: inject() is called inside function body, never at module top-level.
// Per Pitfall 4: migrationsSchema: schema isolates __drizzle_migrations per test schema.
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { Pool } from "pg";
import postgres from "postgres";
import { inject } from "vitest";

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

  // Step 2: Run migrations into the isolated schema.
  // Per D-38: each test file runs migrations fresh (no cache).
  // Per Pitfall 4: migrationsSchema: schema keeps __drizzle_migrations table isolated.
  const migrationSql = postgres(pgUri, {
    max: 1,
    // search_path ensures all DDL targets the test schema, not public.
    connection: { search_path: `${schema},public` },
  });
  const db = drizzle(migrationSql);
  await migrate(db, {
    migrationsFolder: MIGRATIONS_FOLDER,
    migrationsSchema: schema,
  });
  await migrationSql.end();

  // Step 3: Set up role credentials for aprumo_app in the test container.
  // Roles have NOLOGIN in production; in test container we enable LOGIN + password
  // so the app pool can connect with the correct role (required for FND-08 REVOKE tests).
  const setupSql = postgres(pgUri, { max: 1 });
  await setupSql`ALTER ROLE IF EXISTS aprumo_app LOGIN PASSWORD 'test-only'`;
  await setupSql.end();

  // Parse host/port/db from container URI for role-specific connection.
  const url = new URL(pgUri);

  // app pool: connects as aprumo_app — mirrors production application path.
  const app = new Pool({
    host: url.hostname,
    port: Number(url.port),
    database: url.pathname.slice(1),
    user: "aprumo_app",
    password: "test-only",
    options: `--search_path=${schema},public`,
  });

  // migration pool: connects as container superuser — for setup and schema-level queries.
  const migration = new Pool({
    connectionString: pgUri,
    options: `--search_path=${schema},public`,
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
