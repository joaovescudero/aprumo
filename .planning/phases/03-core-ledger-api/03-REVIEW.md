---
phase: 03-core-ledger-api
reviewed: 2026-05-30T00:00:00Z
depth: deep
files_reviewed: 14
files_reviewed_list:
  - packages/core/src/api/server.ts
  - packages/core/src/api/plugins/bigint-serializer.ts
  - packages/core/src/api/errors/app-errors.ts
  - packages/core/src/api/errors/pg-error-handler.ts
  - packages/core/src/api/routes/transactions.ts
  - packages/core/src/api/routes/accounts.ts
  - packages/core/src/api/routes/health.ts
  - packages/core/src/api/schemas/transaction.ts
  - packages/core/src/api/schemas/account.ts
  - packages/core/src/api/schemas/common.ts
  - packages/core/src/lib/with-retry.ts
  - packages/core/src/db/schema.ts
  - packages/core/src/main.ts
  - packages/core/src/index.ts
findings:
  critical: 0
  warning: 4
  info: 2
  total: 6
status: issues_found
---

# Phase 03: Core Ledger API — Code Review Report

**Reviewed:** 2026-05-30
**Depth:** deep (cross-file analysis: import graphs, call chains, contract consistency)
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The implementation correctly wires all mandatory ledger invariants: double-entry via `post_transaction()`, idempotency SELECT-first with concurrent race fallback, SERIALIZABLE isolation with retry, BigInt-as-string serialization, and RFC 9457 problem+json error responses. No critical correctness or security blockers found.

Four warnings were identified: (1) `withRetryOnSerializationFailure` does not unwrap Drizzle's `DrizzleQueryError` wrapper when checking for SQLSTATE 40001, meaning query-level (not COMMIT-level) serialization failures skip retry entirely; (2) `coerceTypes:'array'` applies to request bodies globally, allowing string-typed integers like `"100"` to pass the `amount_cents` validation — fractional amounts are still rejected, but the type contract is weaker than intended; (3) `removeAdditional:'all'` mutates `request.headers` in-place stripping all headers not listed in the schema (a latent footgun for any future handler reading headers after validation); (4) a stale file-header comment still documents the old `coerceTypes: false` value.

Two informational items: route plugins are typed as `FastifyPluginAsync` without `TypeBoxTypeProvider`, requiring manual `as { ... }` casts throughout; and the test for 40001 retry uses a direct-error mock that bypasses the Drizzle wrapping path and so does not prove the retry path works with real Drizzle execution.

---

## Warnings

### WR-01: `withRetryOnSerializationFailure` does not check `error.cause.code` — Drizzle-wrapped 40001 errors skip retry

**File:** `packages/core/src/lib/with-retry.ts:33-36`

**Issue:** The retry detection only reads `err.code` directly. However, Drizzle's `DrizzleQueryError` (thrown when any query inside a `db.transaction()` callback fails) does not carry a `code` property on the wrapper — the original PG `DatabaseError` (including its SQLSTATE `40001`) is stored on `err.cause.code`. When Postgres raises a serialization failure during an intra-transaction query (SELECT, INSERT via SQL template, etc.), Drizzle wraps it in `DrizzleQueryError`, `pgCode` in `withRetryOnSerializationFailure` evaluates to `undefined`, and the function immediately re-throws instead of retrying.

