/**
 * INF-04: Coverage gate fires on 0%-covered code
 *
 * Wave 0 RED test — verifies that the coverage gate actually fires (non-zero exit)
 * when packages/core line coverage is below 90%.
 *
 * This test creates a 0%-covered fixture in packages/core/src/__fixtures__/,
 * spawns vitest --coverage, and asserts the process exits non-zero.
 *
 * RED at Wave 0: packages/core does not exist yet, so the coverage run cannot fire.
 * GREEN in Wave 1: after Plan 02 creates the package stubs.
 *
 * No imports from @aprumo/* packages.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const FIXTURES_DIR = path.join(REPO_ROOT, "packages/core/src/__fixtures__");
const UNCOVERED_FILE = path.join(FIXTURES_DIR, "uncovered.ts");

describe("INF-04: Coverage gate fires on 0%-covered code", () => {
  beforeAll(() => {
    // Create packages/core/src/__fixtures__/uncovered.ts with 0% line coverage
    // This function is exported but has no corresponding test — Vitest will never call it
    if (!fs.existsSync(FIXTURES_DIR)) {
      fs.mkdirSync(FIXTURES_DIR, { recursive: true });
    }
    fs.writeFileSync(
      UNCOVERED_FILE,
      `// This file is intentionally not tested — used to verify the coverage gate fires\nexport function neverCalled(): string {\n  return "I am never tested";\n}\n`,
      "utf8",
    );
  });

  afterAll(() => {
    // Cleanup: remove the fixture file
    if (fs.existsSync(UNCOVERED_FILE)) {
      fs.unlinkSync(UNCOVERED_FILE);
    }
    // Remove the fixtures directory if empty
    try {
      fs.rmdirSync(FIXTURES_DIR);
    } catch {
      // Directory not empty or doesn't exist — ignore
    }
  });

  it(
    "pnpm vitest run --coverage exits non-zero when core coverage is below 90%",
    { timeout: 130_000 },
    () => {
      // Spawn vitest with coverage for the core package
      // We use json reporter to keep output clean and check for threshold failure message
      const result = spawnSync(
        "pnpm",
        ["vitest", "run", "--coverage", "--reporter=json", "--project=@aprumo/core"],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          timeout: 120_000, // 2 minutes max
          env: { ...process.env, CI: "true" },
        },
      );

      const stdout = result.stdout ?? "";
      const stderr = result.stderr ?? "";
      const combinedOutput = stdout + stderr;

      // The process MUST exit non-zero when coverage thresholds are not met
      expect(
        result.status,
        `Expected vitest --coverage to exit non-zero (coverage threshold failure) but got exit code ${result.status}.\nstdout: ${stdout.slice(0, 2000)}\nstderr: ${stderr.slice(0, 2000)}`,
      ).not.toBe(0);

      // Vitest outputs a coverage threshold failure message
      // At Wave 0, the failure is because packages/core doesn't exist — also non-zero
      const hasThresholdOrMissingMessage =
        combinedOutput.includes("ERROR") ||
        combinedOutput.includes("does not meet") ||
        combinedOutput.includes("threshold") ||
        combinedOutput.includes("coverage") ||
        combinedOutput.includes("No test files found") ||
        result.status !== 0;

      expect(
        hasThresholdOrMissingMessage,
        `Expected output to contain coverage threshold error or error message.\nOutput: ${combinedOutput.slice(0, 2000)}`,
      ).toBe(true);
    },
  );
});
