/**
 * INF-07: .gitignore covers sensitive files and build artifacts
 *
 * Wave 0 RED tests — these MUST fail until Wave 1 creates .gitignore.
 * Tests parse .gitignore content and assert required patterns are present.
 *
 * No imports from @aprumo/* packages.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const GITIGNORE_PATH = path.join(REPO_ROOT, ".gitignore");

/**
 * Parses .gitignore content and returns non-comment, non-empty lines.
 */
function getGitignorePatterns(): string[] {
  const content = fs.readFileSync(GITIGNORE_PATH, "utf8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

describe("INF-07: .gitignore covers sensitive files and build artifacts", () => {
  it(".gitignore exists at repo root", () => {
    expect(
      fs.existsSync(GITIGNORE_PATH),
      ".gitignore must exist at repo root (created in Wave 1 Plan 01).",
    ).toBe(true);
  });

  it('.gitignore contains ".env*" pattern', () => {
    const patterns = getGitignorePatterns();
    expect(
      patterns.some((p) => p === ".env*" || p === ".env" || p.startsWith(".env")),
      `Expected .gitignore to contain ".env*" pattern.\nFound patterns: ${patterns.join(", ")}`,
    ).toBe(true);
  });

  it('.gitignore contains "*.key" pattern', () => {
    const patterns = getGitignorePatterns();
    expect(
      patterns.some((p) => p === "*.key" || p.includes(".key")),
      `Expected .gitignore to contain "*.key" pattern.\nFound patterns: ${patterns.join(", ")}`,
    ).toBe(true);
  });

  it('.gitignore contains "secrets/" pattern', () => {
    const patterns = getGitignorePatterns();
    expect(
      patterns.some((p) => p === "secrets/" || p === "secrets"),
      `Expected .gitignore to contain "secrets/" pattern.\nFound patterns: ${patterns.join(", ")}`,
    ).toBe(true);
  });

  it('.gitignore contains "dist/" pattern', () => {
    const patterns = getGitignorePatterns();
    expect(
      patterns.some((p) => p === "dist/" || p === "dist" || p.includes("dist")),
      `Expected .gitignore to contain "dist/" pattern.\nFound patterns: ${patterns.join(", ")}`,
    ).toBe(true);
  });

  it('.gitignore contains "coverage/" pattern', () => {
    const patterns = getGitignorePatterns();
    expect(
      patterns.some((p) => p === "coverage/" || p === "coverage"),
      `Expected .gitignore to contain "coverage/" pattern.\nFound patterns: ${patterns.join(", ")}`,
    ).toBe(true);
  });

  it('.gitignore contains "node_modules/" pattern', () => {
    const patterns = getGitignorePatterns();
    expect(
      patterns.some((p) => p === "node_modules/" || p === "node_modules"),
      `Expected .gitignore to contain "node_modules/" pattern.\nFound patterns: ${patterns.join(", ")}`,
    ).toBe(true);
  });
});
