---
phase: 01-monorepo-scaffold-ci-dev-security
verified: 2026-06-02T12:30:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 9/10 must-haves verified
  gaps_closed:
    - "pnpm test exits 0 with all INF-02 assertions passing (readJsonc gap closed)"
    - "biome.json and package.json reads still use strict readJson (readJson unchanged)"
    - "tsconfig.base.json retains WR-05 // ignoreDeprecations comment"
    - "Code-review BLOCKERs CR-01 and CR-02 resolved via single-pass regex and trailing-comma removal"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "CI pipeline smoke test — push branch and confirm GitHub Actions runs green"
    expected: "All 7 jobs (lint, typecheck, build, test Node 22, test Node 24, coverage-gate, gitleaks-history) pass. changeset-check is PR-only and may be skipped on push."
    why_human: "CI is local-only; repo has not been pushed to GitHub yet. No way to confirm GitHub Actions runner behavior without a live push."
  - test: "Pre-commit hook blocks EC private key commit"
    expected: "Running git commit on a staged file containing '-----BEGIN EC PRIVATE KEY-----' exits non-zero with gitleaks error output before the commit is accepted."
    why_human: "End-to-end git hook behavior requires an actual staged file in the working tree. Grep confirms configuration is correct but cannot prove lefthook correctly invokes gitleaks on commit."
  - test: "GitHub branch protection on main (D-14)"
    expected: "Settings -> Branches shows main protected with: require PR, 1 review, required status checks (lint, typecheck, build, test (22), test (24), coverage-gate, gitleaks-history), linear history. Signed commits: off."
    why_human: "Branch protection must be configured in GitHub UI. Cannot be verified programmatically without admin PAT or GitHub Apps token."
  - test: "GitHub Private Vulnerability Reporting enabled (D-16)"
    expected: "Repository Security tab shows 'Private vulnerability reporting enabled'."
    why_human: "PVR enablement is a GitHub Settings action. Cannot be automated without admin-scope token."
---

# Phase 01 Gap-Closure Re-verification Report

**Phase Goal:** Operators can clone the repo, run `pnpm install`, and see lint, typecheck, and test pipeline pass in CI — with secret scanning blocking any accidental credential commit before a single key is ever generated.
**Verified:** 2026-06-02T12:30:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (01-07 + code review resolution)

## Context

The prior VERIFICATION.md (2026-05-22) was `human_needed` with 9/10 must-haves verified. The UAT (01-UAT.md) diagnosed a blocker gap: `pnpm test` failed 3 assertions in INF-02 because `tsconfig.base.json` is JSONC (WR-05 `// ignoreDeprecations` comment) and `readJson` used strict `JSON.parse`. Gap plan 01-07 introduced `readJsonc`. A subsequent code review (01-REVIEW.md) found two BLOCKERs (CR-01: two-pass approach corrupted string values containing `/* */`; CR-02: dangling trailing commas caused `JSON.parse` to throw). Both were resolved via TDD: commit `1be2651` added 6 failing unit cases, commit `a04a390` replaced the two-pass pipeline with a single-pass string-aware regex plus a trailing-comma cleanup pass.

This re-verification checks that the gap is closed, no regression occurred, and the must-haves from 01-07-PLAN.md frontmatter are satisfied.

---

## Goal Achievement

