---
phase: 01-monorepo-scaffold-ci-dev-security
plan: "04"
subsystem: infra
tags: [github-actions, ci, pnpm, vitest, changesets, gitleaks, oidc]

# Dependency graph
requires:
  - phase: 01-01
    provides: "pnpm workspace, package.json scripts (pnpm lint, pnpm typecheck, pnpm build, pnpm test)"
  - phase: 01-02
    provides: "vitest.config.ts root with coverage thresholds + lcov reporter"
provides:
  - ".github/actions/setup/action.yml — composite action: pnpm/action-setup@v6 + setup-node@v4 with pnpm cache"
  - ".github/workflows/ci.yml — 7-job CI pipeline (lint, typecheck, build, test matrix, coverage-gate, changeset-check, gitleaks-history)"
  - ".github/workflows/release.yml — Changesets release workflow with OIDC id-token:write (D-23a)"
  - ".github/ISSUE_TEMPLATE/{bug,feature,security}.yml — GitHub issue form templates"
  - ".github/PULL_REQUEST_TEMPLATE.md — PR checklist with TDD + changeset + invariants"
affects:
  - "All future PRs — CI gates enforce lint, typecheck, build, test, coverage, changeset, secret scan"
  - "Phase 9 — release.yml already wired for OIDC publish; D-23b npm Trusted Publisher deferred"

# Tech tracking
tech-stack:
  added:
    - "pnpm/action-setup@v6 (composite action)"
    - "actions/setup-node@v4 with pnpm cache"
    - "changesets/action@v1"
    - "davelosert/vitest-coverage-report-action@v2"
    - "actions/upload-artifact@v4"
    - "gitleaks 8.30.1 (downloaded in CI via curl)"
  patterns:
    - "Composite setup action shared across all CI jobs (no corepack enable — Pitfall 5)"
    - "Coverage-gate on single Node 22 (not matrix) with rationale comment"
    - "changeset-check guarded by if: github.event_name == 'pull_request' (Pitfall 8)"
    - "gitleaks-history uses raw CLI with --config .gitleaks.toml for custom rules"
    - "Release workflow OIDC split: D-23a (GitHub side, Phase 1) vs D-23b (npm side, Phase 9)"

key-files:
  created:
    - ".github/actions/setup/action.yml"
    - ".github/workflows/ci.yml"
    - ".github/workflows/release.yml"
    - ".github/ISSUE_TEMPLATE/bug.yml"
    - ".github/ISSUE_TEMPLATE/feature.yml"
    - ".github/ISSUE_TEMPLATE/security.yml"
    - ".github/PULL_REQUEST_TEMPLATE.md"
  modified: []

key-decisions:
  - "D-12 CI shape: single ci.yml with composite setup action + parallel jobs"
  - "D-13 Concurrency: cancel-in-progress per github.ref"
  - "D-23a delivery: id-token:write + provenance in release.yml (Phase 1)"
  - "D-23b deferred: npm Trusted Publisher setup deferred to Phase 9"
  - "gitleaks-history uses raw CLI curl-install instead of gitleaks-action@v2 to apply .gitleaks.toml custom rules (starkbank-private-key)"
  - "Coverage-gate on Node 22 only (not matrix) — v8 coverage provider is Node built-in, version-orthogonal"

patterns-established:
  - "Pattern: Composite setup action — every job uses ./.github/actions/setup; node-version input defaults to 22"
  - "Pattern: PR-only gates — if: github.event_name == 'pull_request' prevents main-push failures"
  - "Pattern: OIDC release — permissions id-token:write for npm publish without long-lived NPM_TOKEN"

requirements-completed: [INF-08, INF-09, INF-10]

# Metrics
duration: 4m
completed: "2026-05-22"
---

# Phase 01 Plan 04: GitHub Actions CI Pipeline and Community Health Files Summary

**7-job CI pipeline (lint + typecheck + build + test matrix Node 22/24 + coverage gate + changeset check + gitleaks full-history scan) with Changesets OIDC release workflow and GitHub community health files**

