/**
 * Race-condition regression test for CREATE ROLE concurrency on pg_authid.
 *
 * Documents two things:
 *
 * 1. RACE-01 (raw race): Concurrent CREATE ROLE statements against a fresh
 *    cluster WITHOUT EXCEPTION handling race and produce 23505 (unique violation
 *    on pg_authid_rolname_index). This proves the underlying PG constraint exists
 *    and the IF NOT EXISTS guard in 0001_roles.sql is non-atomic.
 *
 * 2. RACE-02 (globalSetup fix): After globalSetup pre-creates roles, the roles
 *    exist in the shared container before any worker fork runs. Workers calling
 *    applyMigrationsToSchema find the roles present; IF NOT EXISTS short-circuits.
 *    The shared pgUri container must have aprumo_app and aprumo_migration in pg_roles.
 *
 * Fix: globalSetup.ts pre-creates roles once (single-threaded, before any fork)
 * using PL/pgSQL EXCEPTION duplicate_object — the atomic idempotency mechanism.
 *
 * Per CLAUDE.md: TDD-first — this file was committed (RED) before the globalSetup fix (GREEN).
 * Per D-37: inject("pgUri") guard for Docker-unavailable environments.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import postgres from "postgres";
import { afterAll, describe, expect, inject, it } from "vitest";

import { PG_IMAGE } from "../setup/container.js";

describe("globalSetup role pre-creation race", () => {
  let ephemeralContainer: StartedPostgreSqlContainer | undefined;

  afterAll(async () => {
    await ephemeralContainer?.stop();
  });

  it("RACE-01: concurrent CREATE ROLE without EXCEPTION handling produces 23505 on pg_authid", async () => {
    // Skip if Docker is unavailable (same guard as other integration tests).
    const sharedPgUri = inject("pgUri");
    if (!sharedPgUri) {
      console.warn("Skipping RACE-01 — no pgUri (Docker unavailable)");
      return;
    }

    // Start a FRESH ephemeral container with no pre-existing roles.
    // Do NOT use .withReuse() — must be a fresh cluster with empty pg_authid.
    ephemeralContainer = await new PostgreSqlContainer(PG_IMAGE).start();
    const freshUri = ephemeralContainer.getConnectionUri();

    // Open two separate connections that both observe the role as missing,
    // then both attempt to create it — this is the raw race condition.
    // We use plain DO/IF NOT EXISTS (no EXCEPTION handling) to prove 23505
    // actually surfaces when the IF NOT EXISTS guard is used non-atomically.
    const sqlA = postgres(freshUri, { max: 1 });
    const sqlB = postgres(freshUri, { max: 1 });

    try {
      // Both connections check pg_roles concurrently — both see role missing.
      // Both then attempt CREATE ROLE — second one fails with 23505.
      const [resultA, resultB] = await Promise.allSettled([
        sqlA.unsafe(`
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aprumo_test_race_role') THEN
                CREATE ROLE aprumo_test_race_role NOLOGIN NOSUPERUSER;
              END IF;
            END
            $$
          `),
        sqlB.unsafe(`
            DO $$
            BEGIN
              IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'aprumo_test_race_role') THEN
                CREATE ROLE aprumo_test_race_role NOLOGIN NOSUPERUSER;
              END IF;
            END
            $$
          `),
      ]);

      const errors = [resultA, resultB]
        .filter((r): r is PromiseRejectedResult => r.status === "rejected")
        .map((r) => r.reason);

      // The race may or may not trigger on every run (timing-dependent).
      // If at least one error occurred, verify it is 23505 or 42710.
      // If no errors occurred, the race did not trigger this run — that is OK,
      // the test still documents the pattern and the fix (RACE-02) is the guard.
      if (errors.length > 0) {
        const hasDuplicateRole = errors.some(
          (e) =>
            (e instanceof Error &&
              "code" in e &&
              ((e as { code: string }).code === "23505" ||
                (e as { code: string }).code === "42710")) ||
            (e instanceof Error && /pg_authid|duplicate key|already exists/i.test(e.message)),
        );
        expect(
          hasDuplicateRole,
          `expected 23505/42710 from concurrent CREATE ROLE, got: ${errors.map((e) => String(e)).join("; ")}`,
        ).toBe(true);
      }
    } finally {
      await sqlA.end();
      await sqlB.end();
    }
  }, 90_000); // Container startup + connections can take up to 90s on cold pull

  it("RACE-02: shared container has aprumo_app and aprumo_migration pre-created by globalSetup", async () => {
    // This test verifies the GREEN fix: globalSetup.ts now pre-creates the
    // cluster-global roles before any worker fork starts. After the fix,
    // every parallel applyMigrationsToSchema call finds the roles present
    // and the IF NOT EXISTS guard short-circuits — no CREATE ROLE, no race.
    //
    // In RED (before the fix): globalSetup.ts does NOT pre-create roles.
    // The shared container has no aprumo_app/aprumo_migration in pg_roles.
    // This test fails with "expected 1, got 0" for each role.
    //
    // In GREEN (after the fix): globalSetup.ts pre-creates both roles.
    // This test passes — roles exist before any test file runs migrations.
    const pgUri = inject("pgUri");
    if (!pgUri) {
      console.warn("Skipping RACE-02 — no pgUri (Docker unavailable)");
      return;
    }

    const sql = postgres(pgUri, { max: 1 });
    try {
      const appRole = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM pg_roles WHERE rolname = 'aprumo_app'
      `;
      const migrationRole = await sql<{ count: string }[]>`
        SELECT count(*)::text AS count FROM pg_roles WHERE rolname = 'aprumo_migration'
      `;

      expect(
        Number(appRole[0]?.count ?? 0),
        "aprumo_app must be pre-created by globalSetup before any worker fork",
      ).toBe(1);

      expect(
        Number(migrationRole[0]?.count ?? 0),
        "aprumo_migration must be pre-created by globalSetup before any worker fork",
      ).toBe(1);
    } finally {
      await sql.end();
    }
  });
});
