/**
 * INF-04: Coverage gate fires on 0%-covered code
 *
 * Reworked for adversarial correctness: runs vitest --coverage in an isolated
 * temp directory (NOT against @aprumo/core's real, evolving coverage) so the
 * test remains stable regardless of how much coverage Phase 2+ adds to core.
 *
 * Approach:
 *   1. Create a temp dir with a minimal vitest config (global 90% threshold)
 *      + a single 0%-covered source file
 *   2. Spawn the repo's vitest binary against that isolated config
 *   3. Assert exit code is non-zero AND output contains threshold-failure text
 *   4. afterAll: clean up temp dir
 *
 * No imports from @aprumo/* packages.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const VITEST_BIN = path.join(REPO_ROOT, "node_modules/.bin/vitest");

// Points to the ESM-compatible config entrypoint for use in file:// imports
const VITEST_CONFIG_IMPORT = `file://${REPO_ROOT}/node_modules/vitest/dist/config.js`;
const VITEST_INDEX_IMPORT = `file://${REPO_ROOT}/node_modules/vitest/dist/index.js`;

let tempDir: string;

describe("INF-04: Coverage gate fires on 0%-covered code", () => {
  beforeAll(() => {
    // Create isolated temp project: minimal vitest config + uncovered source file
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aprumo-cov-gate-"));

    fs.mkdirSync(path.join(tempDir, "src"), { recursive: true });

    // Source file: single exported function, never called by any test → 0% coverage
    fs.writeFileSync(
      path.join(tempDir, "src", "uncovered.mjs"),
      `${[
        "// Intentionally untested — exists only to trigger threshold failure",
        "export function neverCalled() { return 'never tested'; }",
      ].join("\n")}\n`,
      "utf8",
    );

    // Dummy test: passes, but never imports uncovered.mjs
    fs.writeFileSync(
      path.join(tempDir, "dummy.test.mjs"),
      `${[
        `import { test, expect } from "${VITEST_INDEX_IMPORT}";`,
        "test('dummy passes', () => { expect(1).toBe(1); });",
      ].join("\n")}\n`,
      "utf8",
    );

    // Minimal vitest config with:
    //   - coverage.include pointing at src/** so uncovered.mjs is tracked
    //   - global thresholds at 90% (not per-glob, which require root-relative paths)
    fs.writeFileSync(
      path.join(tempDir, "vitest.config.mjs"),
      `${[
        `import { defineConfig } from "${VITEST_CONFIG_IMPORT}";`,
        "export default defineConfig({",
        "  test: {",
        "    environment: 'node',",
        "    include: ['**/*.test.mjs'],",
        "    coverage: {",
        "      provider: 'v8',",
        "      reporter: ['text'],",
        "      reportsDirectory: './coverage',",
        "      include: ['src/**'],",
        "      thresholds: {",
        "        lines: 90,",
        "        functions: 90,",
        "        branches: 80,",
        "        statements: 90,",
        "      },",
        "    },",
        "  },",
        "});",
      ].join("\n")}\n`,
      "utf8",
    );
  });

  afterAll(() => {
    // Clean up the entire isolated temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("vitest --coverage exits non-zero when a source file has 0% line coverage against a 90% threshold", {
    timeout: 120_000,
  }, () => {
    // Run vitest binary from the isolated temp directory
    // Using the repo's node_modules/.bin/vitest to avoid any PATH dependency
    const result = spawnSync(VITEST_BIN, ["run", "--coverage", "--config", "vitest.config.mjs"], {
      cwd: tempDir,
      encoding: "utf8",
      timeout: 110_000,
      env: { ...process.env, CI: "true" },
    });

    const stdout = result.stdout ?? "";
    const stderr = result.stderr ?? "";
    const combinedOutput = stdout + stderr;

    // Primary assertion: must exit non-zero when thresholds are breached
    expect(
      result.status,
      `Expected vitest --coverage to exit non-zero (threshold failure).\nstdout: ${stdout.slice(0, 3000)}\nstderr: ${stderr.slice(0, 3000)}`,
    ).not.toBe(0);

    // Secondary assertion: output must contain the threshold-failure error text
    const hasThresholdFailureMessage =
      combinedOutput.includes("does not meet") ||
      combinedOutput.includes("threshold") ||
      combinedOutput.includes("ERROR: Coverage") ||
      combinedOutput.includes("Coverage for");

    expect(
      hasThresholdFailureMessage,
      `Expected vitest output to contain coverage threshold failure message.\nOutput: ${combinedOutput.slice(0, 3000)}`,
    ).toBe(true);
  });
});
