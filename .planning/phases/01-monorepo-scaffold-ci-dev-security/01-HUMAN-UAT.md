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
result: [pass] verified 2026-06-02 (F-02) — staged real EC PEM (prime256v1) in non-ignored file; lefthook pre-commit gitleaks `protect --staged` reported `leaks found: 2`, `exit status 1`, commit rejected. Bonus: `.gitignore` independently blocks `*.pem` (defense-in-depth). Scratch artifacts removed.

### 3. GitHub branch protection on main (D-14)
expected: main protected via repository ruleset "Main" (active) with: require PR, code-owner review required (required_approving_review_count=0 — solo OSS, code-owner gate substitutes for fixed approval count), required status checks (Lint, TypeCheck, Build, Test (Node 22), Test (Node 24), Coverage Gate, Changeset Check, Gitleaks Secret Scan), linear history, deletion + non-fast-forward protection, squash-only merges. Signed commits NOT enabled (per D-14).
result: [pass] verified 2026-06-02 via `gh api repos/{owner}/{repo}/rulesets/16760342` — enforcement active, all checks present. Doc updated: D-14 "1 review" reconciled to code-owner-review + 0-count (solo-maintainer reality), status-check list expanded to current ci.yml.

### 4. GitHub Private Vulnerability Reporting enabled (D-16)
expected: Repository Security tab shows "Private vulnerability reporting enabled".
result: [pass] verified 2026-06-02 (F-04) via `gh api repos/{owner}/{repo}/private-vulnerability-reporting` → `{"enabled":true}`.

## Summary

total: 4
passed: 3
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
