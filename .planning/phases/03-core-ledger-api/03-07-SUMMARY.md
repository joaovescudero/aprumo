---
phase: 03-core-ledger-api
plan: "07"
subsystem: core-api
tags:
  - health-check
  - entrypoint
  - swagger
  - tdd
  - phase-close
dependency_graph:
  requires:
    - 03-06  # accounts routes
    - 03-05  # transaction routes
    - 03-04  # server factory + BigInt serializer
  provides:
    - GET /health liveness + readiness endpoint with PG SELECT 1 check
    - main.ts server entrypoint (all routes wired, SIGTERM graceful shutdown)
    - public exports in @aprumo/core index.ts
  affects:
    - packages/core/package.json (start + dev scripts)
    - packages/core/src/index.ts (public API surface)
tech_stack:
  added:
    - main.ts: production entrypoint using drizzle-orm/postgres-js + postgres.js
  patterns:
    - TDD Red→Green cycle for health route
    - vi.spyOn stub for PG-down simulation (no container manipulation)
    - Catch-without-binding for 503 (no err.message in response)
key_files:
  created:
    - packages/core/src/api/routes/health.ts
    - packages/core/src/api/routes/health.test.ts
    - packages/core/src/main.ts
  modified:
    - packages/core/src/index.ts
    - packages/core/package.json
decisions:
  - D-07 confirmed: single /health endpoint (no /health/live + /health/ready split in v0.1)
  - T-03-07a enforced: catch clause with no variable binding; 503 body uses fixed 'unreachable' string
  - main.ts: DATABASE_URL validation at startup; value never logged (T-03-07b, CLAUDE.md §logging)
  - main.ts: SIGTERM handler closes app + pgClient before process.exit(0) (T-03-07c)
metrics:
  duration: "350s"
  completed_at: "2026-05-30T12:00:00Z"
  tasks_completed: 4
  files_created: 3
  files_modified: 2
---

# Phase 3 Plan 07: Health Check, main.ts Entrypoint, Phase Close Summary

**One-liner:** GET /health with PG SELECT 1 liveness check, main.ts wiring all route plugins with SIGTERM shutdown, and coverage gate confirmed at 90.14% lines (≥90% threshold met).

## Objective

Final Phase 3 plan: implement the `GET /health` route plugin with real PG liveness check (D-07), wire `main.ts` as the server entrypoint registering all route plugins, update `index.ts` public exports, and confirm the coverage gate before the phase closes.

## Tasks Completed

| # | Task | Commit | Result |
|---|------|--------|--------|
| 1 | TDD RED — write failing health.test.ts | 257e36a | 4 test cases; exits non-zero (Cannot find module) |
| 2 | TDD GREEN — implement health.ts | f76a301 | All 4 tests GREEN; typecheck passes; err.message absent from 503 |
| 3 | Wire main.ts entrypoint + update index.ts | 3e142e4 | main.ts exists; index.ts exports createServer; typecheck passes |
| 4 | Coverage gate ≥90% LoC (auto-verified) | — | Lines: 90.14% — gate met |

## TDD Gate Compliance

| Gate | Commit | Status |
|------|--------|--------|
| RED (test commit) | 257e36a | test(03-07): add failing health route tests (RED) |
| GREEN (feat commit) | f76a301 | feat(03-07): implement GET /health route plugin (GREEN) |

Both gates present in git log. Plan type `tdd` compliance confirmed.

## What Was Built

### health.ts — GET /health route plugin

- `FastifyPluginAsync<HealthRouteOptions>` registered WITHOUT `/v1` prefix (D-07)
- PG liveness: `await db.execute(sql\`SELECT 1\`)` → 200 `{ status: 'ok', postgres: 'up' }`
- Failure path: catch clause with no variable binding → 503 `{ status: 'error', postgres: 'unreachable' }`
- T-03-07a enforced: fixed string 'unreachable' — internal PG error details never exposed to callers
- TypeBox response schema for both 200 and 503 shapes

### health.test.ts — Integration tests (4 test cases)

- `GET /health returns 200 when PG is up`: inject, assert 200 + `{status:'ok', postgres:'up'}`
- `GET /health returns 503 when db.execute throws`: `vi.spyOn(drizzleDb, 'execute').mockRejectedValueOnce(...)`, assert 503 + error shape
- `GET /docs returns 200`: swagger UI registration confirmed
- `GET /docs/json has amount_cents as type string`: OpenAPI spec contains `"amount_cents"` and `"type":"string"` (API-13)

### main.ts — Server entrypoint

- Validates `DATABASE_URL` at startup; throws with clear message if missing (T-03-07b)
- Creates `postgres.js` client + `drizzle-orm/postgres-js` instance
- Calls `createServer(db)` → registers `transactionRoutes`, `accountRoutes`, `healthRoutes`
- Route registration order matches server.ts comments (transactionRoutes → accountRoutes → healthRoutes)
- `SIGTERM` handler: `app.close()` → `pgClient.end()` → `process.exit(0)` (T-03-07c)
- Listens on `process.env.PORT ?? 3000` on `0.0.0.0`
- `DATABASE_URL` value never logged (T-03-07b enforcement)