Mitigating factors: for the production driver (`postgres-js`), COMMIT-level 40001 errors propagate as a native `PostgresError` (which carries `code` directly), so the common production path works. The risk applies to intra-transaction 40001 (less common under standard SERIALIZABLE but non-zero), and to every path in the test environment that uses `node-postgres` (where even COMMIT-level 40001 is wrapped by `NodePgSession.transaction`'s `tx.execute(sql\`commit\`)`). The mock in `transactions.test.ts` injects a plain `Error({ code: '40001' })` at the `db.transaction` level, bypassing Drizzle wrapping entirely, so the test passes without proving the actual code path works.

`pgErrorHandler` does check `errAsObj.cause?.code` correctly (see `pg-error-handler.ts:160`). The fix should mirror that pattern in `with-retry.ts`.

**Fix:**
```typescript
// with-retry.ts lines 33-36 — replace:
const pgCode =
  typeof err === "object" && err !== null && "code" in err
    ? (err as { code: unknown }).code
    : undefined;

// with:
const pgCode =
  typeof err === "object" && err !== null
    ? ((err as { code?: unknown }).code ??
       (err as { cause?: { code?: unknown } }).cause?.code)
    : undefined;
```

---

### WR-02: `coerceTypes:'array'` applies to request bodies — string integers pass `amount_cents` validation

**File:** `packages/core/src/api/server.ts:97`

**Issue:** The `coerceTypes:'array'` setting passed to Ajv applies to **all** validation contexts (body, querystring, params, headers) through a single shared Ajv instance. As a result, a client sending `{"amount_cents":"100"}` (string, not integer) will have the value coerced to `100` (integer) and pass the `Type.Integer({ minimum: 1 })` schema. The invariant "accept only integers" is weakened: any whole-number string is silently accepted.

Fractional amounts remain correctly rejected: `"1.5"` coerces to `1.5`, which fails `!(1.5 % 1)`, so the 422 guard still fires. Zero and negative string integers (`"0"`, `"-1"`) are also rejected by `minimum:1`. The money arithmetic itself is unaffected because `BigInt(100)` is correct regardless of whether input was `100` or `"100"`. The money contract is weakened at the type level but not at the value level.

This was raised as a known item in the review brief. Fastify's own `@fastify/ajv-compiler` ships with `coerceTypes:'array'` as its default, so this is no worse than stock Fastify. However, the original `coerceTypes:false` was an explicit, intentional restriction that provided a stricter money-input contract. The correct fix is to scope coercion to querystring/params only, where HTTP string-to-integer coercion is genuinely required.

**Fix (Fastify per-context Ajv — prevents body coercion while enabling querystring coercion):**
```typescript
// server.ts — replace the single ajv: { customOptions: {...} } block with:
ajv: {
  customOptions: {
    coerceTypes: false,     // body/headers/params: no coercion
    removeAdditional: "all",
    useDefaults: true,
  },
},
// Then override for querystring only via schemaController:
// app.setValidatorCompiler(buildCompilerForQuerystring)
// OR use Fastify's built-in per-context ajv override via addSchema hooks.
//
// Simpler alternative (same safety as current, explicit documentation):
// Keep coerceTypes:'array' but add a custom validator for amount_cents
// that rejects typeof amount_cents === 'string' before BigInt conversion:
if (typeof body.postings[n]?.amount_cents !== 'number') {
  throw new ValidationError('amount_cents must be a number, not a string');
}
```

---

### WR-03: `removeAdditional:'all'` mutates `request.headers` in-place — all non-schema headers stripped after validation

**File:** `packages/core/src/api/server.ts:98` (combined effect with `packages/core/src/api/routes/transactions.ts:102`)

**Issue:** Ajv's `removeAdditional:'all'` modifies the validated data object in place. Fastify passes `request.headers` directly to the Ajv validator for header schema validation (see `fastify/lib/validation.js:validateParam`). `PostTransactionHeadersSchema` only declares `idempotency-key`. After validation of any POST `/transactions` request, `request.headers` is mutated: only `idempotency-key` remains — `content-type`, `host`, `connection`, `accept`, `authorization`, and any other headers are deleted from the live object.

This does not cause immediate failures in the current handlers because:
- Fastify reads `content-type` for body parsing **before** schema validation runs (line 166 before line 193 in `validation.js`)
- The pino serializer captures headers in the `onRequest` hook, before validation
- The POST `/transactions` handler only reads `request.headers["idempotency-key"]`

However, this is a latent footgun: any middleware or hook registered **after** validation that reads `request.headers` (e.g. CORS middleware, auth hooks, rate-limiting decorators) will see a stripped object. The correct fix is to avoid applying `removeAdditional` to headers by using per-context Ajv instances, or by removing the headers schema (relying on Ajv's `required` check only) and not applying `removeAdditional` to it.

**Fix:**
```typescript
// Use Fastify's schemaController to configure per-context Ajv.
// For the immediate fix, avoid removeAdditional:'all' globally —
// change to removeAdditional:'true' (only strips when schema has additionalProperties:false).
// TypeBox Type.Object() does NOT emit additionalProperties:false by default,
// so 'true' will not strip anything from body/headers/params that use Type.Object().

ajv: {
  customOptions: {
    coerceTypes: "array",
    removeAdditional: true,  // was 'all'; 'true' only strips when additionalProperties:false
    useDefaults: true,
  },
},
```

Note: with `removeAdditional:'true'` and TypeBox schemas (which don't set `additionalProperties:false` by default), no additional stripping occurs for body or headers. Only schemas explicitly setting `additionalProperties: false` would trigger stripping — which is the intended controlled behavior.

---

### WR-04: Stale file-header comment documents removed `coerceTypes: false` setting

**File:** `packages/core/src/api/server.ts:15`

**Issue:** The wiring-order comment block at the top of the file still documents `coerceTypes: false — never silently coerce types (Pitfall 3 prevention)`. The actual setting was changed to `coerceTypes: 'array'` in Plan 03-06 (per `03-06-SUMMARY.md`), and the inline comment near the actual code (lines 90–94) was updated, but the file-header summary comment was not. A future reader or reviewer will encounter contradictory documentation in the same file.

**Fix:**
```typescript
// Replace line 15:
//   coerceTypes: false    — never silently coerce types (Pitfall 3 prevention)
// with:
//   coerceTypes: 'array'  — enables querystring integer coercion (D-06); also applies
//                           to request bodies (see D-06 discussion in inline comment below)
```

---

## Info

### IN-01: Route plugins typed as `FastifyPluginAsync` without `TypeBoxTypeProvider` — manual casts required throughout handlers

**File:** `packages/core/src/api/routes/transactions.ts:87`, `packages/core/src/api/routes/accounts.ts:104`

**Issue:** Both route plugins are declared as `FastifyPluginAsync<Options>` (generic Fastify plugin) rather than the type-provider-aware variant. As a result, `request.body`, `request.params`, and `request.query` are typed as `unknown` inside handlers, requiring manual `as { ... }` casts (e.g. `request.body as { postings: Array<...> }`). These casts silently bypass TypeScript's structural checking — if the TypeBox schema changes, the cast won't flag divergence.

The schemas still validate the runtime values correctly; this is a type-safety ergonomics issue, not a runtime bug. Fastify supports fully typed plugin registration via `FastifyPluginAsyncTypebox` from `@fastify/type-provider-typebox`.

**Fix:**
```typescript
// transactions.ts / accounts.ts — change plugin type:
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";

export const transactionRoutes: FastifyPluginAsyncTypebox<TransactionRouteOptions> =
  async (fastify, opts) => {
    // request.body is now typed as Static<typeof PostTransactionBodySchema>
    // No manual `as { ... }` casts needed
  };
```

---

### IN-02: 40001 retry integration test uses direct error mock — does not exercise Drizzle wrapping path

**File:** `packages/core/src/api/routes/transactions.test.ts:273-280`

**Issue:** The test for "route-level 40001 retry (SC#4)" spies on `drizzleDb.transaction` and rejects with a plain `Error({ code: '40001' })`. This bypasses the actual Drizzle execution path entirely. The test proves the retry mechanism wires correctly at the `db.transaction` boundary, but does not prove that `withRetryOnSerializationFailure` correctly detects a real 40001 from PG (which, in the node-postgres test driver, would arrive as `DrizzleQueryError(cause.code='40001')`). See WR-01 for the underlying gap.

A complementary integration test that injects a real 40001 via SQL (`SET transaction_isolation TO serializable; SELECT pg_sleep(0)` in a concurrent session to force conflict) would provide complete coverage.

**Fix:** Add a note to the test and/or a separate test that validates the `cause.code` path (or fix WR-01 first, then verify the mock still passes).

---

## Findings Not Raised (Assessed and Closed)

**pgErrorHandler message leak for `not_found` / `invalid_cursor`:** The `detail` field in 404 and 400 responses uses `error.message ?? "..."`. For `not_found`, the message is `"Transaction ${id} not found"` (set by the handler). This exposes the UUID the client already sent — not a meaningful information leak. For `invalid_cursor`, the message is a fixed string set by the throwing code. The P0001 DB message (`errAsObj.cause?.message`) is checked for balance validation but never exposed in the response body. No issue.

**Idempotency 200 fallback after retry exhaustion:** The concurrent duplicate fallback (`try/catch` around `withRetryOnSerializationFailure` in `transactions.ts:187-211`) correctly returns 200 when a concurrent request committed the same key. Pattern is sound.

**BigInt serialization two-layer approach:** `setSerializerCompiler` + `setReplySerializer` dual registration is correct and covers both schema-validated and schema-less routes. No issue.

**Cursor pagination keyset correctness:** `ORDER BY created_at DESC, id DESC` paired with `(created_at < cursorDate) OR (created_at = cursorDate AND id < cursorId)` is a correct keyset pagination pattern. UUID lexicographic comparison for the tiebreaker is arbitrary but consistent and does not cause pagination skips or duplicates.

**Health endpoint error detail:** 503 response returns fixed string `"unreachable"` — no internal error details or connection string leaked. Correct.

**Database string interpolation:** All user-supplied values in `post_transaction()` call use Drizzle `sql` template parameterization. No SQL injection surface.

**Append-only invariants in schema:** `postings` and `raw_events` have `REVOKE INSERT` (migration 0007) and `REVOKE UPDATE, DELETE` (migration 0002) for the `aprumo_app` role. Schema correctly models this.

---

_Reviewed: 2026-05-30_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