## Performance

- **Duration:** ~4m
- **Started:** 2026-05-22T16:14:45Z
- **Completed:** 2026-05-22T16:19:00Z
- **Tasks:** 2 completed
- **Files modified:** 7 created

## Accomplishments

- CI pipeline enforces all quality gates on every PR and push to main: lint (Biome), typecheck (tsc), build, test (Node 22 + 24 matrix, fail-fast:false), coverage-gate (Node 22, davelosert PR comment), changeset-check (PR only), and gitleaks full-history scan with custom starkbank rules
- Release workflow delivers D-23a (GitHub Actions OIDC side: id-token:write) and defers D-23b (npm Trusted Publisher per-package) to Phase 9
- Composite setup action (pnpm/action-setup@v6 + setup-node@v4 with pnpm cache) shared across all jobs — no corepack enable step per Pitfall 5

## Task Commits

Each task was committed atomically:

1. **Task 1: Composite setup action + ci.yml (7 jobs)** - `c9079a4` (feat)
2. **Task 2: Release workflow + GitHub community health files** - `d1eae6d` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `.github/actions/setup/action.yml` — Composite action: pnpm/action-setup@v6 + setup-node@v4 with pnpm cache, no corepack enable
- `.github/workflows/ci.yml` — 7-job CI pipeline with concurrency cancel-in-progress
- `.github/workflows/release.yml` — Changesets release workflow, OIDC id-token:write (D-23a)
- `.github/ISSUE_TEMPLATE/bug.yml` — Bug report form with package/Node version fields
- `.github/ISSUE_TEMPLATE/feature.yml` — Feature request with package multi-select
- `.github/ISSUE_TEMPLATE/security.yml` — Security report with GitHub PVR guidance (D-16)
- `.github/PULL_REQUEST_TEMPLATE.md` — PR checklist: TDD, changeset, CLAUDE.md invariants, no-any

## Decisions Made

- **gitleaks-history implementation:** Plan said to try `gitleaks/gitleaks-action@v2` with `configPath` input; gitleaks-action@v2 does expose a `configPath` input but to guarantee the custom `.gitleaks.toml` rules apply (starkbank-private-key) the job uses raw CLI via curl to download gitleaks 8.30.1 and run `gitleaks detect --config .gitleaks.toml --redact`. This matches the plan's fallback instruction and ensures the custom rule is always applied.
- **D-23a vs D-23b split:** release.yml has both `id-token:write` permission and a comment explaining the split: D-23a (GitHub Actions OIDC side) delivered in Phase 1; D-23b (npm Trusted Publisher per-package on npmjs.com) deferred to Phase 9.

## Deviations from Plan

None — plan executed exactly as written. The gitleaks raw CLI approach (instead of gitleaks-action@v2) was the plan's specified fallback when configPath input behavior was uncertain, so this is plan-compliant.

## Issues Encountered

One commitlint hook failure on Task 1 first commit attempt: body line exceeded 100-character limit (enforced by `@commitlint/config-conventional`). Fixed by reformatting the commit body with line breaks. Not a deviation — this is expected lefthook behavior from Plan 03.

## Known Stubs

None — this plan creates CI configuration files only, no application logic.

## Threat Flags

No new trust boundaries introduced beyond those in the plan's threat model:
- T-1-01 mitigated: gitleaks-history job scans full history with `--config .gitleaks.toml`
- T-1-04 mitigated: release.yml has `environment: release` omitted (D-23b npm side deferred — no publish risk in Phase 1)

## Next Phase Readiness

- CI pipeline is ready; will run as soon as the repo is pushed to GitHub and PR is opened
- Branch protection (D-14) is configured as a manual checkpoint in Plan 06
- Release workflow is ready for Phase 9 when packages are published as v0.1.0
- Plans 05, 06 (Wave 3) can proceed; all Wave 2 plans are complete

---
*Phase: 01-monorepo-scaffold-ci-dev-security*
*Completed: 2026-05-22*