### Observable Truths (from 01-07-PLAN.md must_haves.truths)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `pnpm test` exits 0 with all tests passing (3 previously-failing INF-02 assertions now pass) | VERIFIED | `pnpm test` exits 0. Output: "Test Files 24 passed (24), Tests 176 passed, 1 skipped (177), 0 failed." Confirmed by direct execution. |
| 2 | `pnpm typecheck` still exits 0 (no regression) | VERIFIED | `pnpm typecheck` exits 0 with no output. Confirmed by direct execution. |
| 3 | biome.json and package.json reads still use strict JSON.parse (readJson unchanged for true-JSON files) | VERIFIED | `infra.test.ts` lines 50, 57, 101, 119 call `readJson()` on true-JSON files (package.json, biome.json). The `readJson` function body at lines 16-19 is unchanged: reads file with `fs.readFileSync`, calls `JSON.parse(raw)` directly. No modifications to non-tsconfig call sites. |
| 4 | `tsconfig.base.json` retains its WR-05 `// ignoreDeprecations` comment intact | VERIFIED | `tsconfig.base.json` lines 17-20 contain the multi-line `// ignoreDeprecations: "6.0"` comment block exactly as written by WR-05. File is unmodified from the WR-05 commit. |

**Score:** 4/4 must-haves verified

### INF-02 Assertions — Specific Verification

The three INF-02 assertions that were previously failing now use `readJsonc(configPath)` at lines 74, 81, and 88 of `infra.test.ts`. Each reads `tsconfig.base.json` through the JSONC-aware helper. The `readJsonc` function at lines 21-36:

1. Uses a single-pass regex with the string-literal alternative first: `("(?:[^"\\]|\\.)*")|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g`
2. The replacer preserves captured string literals and erases comment tokens
3. A second `replace(/,(\s*[}\]])/g, "$1")` removes trailing commas before `}` or `]`
4. Returns `JSON.parse(noTrailingCommas)`

This resolves both code-review BLOCKERs: CR-01 (string values containing `/* */` are protected by the string-literal alternative taking priority) and CR-02 (dangling commas after stripped inline comments are cleaned up).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `tests/scaffold/infra.test.ts` | readJsonc helper present; INF-02 assertions use readJsonc; readJson unchanged for JSON-only files | VERIFIED | readJsonc defined at lines 21-36 with single-pass regex + trailing-comma cleanup. Three INF-02 calls at lines 74, 81, 88 use readJsonc. readJson at lines 16-19 is unchanged. 6 unit tests for readJsonc added in `describe("readJsonc helper")` block at lines 174-220. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `tests/scaffold/infra.test.ts (readJsonc)` | `tsconfig.base.json` | `fs.readFileSync + single-pass comment strip + JSON.parse` | WIRED | Lines 73-90: `readJsonc(configPath)` called three times where `configPath = path.join(REPO_ROOT, "tsconfig.base.json")`. File exists and contains the WR-05 JSONC comment that triggered the original failure. |

### Regression Check (Previously-Passing Items)

All truths from the prior VERIFICATION.md score of 9/10 were re-checked:

- The 4 human verification items carry over unchanged (CI push, pre-commit end-to-end, branch protection, PVR) — these are operational GitHub steps, not code regressions.
- The 10/10 INF requirement truths from the prior verification were not touched by the gap-closure commits (only `tests/scaffold/infra.test.ts` was modified). Spot-checked: all 4 packages still present, tsconfig.base.json flags unchanged, biome.json rules unchanged, vitest.config.ts thresholds unchanged, lefthook.yml unchanged.

No regressions detected.

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite exits 0 | `pnpm test` | 24 test files passed, 176 tests passed, 1 skipped, 0 failed — exit 0 | PASS |
| Typecheck exits 0 | `pnpm typecheck` | No output, exit 0 | PASS |
| INF-02 uses readJsonc | `grep -n "readJsonc" tests/scaffold/infra.test.ts` | Lines 21, 74, 81, 88, 174 — function definition + 3 INF-02 call sites + unit test describe | PASS |
| readJson unchanged (no tsconfig call sites) | `grep -n "readJson" tests/scaffold/infra.test.ts` | Lines 16, 50, 57, 101, 119 — only package.json and biome.json call sites | PASS |
| WR-05 comment in tsconfig.base.json | `grep -n "ignoreDeprecations" tsconfig.base.json` | Lines 17, 21 — comment block + the actual JSON key | PASS |
| No debt markers in modified file | `grep -n "TBD\|FIXME\|XXX" tests/scaffold/infra.test.ts` | 0 matches | PASS |

