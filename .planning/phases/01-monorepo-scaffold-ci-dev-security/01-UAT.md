---
status: diagnosed
phase: 01-monorepo-scaffold-ci-dev-security
source: [01-00-SUMMARY.md, 01-01-SUMMARY.md, 01-02-SUMMARY.md, 01-03-SUMMARY.md, 01-04-SUMMARY.md, 01-05-SUMMARY.md, 01-06-SUMMARY.md]
started: 2026-06-02T13:28:07Z
updated: 2026-06-02T13:30:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: From a clean state (rm -rf node_modules packages/*/dist coverage), `pnpm install` succeeds and runs prepare→lefthook install, `pnpm build` produces dist/ for all 4 packages, `pnpm test` passes 32/32. Catches fresh-clone bugs that warm state hides.
result: issue
reported: "3 tests fail in tests/scaffold/infra.test.ts (INF-02 tsconfig.base.json strict / noUncheckedIndexedAccess / module NodeNext). SyntaxError: Expected double-quoted property name in JSON at position 423 (line 17 column 5). JSON.parse fails reading tsconfig.base.json."
severity: blocker

### 2. Workspace resolution & hook wiring
expected: After `pnpm install`, pnpm resolves the 4 @aprumo/* workspace packages and `.git/hooks/pre-commit`, `commit-msg`, `pre-push` exist (lefthook installed via prepare).
result: pass

### 3. Typecheck passes
expected: `pnpm typecheck` exits 0 — strict TS (noUncheckedIndexedAccess, NodeNext) across all packages with no type errors.
result: pass

### 4. Build all packages
expected: `pnpm build` produces dist/index.js + type declarations for core, connector-base, connector-starkbank, webhooks. No build errors.
result: pass

### 5. Test suite green with coverage
expected: `pnpm test` runs the Vitest projects array and passes 32/32. Coverage thresholds (90% core / 80% others) are active and do not fail on current stubs.
result: issue
reported: "Test Files 1 failed | 23 passed (24). Tests 3 failed | 167 passed | 1 skipped (171). Same 3 INF-02 failures: SyntaxError Expected double-quoted property name in JSON at position 423 (line 17 column 5) reading tsconfig.base.json. Same root cause as test 1."
severity: blocker

### 6. Lint clean
expected: `biome check .` (or `pnpm run --reporter append-only lint`) reports no errors. noExplicitAny=error rule active. (Note: bare `pnpm lint` may OOM in some PTY terminals — env-specific, not a code bug.)
result: pass
note: "Lint tooling works — 0 errors (exit 0). 3 warnings + 1 info present, all in packages/core (phase 2/3 code, out of phase 1 scope): useLiteralKeys process.env['NODE_ENV'] @ server.ts:75, noUnusedImports @ routes/accounts.ts:24, noUnusedFunctionParameters db @ server.ts:72, noUnusedVariables endpointId @ audit-triggers.integration.test.ts:18. Flag for cleanup in owning phase, not a phase 1 gap."

### 7. Coverage gate fires
expected: Add an uncovered export to packages/core/src and run coverage on @aprumo/core — the coverage gate exits non-zero because core drops below 90% LoC. (Revert the change after.)
result: pass

### 8. Pre-commit blocks secret
expected: Stage a file containing an EC PRIVATE KEY PEM header and run `git commit` — gitleaks pre-commit hook blocks the commit with non-zero exit before it is accepted.
result: pass

### 9. Commit message lint
expected: A non-conventional commit message (e.g. "bad message") is rejected by commitlint via the commit-msg hook; a valid one (e.g. "feat(scope): add x") is accepted.
result: pass

### 10. Changeset gate
expected: With a publishable package change staged and no changeset file present, `pnpm changeset:check` exits non-zero (matches the CI changeset-check gate).
result: pass

### 11. CI pipeline green (GitHub)
expected: Push the branch / open a PR — GitHub Actions runs and all CI jobs pass: lint, typecheck, build, test (Node 22), test (Node 24), coverage-gate, gitleaks-history. changeset-check is PR-only.
result: pass
note: "CI green while local `pnpm test` fails (tests 1/5) — strong signal the malformed tsconfig.base.json is an uncommitted local edit, not in the pushed commit. Diagnosis should diff working tree vs HEAD on tsconfig.base.json."

### 12. Branch protection on main (GitHub, D-14)
expected: Settings → Branches shows main protected: require PR, 1 review, required status checks (lint, typecheck, build, test 22, test 24, coverage-gate, gitleaks-history), linear history. Signed commits NOT enabled (per D-14).
result: pass

### 13. Private Vulnerability Reporting (GitHub, D-16)
expected: Repository Security tab shows "Private vulnerability reporting enabled".
result: pass

## Summary

total: 13
passed: 10
issues: 2
pending: 0
skipped: 0
blocked: 0

## Gaps

- truth: "From a clean state, `pnpm test` passes 32/32 (cold start smoke)"
  status: failed
  reason: "User reported: 3 tests fail in tests/scaffold/infra.test.ts (INF-02). SyntaxError: Expected double-quoted property name in JSON at position 423 (line 17 column 5) — JSON.parse fails on tsconfig.base.json"
  severity: blocker
  test: 1, 5
  root_cause: "Commit 3a9fc93 (WR-05) added a `// ignoreDeprecations: \"6.0\"...` line comment to tsconfig.base.json, making it JSONC. tests/scaffold/infra.test.ts readJson() uses strict JSON.parse() (no comment support) for the 3 INF-02 assertions (strict / noUncheckedIndexedAccess / module NodeNext), which throw SyntaxError at line 17. tsc tolerates JSONC so typecheck/build pass and mask the break; CI was green on a commit predating the comment."
  artifacts:
    - path: "tests/scaffold/infra.test.ts"
      issue: "readJson() uses strict JSON.parse on tsconfig.base.json (a JSONC file) — 3 INF-02 assertions throw on the // comment"
    - path: "tsconfig.base.json"
      issue: "Contains a // line comment (valid JSONC/TS, intentional WR-05 documentation) that strict JSON.parse rejects"
  missing:
    - "Parse tsconfig.base.json as JSONC in the test (strip // line and /* */ block comments before JSON.parse, e.g. a readJsonc helper for tsconfig reads), preserving the WR-05 comment. Keep strict readJson for true-JSON files (package.json, biome.json)."
    - "Alternative: relocate the WR-05 explanation out of tsconfig.base.json to restore strict-JSON validity (loses inline doc)."
  debug_session: ""
