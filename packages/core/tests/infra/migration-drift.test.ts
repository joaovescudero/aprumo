/**
 * Migration drift detection tests (FND-15 hard gate).
 *
 * These are script-level tests — no DB container required. They run
 * check-migration-drift.mjs as a subprocess and assert on its exit code.
 *
 * Tests:
 *   1. Clean state: script exits 0 when no migrations are edited.
 *   2. Tampered migration: script exits non-zero when a migration file is mutated.
 *   3. Missing migration: script exits non-zero when a migration file is deleted.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Root of the monorepo (two levels up from packages/core/)
const REPO_ROOT = resolve(__dirname, "../../../../");

const SCRIPT = resolve(REPO_ROOT, "scripts/check-migration-drift.mjs");
const MIGRATIONS_DIR = resolve(REPO_ROOT, "packages/core/migrations");
const FIRST_MIGRATION = resolve(MIGRATIONS_DIR, "0000_init_tables.sql");

function runDriftCheck(): { exitCode: number | null; stderr: string; stdout: string } {
  const result = spawnSync("node", [SCRIPT], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return {
    exitCode: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

describe("check-migration-drift.mjs", () => {
  it("exits 0 when no migrations are edited (clean state)", () => {
    const { exitCode } = runDriftCheck();
    expect(exitCode).toBe(0);
  });

  describe("tampered migration", () => {
    let originalContent: string;

    beforeEach(() => {
      originalContent = readFileSync(FIRST_MIGRATION, "utf8");
    });

    afterEach(() => {
      // Always restore original content regardless of test outcome
      writeFileSync(FIRST_MIGRATION, originalContent, "utf8");
    });

    it("exits non-zero when a migration file is tampered", () => {
      // Append a comment to simulate a developer editing a committed migration
      writeFileSync(FIRST_MIGRATION, `${originalContent}\n-- tampered`, "utf8");

      const { exitCode, stderr } = runDriftCheck();

      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/DRIFT/i);
    });
  });

  describe("missing migration", () => {
    const BACKUP_PATH = `${FIRST_MIGRATION}.bak`;

    beforeEach(() => {
      // Rename to simulate a deleted/missing migration file
      renameSync(FIRST_MIGRATION, BACKUP_PATH);
    });

    afterEach(() => {
      // Always restore original file
      renameSync(BACKUP_PATH, FIRST_MIGRATION);
    });

    it("exits non-zero when a migration file is missing", () => {
      const { exitCode, stderr } = runDriftCheck();

      expect(exitCode).not.toBe(0);
      expect(stderr).toMatch(/DRIFT/i);
    });
  });
});