### index.ts — Updated public exports

- `export { createServer }` + `export type { AnyDrizzleDb, ServerOptions }` from `./api/server.js`
- `export * from './db/schema.js'` for downstream consumer access
- `main.ts` is NOT exported (entrypoint only)

### package.json — New scripts

- `"start": "node dist/main.js"` — production start after build
- `"dev": "tsx watch src/main.ts --env-file=../../.env"` — development watch mode

## Coverage Gate

```
Lines        : 90.14% ( 302/335 )    ← GATE: ≥90% PASSED
Statements   : 89.01% ( 308/346 )
Branches     : 74.33% ( 139/187 )
Functions    : 81.13% ( 43/53 )
```

## Known Flake

The pre-existing test `tests/helpers/applyMigrationsToSchema.test.ts > Test 6 (idempotent)` intermittently fails with `PostgresError 42P07 "relation account_balance already exists"` (phase-2 test-infra state-leak bug). This was observed once during the coverage run. A second run passed cleanly. This flake is tracked separately for `/gsd-debug` — it is NOT related to this plan's changes. Coverage threshold was confirmed on the clean re-run.

## Verification Results

| Check | Result |
|-------|--------|
| `pnpm --filter @aprumo/core test` (full suite) | PASS (103 passed, 1 skipped; known flake observed once) |
| `pnpm --filter @aprumo/core test --coverage` | PASS — Lines 90.14% ≥ 90% |
| `pnpm --filter @aprumo/core typecheck` | PASS (clean) |
| `pnpm typecheck` (root) | PASS (clean) |
| `pnpm --filter @aprumo/core lint` | PASS (2 warnings, 0 errors) |
| `GET /health` 200 PG up | PASS (test confirmed) |
| `GET /health` 503 PG down (stub) | PASS (test confirmed) |
| `GET /docs` 200 swagger UI | PASS (test confirmed) |
| `GET /docs/json` amount_cents type:string | PASS (test confirmed) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Biome import-order violations**
- **Found during:** Task 1, 2, 3 commit hooks
- **Issue:** Biome `organizeImports` required consistent ordering (external packages before internal; alphabetically within groups). Three files needed import reordering: `health.test.ts`, `health.ts`, `main.ts`.
- **Fix:** Reordered imports in all three files to satisfy Biome `assist/source/organizeImports` rule.
- **Files modified:** `health.test.ts`, `health.ts`, `main.ts`

**2. [Rule 3 - Blocking] Biome `useLiteralKeys` in main.ts**
- **Found during:** Task 3 commit hook
- **Issue:** `process.env["DATABASE_URL"]` and `process.env["PORT"]` flagged as `lint/complexity/useLiteralKeys` — simplifiable to `process.env.DATABASE_URL` / `process.env.PORT`.
- **Fix:** Changed to dot-notation access in `main.ts`.
- **Files modified:** `main.ts`

**3. [Rule 3 - Blocking] Biome organizeImports for index.ts exports**
- **Found during:** Task 3 commit hook
- **Issue:** `export type {...}` must precede `export {...}` from the same module path in Biome ordering.
- **Fix:** Reordered to `export type { AnyDrizzleDb, ServerOptions }` before `export { createServer }`.
- **Files modified:** `index.ts`

## Threat Surface Scan

No new security-relevant surface beyond what the plan's `<threat_model>` documented. All mitigations verified:
- T-03-07a: `health.ts` catch clause uses no variable binding; 503 response hardcoded to `'unreachable'`
- T-03-07b: `main.ts` logs only `{ port }` at startup; `DATABASE_URL` value never reaches pino
- T-03-07c: `process.on('SIGTERM', ...)` handler implemented and closes DB connections before exit
- T-03-07d: `DATABASE_URL` env var access is standard; no application-level logging of its value
- T-03-07e: `/docs` unauthenticated (accepted for v0.1 OSS self-hosted)

## Known Stubs

None. All exported modules have real implementations. `index.ts` re-exports from real modules.

## Phase 3 Closure

All 13 API requirements (API-01..API-13) addressed across Plans 03-01..03-07:
- API-01: Fastify configured (03-04)
- API-02: BigInt → string serializer (03-04)
- API-03/04/05/06: POST/GET transactions (03-05)
- API-07/08/09: POST/GET accounts + postings pagination (03-06)
- API-10: withRetryOnSerializationFailure (03-01)
- API-11: pgErrorHandler (03-03)
- API-12: GET /health (03-07) ← this plan
- API-13: OpenAPI docs + amount_cents string type (03-04/07) ← verified this plan

## Self-Check: PASSED

| Item | Status |
|------|--------|
| packages/core/src/api/routes/health.ts | FOUND |
| packages/core/src/api/routes/health.test.ts | FOUND |
| packages/core/src/main.ts | FOUND |
| packages/core/src/index.ts (modified) | FOUND |
| RED commit 257e36a | FOUND |
| GREEN commit f76a301 | FOUND |
| Task 3 commit 3e142e4 | FOUND |
