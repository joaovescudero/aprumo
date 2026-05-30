/**
 * INF-05: commitlint enforces Conventional Commit format
 *
 * Verifies three behavioral requirements:
 *   1. commitlint rejects a non-Conventional message (non-zero exit)
 *   2. commitlint accepts a valid `feat(scope): msg` message (zero exit)
 *   3. lefthook.yml wires a commit-msg hook that invokes commitlint
 *
 * Matches secret-scan.test.ts pattern: skip-not-crash when binary is unavailable.
 * No imports from @aprumo/* packages.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const COMMITLINT_BIN = path.join(REPO_ROOT, "node_modules/.bin/commitlint");
const LEFTHOOK_PATH = path.join(REPO_ROOT, "lefthook.yml");
const COMMITLINT_CONFIG = path.join(REPO_ROOT, "commitlint.config.ts");

function commitlintAvailable(): boolean {
  return fs.existsSync(COMMITLINT_BIN);
}

describe("INF-05: commitlint enforces Conventional Commit format", () => {
  it("commitlint binary is available in node_modules/.bin", () => {
    expect(
      commitlintAvailable(),
      `commitlint binary not found at ${COMMITLINT_BIN}. Install with: pnpm add -D @commitlint/cli`,
    ).toBe(true);
  });

  it("commitlint rejects a non-Conventional Commit message with non-zero exit", () => {
    if (!commitlintAvailable()) {
      console.warn("Skipping: commitlint binary not found");
      return;
    }

    const result = spawnSync(COMMITLINT_BIN, ["--config", COMMITLINT_CONFIG], {
      input: "bad commit message without conventional format\n",
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 15_000,
    });

    expect(
      result.status,
      `Expected commitlint to exit non-zero for invalid commit message.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).not.toBe(0);
  });

  it("commitlint accepts a valid `feat(scope): msg` message with zero exit", () => {
    if (!commitlintAvailable()) {
      console.warn("Skipping: commitlint binary not found");
      return;
    }

    const result = spawnSync(COMMITLINT_BIN, ["--config", COMMITLINT_CONFIG], {
      input: "feat(scope): add a valid conventional commit message\n",
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 15_000,
    });

    expect(
      result.status,
      `Expected commitlint to exit 0 for valid commit message.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).toBe(0);
  });

  it("lefthook.yml exists at repo root", () => {
    expect(fs.existsSync(LEFTHOOK_PATH), "lefthook.yml must exist at repo root").toBe(true);
  });

  it("lefthook.yml commit-msg hook invokes commitlint", () => {
    const content = fs.readFileSync(LEFTHOOK_PATH, "utf8");

    // Assert the commit-msg section exists
    expect(content.includes("commit-msg"), "lefthook.yml must define a commit-msg hook").toBe(true);

    // Assert commitlint is referenced in the hook
    expect(
      content.includes("commitlint"),
      "lefthook.yml commit-msg hook must invoke commitlint",
    ).toBe(true);
  });
});
