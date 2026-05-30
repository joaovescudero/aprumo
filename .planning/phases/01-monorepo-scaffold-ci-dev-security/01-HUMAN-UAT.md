---
status: partial
phase: 01-monorepo-scaffold-ci-dev-security
source: [01-VERIFICATION.md]
started: 2026-05-22T18:10:00Z
updated: 2026-05-22T18:10:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. CI pipeline smoke test — push branch and confirm GitHub Actions runs green
expected: All 7 jobs (lint, typecheck, build, test Node 22, test Node 24, coverage-gate, gitleaks-history) pass. changeset-check is PR-only and may be skipped on push.
result: [pending]
note: Apply CR-01 fix (allowlist `\.test\.ts$` on `starkbank-private-key` rule in `.gitleaks.toml`) before pushing — otherwise `gitleaks-history` will self-fire on `tests/ci/secret-scan.test.ts`.

### 2. Pre-commit hook blocks EC private key commit
expected: Running `git commit` on a staged file containing the EC private key PEM header exits non-zero with gitleaks error output before the commit is accepted.
result: [pending]

### 3. GitHub branch protection on main (D-14)
expected: Settings → Branches shows main protected with: require PR, 1 review, required status checks (lint, typecheck, build, test (22), test (24), coverage-gate, gitleaks-history), linear history. Signed commits NOT yet enabled (per D-14).
result: [pending]

### 4. GitHub Private Vulnerability Reporting enabled (D-16)
expected: Repository Security tab shows "Private vulnerability reporting enabled".
result: [pending]

## Summary

total: 4
passed: 0
issues: 0
pending: 4
skipped: 0
blocked: 0

## Gaps