---

## Anti-Patterns Found

None in the modified file (`tests/scaffold/infra.test.ts`). No unreferenced `TBD`, `FIXME`, or `XXX` markers. No `TODO` or `HACK` markers. No stub patterns (the `readJsonc` unit tests use explicit `writeTmp` helpers that produce real temporary files, not empty returns).

The three pre-existing warnings from the prior VERIFICATION.md remain tracked in `01-REVIEW.md` and are not regressions introduced by this gap closure:
- CR-01 gitleaks self-fire on test file (WARNING, pre-existing)
- CR-02 SHA pinning on Actions (WARNING, pre-existing)
- CR-03 gitleaks binary checksum (WARNING, pre-existing)

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| INF-02 | `tsconfig.base.json` with `strict: true`, `noUncheckedIndexedAccess: true`, target Node 22+ | SATISFIED | `tsconfig.base.json` contains all three flags. `readJsonc` now correctly parses the JSONC file, so all 3 test assertions pass (lines 72-91 of infra.test.ts). |

---

## Human Verification Required

These 4 items are carried over from the initial VERIFICATION.md. They are operational GitHub steps that require a live push or UI access — no code changes can satisfy them.

### 1. GitHub Actions CI Smoke Test

**Test:** Push the `gsd/phase-01-monorepo-scaffold-ci-dev-security` branch to GitHub (or open a PR to main). Observe the GitHub Actions tab.
**Expected:** All 7 CI jobs complete green: lint, typecheck, build, test (Node 22), test (Node 24), coverage-gate, gitleaks-history. changeset-check is PR-only — open a PR to test it.
**Why human:** CI runs only on GitHub. Local environment cannot simulate the GitHub Actions runner.

### 2. Pre-Commit Hook End-to-End Test

**Test:** Stage a file inside the repo containing `-----BEGIN EC PRIVATE KEY-----` then attempt `git commit`.
**Expected:** lefthook runs `gitleaks protect --staged`, gitleaks exits 1 and prints a detection message, and `git commit` is rejected before the commit is created.
**Why human:** End-to-end git hook behavior (lefthook -> gitleaks subprocess -> exit propagation) requires live execution.

### 3. GitHub Branch Protection on Main (D-14)

**Test:** Go to `https://github.com/<your-username>/apruma/settings/branches` and configure the main branch protection rule.
**Expected:** Branch protection rule exists for `main` with: require PR, 1 review, required status checks (lint, typecheck, build, test (22), test (24), coverage-gate, gitleaks-history), linear history. Signed commits: off.
**Why human:** Branch protection is a GitHub Settings action requiring admin PAT or UI access.

### 4. GitHub Private Vulnerability Reporting (D-16)

**Test:** Go to `https://github.com/<your-username>/apruma/security` and enable Private Vulnerability Reporting.
**Expected:** Security tab shows "Private vulnerability reporting enabled".
**Why human:** PVR is a repository-level GitHub Settings toggle that cannot be automated.

---

## Gap Closure Summary

The UAT blocker is closed. The `readJsonc` helper correctly handles JSONC files with `//` line comments and `/* */` block comments, protects string values containing comment-like text, and removes dangling trailing commas. The three INF-02 assertions that were failing with `SyntaxError: Expected double-quoted property name in JSON at position 423` now pass. The code-review BLOCKERs (CR-01, CR-02) were addressed by replacing the two-pass pipeline with a single-pass string-aware regex, confirmed by 6 unit tests.

`pnpm test` exits 0 with 176 passed / 1 skipped / 0 failed. `pnpm typecheck` exits 0. No regressions.

The only remaining open items are the 4 human verification tasks above, which require GitHub UI access and have been open since the initial verification.

---

_Verified: 2026-06-02T12:30:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification after: 01-07 gap closure + code review resolution (commits fe4828d, 1be2651, a04a390)_
