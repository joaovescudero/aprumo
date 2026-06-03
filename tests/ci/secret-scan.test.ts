/**
 * INF-06: Pre-commit secret scanning with gitleaks
 *
 * Wave 0 RED tests — these MUST fail until Wave 2 creates .gitleaks.toml.
 * Tests verify that gitleaks is available and blocks EC private keys.
 *
 * Threat: T-1-01 (test fixtures use dummy PEM headers, NOT real keys)
 * No imports from @aprumo/* packages.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");

// Dummy PEM header strings — these are NOT real keys, just the header pattern
// T-1-01 mitigation: fixture content is PEM header only, not a valid key
const EC_PEM_HEADER = "-----BEGIN EC PRIVATE KEY-----";
const SECRET_FIXTURE = "SECRET=abc123supersecretvalue123456abc123";

let gitleaksAvailable = false;
let fixtureDir: string;

beforeAll(() => {
  // Check if gitleaks is available
  const versionResult = spawnSync("gitleaks", ["version"], {
    encoding: "utf8",
    timeout: 10_000,
  });
  gitleaksAvailable = versionResult.status === 0;

  // Create a temp fixture directory outside the repo
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "gitleaks-test-"));
});

afterAll(() => {
  // Cleanup temp fixture directory
  try {
    fs.rmSync(fixtureDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

describe("INF-06: Secret scanning (gitleaks)", () => {
  it("gitleaks binary is available on PATH", () => {
    expect(
      gitleaksAvailable,
      "gitleaks binary must be available on PATH. Install with: brew install gitleaks\nThis test is RED until gitleaks is installed.",
    ).toBe(true);
  });

  it(".gitleaks.toml exists at repo root", () => {
    expect(
      fs.existsSync(path.join(REPO_ROOT, ".gitleaks.toml")),
      ".gitleaks.toml must exist at repo root (created in Wave 2 Plan 03).",
    ).toBe(true);
  });

  it("gitleaks detects EC private key header in a fixture file", (ctx) => {
    if (!gitleaksAvailable) {
      ctx.skip();
      return;
    }

    // Create a fixture file with a PEM header (NOT a real key — T-1-01 mitigation)
    const fixtureFile = path.join(fixtureDir, "ec-key.pem");
    fs.writeFileSync(
      fixtureFile,
      `${EC_PEM_HEADER}\nMHQCAQEEIMockNotARealKeyJustAHeader\n-----END EC PRIVATE KEY-----\n`,
      "utf8",
    );

    // Use gitleaks detect against the fixture directory (avoids git staging)
    const gitleaksToml = path.join(REPO_ROOT, ".gitleaks.toml");
    const configArgs = fs.existsSync(gitleaksToml) ? ["--config", gitleaksToml] : [];

    const result = spawnSync(
      "gitleaks",
      ["detect", "--source", fixtureDir, "--no-git", "--redact", ...configArgs],
      {
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    // gitleaks exits non-zero when secrets are found
    expect(
      result.status,
      `Expected gitleaks to detect EC PRIVATE KEY header and exit non-zero.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).not.toBe(0);
  });

  it("gitleaks detects SECRET= assignment in a fixture file", (ctx) => {
    if (!gitleaksAvailable) {
      ctx.skip();
      return;
    }

    // Create a fixture file with a SECRET= assignment (NOT real credentials — T-1-01 mitigation)
    const fixtureFile = path.join(fixtureDir, "env-secret.env");
    fs.writeFileSync(fixtureFile, `${SECRET_FIXTURE}\n`, "utf8");

    const gitleaksToml = path.join(REPO_ROOT, ".gitleaks.toml");
    const configArgs = fs.existsSync(gitleaksToml) ? ["--config", gitleaksToml] : [];

    const result = spawnSync(
      "gitleaks",
      ["detect", "--source", fixtureDir, "--no-git", "--redact", ...configArgs],
      {
        encoding: "utf8",
        timeout: 30_000,
      },
    );

    // gitleaks exits non-zero when secrets are found
    expect(
      result.status,
      `Expected gitleaks to detect SECRET= pattern and exit non-zero.\nstdout: ${result.stdout}\nstderr: ${result.stderr}`,
    ).not.toBe(0);
  });
});
