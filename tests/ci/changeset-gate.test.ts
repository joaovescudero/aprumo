/**
 * INF-09/INF-10: Changesets configuration and CI gate
 *
 * Wave 0 RED tests — these MUST fail until Wave 3 creates .changeset/config.json.
 * Tests check for .changeset/config.json and its required fields per D-24.
 *
 * No imports from @aprumo/* packages.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const CHANGESET_CONFIG_PATH = path.join(REPO_ROOT, ".changeset", "config.json");

describe("INF-09/INF-10: Changesets configuration", () => {
  it(".changeset/config.json exists at repo root", () => {
    expect(
      fs.existsSync(CHANGESET_CONFIG_PATH),
      '.changeset/config.json must exist at repo root (created in Wave 3 Plan 05).',
    ).toBe(true);
  });

  it('.changeset/config.json contains "access": "public"', () => {
    const config = JSON.parse(
      fs.readFileSync(CHANGESET_CONFIG_PATH, "utf8"),
    ) as Record<string, unknown>;
    expect(
      config["access"],
      'Expected .changeset/config.json to have "access": "public" per D-24.',
    ).toBe("public");
  });

  it('.changeset/config.json contains "baseBranch": "main"', () => {
    const config = JSON.parse(
      fs.readFileSync(CHANGESET_CONFIG_PATH, "utf8"),
    ) as Record<string, unknown>;
    expect(
      config["baseBranch"],
      'Expected .changeset/config.json to have "baseBranch": "main" per D-24.',
    ).toBe("main");
  });

  it('.changeset/config.json contains "updateInternalDependencies": "patch"', () => {
    const config = JSON.parse(
      fs.readFileSync(CHANGESET_CONFIG_PATH, "utf8"),
    ) as Record<string, unknown>;
    expect(
      config["updateInternalDependencies"],
      'Expected .changeset/config.json to have "updateInternalDependencies": "patch" per D-24.',
    ).toBe("patch");
  });

  it('root package.json defines "changeset:check" script', () => {
    const pkgPath = path.join(REPO_ROOT, "package.json");
    const pkg = JSON.parse(
      fs.readFileSync(pkgPath, "utf8"),
    ) as Record<string, unknown>;
    const scripts = pkg["scripts"] as Record<string, unknown> | undefined;
    expect(
      scripts?.["changeset:check"],
      'Expected root package.json to define "changeset:check" script per D-24/INF-10.',
    ).toBeDefined();
  });
});
