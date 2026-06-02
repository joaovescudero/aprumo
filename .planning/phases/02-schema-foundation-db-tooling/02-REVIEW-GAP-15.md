---
phase: 02-schema-foundation-db-tooling
gap_plan: 02-15
reviewed: 2026-06-02T00:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - packages/core/src/db/seed.ts
  - packages/core/tests/infra/seed-guard.test.ts
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 02 Gap-15: Code Review Report

**Reviewed:** 2026-06-02T00:00:00Z
**Depth:** standard
**Files Reviewed:** 2 (`seed.ts`, `seed-guard.test.ts`)
**Status:** issues_found

## Summary

This gap-closure review covers the WR-06 fix: the extraction of `assertSeedStructure(content, label?)` from `seed.ts`, plus the new unit test suite in `seed-guard.test.ts`.

**WR-06 bypass verdict: the guard holds.** The comment-stripping logic correctly handles all smuggling vectors I could construct:

- `-- DO $$` (DO $$ inside a comment) → `startsWith("--")` skips it; the next real line fails the regex → REJECTS.
- Block-comment prefix `/* ... */\nDO $$` → the `/*` line is the `firstRealLine` (does not start with `--`); regex `/^\s*DO\s+\$\$/` fails → REJECTS.
- Executable SQL before `DO $$` (INSERT, CREATE, SELECT) → first real line fails regex → REJECTS.
- Blank-only / empty input → `find` returns `undefined` → throws.
- CRLF line endings → `String.prototype.trim()` strips `\r` from the trimmed copy used for the skip decision; the raw line is tested by regex which has leading `\s*`; both paths work correctly.
- Inline trailing content after `DO $$` (e.g. `DO $$ -- comment`) → regex anchored at start only, matches prefix → ACCEPTS. Intentional and correct; the security boundary is on what precedes the block, not what follows on the same line.

No security regression was introduced. One warning and three informational items follow.

---

## Warnings

### WR-01: No test for multi-line block-comment prefix — an accepted-but-untested rejection path

**File:** `packages/core/tests/infra/seed-guard.test.ts`

**Issue:** The test suite covers `--` line-comment stripping comprehensively, but there is no test for a seed file that opens with a `/* block comment */` before `DO $$`. The guard correctly rejects this because `/*` does not start with `--`, making the block-comment line the `firstRealLine`, which fails the `DO $$` regex. However, this path is untested. A future refactor of the stripping logic (e.g., adding block-comment support) could accidentally open a bypass here without a failing test to catch it.

The security relevance: a `/* ... */\nDO $$` file is rejected today, but if a developer later extends the guard to also skip block comments, the regex check would run against `DO $$` and pass — possibly accepting a file where the block comment contained executable SQL that PostgreSQL's parser would evaluate differently than the guard assumed.

**Fix:** Add a rejection test for block-comment prefix:

```typescript
it("rejects file whose first real content is a block comment (not DO $$)", () => {
  expect(() =>
    assertSeedStructure("/* header comment */\nDO $$\nBEGIN\nEND $$;"),
  ).toThrow(/does not begin with.*DO \$\$/i);
});
```

This documents the current behaviour as intentional and will catch any future regression if block-comment stripping is ever added.

---

## Info

### IN-01: Stale TDD RED-phase comment in test file

**File:** `packages/core/tests/infra/seed-guard.test.ts:8-10`

**Issue:** Lines 8–10 read:

```
 * RED phase: assertSeedStructure is not yet exported from seed.ts.
 * This file must produce at least one failure (import error) before the fix.
```

This is a TDD scaffolding note from the RED commit. It is now the GREEN state — `assertSeedStructure` is exported and all tests pass. The comment is misleading to future readers: it suggests the import will fail, which it will not. It should be removed or replaced with a note that documents why the test file exists.

**Fix:** Replace the block with a plain description:

```typescript
/**
 * Unit tests for assertSeedStructure() — WR-06 seed guard (FND-14).
 *
 * Pure logic tests — no DB, no testcontainers, no beforeAll.
 * Verifies the guard correctly accepts DO $$ blocks (with or without
 * leading SQL line-comments and blank lines) and rejects anything else.
 */
```

---

### IN-02: `DO$$` (no space) is silently rejected — conservative but undocumented behaviour

**File:** `packages/core/src/db/seed.ts:47`

**Issue:** The regex `/^\s*DO\s+\$\$/` requires one or more whitespace characters between `DO` and `$$` (`\s+`). PostgreSQL accepts `DO$$` with no space as a valid anonymous block. The seed file `0006_seed_dev.sql` uses `DO $$` (with space), so this does not affect the current implementation. But the restriction is undocumented, meaning a future valid seed file written as `DO$$` would be silently rejected by the guard with an error that gives no hint about the space requirement.

**Fix:** Either add a comment to the regex explaining the intentional conservatism, or broaden it to match both forms:

```typescript
// /^\s*DO\s*\$\$/ — accepts both "DO $$" and "DO$$" (both valid PG syntax)
if (firstRealLine === undefined || !/^\s*DO\s*\$\$/.test(firstRealLine)) {
```

Alternatively, if the strict `\s+` form is intentional policy, document it:

```typescript
// Require explicit space between DO and $$. Both "DO $$" and "DO$$" are valid
// PostgreSQL syntax, but this project's seed files must use "DO $$" for
// readability. Tighten the regex intentionally.
if (firstRealLine === undefined || !/^\s*DO\s+\$\$/.test(firstRealLine)) {
```

---

### IN-03: `finally { await sql.end() }` without `catch` — a `sql.end()` throw shadows the original error

**File:** `packages/core/src/db/seed.ts:81-83`

**Issue:**

```typescript
try {
  await sql.unsafe(seedContent);
  process.stdout.write("Seed applied.\n");
} finally {
  await sql.end();
}
```

If `sql.unsafe()` rejects and `sql.end()` also throws in the `finally` block (e.g., because the connection is already in an error state), the `sql.end()` error replaces the original error propagated to the CLI's `.catch()`. The seed failure message seen by the developer will describe the connection teardown problem rather than the root cause. In practice, `postgres-js` `sql.end()` is very unlikely to throw after a query error, but the pattern is fragile.

**Fix:** Wrap `sql.end()` inside `finally` defensively:

```typescript
} finally {
  await sql.end().catch(() => {
    // Ignore sql.end() errors — they must not shadow the original query error.
  });
}
```

---

_Reviewed: 2026-06-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
