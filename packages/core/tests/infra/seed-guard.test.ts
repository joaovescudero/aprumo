/**
 * Unit tests for assertSeedStructure() — WR-06 seed guard (FND-14).
 *
 * These are pure logic tests — no DB, no testcontainers, no beforeAll.
 * Verifies that the guard correctly accepts DO $$ blocks (with or without
 * leading SQL line-comments and blank lines) and rejects anything else.
 *
 * WR-06 invariant: only `--` line-comments and blank lines may precede DO $$.
 * Any other leading content (block comments, executable SQL) must be rejected.
 */
import { describe, expect, it } from "vitest";
import { assertSeedStructure } from "../../src/db/seed.js";

describe("assertSeedStructure", () => {
  // ──────────────────────────────────────────────────────────────────────────
  // ACCEPTANCE cases — must NOT throw
  // ──────────────────────────────────────────────────────────────────────────

  it("accepts DO $$ with no leading content", () => {
    expect(() => assertSeedStructure("DO $$\nBEGIN\nEND $$;")).not.toThrow();
  });

  it("accepts DO $$ preceded by leading whitespace only", () => {
    expect(() => assertSeedStructure("  \n\nDO $$\nBEGIN\nEND $$;")).not.toThrow();
  });

  it("accepts DO $$ preceded by SQL line-comments and blank lines", () => {
    // Matches the exact shape of 0006_seed_dev.sql: 8 comment lines + blank + DO $$
    const content = [
      "-- DEV SEED ONLY. Do NOT run as part of pnpm db:migrate production path.",
      "-- Run via: pnpm db:seed",
      "-- Creates: 1 owner ref ('seed-owner'), 2 accounts (asset + liability), 1 balanced transaction",
      "--          via post_transaction — never direct INSERT into postings.",
      "--",
      "-- See: CLAUDE.md Invariant #1 (append-only postings — sole write path via post_transaction)",
      "-- See: CLAUDE.md Invariant #2 (double-entry balance enforced by post_transaction)",
      "-- See: FND-14 (dev seed script)",
      "",
      "DO $$",
      "BEGIN",
      "END $$;",
    ].join("\n");
    expect(() => assertSeedStructure(content)).not.toThrow();
  });

  it("accepts DO $$ when inline comment follows on same line", () => {
    expect(() =>
      assertSeedStructure("-- header\n\nDO $$ -- optional comment\nBEGIN\nEND $$;"),
    ).not.toThrow();
  });

  // ──────────────────────────────────────────────────────────────────────────
  // REJECTION cases — must throw Error matching /does not begin with.*DO \$\$/i
  // ──────────────────────────────────────────────────────────────────────────

  it("rejects empty string", () => {
    expect(() => assertSeedStructure("")).toThrow(/does not begin with.*DO \$\$/i);
  });

  it("rejects whitespace-only string", () => {
    expect(() => assertSeedStructure("   \n\n  \t  ")).toThrow(/does not begin with.*DO \$\$/i);
  });

  it("rejects file starting with INSERT INTO", () => {
    expect(() =>
      assertSeedStructure("INSERT INTO accounts (id) VALUES (gen_random_uuid());"),
    ).toThrow(/does not begin with.*DO \$\$/i);
  });

  it("rejects file starting with SELECT 1", () => {
    expect(() => assertSeedStructure("SELECT 1;")).toThrow(/does not begin with.*DO \$\$/i);
  });

  it("rejects file where DO $$ appears only inside a comment (-- DO $$)", () => {
    // The only line that would match is inside a comment — after stripping comments,
    // no non-comment line starts with DO $$.
    expect(() => assertSeedStructure("-- DO $$\nINSERT INTO accounts VALUES (1);")).toThrow(
      /does not begin with.*DO \$\$/i,
    );
  });

  it("rejects file whose first real statement is CREATE TABLE, not DO $$", () => {
    expect(() =>
      assertSeedStructure(
        "-- just a comment\n\nCREATE TABLE foo (id bigint);\n\nDO $$\nBEGIN\nEND $$;",
      ),
    ).toThrow(/does not begin with.*DO \$\$/i);
  });

  it("rejects DO $$ hidden behind a block comment (only -- comments are stripped)", () => {
    // WR-06: the guard strips only `--` line-comments. A /* ... */ block comment
    // is NOT stripped, so its opening line becomes the first real line and fails
    // the DO $$ check — preventing block comments from masking smuggled SQL.
    expect(() =>
      assertSeedStructure("/* DO $$ */\nINSERT INTO accounts VALUES (1);\nDO $$\nBEGIN\nEND $$;"),
    ).toThrow(/does not begin with.*DO \$\$/i);
  });
});
