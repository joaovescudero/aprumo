# Phase 3: Core Ledger API - Pattern Map

**Mapped:** 2026-05-29
**Files analyzed:** 15 new/modified files
**Analogs found:** 8 / 15 (7 with no direct codebase analog — first Fastify code in repo)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `packages/core/src/api/server.ts` | config/factory | request-response | none (first Fastify file) | no-analog |
| `packages/core/src/api/plugins/bigint-serializer.ts` | utility/plugin | transform | none (first Fastify file) | no-analog |
| `packages/core/src/api/plugins/swagger.ts` | config/plugin | request-response | none (first Fastify file) | no-analog |
| `packages/core/src/api/routes/transactions.ts` | controller/route | request-response + CRUD | `tests/schema/post-transaction.integration.test.ts` | data-flow-match |
| `packages/core/src/api/routes/accounts.ts` | controller/route | request-response + CRUD | `src/db/schema.ts` (accounts/account_balance tables) | partial |
| `packages/core/src/api/routes/health.ts` | controller/route | request-response | none (first Fastify file) | no-analog |
| `packages/core/src/api/schemas/transaction.ts` | model/schema | transform | `src/db/schema.ts` | partial |
| `packages/core/src/api/schemas/account.ts` | model/schema | transform | `src/db/schema.ts` | partial |
| `packages/core/src/api/schemas/common.ts` | model/schema | transform | none | no-analog |
| `packages/core/src/api/errors/pg-error-handler.ts` | middleware/utility | request-response | `tests/schema/post-transaction.integration.test.ts` (error code patterns) | partial |
| `packages/core/src/api/errors/app-errors.ts` | utility | — | none (new error classes) | no-analog |
| `packages/core/src/lib/with-retry.ts` | utility | event-driven/retry | `tests/helpers/applyMigrationsToSchema.ts` (readWithRetry) | role-match |
| `packages/core/migrations/0010_postings_created_at.sql` | migration | batch/DDL | `migrations/0009_account_balance_last_posting_fk.sql` | exact |
| `packages/core/src/api/routes/transactions.test.ts` | test (integration) | request-response | `tests/schema/post-transaction.integration.test.ts` | exact |
| `packages/core/src/api/routes/accounts.test.ts` | test (integration) | request-response | `tests/schema/audit-triggers.integration.test.ts` | exact |
| `packages/core/src/api/routes/health.test.ts` | test (integration) | request-response | `tests/schema/schema-shape.integration.test.ts` | exact |
| `packages/core/src/lib/with-retry.test.ts` | test (unit) | — | `tests/helpers/createTestDb.test.ts` | role-match |
| `packages/core/src/api/errors/pg-error-handler.test.ts` | test (unit) | — | `tests/helpers/createTestDb.test.ts` | role-match |

---

## Pattern Assignments

### `packages/core/src/lib/with-retry.ts` (utility, retry)

**Analog:** `packages/core/tests/helpers/applyMigrationsToSchema.ts` — `readWithRetry` function (lines 232-257)

**Retry with exponential backoff pattern** (lines 232-257):
```typescript
async function readWithRetry(filePath: string, folderForError: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch (err: unknown) {
      lastErr = err;
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? (err as { code: string }).code
          : undefined;
      if (code !== 'ENOENT') throw err;
      // Exponential backoff with jitter
      const wait = Math.min(20 * 2 ** attempt + Math.random() * 20, 500);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw lastErr;
}
```

**Key differences for `withRetryOnSerializationFailure`:**
- Factory function pattern: receives `() => Promise<T>` not a direct value (critical — must wrap entire `db.transaction()` call, not a single SQL statement)
- Error discriminant: `error.code === '40001'` (SQLSTATE serialization_failure), not `'ENOENT'`
- Max retries: 3 (not 10)
- Backoff: `50 * 2 ** attempt` ms (50ms, 100ms, 200ms) — no jitter needed for DB retries
- Returns `T` generic, not `string`

**Error discrimination pattern** (lines 372-386 in applyMigrationsToSchema.ts):
```typescript
const pgCode =
  err instanceof Error && 'code' in err ? (err as { code: string }).code : undefined;
// ... discriminate on pgCode
if ((pgCode === '23505' || pgCode === '42710') && isRoleStatement) { ... }
```
Copy this `pgCode` extraction pattern — same for `'40001'`.

---

### `packages/core/migrations/0010_postings_created_at.sql` (migration, DDL)

**Analog:** `packages/core/migrations/0009_account_balance_last_posting_fk.sql` (lines 1-22)

