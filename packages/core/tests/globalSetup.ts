// Vitest globalSetup: starts one shared PostgreSQL container per test run.
// Per D-37: one container global; schema-per-file isolation handled by createTestDb().
// Per D-40: APRUMO_TEST_REUSE=1 enables .withReuse() for faster local dev iteration.
//
// When Docker is unavailable (CI without Docker, local env without daemon),
// globalSetup provides an empty pgUri. Integration tests that call createTestDb()
// will fail with a connection error — unit tests that do not call createTestDb() pass normally.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";

import { PG_IMAGE } from "./setup/container.js";

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: { provide: (key: string, value: unknown) => void }) {
  const useReuse = process.env.APRUMO_TEST_REUSE === "1";

  let builder = new PostgreSqlContainer(PG_IMAGE);

  if (useReuse) {
    // Enable container reuse for local dev speed; disabled in CI (fresh container per run)
    builder = builder.withReuse();
  }

  try {
    container = await builder.start();

    // Pre-create cluster-global roles once before any worker fork.
    // Roles are global to the PG cluster (pg_authid); when N test files run
    // applyMigrationsToSchema in parallel, they all race on CREATE ROLE in
    // 0001_roles.sql. The IF NOT EXISTS guard in that DO block is non-atomic
    // across sessions — two forks observe the role missing then both attempt
    // CREATE ROLE, causing SQLSTATE 23505 on pg_authid_rolname_index.
    //
    // Fix: pre-create here (single-threaded, before any fork) using PL/pgSQL
    // EXCEPTION duplicate_object — the atomic, correct idempotency mechanism.
    //
    // Per D-40 reuse mode (.withReuse): the warm container already has the roles;
    // EXCEPTION duplicate_object silently absorbs 42710 — idempotent.
    //
    // Production migrate.ts is NOT affected — 0001_roles.sql still runs there
    // and its IF NOT EXISTS guard is correct for single-session production deploys.
    const pgUri = container.getConnectionUri();
    const adminSql = postgres(pgUri, { max: 1 });
    try {
      await adminSql.unsafe(
        `DO $$ BEGIN CREATE ROLE aprumo_app NOLOGIN NOSUPERUSER; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      );
      await adminSql.unsafe(
        `DO $$ BEGIN CREATE ROLE aprumo_migration NOLOGIN NOSUPERUSER CREATEDB; EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
      );
    } catch (roleErr) {
      // Unexpected error (e.g. connection refused before container fully ready).
      // Log and continue — applyMigrationsToSchema savepoint handler is a second
      // line of defence (23505 / 42710 suppressed per WR-02 plan 12).
      const roleMsg = roleErr instanceof Error ? roleErr.message : String(roleErr);
      console.warn(`[globalSetup] Role pre-creation failed (non-fatal): ${roleMsg}`);
    } finally {
      await adminSql.end();
    }

    // Provide the URI to all worker fork processes via Vitest's inject API.
    // Per Pitfall 3: inject() is only valid inside Vitest lifecycle hooks — not at module top-level.
    project.provide("pgUri", pgUri);
  } catch (err) {
    // Docker not available — provide empty URI so unit tests can still run.
    // Integration tests requiring a real DB will fail with connection errors.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[globalSetup] Docker unavailable — integration tests will be skipped: ${msg}`);
    project.provide("pgUri", "");
  }
}

export async function teardown() {
  if (container) {
    await container.stop();
  }
}
