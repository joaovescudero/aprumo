---
status: open
created: 2026-05-30
origin: phase-03 execution (post-merge + verification gates)
severity: medium
type: test-infra-flake
---

# Flake: applyMigrationsToSchema Test 6 (idempotent re-apply) — 42P07

## Symptom
`tests/helpers/applyMigrationsToSchema.test.ts > Test 6 (running applyMigrationsToSchema twice on same schema does not fail / idempotent)` intermittently fails with:
`PostgresError 42P07 — relation "account_balance" already exists` (migration 0000_init_tables CREATE TABLE).

## Reproduction profile (measured during phase-03 execution)
- Full suite: fails ~25–40% of runs.
- File alone (`vitest run tests/helpers/applyMigrationsToSchema.test.ts`): 6/6 green, never fails.
- `maxForks: 4`: still flakes (~1/4). `maxForks: 1` (fully serial): STILL flakes (2/4).
  => NOT a parallelism/concurrency problem. Disproven.

## Diagnosis (partial)
Schema is file-unique (`computeSchemaName(import.meta.url)` = `test_<sha1>`), only Test 5→Test 6 write it, sequentially. For Test 6 to hit 42P07, migration 0000's hash must be ABSENT from `<schema>.__drizzle_migrations` while its tables EXIST. Two contributing latent defects in `tests/helpers/applyMigrationsToSchema.ts`:
1. Test 5 only asserts tables exist, never that 0000's tracking hash was recorded → can pass with tracking desynced.
2. Runner does `SET search_path = <schema>,public` (public leaks) and migration 0000 uses bare `CREATE TABLE` (no IF NOT EXISTS) → non-idempotent on re-apply.
Trigger appears tied to leftover GLOBAL postgres state from prior test files in the shared container (roles are cluster-global; createTestDb notes ALTER ROLE is cluster-level). Exact state-leak path NOT yet pinned.

## Not the cause
- Not phase-3 production code. All phase-3 API code verified, real tests pass.
- Not coverage (separate, already fixed).

## Candidate fixes (for /gsd-debug to evaluate)
- Make applyMigrationsToSchema idempotency record-and-skip on "already exists" DDL codes (42P07/42P06/42710) scoped to test infra — but understand WHY tracking desyncs first.
- Or: have Test 5 assert the tracking row count, exposing the real desync deterministically.
- Or: isolate global role/ALTER ROLE setup out of per-schema migration application.

## Next step
`/gsd-debug` — reproduce with __drizzle_migrations dump at failure, pin the state-leak.
