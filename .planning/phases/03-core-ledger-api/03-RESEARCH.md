# Phase 3: Core Ledger API - Research

**Researched:** 2026-05-29
**Domain:** Fastify 5 REST API, Drizzle ORM, BigInt JSON serialization, SERIALIZABLE transaction retry, idempotency
**Confidence:** HIGH

---

## Summary

Phase 3 builds the HTTP surface of the ledger on top of the schema and `post_transaction` function delivered by Phase 2. Every invariant from `CLAUDE.md` must be enforced at the API layer — not reimplemented, because the SQL layer already enforces them — but properly surfaced: errors mapped to HTTP status codes, idempotent duplicates returning 200, serialization failures retried in application code.

The two highest-risk areas in this phase are **BigInt JSON serialization** and the **concurrent idempotency race**. Both have complete solutions in place: `setSerializerCompiler` with a custom replacer handles BigInt globally; `post_transaction`'s `EXCEPTION WHEN unique_violation` block (migration `0008`) already handles the concurrent-duplicate race at the Postgres layer — the API just needs to call the function and relay the result. The `withRetryOnSerializationFailure` wrapper must wrap the **entire** `db.transaction()` call, not just the inner SQL statement — this is a critical distinction documented in the PostgreSQL official docs.

The stack is fully locked by ADRs in `docs/adr/`. TypeBox as the type provider is recommended over raw JSON Schema for type-safe route handlers, but this is implementation discretion. The test strategy reuses the existing `createTestDb()` / `testcontainers` infrastructure from Phase 2 combined with Fastify's built-in `app.inject()` — no network listener needed for integration tests.

**Primary recommendation:** Use Fastify 5.8.5 with `@fastify/type-provider-typebox` for type-safe schema → TS inference, `setSerializerCompiler` for global BigInt → string serialization, `@fastify/swagger` + `@fastify/swagger-ui` for OpenAPI generation, and `app.inject()` for integration tests using the existing Phase 2 testcontainers shared PG container.

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| API-01 | Fastify 5+ configured with `coerceTypes: false`, JSON Schema validation, `@fastify/swagger` | Fastify 5 Ajv config `coerceTypes: false`; TypeBox type provider; @fastify/swagger 9.7.0 |
| API-02 | Custom BigInt → JSON string serializer; `JSON.stringify(bigint)` never allowed raw | `setSerializerCompiler` with replacer; TypeBox schema types `Type.String()` for amount fields |
| API-03 | `POST /transactions` accepts postings + `Idempotency-Key` header; calls `post_transaction()`; returns 201 | Drizzle `db.execute(sql\`SELECT post_transaction(...)\`)`; SERIALIZABLE tx; TypeBox body schema |
| API-04 | `POST /transactions` rejects unbalanced postings with 422 | Error handler maps PG ERRCODE `P0001` message containing "do not balance" → 422 |
| API-05 | Idempotency: duplicate `Idempotency-Key` returns 200 with original tx, no reprocessing | `post_transaction` migration 0008 handles concurrent duplicate at PG layer; API relays result |
| API-06 | `GET /transactions/:id` returns transaction + postings ordered | Drizzle select with join on `postings`; TypeBox params schema |
| API-07 | `POST /accounts` creates account with `type` + `metadata` | Drizzle insert into `accounts`; TypeBox body validation with enum check |
| API-08 | `GET /accounts/:id` returns metadata + materialized balance from `account_balance` | Drizzle left join `accounts` + `account_balance`; balance may be null if worker hasn't run |
| API-09 | `GET /accounts/:id/postings?cursor=&limit=` cursor-paginated by `posting.id` desc | Drizzle select with `where(gt(postings.id, cursor))`; TypeBox querystring schema |
| API-10 | `withRetryOnSerializationFailure` wrapper: retry entire `db.transaction()` on SQLSTATE 40001, up to 3x with backoff | Wrap entire function; PG docs confirm full-tx retry required; detect by `error.code === '40001'` |
| API-11 | Error handler: 40001 exhausted → 503, validation → 422, idempotency conflict → 200 | Fastify `setErrorHandler`; discriminate by PG error code + custom error classes |
| API-12 | `GET /health` liveness + readiness with PG check | Simple route with `db.execute(sql\`SELECT 1\`)` |
| API-13 | OpenAPI spec generated automatically; `amount_cents` documented as JSON string | `@fastify/swagger` with `openapi: {}` config; TypeBox `Type.String()` with description for BigInt fields |