**Migration file structure pattern** (full file):
```sql
-- 0009_account_balance_last_posting_fk.sql
-- Adds a foreign key from account_balance.last_posting_id to postings.id.
--
-- Context: last_posting_id is the incremental balance worker's cursor column.
-- ...
-- See: CLAUDE.md Invariant #1 (append-only postings)
-- See: WR-03 review finding

ALTER TABLE "account_balance"
  ADD CONSTRAINT "account_balance_last_posting_id_postings_id_fk"
  FOREIGN KEY ("last_posting_id") REFERENCES "public"."postings"("id")
  ON DELETE no action ON UPDATE no action NOT VALID;
```

**Copy pattern:**
- Header comment: filename, one-sentence description, multi-line context/rationale block, `See:` references
- Quoted identifiers: `"table_name"` and `"column_name"` convention (matches drizzle-kit output style)
- No `--> statement-breakpoint` markers (hand-written migration, not drizzle-kit generated)
- Content for `0010`: `ALTER TABLE "postings" ADD COLUMN "created_at" TIMESTAMPTZ NOT NULL DEFAULT now();` + index creation for cursor pagination

**Journal registration:** After writing the SQL file, add an entry to `migrations/meta/_journal.json` with `idx: 10`, matching the existing entry format from the journal.

---

### Integration test files: `transactions.test.ts`, `accounts.test.ts`, `health.test.ts`

**Analog:** `packages/core/tests/schema/post-transaction.integration.test.ts` (full file, 210 lines)

**File header comment pattern** (lines 1-10):
```typescript
// post_transaction integration tests (RED path — written before 0003_post_transaction.sql exists).
// Per D-39: db.app pool connects as aprumo_app; db.migration pool connects as container superuser.
// Per FND-09: post_transaction is the sole INSERT path into postings; validates double-entry balance.
// Per CLAUDE.md Invariant #2: every accounting transaction must have SUM(signed amount) = 0.
// Per CLAUDE.md Invariant #3: duplicate idempotency_key returns existing tx without error.
// Per CLAUDE.md Invariant #1: aprumo_app must not INSERT into postings directly (only via function).
//
// Wave dependency: createTestDb helper from Plan 08 (completed). Migration 0003 from Plan 04 (this plan).
// Tests are RED until 0003_post_transaction.sql is applied via createTestDb.
```

**Imports pattern** (lines 10-13):
```typescript
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from '../helpers/createTestDb.js';
```

**Test lifecycle pattern** (lines 15-45):
```typescript
let db: TestDb;
let account1Id: string;
let account2Id: string;

beforeAll(async () => {
  db = await createTestDb(import.meta.url);
  // Seed via db.migration (superuser) — aprumo_app cannot seed reference data
  const result = await db.migration.query<{ id: string }>(
    `INSERT INTO accounts (id, type, metadata, owner_ref, created_at)
     VALUES (gen_random_uuid(), 'asset', '{}'::jsonb, 'test', now()),
            (gen_random_uuid(), 'liability', '{}'::jsonb, 'test', now())
     RETURNING id`,
  );
  // ... extract IDs with length guard
});

afterAll(async () => {
  await db.cleanup();
});
```

**For API integration tests, additionally:**
- Import `createServer` from `../server.js`
- Import `drizzle` from `drizzle-orm/node-postgres` (test path uses pg.Pool from createTestDb)
- Create app in `beforeAll` after `createTestDb`:
  ```typescript
  const drizzleDb = drizzle(testDb.app); // node-postgres drizzle from pg.Pool
  app = await createServer(drizzleDb);
  await app.ready();
  ```
- Call `await app.close()` in `afterAll` before `testDb.cleanup()`
- Use `app.inject({ method, url, headers, payload })` for all HTTP assertions — no port listening

**Error path assertion pattern** (lines 99-119):
```typescript
await expect(
  db.app.query(`SELECT post_transaction(...)`, [randomUUID(), account1Id, account2Id]),
).rejects.toMatchObject({
  code: 'P0001',
  message: expect.stringContaining('do not balance'),
});
```

**For HTTP error paths:**
```typescript
const response = await app.inject({
  method: 'POST',
  url: '/v1/transactions',
  headers: { 'idempotency-key': 'key-1', 'content-type': 'application/json' },
  payload: { postings: [/* unbalanced */] },
});
expect(response.statusCode).toBe(422);
```

---

### Unit test files: `with-retry.test.ts`, `pg-error-handler.test.ts`

**Analog:** `packages/core/tests/helpers/createTestDb.test.ts` — pattern for unit tests without DB

