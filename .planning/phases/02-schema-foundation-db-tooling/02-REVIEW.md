---
phase: 02-schema-foundation-db-tooling
reviewed: 2026-05-25T14:00:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - packages/core/tests/helpers/globalSetup.race.test.ts
  - packages/core/tests/globalSetup.ts
findings:
  critical: 1
  warning: 2
  info: 1
  total: 4
status: fixed
---

# Phase 02 Plan 14: Code Review Report (Addendum)

**Reviewed:** 2026-05-25T14:00:00Z
**Depth:** standard
**Files Reviewed:** 2 (plan 02-14 gap-closure delta only)
**Status:** issues_found

## Summary

This addendum reviews the two files changed by plan 02-14: `globalSetup.ts` (GREEN fix — role pre-creation) and `globalSetup.race.test.ts` (RED + RACE-02 tests documenting and asserting the fix boundary). The fix correctly uses PL/pgSQL `EXCEPTION WHEN duplicate_object` to atomically pre-create cluster-global roles before any Vitest worker fork, which is the right mechanism.

One critical defect was found: `teardown()` calls `container.stop()` unconditionally, and the testcontainers v12 library passes `autoRemove=true` to the started container even when constructed via the `withReuse()` path. This means `APRUMO_TEST_REUSE=1` does not actually preserve the container across test runs — teardown destroys it. The reuse feature is silently broken.

Two warnings: the outer `catch` block in `setup()` conflates "Docker unavailable" with unexpected errors from within the role pre-creation block (e.g., `adminSql.end()` failure), causing misleading diagnostic messages. RACE-01 is a vacuous test on every run — if the race does not trigger (timing-dependent), it passes with zero assertions, providing no regression value.

---

## Critical Issues

### CR-01: `teardown()` destroys container when `APRUMO_TEST_REUSE=1` — `withReuse()` is silently inoperative

**File:** `packages/core/tests/globalSetup.ts:74-78`

**Issue:** The `teardown()` function calls `container.stop()` unconditionally:

```typescript
export async function teardown() {
  if (container) {
    await container.stop();
  }
}
```

When `APRUMO_TEST_REUSE=1`, the `builder.withReuse()` flag is set before `builder.start()`. In testcontainers v12, the `reuseContainer()` internal method constructs a `StartedGenericContainer` with `this.autoRemove` as the final argument (see `generic-container.js` line 173):

```javascript
return new StartedGenericContainer(
  container, host, inspectResult, boundPorts, name, waitStrategy,
  this.autoRemove   // ← defaults to true, not reset by withReuse()
);
```

`autoRemove` defaults to `true` and is not altered by `withReuse()`. Consequently, `container.stop()` resolves to `stopContainer({ remove: true, removeVolumes: true })`, which stops **and removes** the container. The next invocation of `APRUMO_TEST_REUSE=1 pnpm test` finds no reusable container and starts a fresh one — incurring the full cold-start penalty every run. The feature documented at line 20 ("Enable container reuse for local dev speed") does not work.

Additionally, the SUMMARY for plan 02-14 reports "APRUMO_TEST_REUSE=1 path is idempotent: EXCEPTION duplicate_object absorbs 42710 on warm container" as a verified check — but this claim cannot be accurate if `teardown()` always destroys the container. The "warm container" scenario never materialises.

**Fix:** Guard `stop()` in `teardown()` so it is not called when the container was started in reuse mode:

```typescript
let useReuseGlobal = false;  // capture at module scope

export async function setup(project: { provide: (key: string, value: unknown) => void }) {
  const useReuse = process.env.APRUMO_TEST_REUSE === "1";
  useReuseGlobal = useReuse;
  // ... rest unchanged
}

export async function teardown() {
  // Do not stop a reused container — it is intentionally long-lived.
  // Only stop containers we own (non-reuse mode).
  if (container && !useReuseGlobal) {
    await container.stop();
  }
}
```

Alternatively, call `container.stop({ remove: false })` in reuse mode to stop the container without removing it, so the Ryuk reaper can later clean it up without interfering with reuse-across-runs semantics.

---

## Warnings

### WR-01: Outer `catch` block conflates "Docker unavailable" with unexpected role-creation errors — misleading diagnostic

**File:** `packages/core/tests/globalSetup.ts:65-71`

**Issue:** The outer `try/catch` that wraps `builder.start()` also implicitly wraps the role-creation block (because the inner `try/catch/finally` only handles its own errors; `adminSql.end()` in the `finally` clause could throw and propagate to the outer catch). The outer catch logs:

```typescript
console.warn(`[globalSetup] Docker unavailable — integration tests will be skipped: ${msg}`);
project.provide("pgUri", "");
```

