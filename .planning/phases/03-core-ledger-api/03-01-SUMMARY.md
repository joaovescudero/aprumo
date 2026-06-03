---
phase: 03-core-ledger-api
plan: "01"
subsystem: core
tags:
  - fastify
  - typebox
  - swagger
  - packages
  - dependencies
dependency_graph:
  requires:
    - "02-14: Phase 2 schema + tooling complete"
  provides:
    - "fastify 5 ecosystem resolvable in @aprumo/core"
    - "prerequisite for Plans 03-03 through 03-07"
  affects:
    - "packages/core (runtime + dev deps)"
tech_stack:
  added:
    - "fastify@5.8.5"
    - "@fastify/swagger@9.7.0"
    - "@fastify/swagger-ui@5.2.6"
    - "@fastify/type-provider-typebox@5.2.0"
    - "@sinclair/typebox@0.34.49"
    - "pino-pretty@13.1.3 (dev)"
  patterns:
    - "TypeBox as Fastify type provider (v5 plugin series, @sinclair/typebox peer)"
    - "pnpm --filter workspace install pattern"
key_files:
  modified:
    - path: "packages/core/package.json"
      why: "Added 5 runtime deps + 1 devDep for Fastify 5 ecosystem"
    - path: "pnpm-lock.yaml"
      why: "Updated lockfile with new package resolutions"
decisions:
  - "@fastify/type-provider-typebox downgraded to 5.2.0 (from plan's 6.1.0): v6 switched peer dep from @sinclair/typebox to standalone typebox@1.x — incompatible with @sinclair/typebox@0.34.49 specified in the plan. v5.2.0 explicitly supports @sinclair/typebox >=0.26 <=0.34 with no peer warning."
metrics:
  duration: "6m 5s"
  completed_date: "2026-05-30"
  tasks_completed: 2
  files_modified: 2
---

# Phase 3 Plan 01: Fastify Ecosystem Package Install Summary

Installed Fastify 5 ecosystem runtime deps and pino-pretty devDep into `@aprumo/core`, unblocking all API implementation plans (03-03 through 03-07). All 6 packages resolve cleanly; `pnpm typecheck` exits 0.

## Tasks Completed

| Task | Type | Description | Commit |
|------|------|-------------|--------|
| 1 | checkpoint:human-verify | Package legitimacy verified by user (npmjs.com check) | — |
| 2 | auto | Install fastify ecosystem packages into @aprumo/core | 499edee |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Downgraded @fastify/type-provider-typebox from 6.1.0 to 5.2.0**
- **Found during:** Task 2
- **Issue:** Plan specified `@fastify/type-provider-typebox@6.1.0` + `@sinclair/typebox@0.34.49`. Version 6.1.0 of the plugin has a breaking peer dependency change: it requires the standalone `typebox` package (v1.x by sinclairzx81), NOT `@sinclair/typebox`. The internal `dist/cjs/index.js` uses `require("typebox/compile")` — not the `@sinclair/typebox` package. Running v6.1.0 + @sinclair/typebox@0.34.49 would cause runtime resolution failures.
- **Fix:** Downgraded `@fastify/type-provider-typebox` to `5.2.0` which explicitly declares `peerDependencies: { "@sinclair/typebox": ">=0.26 <=0.34" }` — fully compatible with the planned `@sinclair/typebox@0.34.49`. v5.2.0 supports Fastify 5.x.
- **Files modified:** `packages/core/package.json`, `pnpm-lock.yaml`
- **Commit:** 499edee

## Self-Check

### Files Exist
- [x] `packages/core/package.json` — modified with all 6 packages
- [x] `pnpm-lock.yaml` — updated

### Commits Exist
- [x] 499edee: chore(03-01): install fastify 5 ecosystem packages in @aprumo/core

### Verification Results
- `node -e "require('./packages/core/node_modules/fastify')"` → exits 0
- All 6 packages present in package.json (dependencies + devDependencies)
- `pnpm typecheck` → exits 0, no new TS errors
- No peer dependency warnings after downgrade

## Self-Check: PASSED