**Pattern:** No `createTestDb` call, no `beforeAll`/`afterAll` lifecycle. Pure describe/it blocks testing exported functions in isolation. For `withRetryOnSerializationFailure`, inject a mock factory that throws `{ code: '40001' }` on first call and resolves on second.

**Imports for unit tests (no DB dependency):**
```typescript
import { describe, expect, it, vi } from 'vitest';
import { withRetryOnSerializationFailure } from '../../lib/with-retry.js';
```

---

### `packages/core/src/db/schema.ts` — Drizzle schema patterns for new files

**Analog for TypeBox schemas:** `src/db/schema.ts` — authoritative source for field types and constraints

**BigInt column declaration** (lines 91-91 and 144-144):
```typescript
amount_cents: bigint('amount_cents', { mode: 'bigint' }).notNull(),
balance: bigint('balance', { mode: 'bigint' }).notNull().default(sql`0`),
```
In TypeBox schemas, `amount_cents` must be declared as `Type.String()` in response schemas (serialized by `setSerializerCompiler`) and `Type.Integer({ minimum: 1 })` in request body schemas (callers send integers).

**UUID primary key pattern** (lines 36-36):
```typescript
id: uuid('id').primaryKey().defaultRandom(),
```
In TypeBox route params: `Type.String({ format: 'uuid' })`.

**Timestamp pattern** (lines 43-43):
```typescript
created_at: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
```
In TypeBox response schemas: `Type.String({ format: 'date-time' })`.

**JSONB metadata pattern** (lines 40-40):
```typescript
metadata: jsonb('metadata'),
```
In TypeBox: `Type.Optional(Type.Object({}, { additionalProperties: true }))`.

**Account type enum pattern** (lines 45-50):
```typescript
check('account_type_check', sql`${table.type} IN ('asset', 'liability', 'revenue', 'expense', 'equity')`)
```
In TypeBox: `Type.Union([Type.Literal('asset'), Type.Literal('liability'), Type.Literal('revenue'), Type.Literal('expense'), Type.Literal('equity')])`.

---

### `packages/core/src/db/migrate.ts` — PG error code discrimination pattern

**Analog for `app-errors.ts` and `pg-error-handler.ts`**

**PG error code extraction pattern** (lines 376-379 in applyMigrationsToSchema.ts):
```typescript
const pgCode =
  err instanceof Error && 'code' in err ? (err as { code: string }).code : undefined;
```
Use this pattern (not `(err as any).code`) in the error handler. The `FastifyError` type does not directly extend PG driver errors, so cast via `unknown` first:
```typescript
const pgCode = (error as unknown as { code?: string }).code;
```

**Error class with `code` discriminant** — project convention from `CLAUDE.md`:
```typescript
// Custom errors use `name` or `code` as discriminant (never throw strings)
class LedgerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'LedgerError';
  }
}
```

---

## Shared Patterns

### Test Infrastructure (applies to all `*.test.ts` integration files)

**Source:** `packages/core/tests/helpers/createTestDb.ts` (full file)
**Source:** `packages/core/tests/globalSetup.ts` (full file)
**Apply to:** All integration test files under `src/api/routes/`

Critical rules:
1. Always call `createTestDb(import.meta.url)` — `import.meta.url` is the schema namespace key
2. Always call `db.cleanup()` in `afterAll` — drops the isolated schema
3. Seed data via `db.migration` pool (superuser), not `db.app` pool
4. For API tests, also call `app.close()` before `db.cleanup()` in `afterAll`
5. `inject()` from vitest is only valid inside lifecycle hooks (already handled by `createTestDb`)
6. Pool config uses `-c search_path=${schema},public` options — do NOT SET search_path manually in tests

### Drizzle Query with `sql` Template

**Source:** `packages/core/migrations/0008_post_transaction_idempotency_race.sql` — documents the stored function signature
**Apply to:** `src/api/routes/transactions.ts`

The `post_transaction` function signature (from migration 0008):
```sql
post_transaction(
  p_idempotency_key  text,
  p_description      text,
  p_source           text,
  p_metadata         jsonb,
  p_postings         posting_input[]
) RETURNS uuid
```

Each `posting_input` composite type field order: `(account_id, amount_cents, direction)`.

Call pattern from existing test (lines 51-63 of post-transaction.integration.test.ts):
```typescript
await db.app.query<{ post_transaction: string }>(
  `SELECT post_transaction(
    $1,
    'test transaction',
    'manual',
    '{}'::jsonb,
    ARRAY[
      ROW($2, 100, 'debit')::posting_input,
      ROW($3, 100, 'credit')::posting_input
    ]
  )`,
  [idempotencyKey, account1Id, account2Id],
);
```
In the Drizzle API route context, use `sql` template tag with `db.execute()` inside `db.transaction({ isolationLevel: 'serializable' })`.