If `adminSql.end()` throws an unexpected error after `container.start()` succeeds and roles are created, the outer catch would fire, log a misleading "Docker unavailable" message, and provide an empty `pgUri` — causing every integration test to skip. The container was actually started and would be leaked (no teardown because `container` is set but `project.provide("pgUri", "")` sends all workers to the skip path, so no test will call `teardown()` — actually `teardown()` runs unconditionally from the globalSetup lifecycle, so the container would be stopped, but the `pgUri` would be empty and all tests would skip).

The failure window is narrow (postgres-js connection cleanup failure) but the consequence — silently skipping all integration tests and reporting success — is disproportionate.

**Fix:** Separate the catch scopes so "Docker unavailable" is identified correctly. The container-start failure and the role-creation failure are distinct failure modes:

```typescript
try {
  container = await builder.start();
} catch (err) {
  const msg = err instanceof Error ? err.message : String(err);
  console.warn(`[globalSetup] Docker unavailable — integration tests will be skipped: ${msg}`);
  project.provide("pgUri", "");
  return;
}

// Container started — now pre-create roles.
const pgUri = container.getConnectionUri();
const adminSql = postgres(pgUri, { max: 1 });
try {
  await adminSql.unsafe(
    `DO $$ BEGIN CREATE ROLE aprumo_app NOLOGIN NOSUPERUSER; EXCEPTION WHEN duplicate_object THEN NULL; END $$`
  );
  await adminSql.unsafe(
    `DO $$ BEGIN CREATE ROLE aprumo_migration NOLOGIN NOSUPERUSER CREATEDB; EXCEPTION WHEN duplicate_object THEN NULL; END $$`
  );
} catch (roleErr) {
  const roleMsg = roleErr instanceof Error ? roleErr.message : String(roleErr);
  console.warn(`[globalSetup] Role pre-creation failed (non-fatal): ${roleMsg}`);
} finally {
  await adminSql.end();
}

project.provide("pgUri", pgUri);
```

---

### WR-02: RACE-01 is a vacuous test — passes with zero assertions when the race does not trigger

**File:** `packages/core/tests/helpers/globalSetup.race.test.ts:83-100`

**Issue:** The test body conditionally asserts:

```typescript
if (errors.length > 0) {
  const hasDuplicateRole = errors.some(...);
  expect(hasDuplicateRole, ...).toBe(true);
}
```

When the race does not trigger (both `DO/IF NOT EXISTS` blocks serialize due to OS scheduling), `errors.length === 0` and no `expect()` call is ever reached. Vitest marks the test as passed with zero assertions. This is documented by the comment at line 83: "If no errors occurred, the race did not trigger this run — that is OK." However, the consequence is that RACE-01 cannot serve as a regression gate: it cannot distinguish "race confirmed" from "both ran serially." It also cannot catch regressions where the error code changes (e.g., a future Postgres version uses a different SQLSTATE for pg_authid conflicts).

Furthermore, because `Promise.allSettled` is used and both connections share the same single-node test container, the two concurrent `DO` blocks frequently serialize at the Postgres lock level anyway — the race triggers only when both connections pass the `pg_roles` check simultaneously before either acquires the `pg_authid` row lock. On a lightly loaded test runner this is infrequent.

**Fix:** Either accept RACE-01 as pure documentation (move to a comment or a `.skip`-marked test so CI does not count it as a passing assertion), or restructure it to guarantee the race surface. The guaranteed form would create the role from `sqlA`, then set up a `pg_advisory_lock`-based barrier to synchronise both connections at the `CREATE ROLE` decision point. Simpler option: mark the test as `it.skip` with a comment explaining it is a documentation artifact, not a regression gate:

```typescript
it.skip("RACE-01: concurrent CREATE ROLE without EXCEPTION handling produces 23505 on pg_authid (documentation — non-deterministic, see RACE-02 for the regression gate)", async () => {
  // ... body unchanged
});
```

This preserves the documentation value without creating false confidence from a vacuous pass.

---

## Info

### IN-01: `console.warn` in `globalSetup.ts` is consistent with prior convention but deviates from CLAUDE.md structured-logging mandate

**File:** `packages/core/tests/globalSetup.ts:57,69`

**Issue:** CLAUDE.md mandates structured logging (pino) and prohibits `console.log`/`console.error` in production code. The `console.warn` calls in `globalSetup.ts` were present before plan 02-14 (line 69 pre-existed; line 57 was added by plan 02-14). The file is test infrastructure, not published production code, so the risk is low. `console.warn` in `globalSetup.race.test.ts` (lines 39, 121) follows the same established pattern used throughout the test suite for Docker-unavailable skip guards.

This is not a new deviation introduced by plan 02-14 — it mirrors the existing convention. No action required for the new lines; the pre-existing `console.warn` at line 69 is outside the scope of this review.

**Fix:** No change required for test-only infrastructure files. If consistency with the CLAUDE.md mandate is desired for `globalSetup.ts`, route through `process.stderr.write` or use a minimal pino instance — but this is low priority.

---

_Reviewed: 2026-05-25T14:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
