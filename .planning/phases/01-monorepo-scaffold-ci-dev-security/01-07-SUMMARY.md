---
phase: 01-monorepo-scaffold-ci-dev-security
plan: "07"
subsystem: test-infrastructure
tags: [gap-closure, jsonc, inf-02, test-helpers]
dependency_graph:
  requires: ["01-06"]
  provides: ["INF-02 green", "readJsonc helper"]
  affects: ["tests/scaffold/infra.test.ts"]
tech_stack:
  added: []
  patterns: ["comment-strip regex with string-literal guard", "JSONC-safe JSON parsing"]
key_files:
  created: []
  modified:
    - tests/scaffold/infra.test.ts
decisions:
  - "readJsonc uses inline regex (zero-dep) to strip // and /* */ comments, preserving comment-like strings inside JSON string values via replacer function"
  - "readJson left unchanged — correct for genuine-JSON files (biome.json, package.json)"
  - "tsconfig.base.json untouched — WR-05 // ignoreDeprecations comment retained"
metrics:
  duration: "112s"
  completed: "2026-06-02"
  tasks: 2
  files: 1
---

# Phase 01 Plan 07: Add readJsonc helper — INF-02 gap closure Summary

Gap-closure plan: added `readJsonc()` helper in `tests/scaffold/infra.test.ts` that strips JSONC comments before `JSON.parse`, fixing the 3 failing INF-02 assertions caused by the WR-05 `// ignoreDeprecations` comment in `tsconfig.base.json`.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add readJsonc helper and update INF-02 assertions | fe4828d | tests/scaffold/infra.test.ts |
| 2 | Confirm full suite green + typecheck clean | (no commit — verification only) | — |

## Verification Results

- `pnpm test`: 24 test files passed, 170 tests passed, 1 skipped — 0 failures (was 3 failing)
- `pnpm typecheck`: exit 0, no errors
- `tsconfig.base.json`: unmodified (WR-05 `// ignoreDeprecations` comment retained)
- `readJson`: unchanged — still used for genuine-JSON files (package.json, biome.json)

## Implementation Details

Added `readJsonc(filePath: string): unknown` immediately after `readJson` in `tests/scaffold/infra.test.ts`:

1. Reads file with `fs.readFileSync(filePath, "utf8")`
2. Strips `/* ... */` block comments via `/\/\*[\s\S]*?\*\//g`
3. Strips `// ...` line comments outside string values via `("(?:[^"\\]|\\.)*")|\/\/[^\n]*/g` with a replacer that preserves captured string literals (`stringLiteral !== undefined ? stringLiteral : ""`)
4. Calls `JSON.parse(stripped)` and returns `unknown`
5. No `any`, no `@ts-ignore` — replacer typed as `(match: string, stringLiteral: string | undefined) => string`

Three INF-02 test cases updated: `readJson(configPath)` → `readJsonc(configPath)`. No other call sites changed.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. This plan modifies only test infrastructure.

## Self-Check: PASSED

- [x] `tests/scaffold/infra.test.ts` modified and committed at fe4828d
- [x] `pnpm test` exits 0 — 24 test files, 170 passed, 1 skipped, 0 failed
- [x] `pnpm typecheck` exits 0
- [x] `tsconfig.base.json` unmodified
- [x] Commit fe4828d exists in git log