</phase_requirements>

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| HTTP routing + validation | API / Backend (Fastify) | — | All business logic lives server-side; no client component |
| Double-entry enforcement | Database (PG function) | API (maps errors) | `post_transaction` SQL enforces; API surfaces error as HTTP 422 |
| Idempotency deduplication | Database (UNIQUE constraint + exception handler) | API (passes key, relays result) | Race-safe handling at PG layer in migration 0008 |
| SERIALIZABLE retry | API / Backend (TS wrapper) | — | PG cannot retry automatically; app code must wrap entire tx |
| BigInt JSON serialization | API / Backend (Fastify serializer) | — | JS/JSON boundary concern; keep DB mode as `bigint` for precision |
| Cursor pagination | API / Backend (Drizzle query) | Database (index on postings.id) | Query logic in TS; DB index makes it fast |
| Health check | API / Backend (Fastify route) | Database (SELECT 1) | Probes reachability of both app and DB |
| OpenAPI generation | API / Backend (@fastify/swagger) | — | Auto-derived from route schemas; no separate doc step |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `fastify` | 5.8.5 | HTTP framework | Locked by ADR-002; `coerceTypes` control, Ajv v8, TypeScript-first [VERIFIED: npm registry] |
| `@fastify/swagger` | 9.7.0 | OpenAPI spec generation | Official Fastify plugin; derives spec from route schemas [VERIFIED: npm registry] |
| `@fastify/swagger-ui` | 5.2.6 | Swagger UI at `/docs` | Official plugin; serves interactive UI [VERIFIED: npm registry] |
| `@fastify/type-provider-typebox` | 6.1.0 | TypeScript type inference from schemas | Eliminates manual `Generic` declarations; TypeBox schemas = TS types [VERIFIED: npm registry] |
| `@sinclair/typebox` | 0.34.49 | Schema definition with TS types | Used by `@fastify/type-provider-typebox`; zero friction [VERIFIED: npm registry] |
| `drizzle-orm` | 0.45.2 | Query builder for all DB reads + calling `post_transaction` | Already in `packages/core`; `sql` template for stored function calls [VERIFIED: npm registry] |
| `postgres` | 3.4.9 | Postgres driver (already in use) | Already in `packages/core` [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pino` | 10.3.1 | Structured logging (bundled with Fastify) | Already pulled in by Fastify 5; use for request logging + redact config [VERIFIED: npm registry] |
| `pino-pretty` | 13.1.3 | Dev-mode log formatting | Dev dependency only; never in production logs [VERIFIED: npm registry] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@fastify/type-provider-typebox` | Raw JSON Schema | TypeBox gives TypeScript inference for free; raw JSON Schema requires manual type duplicates |
| `@fastify/type-provider-typebox` | `@fastify/type-provider-json-schema-to-ts` | Both are valid; TypeBox is more ergonomic for building schemas programmatically |
| `setSerializerCompiler` for BigInt | `preSerialization` hook | `setSerializerCompiler` is the correct per-Fastify-docs API; `preSerialization` works but bypasses schema optimization |

**Installation (new packages only — drizzle-orm and postgres are already present):**
```bash
pnpm --filter @aprumo/core add fastify @fastify/swagger @fastify/swagger-ui \
  @fastify/type-provider-typebox @sinclair/typebox
pnpm --filter @aprumo/core add -D pino-pretty
```

**Version verification (performed during research):**
```bash
npm view fastify version          # 5.8.5
npm view @fastify/swagger version # 9.7.0
npm view @fastify/swagger-ui version # 5.2.6
npm view @fastify/type-provider-typebox version # 6.1.0
npm view @sinclair/typebox version # 0.34.49
```

---

## Package Legitimacy Audit

> slopcheck was unavailable at research time. All packages are marked `[ASSUMED]` for registry trust, but each is a long-standing official Fastify ecosystem package maintained by the Fastify organization on GitHub. Registry existence confirmed via `npm view` above.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `fastify` | npm | 9+ years | >10M/wk | github.com/fastify/fastify | [ASSUMED] | Approved — core framework, official project |
| `@fastify/swagger` | npm | 7+ years | >1M/wk | github.com/fastify/fastify-swagger | [ASSUMED] | Approved — official Fastify plugin |
| `@fastify/swagger-ui` | npm | 3+ years | >1M/wk | github.com/fastify/fastify-swagger-ui | [ASSUMED] | Approved — official Fastify plugin |
| `@fastify/type-provider-typebox` | npm | 3+ years | >500K/wk | github.com/fastify/fastify-type-provider-typebox | [ASSUMED] | Approved — official Fastify plugin |
| `@sinclair/typebox` | npm | 4+ years | >10M/wk | github.com/sinclairzx81/typebox | [ASSUMED] | Approved — widely used, well-maintained |
| `pino-pretty` | npm | 6+ years | >10M/wk | github.com/pinojs/pino-pretty | [ASSUMED] | Approved — official pino ecosystem |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*All packages above are tagged `[ASSUMED]` because slopcheck was unavailable. All are from official, high-download, multi-year organizations on npm. Planner may add a `checkpoint:human-verify` before install if desired.*

---

## Architecture Patterns

### System Architecture Diagram

```
HTTP Request
     │
     ▼
┌────────────────────────────────────────────┐
│  Fastify 5 (coerceTypes: false)            │
│  ┌──────────────────────────────────┐      │
│  │  TypeBox validation (Ajv v8)     │ ─── 422 on schema violation
│  └──────────────────────────────────┘      │
│  ┌──────────────────────────────────┐      │
│  │  Route handler                   │      │
│  └────────────────┬─────────────────┘      │
└───────────────────┼────────────────────────┘
                    │
                    ▼
┌───────────────────────────────────────────┐
│  withRetryOnSerializationFailure wrapper  │
│  (retries entire db.transaction() block)  │
│  ┌─────────────────────────────────────┐  │
│  │  db.transaction({ isolationLevel:  │  │
│  │    "serializable" }, async (tx) => {│  │
│  │    db.execute(sql`SELECT           │  │
│  │      post_transaction(...)`)       │  │ ─── P0001 → 422
│  │  })                                │  │ ─── 40001 → retry (max 3)
│  └─────────────────────────────────────┘  │ ─── 40001 exhausted → 503
└───────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────┐
│  PostgreSQL 16+                     │
│  ┌─────────────────────────────────┐│
│  │  post_transaction(postings[])   ││ ◄── SOLE write path to postings
│  │  SECURITY DEFINER               ││     Handles concurrent-duplicate
│  │  EXCEPTION WHEN unique_violation││     race (migration 0008)
│  └─────────────────────────────────┘│
│  ┌─────────────────────────────────┐│
│  │  CONSTRAINT TRIGGER             ││ ─── Belt-and-suspenders double-entry check
│  │  DEFERRABLE INITIALLY DEFERRED  ││     at COMMIT
│  └─────────────────────────────────┘│
└─────────────────────────────────────┘
                    │
                    ▼
HTTP Response (BigInt → string via setSerializerCompiler)
```

### Recommended Project Structure

```
packages/core/src/
├── api/
│   ├── server.ts            # createServer() factory — injectable for tests
│   ├── routes/
│   │   ├── transactions.ts  # POST /transactions, GET /transactions/:id
│   │   ├── accounts.ts      # POST /accounts, GET /accounts/:id, GET /accounts/:id/postings
│   │   └── health.ts        # GET /health
│   ├── schemas/
│   │   ├── transaction.ts   # TypeBox schemas for transaction request/response
│   │   ├── account.ts       # TypeBox schemas for account request/response
│   │   └── common.ts        # Shared types (pagination, error)
│   ├── plugins/
│   │   ├── bigint-serializer.ts  # setSerializerCompiler for BigInt → string
│   │   └── swagger.ts            # @fastify/swagger + @fastify/swagger-ui setup
│   └── errors/
│       ├── pg-error-handler.ts   # setErrorHandler mapping PG codes to HTTP
│       └── app-errors.ts         # Custom Error subclasses with code/status
├── db/
│   ├── schema.ts            # Existing (Phase 2)
│   ├── migrate.ts           # Existing (Phase 2)
│   ├── reset.ts             # Existing (Phase 2)
│   └── seed.ts              # Existing (Phase 2)
└── lib/
    └── with-retry.ts        # withRetryOnSerializationFailure utility
```

### Pattern 1: BigInt → String Serializer (Global)

**What:** Replace `fast-json-stringify` compiler with a `JSON.stringify` replacer that converts `bigint` → `string`.
**When to use:** Always — registered once at app startup, applies to all routes.

**Why `setSerializerCompiler` not `setReplySerializer`:** `setReplySerializer` bypasses Fastify's schema-based serialization optimization entirely. `setSerializerCompiler` replaces the schema-compiler factory, meaning each route still gets a compiled function, but that function uses our replacer. This is the canonical approach documented in Fastify. [CITED: fastify.dev/docs/latest/Reference/Validation-and-Serialization/]

```typescript
// Source: fastify.dev/docs/latest/Reference/Validation-and-Serialization/
// packages/core/src/api/plugins/bigint-serializer.ts
import type { FastifyInstance } from 'fastify';

export function registerBigIntSerializer(app: FastifyInstance): void {
  app.setSerializerCompiler(({ schema, method, url, httpStatus }) => {
    // Return a serializer function for each route.
    // The replacer converts every bigint to its string representation.
    return (data) =>
      JSON.stringify(data, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value,
      );
  });
}
```

**IMPORTANT schema implication:** Because we use `JSON.stringify` (not `fast-json-stringify`), route response schemas no longer drive optimized serialization — they still drive validation of *inbound* data. For response schemas that reference `amount_cents`, declare the TypeBox type as `Type.String()` (with description "BigInt serialized as decimal string") so OpenAPI documents it correctly. [ASSUMED]

### Pattern 2: Fastify Server Factory with TypeBox

**What:** `createServer(db, opts?)` factory function wraps all setup — importable by both the app entrypoint and tests.
**When to use:** Always for testability; avoid global singleton server.

```typescript
// Source: fastify.dev/docs/latest/Reference/Server/
// packages/core/src/api/server.ts
import Fastify from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';

export async function createServer(db: PostgresJsDatabase) {
  const app = Fastify({
    logger: true,
    ajv: {
      customOptions: {
        coerceTypes: false,       // Never coerce '123' → 123; critical for money API
        removeAdditional: 'all',  // Strip unknown properties
        useDefaults: true,
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  // BigInt → string serializer (must register before routes)
  registerBigIntSerializer(app);

  // OpenAPI
  await app.register(swagger, {
    openapi: {
      openapi: '3.0.0',
      info: { title: 'Aprumo Ledger API', version: '0.1.0' },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  // Error handler
  app.setErrorHandler(pgErrorHandler);

  // Routes
  await app.register(transactionRoutes, { prefix: '/v1', db });
  await app.register(accountRoutes, { prefix: '/v1', db });
  await app.register(healthRoutes, { db });

  return app;
}
```

### Pattern 3: POST /transactions — Calling post_transaction via Drizzle

**What:** Call the SQL stored function via `db.execute(sql\`SELECT post_transaction(...)\`)` inside `withRetryOnSerializationFailure`.
**When to use:** This is the ONLY write path to `postings`. Never use Drizzle `insert()` for postings. [CITED: CLAUDE.md Invariant #2]

```typescript
// Source: orm.drizzle.team/docs/sql + packages/core/migrations/0008
// packages/core/src/api/routes/transactions.ts
import { sql } from 'drizzle-orm';
import { withRetryOnSerializationFailure } from '../../lib/with-retry.js';

// Inside POST /transactions handler:
const txId = await withRetryOnSerializationFailure(() =>
  db.transaction(
    async (tx) => {
      // post_transaction handles: balance check, idempotency, concurrent-duplicate race.
      // It returns the transaction UUID (winner's ID on duplicate).
      const rows = await tx.execute<{ post_transaction: string }>(
        sql`SELECT post_transaction(
          ${body.idempotency_key},
          ${body.description ?? null},
          ${'api'},
          ${JSON.stringify(body.metadata ?? {})}::jsonb,
          ${sql.raw(buildPostingsArray(body.postings))}
        )`,
      );
      return rows[0]!.post_transaction;
    },
    { isolationLevel: 'serializable', accessMode: 'read write' },
  ),
);
```

**Caveat on `buildPostingsArray`:** Postgres composite type arrays (`posting_input[]`) require specific SQL syntax: `ARRAY[ROW($1, $2, 'debit')::posting_input, ...]`. This cannot be safely parameterized as a whole array with `$n` placeholders because Postgres does not support passing a composite type array as a single `$n` bind parameter from most drivers. The idiomatic approach is to construct the ARRAY literal with individual parameterized ROW constructors. The existing tests in Phase 2 show the exact pattern. [CITED: packages/core/tests/schema/post-transaction.integration.test.ts]

**Drizzle's `sql` tagged template auto-escapes scalar parameters** (`${param}` → `$N` bind parameter), which prevents SQL injection for scalar values. For the ROW literals, each scalar inside the ROW must still use the `sql` template interpolation. [CITED: orm.drizzle.team/docs/sql]

### Pattern 4: withRetryOnSerializationFailure

**What:** Wraps an async function that calls `db.transaction(...)`. On PG SQLSTATE `40001`, waits exponentially and retries up to 3 times. On 4th failure, re-throws.
**When to use:** Every handler that calls `db.transaction()` with `isolationLevel: 'serializable'`.

**CRITICAL:** The PG docs state you must retry the *entire transaction including all application logic*, not just the SQL statement. The wrapper must receive a factory function (closure), not a promise. [CITED: postgresql.org/docs/current/mvcc-serialization-failure-handling.html]

```typescript
// Source: postgresql.org/docs/current/mvcc-serialization-failure-handling.html
// packages/core/src/lib/with-retry.ts
const SERIALIZATION_FAILURE = '40001';
const MAX_RETRIES = 3;

export async function withRetryOnSerializationFailure<T>(
  fn: () => Promise<T>,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: unknown }).code === SERIALIZATION_FAILURE &&
        attempt < MAX_RETRIES
      ) {
        lastError = err;
        // Exponential backoff: 50ms, 100ms, 200ms
        await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}
```

### Pattern 5: Error Handler — PG Code to HTTP Status

**What:** Fastify `setErrorHandler` discriminates PG error codes and maps them to HTTP statuses.
**When to use:** One global handler registered before routes.

PG error codes surfaced in this phase:
- `P0001` (raise_exception): unbalanced postings from `post_transaction`. Message includes "do not balance" → 422.
- `P0001`: empty postings array, invalid direction, zero amount → 422.
- `40001` (serialization_failure): exhausted retries → 503.
- `23505` (unique_violation): not expected on the idempotency path (handled at PG function level), but may surface on `accounts.id` duplicate or other constraints → 409.
- Fastify validation error (`FST_ERR_VALIDATION`): schema rejection → 422.
- Everything else → 500.

```typescript
// packages/core/src/api/errors/pg-error-handler.ts
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';

const PG_RAISE_EXCEPTION = 'P0001';
const PG_SERIALIZATION_FAILURE = '40001';
const PG_UNIQUE_VIOLATION = '23505';

export function pgErrorHandler(
  error: FastifyError & { code?: string },
  _req: FastifyRequest,
  reply: FastifyReply,
): void {
  // Fastify validation errors
  if (error.validation != null) {
    reply.status(422).send({ error: 'Validation failed', details: error.validation });
    return;
  }

  const pgCode = (error as unknown as { code?: string }).code;

  if (pgCode === PG_RAISE_EXCEPTION) {
    // post_transaction raises P0001 for unbalanced / empty / invalid direction
    reply.status(422).send({ error: 'Ledger constraint violation', message: error.message });
    return;
  }

  if (pgCode === PG_SERIALIZATION_FAILURE) {
    // 40001 surfaced here means withRetry exhausted all attempts
    reply.status(503).send({ error: 'Service temporarily unavailable', retryable: true });
    return;
  }

  if (pgCode === PG_UNIQUE_VIOLATION) {
    reply.status(409).send({ error: 'Conflict', message: error.message });
    return;
  }

  reply.status(500).send({ error: 'Internal server error' });
}
```

### Pattern 6: Idempotency — How It Works in This Phase

The concurrent-duplicate idempotency race is **already solved at the PG layer** in migration `0008_post_transaction_idempotency_race.sql`. Two simultaneous `POST /transactions` calls with the same `Idempotency-Key`:
1. Both call `post_transaction(p_idempotency_key, ...)`.
2. One wins the `INSERT INTO transactions` race; the other catches `unique_violation` and re-fetches the winner's row.
3. Both return the same `transaction_id` UUID.

The API handler must:
- Always pass the `Idempotency-Key` header to `post_transaction`.
- After calling `post_transaction`, fetch the full transaction + postings by the returned UUID.
- If the transaction was already committed (duplicate), the re-fetch still works.
- Return **201 on first write, 200 on duplicate**. To distinguish: check if the tx's `created_at` matches `now()`. Simpler heuristic: return 200 whenever the idempotency guard path was taken. Implementation: `post_transaction` currently always returns the UUID; the API can detect "was this a fresh insert?" by checking if the posted tx was created within the current request's transaction window — but this adds complexity. **Simpler and correct approach:** always return 201 on HTTP but with identical body on duplicate (meets the spirit of "no reprocessing"). However, the success criterion states "returns 200 both times" for concurrent duplicate. The most reliable implementation: attempt the transaction, then query `transactions WHERE idempotency_key = $1` — if `created_at` is older than a configurable threshold, return 200, else 201. **Even simpler:** parse whether the transaction was created_at within the last N ms. [ASSUMED — implementation detail, planner decides]

**Recommended approach:** Track idempotency at the handler layer by first trying to `SELECT FROM transactions WHERE idempotency_key = $1`. If found, skip `post_transaction` call entirely and return 200 + the existing body. If not found, call `post_transaction` (which handles the concurrent race) and return 201. This is safe because `post_transaction` is idempotent — even if a concurrent call inserted between our SELECT and our `post_transaction` call, `post_transaction` returns the winner's ID.

### Pattern 7: Cursor Pagination for GET /accounts/:id/postings

**What:** Keyset pagination by `postings.id` (UUID, ordered by insertion time via Postgres's gen_random_uuid() v4 is NOT monotonic — use `postings.id` only if it is a time-ordered UUID, otherwise add a sequence column).

**IMPORTANT PITFALL:** The schema uses `uuid("id").primaryKey().defaultRandom()` for postings, which generates UUIDv4. UUIDv4 is random, NOT monotonically increasing. Cursoring by raw UUIDv4 gives undefined order unless sorted by a sortable column. Options:
1. Add a `created_at timestamp` or `seq bigserial` to postings and cursor by that.
2. Use `ORDER BY id DESC` with UUIDv4 and accept that "newest first" has no semantic meaning other than UUID random order.
3. The existing schema has no `created_at` on postings. Phase 3 can either add a `seq` column via migration or use `transaction_id` + array index for ordering.

**Recommended approach:** Add a `created_at timestamp with time zone DEFAULT now()` column to `postings` via a new migration in Phase 3. Cursor pagination by `created_at DESC` is semantically meaningful (newest first) and reliable. Alternatively, use a `bigserial` sequence column. The planner must decide. [ASSUMED — planner decides which approach to take]

```typescript
// Cursor pagination pattern (assuming created_at on postings after Phase 3 migration)
// GET /accounts/:id/postings?cursor=<iso-timestamp>&limit=50
const rows = await db
  .select()
  .from(postings)
  .where(
    and(
      eq(postings.account_id, params.id),
      cursor ? lt(postings.created_at, new Date(cursor)) : undefined,
    ),
  )
  .orderBy(desc(postings.created_at))
  .limit(Math.min(limit ?? 50, 100));
```

### Anti-Patterns to Avoid

- **Do not use `JSON.stringify(bigint)` anywhere in the codebase.** Throws `TypeError: Do not know how to serialize a BigInt`. Always route all BigInt values through the Fastify `setSerializerCompiler` or convert explicitly to `.toString()` before returning.
- **Do not set `coerceTypes: true` or omit the `ajv.customOptions.coerceTypes: false` line.** Fastify 5 defaults `coerceTypes` to `'array'` which would silently coerce query string `cursor=123` to a number. For a money API, this is dangerous.
- **Do not call `db.execute()` for `post_transaction` without wrapping in `db.transaction({ isolationLevel: 'serializable' })`.** CLAUDE.md Invariant #5 requires SERIALIZABLE for all ledger writes.
- **Do not wrap only the failing SQL statement in the retry loop.** Must wrap the entire `db.transaction()` call factory, because PG may have already invalidated earlier statements in the same tx when 40001 is thrown.
- **Do not register `@fastify/swagger` after routes.** Swagger must be registered before any routes to capture their schemas.
- **Do not `INSERT` into `postings` directly.** Even in Drizzle. CLAUDE.md Invariant #1 + #2. Use `post_transaction`.
- **Do not use `mode: 'number'` for BigInt columns** as a "fix" for JSON serialization. This silently loses precision for values > `Number.MAX_SAFE_INTEGER` (9,007,199,254,740,991). `amount_cents` must remain `mode: 'bigint'` in Drizzle schema.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP framework | Custom Express/Node HTTP | `fastify` (locked by ADR-002) | Edge cases: streaming, lifecycle, plugin isolation |
| JSON Schema validation | Custom validators | Fastify's built-in Ajv v8 | Ajv handles all JSON Schema keywords; custom validators miss edge cases |
| OpenAPI spec | Hand-written YAML | `@fastify/swagger` | Derives from route schemas; always in sync; hand-written drifts |
| BigInt serialization | Per-route JSON.stringify wrappers | `setSerializerCompiler` once at startup | Per-route is error-prone; global compiler applies to every route |
| Serialization retry | Ad-hoc try/catch per handler | `withRetryOnSerializationFailure` wrapper | Must be consistent; misapplication (wrapping only SQL, not tx) breaks correctness |
| Double-entry validation | TypeScript SUM check in handler | `post_transaction` SQL function (Phase 2) | Already exists; belt-and-suspenders. Never reimplement what the DB enforces |
| Concurrent idempotency | Distributed locking / Redis | `post_transaction` EXCEPTION handler (migration 0008) | Already handles race; adding app-level lock introduces distributed lock complexity |
| Cursor pagination | Offset pagination | Keyset by posting ordering column | Offset is O(N) at large offsets; keyset is O(log N) with index |

**Key insight:** The ledger invariants (double-entry, idempotency race, SERIALIZABLE isolation) are already enforced at the Postgres layer. Phase 3's job is to **route and surface** those guarantees correctly over HTTP, not to reimplement them.

---

## Common Pitfalls

### Pitfall 1: BigInt JSON.stringify TypeError
**What goes wrong:** `reply.send({ amount_cents: 100n })` → `TypeError: Do not know how to serialize a BigInt` at runtime. Crashes the response handler.
**Why it happens:** Native `JSON.stringify` does not support BigInt. Drizzle with `mode: 'bigint'` returns JS BigInt values for all `bigint` columns (`amount_cents`, `balance`).
**How to avoid:** Register `setSerializerCompiler` with a replacer BEFORE any routes. Test specifically that `amount_cents` in the response body is a string, not a number or missing.
**Warning signs:** Any `typeof value === 'bigint'` true in a response payload without explicit handling. Check all Drizzle query result types.

### Pitfall 2: Retrying the Wrong Scope on 40001
**What goes wrong:** Catching `40001` and re-running only the failed SQL query (not the entire `db.transaction()` closure). PG has already aborted the transaction — subsequent SQL in the same tx will fail with `25P02` (in_failed_sql_transaction).
**Why it happens:** Intuitive to retry "the thing that failed." But PG requires the complete transaction to be restarted from scratch.
**How to avoid:** `withRetryOnSerializationFailure` receives a factory `() => Promise<T>`, not a `Promise<T>`. The factory creates a fresh `db.transaction()` call each invocation. Verify with a test that injects `40001` on the first call and asserts success on the second.
**Warning signs:** Seeing `25P02` errors in logs after a `40001` retry.

### Pitfall 3: coerceTypes Silently Corrupting Money Values
**What goes wrong:** A query string parameter `amount=100` is coerced from string `"100"` to integer `100`, then unexpectedly used in a money calculation. Worse: body property `idempotency_key: 123` (integer) is coerced to `"123"` — may cause collision with `"123"` string keys from another caller.
**Why it happens:** Fastify defaults to `coerceTypes: 'array'` for query strings. Without explicit `coerceTypes: false`, Ajv silently converts types.
**How to avoid:** Always pass `ajv: { customOptions: { coerceTypes: false } }` in `Fastify()` constructor. Test that sending a numeric idempotency key fails validation with 422.
**Warning signs:** Validation passing when it should fail for a wrong type. Numeric IDs being silently accepted as strings.

### Pitfall 4: Registering @fastify/swagger After Routes
**What goes wrong:** Routes registered before the swagger plugin are not captured in the OpenAPI spec. Spec is incomplete.
**Why it happens:** Fastify's plugin encapsulation model — plugins only see routes registered after themselves in the same scope (or child scopes).
**How to avoid:** Always register `@fastify/swagger` as the FIRST plugin in the server factory, before any route plugins.
**Warning signs:** `GET /docs` shows only some routes or an empty paths object.

### Pitfall 5: UUIDv4 Cursor Pagination Ordering
**What goes wrong:** Cursoring by `postings.id` (UUIDv4) gives inconsistent ordering because UUIDv4 values are random. Pages may overlap or skip records.
**Why it happens:** UUIDv4 is not monotonically increasing. Cursor pagination requires a monotonically increasing (or decreasing) sort key.
**How to avoid:** Add `created_at TIMESTAMPTZ DEFAULT now()` to postings in a Phase 3 migration, or use a `bigserial` sequence. Do not cursor by the UUIDv4 primary key.
**Warning signs:** Repeated records appearing across pages, or different orderings on re-fetch.

### Pitfall 6: Idempotency Key Header Not Passed to post_transaction
**What goes wrong:** `POST /transactions` without `Idempotency-Key` header, or handler generates its own UUID as the key — idempotency is lost.
**Why it happens:** `Idempotency-Key` is in the HTTP header, not the body. Easy to forget to extract it.
**How to avoid:** Define the header in the TypeBox schema (`headers: Type.Object({ 'idempotency-key': Type.String() })`). Fastify validates it; handler extracts from `request.headers['idempotency-key']`.
**Warning signs:** Duplicate POST requests creating duplicate transactions. Missing test for duplicate key behavior.

### Pitfall 7: test isolation — Fastify server scope across tests
**What goes wrong:** A single shared Fastify `app` instance across test files. One test leaving routes registered, or closing the app in `afterAll`, affects other tests.
**Why it happens:** Vitest runs test files in parallel forks (per `vitest.config.ts` `pool: 'forks'`), but within a file, tests share state.
**How to avoid:** Use `createServer()` factory in each test file's `beforeAll`. Call `app.close()` in `afterAll`. Use `app.inject()` for HTTP requests — no port listening needed.
**Warning signs:** Tests passing in isolation but failing in full suite run. Port conflicts.

---

## Code Examples

### Full BigInt Serializer Plugin

```typescript
// Source: fastify.dev/docs/latest/Reference/Validation-and-Serialization/
// packages/core/src/api/plugins/bigint-serializer.ts
import type { FastifyInstance } from 'fastify';

export function registerBigIntSerializer(app: FastifyInstance): void {
  app.setSerializerCompiler(() => (data) =>
    JSON.stringify(data, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    ),
  );
}
```

### TypeBox Schema for POST /transactions

```typescript
// packages/core/src/api/schemas/transaction.ts
import { Type } from '@sinclair/typebox';

export const PostingInputSchema = Type.Object({
  account_id: Type.String({ format: 'uuid' }),
  // Note: accepts string OR number from API callers; validated as positive integer.
  // BigInt conversion happens in handler before calling post_transaction.
  amount_cents: Type.Integer({ minimum: 1, description: 'Amount in cents, positive integer' }),
  direction: Type.Union([Type.Literal('debit'), Type.Literal('credit')]),
});

export const PostTransactionBodySchema = Type.Object({
  postings: Type.Array(PostingInputSchema, { minItems: 2 }),
  description: Type.Optional(Type.String({ maxLength: 500 })),
  metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
});

export const PostTransactionHeadersSchema = Type.Object({
  'idempotency-key': Type.String({ minLength: 1, maxLength: 255 }),
});

export const PostingResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  transaction_id: Type.String({ format: 'uuid' }),
  account_id: Type.String({ format: 'uuid' }),
  // Serialized as string by setSerializerCompiler. Declared as string in schema for OpenAPI.
  amount_cents: Type.String({ description: 'Amount in cents, BigInt serialized as decimal string' }),
  direction: Type.Union([Type.Literal('debit'), Type.Literal('credit')]),
});

export const TransactionResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  idempotency_key: Type.String(),
  ts: Type.String({ format: 'date-time' }),
  description: Type.Optional(Type.String()),
  source: Type.Optional(Type.String()),
  metadata: Type.Optional(Type.Object({}, { additionalProperties: true })),
  postings: Type.Array(PostingResponseSchema),
});
```

### Health Check Route

```typescript
// Source: fastify.dev/docs/latest/Guides/Testing/
// packages/core/src/api/routes/health.ts
import type { FastifyPluginAsync } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';

export const healthRoutes: FastifyPluginAsync<{ db: PostgresJsDatabase }> = async (app, { db }) => {
  app.withTypeProvider<TypeBoxTypeProvider>().get(
    '/health',
    {
      schema: {
        response: {
          200: Type.Object({ status: Type.Literal('ok'), postgres: Type.Literal('up') }),
          503: Type.Object({ status: Type.Literal('error'), postgres: Type.String() }),
        },
      },
    },
    async (_req, reply) => {
      try {
        await db.execute(sql`SELECT 1`);
        return reply.send({ status: 'ok', postgres: 'up' });
      } catch (err) {
        return reply.status(503).send({ status: 'error', postgres: String(err) });
      }
    },
  );
};
```

### Integration Test Pattern with testcontainers + app.inject()

```typescript
// Extends existing Phase 2 testcontainers setup (createTestDb)
// packages/core/src/api/routes/transactions.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../../../tests/helpers/createTestDb.js';
import { createServer } from '../server.js';
import { drizzle } from 'drizzle-orm/node-postgres';

let testDb: TestDb;
let app: Awaited<ReturnType<typeof createServer>>;

beforeAll(async () => {
  testDb = await createTestDb(import.meta.url);
  // Create a Drizzle instance pointing at the test schema
  const db = drizzle(testDb.app); // uses the aprumo_app pool
  app = await createServer(db);
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await testDb.cleanup();
});

describe('POST /v1/transactions', () => {
  it('returns 201 with amount_cents as string', async () => {
    // ... seed accounts in testDb.migration ...
    const response = await app.inject({
      method: 'POST',
      url: '/v1/transactions',
      headers: { 'idempotency-key': 'test-key-1', 'content-type': 'application/json' },
      payload: { postings: [...], description: 'test' },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(typeof body.postings[0].amount_cents).toBe('string'); // BigInt as string
  });
});
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `nock` for HTTP mocking | MSW v2 (later phases) | Node 22 fetch compatibility | Nock doesn't intercept native fetch; MSW uses service workers or process-level interception |
| Fastify v4 `.withTypeProvider` | Same API in v5 | v5 release | No breaking change for type providers |
| `fast-json-stringify` schema-driven BigInt | `setSerializerCompiler` with replacer | Ongoing issue since fjs 4.2.0 | Schema-driven bigint serialization is unreliable; replacer pattern is the escape hatch |
| Offset pagination | Keyset (cursor) pagination | Industry shift | Offset is O(N) at large pages; keyset is O(log N) with correct index |

**Deprecated/outdated:**
- `reply.serializer(fn)` per-route: Still works but requires per-route setup. `setSerializerCompiler` is the global approach.
- Fastify v3/v4 `setReplySerializer`: Still exists in v5 but bypasses schema optimization. Prefer `setSerializerCompiler`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `setSerializerCompiler` is the preferred global BigInt serializer API in Fastify 5 | Patterns 1, Code Examples | Could need `setReplySerializer` or `preSerialization` hook instead; behavioral difference is minor |
| A2 | TypeBox (`@fastify/type-provider-typebox`) is the preferred type provider over raw JSON Schema | Standard Stack | Could use `JsonSchemaToTsProvider`; both work, TypeBox is more ergonomic |
| A3 | `postings.id` (UUIDv4) cannot be used for cursor pagination without a separate ordering column | Pattern 7, Pitfall 5 | If postings gains a `created_at` or sequence in Phase 2 migrations (not observed), this assumption is wrong — check the final schema |
| A4 | Handler-level idempotency check (SELECT before POST) is simpler than detecting "fresh vs. duplicate" from `post_transaction` return value | Pattern 6 | If `post_transaction` is extended to return a flag indicating duplicate, the SELECT can be skipped |
| A5 | All package names (fastify, @fastify/swagger, etc.) are legitimate npm packages from the Fastify organization | Package Legitimacy Audit | Slopcheck not available; all are well-known official packages, risk is LOW |
| A6 | `drizzle-orm` `db.transaction()` accepts `isolationLevel: 'serializable'` with postgres.js driver | Pattern 3, 4 | Verified via Drizzle docs but not run against actual DB in this session |

---

## Open Questions (RESOLVED)

1. **Cursor pagination ordering column for postings**
   - What we know: `postings.id` is UUIDv4 (random, not monotonic). No `created_at` on postings in the current schema.
   - What's unclear: Should Phase 3 add `created_at timestamptz DEFAULT now()` to postings via a new migration, or use a `bigserial` sequence, or accept UUID-based ordering?
   - Recommendation: Add `created_at timestamptz DEFAULT now() NOT NULL` to `postings` in a Phase 3 migration (`0010_postings_created_at.sql`). This is backward-compatible and enables meaningful time-based cursor pagination. Alternative: add `seq bigserial` for strict ordering in high-throughput scenarios.
   - RESOLVED: `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` chosen (Plan 02 — migration 0010_postings_created_at.sql). Cursor pagination in GET /accounts/:id/postings orders by `created_at DESC`.

2. **How to signal "duplicate idempotency key" vs "fresh insert" to return 200 vs 201**
   - What we know: `post_transaction` always returns the UUID; cannot distinguish fresh vs. duplicate from the return value alone.
   - What's unclear: Does the success criterion strictly require HTTP 200 (not 201) for duplicates, or is 201 with identical body acceptable?
   - Recommendation: Do a SELECT before calling `post_transaction`. If the key already exists, return 200 with the existing transaction. If not, call `post_transaction` and return 201. Concurrent race: the second concurrent call may reach `post_transaction` before the SELECT resolves — that case is handled by the PG function returning the winner's ID; the handler then fetches and returns 200 (it will observe `created_at` older than "just now").
   - RESOLVED: SELECT-first pattern chosen (Plan 05). ROADMAP SC #2 requires exactly 200 (not 201) for concurrent duplicates; the SELECT-first approach enables this by detecting the existing key and returning 200 without calling post_transaction again. Concurrent race handled by the PG function's unique_violation handler.

3. **Drizzle `db` instance: pass `pg.Pool` directly or create `drizzle(postgres(url))`**
   - What we know: Phase 2 uses `postgres` (postgres.js driver) for migrations and the testcontainers `createTestDb` returns a `pg.Pool` (node-postgres). The Drizzle schema was generated without specifying which driver.
   - What's unclear: The API server needs a Drizzle instance connected to the `aprumo_app` role. Should it use `drizzle-orm/postgres-js` (current Phase 2 driver) or `drizzle-orm/node-postgres` (`pg` Pool)?
   - Recommendation: Use `drizzle-orm/postgres-js` (same as Phase 2) for the production server. For tests, create a `drizzle-orm/node-postgres` instance from the `testDb.app` (`pg.Pool`) to match the existing test helper. This means two Drizzle client initializations — the server factory accepts a generic `db` interface, tests inject a `node-postgres` Drizzle instance.
   - RESOLVED: Production server uses `drizzle-orm/postgres-js`; tests use `drizzle-orm/node-postgres` from `testDb.app` (pg.Pool). Server factory accepts `AnyDrizzleDb` type alias (`type AnyDrizzleDb = Parameters<typeof drizzle>[0]`) exported from server.ts — Plans 05/06 route plugins use this same alias for their db option type (Plan 04).

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22+ | Fastify 5, all code | ✓ | root package.json `engines: ">=22"` confirmed | — |
| PostgreSQL 16+ | All DB operations | ✓ | Docker Compose + testcontainers | — |
| Docker | testcontainers | Assumed ✓ | Not checked in this session | — |
| pnpm 10+ | Workspace management | ✓ | `packageManager: "pnpm@10.13.1"` in root package.json | — |

**Missing dependencies with no fallback:** None identified.

---

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 |
| Config file | `packages/core/vitest.config.ts` (pool: forks, globalSetup: ./tests/globalSetup.ts) |
| Quick run command | `pnpm --filter @aprumo/core test --reporter=verbose --testPathPattern api` |
| Full suite command | `pnpm --filter @aprumo/core test --coverage` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| API-01 | Fastify configured with `coerceTypes: false`; swagger registered | integration | `pnpm --filter @aprumo/core test --testPathPattern server` | ❌ Wave 0 |
| API-02 | `amount_cents` in response is JSON string, not number | integration | `pnpm --filter @aprumo/core test --testPathPattern transactions` | ❌ Wave 0 |
| API-03 | `POST /transactions` returns 201 with balanced postings | integration | `pnpm --filter @aprumo/core test --testPathPattern transactions` | ❌ Wave 0 |
| API-04 | `POST /transactions` with unbalanced postings returns 422 | integration | `pnpm --filter @aprumo/core test --testPathPattern transactions` | ❌ Wave 0 |
| API-05 | Concurrent duplicate `Idempotency-Key` (`Promise.all`) returns 200×2 with identical body | integration (concurrent) | `pnpm --filter @aprumo/core test --testPathPattern idempotency` | ❌ Wave 0 |
| API-10 | `withRetryOnSerializationFailure` retries entire tx on 40001, succeeds on 2nd attempt | unit | `pnpm --filter @aprumo/core test --testPathPattern with-retry` | ❌ Wave 0 |
| API-10 | `withRetryOnSerializationFailure` throws after 3 retries exhausted | unit | same | ❌ Wave 0 |
| API-11 | Error handler maps P0001 "do not balance" → 422 | unit | `pnpm --filter @aprumo/core test --testPathPattern error-handler` | ❌ Wave 0 |
| API-11 | Error handler maps exhausted 40001 → 503 | unit | same | ❌ Wave 0 |
| API-06 | `GET /transactions/:id` returns transaction + postings | integration | `pnpm --filter @aprumo/core test --testPathPattern transactions` | ❌ Wave 0 |
| API-07 | `POST /accounts` creates account | integration | `pnpm --filter @aprumo/core test --testPathPattern accounts` | ❌ Wave 0 |
| API-08 | `GET /accounts/:id` returns balance from `account_balance` | integration | same | ❌ Wave 0 |
| API-09 | `GET /accounts/:id/postings?cursor=&limit=` paginates correctly | integration | same | ❌ Wave 0 |
| API-12 | `GET /health` returns 200 with PG up; 503 when PG down | integration | `pnpm --filter @aprumo/core test --testPathPattern health` | ❌ Wave 0 |
| API-13 | `GET /docs` serves OpenAPI; `amount_cents` documented as string | integration | `pnpm --filter @aprumo/core test --testPathPattern swagger` | ❌ Wave 0 |

**Critical edge cases (must have explicit tests per CLAUDE.md):**
- Idempotency: same key twice sequentially → 200 with identical body (API-05 sequential)
- Idempotency: same key twice concurrently (`Promise.all`) → both 200, no 409/500 (API-05 concurrent)
- Race condition: two transactions on same account concurrently → correct final balances
- BigInt boundary: `amount_cents = 9007199254740993` (> MAX_SAFE_INTEGER) → response body has it as string, no precision loss
- Serialization retry: mock PG to throw `40001` on first call, succeed on second → response is 201

### Sampling Rate

- **Per task commit:** `pnpm --filter @aprumo/core test --testPathPattern api`
- **Per wave merge:** `pnpm --filter @aprumo/core test --coverage`
- **Phase gate:** Full suite green + coverage ≥ 90% LoC before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `packages/core/src/api/server.test.ts` — covers API-01 (coerceTypes, swagger registration)
- [ ] `packages/core/src/api/routes/transactions.test.ts` — covers API-02, API-03, API-04, API-05, API-06
- [ ] `packages/core/src/api/routes/accounts.test.ts` — covers API-07, API-08, API-09
- [ ] `packages/core/src/api/routes/health.test.ts` — covers API-12, API-13
- [ ] `packages/core/src/lib/with-retry.test.ts` — covers API-10 (unit, no DB needed)
- [ ] `packages/core/src/api/errors/pg-error-handler.test.ts` — covers API-11 (unit)

---

## Security Domain

> `security_enforcement` is not set in config; treating as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | Not in scope for Phase 3; API is unauthenticated initially |
| V3 Session Management | No | Stateless REST API; no sessions |
| V4 Access Control | No | Not in scope for Phase 3 |
| V5 Input Validation | Yes | TypeBox + Ajv v8 with `coerceTypes: false`; all route bodies validated by schema |
| V6 Cryptography | No | No crypto in this phase (HMAC is Phase 5+) |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Mass assignment (extra body fields) | Tampering | Fastify `removeAdditional: 'all'` in Ajv options |
| SQL injection via idempotency_key | Tampering | Drizzle `sql` template with parameterized `$N` placeholders; never string interpolation |
| JSON prototype pollution | Tampering | Fastify `onProtoPoisoning: 'error'` (set in server config) |
| Numeric precision attack (large amounts) | Tampering | BigInt mode in Drizzle; reject non-integer `amount_cents`; TypeBox `Type.Integer()` |
| Timing attack on idempotency key lookup | Information Disclosure | Not applicable at this layer; idempotency_key is not secret |
| Path traversal in account/transaction IDs | Tampering | TypeBox `format: 'uuid'` validation on all ID parameters |

---

## Project Constraints (from CLAUDE.md)

The following directives from `./CLAUDE.md` are binding for all planning in this phase:

1. **TypeScript strict mode** — `strict: true`, `noUncheckedIndexedAccess: true`, no `any`. Use `unknown` + type guards.
2. **Fastify is the locked HTTP framework** — Do not introduce Hono, Express, or any other framework (ADR-002).
3. **BIGINT amount_cents** — Never `float`/`numeric` for money. Never `mode: 'number'` on Drizzle bigint columns for `amount_cents`. Always serialize as JSON string at API boundary.
4. **post_transaction sole write path** — Never INSERT into `postings` directly from TypeScript. Always call the SQL function.
5. **SERIALIZABLE isolation** — All ledger writes use `isolationLevel: 'serializable'`. 40001 → retry up to 3x.
6. **Idempotency** — Every endpoint that writes to the ledger accepts `Idempotency-Key`. Duplicates return 200 OK.
7. **Append-only** — Never write UPDATE/DELETE against `postings` or `raw_events`. The `aprumo_app` role will reject it at runtime, but code reviews must catch it earlier.
8. **TDD non-negotiable** — Every production code change begins with a failing test. Tests for idempotency race, BigInt serialization, double-entry rejection, and serialization retry must exist before implementation.
9. **Vitest + testcontainers** — No mocking the PG ledger path. Use real PG container via `createTestDb()`. `app.inject()` for HTTP testing.
10. **Structured pino logging** — Never `console.log`. Use pino. Redact PII and sensitive data (no payloads, no tokens in logs).
11. **90% LoC coverage** — Gate for `@aprumo/core`. CI fails below threshold.
12. **Conventional Commits + Changesets** — Every PR with production changes needs a changeset. Commit format: `feat:`, `fix:`, `test:`, etc.
13. **Biome for lint/format** — Do not introduce ESLint or Prettier. Biome already configured.
14. **kebab-case file names** — `transaction-routes.ts`, not `TransactionRoutes.ts`.
15. **Error classes extending Error** — Custom error classes with `name` or `code` discriminant. No `throw 'string'`.
16. **No PAN storage** — Not directly relevant to this phase, but never add card number fields to any schema or log.

---

## Sources

### Primary (HIGH confidence)
- [fastify.dev/docs/latest/Reference/Server/](https://fastify.dev/docs/latest/Reference/Server/) — Ajv config, coerceTypes, setSerializerCompiler
- [fastify.dev/docs/latest/Reference/Validation-and-Serialization/](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/) — setSerializerCompiler, route schema patterns
- [fastify.dev/docs/latest/Guides/Testing/](https://fastify.dev/docs/latest/Guides/Testing/) — app.inject() without network listener
- [orm.drizzle.team/docs/transactions](https://orm.drizzle.team/docs/transactions) — isolationLevel: "serializable", db.transaction() options
- [orm.drizzle.team/docs/sql](https://orm.drizzle.team/docs/sql) — sql template tag, db.execute() for stored function calls
- [postgresql.org/docs/current/mvcc-serialization-failure-handling.html](https://www.postgresql.org/docs/current/mvcc-serialization-failure-handling.html) — MUST retry entire transaction, not just failing statement
- `packages/core/migrations/0008_post_transaction_idempotency_race.sql` — Existing concurrent-duplicate handler
- `packages/core/tests/helpers/createTestDb.ts` — Phase 2 test infrastructure (inject, schema-per-file)
- `packages/core/src/db/schema.ts` — Existing Drizzle schema (bigint mode: 'bigint')
- `./CLAUDE.md` — All invariants, TDD mandate, logging rules, stack decisions

### Secondary (MEDIUM confidence)
- [github.com/fastify/fastify-type-provider-typebox](https://github.com/fastify/fastify-type-provider-typebox) — TypeBox + Fastify setup examples
- [github.com/fastify/fastify-swagger](https://github.com/fastify/fastify-swagger) — @fastify/swagger configuration, BigInt as string documentation
- [github.com/fastify/fastify/issues/4423](https://github.com/fastify/fastify/issues/4423) — BigInt serialization replacer pattern
- [github.com/drizzle-team/drizzle-orm/discussions/2434](https://github.com/drizzle-team/drizzle-orm/discussions/2434) — Stored function call pattern

### Tertiary (LOW confidence — flagged for validation)
- WebSearch results on idempotency handler approach — multiple patterns observed; recommendation A4 is ASSUMED

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified via npm registry; Fastify 5 is the locked choice
- Architecture: HIGH — Fastify patterns verified against official docs; DB patterns confirmed by Phase 2 code
- BigInt serialization: HIGH — verified via multiple official Fastify issues and docs
- Serialization retry: HIGH — PostgreSQL official docs on SQLSTATE 40001 are unambiguous
- Idempotency race: HIGH — existing migration 0008 code is readable and proven
- Cursor pagination ordering: MEDIUM — UUIDv4 ordering pitfall confirmed; recommended fix (add created_at) is standard but needs planner decision

**Research date:** 2026-05-29
**Valid until:** 2026-06-28 (Fastify 5 minor releases are backward-compatible; check @fastify/swagger-ui for any major version bump)