### TypeScript Strict Mode Patterns

**Source:** `packages/core/src/db/schema.ts` and `packages/core/tests/helpers/createTestDb.ts`
**Apply to:** All new TypeScript files

Conventions observed:
- `unknown` + type guard for error handling (never `any`): `err instanceof Error && 'code' in err ? (err as { code: string }).code : undefined`
- Optional chaining with non-null assertion after length guard: `rows[0]!.id` (only after checking `rows.length`)
- `import.meta.url` for `__dirname` equivalent in ESM
- `.js` extension on all relative imports (ESM, `"type": "module"`)
- File names in kebab-case: `create-test-db.ts` style (though existing files use camelCase variants — follow `kebab-case.ts` per CLAUDE.md)

### Pino Logging

**Source:** CLAUDE.md constraint — no `console.log`, use pino
**Apply to:** `server.ts`, all route handlers

Fastify 5 includes pino as its built-in logger. In `createServer`, enable with `logger: true` (development) or `logger: { level: 'info', redact: ['req.headers.authorization', 'req.body.metadata'] }` (production). Never log `req.body` wholesale — may contain PII.

---

## No Analog Found

Files with no close match in the codebase — planner should use RESEARCH.md patterns directly:

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/api/server.ts` | config/factory | request-response | First Fastify server file in repo — use RESEARCH.md Pattern 2 |
| `src/api/plugins/bigint-serializer.ts` | utility/plugin | transform | No serializer plugins exist — use RESEARCH.md Pattern 1 + Code Example |
| `src/api/plugins/swagger.ts` | config/plugin | request-response | No OpenAPI setup exists — use RESEARCH.md Pattern 2 (swagger registration in createServer) |
| `src/api/routes/health.ts` | controller/route | request-response | No health routes exist — use RESEARCH.md Code Example (health route) |
| `src/api/schemas/common.ts` | model/schema | — | No TypeBox schemas exist — use RESEARCH.md TypeBox examples |
| `src/api/errors/app-errors.ts` | utility | — | New error class hierarchy — follow CLAUDE.md `Error` subclass convention |

---

## Key Analog Excerpts Reference

### `packages/core/tests/schema/post-transaction.integration.test.ts`

Most important analog for Phase 3. Pay attention to:
- Lines 10-13: import block (node:crypto, vitest, createTestDb)
- Lines 15-45: beforeAll setup with seeding pattern via `db.migration.query`
- Lines 43-45: afterAll cleanup — `db.cleanup()`
- Lines 49-68: success path assertion pattern with UUID regex
- Lines 73-96: idempotency test pattern (same params twice, compare returned IDs)
- Lines 99-119: `rejects.toMatchObject({ code: 'P0001', message: expect.stringContaining(...) })`

### `packages/core/tests/helpers/applyMigrationsToSchema.ts`

Key patterns for `with-retry.ts`:
- Lines 232-257: `readWithRetry` — retry loop with typed error code extraction and exponential backoff
- Lines 370-390: PG error code discrimination with savepoint recovery (shows the `pgCode` extraction idiom)

### `packages/core/migrations/0009_account_balance_last_posting_fk.sql`

Exact template for migration `0010_postings_created_at.sql` — copy the comment/rationale structure and `ALTER TABLE` DDL style.

### `packages/core/src/db/schema.ts`

Canonical field type reference for all TypeBox schemas (lines 33-198). Every TypeBox schema for request/response must stay in sync with the Drizzle column types defined here — especially `bigint({ mode: 'bigint' })` for `amount_cents` and `balance`.

---

## Metadata

**Analog search scope:** `packages/core/src/`, `packages/core/tests/`, `packages/core/migrations/`
**Files scanned:** 23
**Pattern extraction date:** 2026-05-29

**Notes on first-Fastify constraint:**
This is the first HTTP/Fastify code in the entire repository. Seven of the fifteen new files have no codebase analog. For those files, the planner must rely entirely on:
1. RESEARCH.md Patterns 1–7 (concrete, production-ready code with full TypeScript)
2. RESEARCH.md Code Examples section (BigInt serializer, TypeBox schemas, health route, integration test pattern)
3. CLAUDE.md invariants (SERIALIZABLE, append-only, BigInt cents, no console.log, strict TS)

The existing codebase provides strong analogs for: migration DDL style, test file structure, PG error code discrimination, retry loop patterns, and the exact `post_transaction` call syntax. These are the highest-value patterns to copy because they are already battle-tested in this repo.
