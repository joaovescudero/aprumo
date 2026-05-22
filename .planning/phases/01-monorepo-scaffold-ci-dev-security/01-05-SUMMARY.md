---
phase: 01-monorepo-scaffold-ci-dev-security
plan: "05"
subsystem: infra
tags: [changesets, versioning, ci-gate, pnpm, tdd-green]

# Dependency graph
requires:
  - phase: 01-04
    provides: ".github/workflows/ci.yml changeset-check job that calls pnpm changeset status --since=main"
  - phase: 01-00
    provides: "tests/ci/changeset-gate.test.ts — RED tests for INF-09/INF-10"
provides:
  - ".changeset/config.json — Changesets configuration per D-24 (access:public, updateInternalDependencies:patch, baseBranch:main)"
  - "scripts/changeset-required.sh — local CI gate simulation script"
affects:
  - "tests/ci/changeset-gate.test.ts — 4 RED assertions flip to GREEN"
  - "All future PRs — pnpm changeset:check runnable locally to reproduce CI gate"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Changesets independent versioning: linked:[] ensures each @aprumo/* package versions independently"
    - "updateInternalDependencies:patch: when package A depends on B and B bumps, A auto-patches"
    - "changeset:check script delegates to bash scripts/changeset-required.sh (local == CI)"

key-files:
  created:
    - path: ".changeset/config.json"
      description: "Changesets config: access:public, updateInternalDependencies:patch, baseBranch:main, linked:[], commit:false, privatePackages.version:true"
    - path: "scripts/changeset-required.sh"
      description: "Executable bash script simulating CI changeset-check gate locally"
  modified:
    - path: "package.json"
      description: "changeset:check script updated from direct changeset invocation to bash scripts/changeset-required.sh"

key-decisions:
  - "D-24 delivered: .changeset/config.json fields exactly as specified"
  - "D-22: changesets/action reads this config for package access and internal deps"
  - "D-23b confirmed deferred: no packages in ignore[] — all 4 @aprumo/* are publishable from Phase 1"
  - "changeset:check delegates to scripts/changeset-required.sh for single source of truth between local and CI"

requirements-completed: [INF-09, INF-10]

# Metrics
duration: 3m
completed: "2026-05-22"
tasks_completed: 1
files_created: 2
files_modified: 1
tests_green_flip: 4
---

# Phase 01 Plan 05: Changesets Configuration Summary

**Changesets configuration for independent per-package versioning with CI gate: .changeset/config.json (access:public, updateInternalDependencies:patch, linked:[]) + scripts/changeset-required.sh; INF-09 and INF-10 fully implemented, Wave 0 changeset-gate tests flip GREEN.**

## Performance

- **Duration:** ~3m
- **Started:** 2026-05-22T16:21:00Z
- **Completed:** 2026-05-22T16:24:00Z
- **Tasks:** 1 completed
- **Files modified:** 2 created, 1 modified

## Accomplishments

- `.changeset/config.json` created with all required D-24 fields: `access:"public"`, `updateInternalDependencies:"patch"`, `baseBranch:"main"`, `linked:[]` (independent per-package versioning per INF-09), `commit:false`, `privatePackages:{version:true,tag:false}`
- `scripts/changeset-required.sh` created and made executable — simulates CI `changeset-check` gate locally so developers can reproduce CI with `pnpm changeset:check` before pushing
- `package.json` `changeset:check` script updated to delegate to `bash scripts/changeset-required.sh` (single source of truth)
- Wave 0 `tests/ci/changeset-gate.test.ts`: 4 RED assertions flipped to GREEN; full suite now 32/32 passing
- `pnpm changeset status --since=main` exits 1 on main (publishable packages changed, no changeset file present) — correct gate behavior

## Task Commits

Each task was committed atomically:

1. **Task 1: .changeset/config.json + scripts/changeset-required.sh + package.json** - `3230def` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `.changeset/config.json` — access:public, updateInternalDependencies:patch, baseBranch:main, linked:[], commit:false, privatePackages
- `scripts/changeset-required.sh` — executable bash script: `set -e; pnpm changeset status --since=main`
- `package.json` — changeset:check now: `bash scripts/changeset-required.sh`

## Decisions Made

- **No packages in `ignore[]`:** All 4 `@aprumo/*` packages are publishable from Phase 1. D-23b (npm Trusted Publisher per-package) is deferred to Phase 9, but the config is ready.
- **`privatePackages: { version: true, tag: false }`:** The root `aprumo` package is private; this prevents Changesets from erroring when computing version bumps on the root while still not tagging it.
- **`commit: false`:** Changesets does NOT auto-commit version bumps — developer controls all commits, matching project convention.

## Deviations from Plan

None — plan executed exactly as written.

## TDD Gate Compliance

This plan is the GREEN phase for the Wave 0 RED tests created in Plan 00.

- `test(01-00)` commits (RED gate): 59d956f, 62e0cc2
- `feat(01-05)` commit (GREEN gate): 3230def

Wave 0 RED → GREEN gate transition confirmed:
- Before: 4 failing assertions in changeset-gate.test.ts (config.json does not exist)
- After: 32/32 tests passing (all RED assertions GREEN)

## Known Stubs

None — this plan creates configuration files only, no application logic.

## Threat Surface Scan

No new security-relevant surface introduced. The `.changeset/config.json` is a local tooling config; `scripts/changeset-required.sh` invokes `pnpm changeset status` (read-only). Threat model items T-1-04 (premature npm publish) remain mitigated: no publish step is triggered by this config in Phase 1.

## Self-Check: PASSED

Files verified to exist:
- .changeset/config.json: EXISTS
- scripts/changeset-required.sh: EXISTS (executable -rwxr-xr-x)

Commit verified:
- 3230def: EXISTS (feat(01-05): add Changesets config...)

Test suite: 32/32 GREEN confirmed.
