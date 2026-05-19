# Technology Stack — Implementation Patterns

**Project:** Aprumo — open-source financial ledger for Brazilian recurring-revenue SaaS
**Researched:** 2026-05-18
**Scope:** Implementation patterns and verified versions for the fixed stack (ADR-001 through ADR-009 are not re-debated)
**Overall confidence:** HIGH — all versions verified via npm registry, Context7 docs, and official sources

---

## Verified Versions (as of 2026-05-18)

| Package | Version | Source |
|---------|---------|--------|
| `fastify` | 5.8.5 | npm |
| `@fastify/swagger` | 9.7.0 | npm |
| `@fastify/swagger-ui` | 5.2.6 | npm |
| `pg-boss` | 12.18.2 | npm (requires Node ≥ 22.12.0) |
| `drizzle-orm` | 0.45.2 | npm |
| `drizzle-kit` | 0.31.10 | npm |
| `vitest` | 4.1.6 | npm |
| `@vitest/coverage-v8` | 4.1.6 | npm |
| `@testcontainers/postgresql` | 11.14.0 | npm |
| `starkbank` | 2.40.0 | npm |
| `pino` | 10.3.1 | npm (bundled with Fastify) |
| `fastify-metrics` | 13.2.0 | npm |
| `msw` | 2.14.6 | npm |
| `@biomejs/biome` | 2.4.15 | npm |
| `@changesets/cli` | 2.31.0 | npm |

---

## 1. Postgres 16+ for Financial Ledgers

**Confidence: HIGH** — Based on PostgreSQL official docs + community fintech patterns.

### SERIALIZABLE Isolation — What You Actually Get

PostgreSQL implements SERIALIZABLE via Serializable Snapshot Isolation (SSI), not two-phase locking. This is critical to understand:

- SSI detects dangerous rw-antidependency cycles (not just write conflicts) and aborts one of the conflicting transactions with error code `40001` (`ERROR: could not serialize access due to concurrent update`).
- False positives are possible: PG may abort a transaction that was not actually problematic. The 3-retry-with-backoff policy in CLAUDE.md is correct and necessary.
- Read-only transactions under SERIALIZABLE can be made `DEFERRABLE READ ONLY` to avoid serialization overhead entirely — use this for reporting/balance queries.

Pattern for application-level retry:
```typescript
async function withSerializable<T>(
  db: DrizzleDB,
  fn: (tx: DrizzleTransaction) => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await db.transaction(fn, {
        isolationLevel: 'serializable',
      });
    } catch (err) {
      if (isSerializationFailure(err) && attempt < maxRetries) {
        attempt++;
        // Small jitter avoids thundering herd
        await sleep(Math.random() * 50 * attempt);
        continue;
      }
      throw err;
    }
  }
}

function isSerializationFailure(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as { code: string }).code === '40001'
  );
}
```

### Double-Entry Balance Constraint

**Critical PostgreSQL constraint:** `CHECK` constraints are NOT DEFERRABLE in PostgreSQL. Only `UNIQUE`, `PRIMARY KEY`, `REFERENCES` (FK), and `EXCLUDE` can be DEFERRABLE.

To enforce `SUM(amount_cents WITH SIGN) = 0` per `transaction_id` at COMMIT time, use a **constraint trigger** (not a CHECK constraint):

```sql
-- Constraint trigger fires at COMMIT when DEFERRABLE INITIALLY DEFERRED
CREATE CONSTRAINT TRIGGER validate_double_entry
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_transaction_balance();

CREATE OR REPLACE FUNCTION check_transaction_balance()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_balance BIGINT;
BEGIN
  SELECT COALESCE(SUM(
    CASE direction
      WHEN 'debit'  THEN  amount_cents
      WHEN 'credit' THEN -amount_cents
    END
  ), 0)
  INTO v_balance
  FROM postings
  WHERE transaction_id = NEW.transaction_id;

  IF v_balance <> 0 THEN
    RAISE EXCEPTION 'Transaction % is unbalanced: sum = %',
      NEW.transaction_id, v_balance
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
```

**Why a constraint trigger, not a regular trigger?** Constraint triggers respect `SET CONSTRAINTS DEFERRED` and fire at COMMIT, allowing the caller to insert all postings before the balance is checked. A regular `AFTER INSERT` trigger fires after each row, which would fail on the first posting (before the balancing entry exists).

**Why not a CHECK constraint?** CHECK is not deferrable in PostgreSQL, so it would fire per-row, not per-transaction.

### REVOKE UPDATE/DELETE for Immutability

Role separation is clean and well-supported:

```sql
-- Migration role (DDL-capable)
CREATE ROLE aprumo_migration LOGIN;
GRANT ALL ON ALL TABLES IN SCHEMA public TO aprumo_migration;

-- Application role (no DDL, no mutation of append-only tables)
CREATE ROLE aprumo_app LOGIN;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO aprumo_app;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO aprumo_app;

-- Explicitly revoke mutation on immutable tables
REVOKE UPDATE, DELETE ON postings   FROM aprumo_app;
REVOKE UPDATE, DELETE ON raw_events FROM aprumo_app;
-- TRUNCATE is implicitly not granted; confirm explicitly
REVOKE TRUNCATE ON postings   FROM aprumo_app;
REVOKE TRUNCATE ON raw_events FROM aprumo_app;
```

**Gotcha:** `DEFAULT PRIVILEGES` must be configured for future tables. Otherwise new tables created via `aprumo_migration` won't have the right grants:

```sql
ALTER DEFAULT PRIVILEGES FOR ROLE aprumo_migration
  GRANT SELECT, INSERT ON TABLES TO aprumo_app;
```

**CI test for immutability:** Add an integration test that connects as `aprumo_app` and asserts that `UPDATE postings SET amount_cents = 0 WHERE id = 1` throws a PostgreSQL permission error (code `42501`).

### Audit Shadow Tables

Standard pattern using `AFTER UPDATE OR DELETE` triggers with JSONB diff:

```sql
CREATE TABLE accounts_audit (
  audit_id      BIGSERIAL PRIMARY KEY,
  operation     CHAR(1)    NOT NULL CHECK (operation IN ('U', 'D')),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_by    TEXT        NOT NULL DEFAULT current_user,
  old_row       JSONB       NOT NULL,
  new_row       JSONB       -- NULL on DELETE
);

CREATE OR REPLACE FUNCTION audit_row() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO accounts_audit(operation, old_row, new_row)
  VALUES (
    LEFT(TG_OP, 1),
    row_to_json(OLD)::jsonb,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE row_to_json(NEW)::jsonb END
  );
  RETURN NULL;
END;
$$;

CREATE TRIGGER accounts_audit_trigger
  AFTER UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION audit_row();
```

**Rule:** Every mutable table (`accounts`, `outbound_endpoints`, `outbound_events`, config tables) gets this treatment. `postings` and `raw_events` are append-only — no audit trigger needed, the data is immutable by design.

**Gotcha:** `current_timestamp` in triggers records statement time, not commit time. For higher-precision commit-time auditing, use `clock_timestamp()` or `pg_current_xact_id()`. For a ledger, `clock_timestamp()` is sufficient.

---

## 2. pg-boss v12 — Exact-Once Webhook Enqueue

**Confidence: HIGH** — Verified via Context7 docs + npm registry.

**Current version:** 12.18.2 (published 2026-05-02). Node ≥ 22.12.0 required.

### Key v10/v11/v12 Breaking Changes (from v9)

If starting greenfield (Aprumo is), none of these are migration concerns — they are design constraints:

- **v10:** Queues must be created explicitly with `boss.createQueue()` before any job can be sent. Jobs are no longer auto-created in an ad-hoc queue. Dead letter queues must be created before the main queue references them.
- **v10:** Default `retryLimit` changed from 0 (opt-in) to 2 (opt-out). Set `retryLimit: 0` explicitly if you want a fire-and-forget job.
- **v10:** `work()` now receives an **array** of jobs (not a single job). Worker code must be written for batch processing.
- **v11:** Major partitioning changes — no migration path from v10. Greenfield unaffected.
- **v12:** Transaction adapters (`fromKnex`, `fromKysely`, `fromPrisma`, `fromDrizzle`) introduced as the canonical way to enqueue within ORM transactions.

### Exact-Once Enqueue Pattern with Drizzle (Critical)

This is the core of ADR-003. The `fromDrizzle` adapter wraps the Drizzle transaction so the pg-boss INSERT shares the same Postgres connection:

```typescript
import PgBoss, { fromDrizzle } from 'pg-boss';
import { sql } from 'drizzle-orm';
import { db } from './db';
import { rawEvents } from './schema';

// In webhook handler:
await db.transaction(async (tx) => {
  // 1. INSERT into raw_events (with UNIQUE constraint on provider+event_id)
  await tx.insert(rawEvents).values({
    provider: 'starkbank',
    providerEventId: event.id,
    receivedAt: new Date(),
    payloadJsonb: event.payload,
  })
  .onConflictDoNothing(); // idempotency: duplicate → no-op, no error

  // 2. Enqueue pg-boss job IN THE SAME TRANSACTION
  await boss.send(
    'process-webhook',
    { rawEventId: event.id },
    { db: fromDrizzle(tx, sql) }, // <-- same tx connection
  );
}, { isolationLevel: 'serializable' });
```

If the Postgres transaction rolls back (e.g., constraint violation, application error), the job INSERT also rolls back — no orphaned jobs, no double processing. This is the exact-once guarantee.

### Queue Setup Pattern

```typescript
// Call once at startup (idempotent in pg-boss v12)
await boss.createQueue('process-webhook-failed', {
  retryLimit: 0,
  deleteAfterSeconds: 60 * 60 * 24 * 30, // keep DLQ entries 30 days
});

await boss.createQueue('process-webhook', {
  policy: 'standard',
  deadLetter: 'process-webhook-failed',
  retryLimit: 5,
  retryDelay: 10,
  retryBackoff: true,
  retryDelayMax: 3600, // 1 hour max
  expireInSeconds: 300,
});

await boss.createQueue('balance-worker', {
  policy: 'singleton', // only 1 active balance recalculation at a time
});

await boss.createQueue('reconcile', {
  policy: 'standard',
  deadLetter: 'reconcile-failed',
  retryLimit: 3,
  retryBackoff: true,
});

await boss.createQueue('outbound-webhook', {
  policy: 'standard',
  deadLetter: 'outbound-webhook-failed',
  retryLimit: 6,
  retryDelay: 1,
  retryBackoff: true,
  retryDelayMax: 7200, // 2 hours = matches PRD retry schedule
});
```

### Scheduled Jobs

```typescript
// Daily balance reconciliation check (runs at 02:00 UTC)
await boss.schedule('balance-reconcile-daily', '0 2 * * *', {});

await boss.work('balance-reconcile-daily', async ([job]) => {
  await reconcileBalancesFromScratch();
});
```

### Worker Pattern (v12 receives array)

```typescript
await boss.work('process-webhook', async (jobs) => {
  for (const job of jobs) {
    await processWebhookJob(job.data);
    // pg-boss auto-completes on resolved promise, auto-retries on rejected
  }
});
```

### What NOT to Use

- Do NOT use `boss.publish()` / `boss.subscribe()` — these are v9 APIs removed in v10+.
- Do NOT use `teamSize` or `teamConcurrency` — removed in v10.
- Do NOT rely on `work(name, { batchSize: N })` for exact-once guarantees with external DB state changes. Each job should be a self-contained unit.

---

## 3. Drizzle ORM — Migration Workflow

**Confidence: HIGH** — Verified via Context7 + npm registry.

**Current versions:** `drizzle-orm` 0.45.2, `drizzle-kit` 0.31.10

**ADR-009 confirmed.** Drizzle is the correct choice because:
1. `fromDrizzle(tx, sql)` is the canonical pg-boss adapter — using any other migration tool means you still need Drizzle at runtime for the tx adapter.
2. Type-safe schema as code → TypeScript types for all tables at compile time.
3. Parametrized queries by default — `sql` template tag never interpolates unsanitized values.
4. `drizzle-kit` handles both schema diff and migration file generation.

### Why Not Kysely

Kysely is excellent as a query builder, but lacks the migration tooling of drizzle-kit. You would still need node-pg-migrate or flyway alongside it. Keeping Drizzle simplifies the stack to one tool.

### Why Not node-pg-migrate

Node-pg-migrate is SQL files only — no TypeScript types, no schema-as-code. You lose compile-time safety on column names and types. Drizzle gives you both migration files and type generation.

### Migration Workflow

```bash
# drizzle.config.ts at monorepo root
# packages/core/src/db/schema.ts defines all tables

# Generate SQL diff from schema changes
npx drizzle-kit generate --config=packages/core/drizzle.config.ts

# Apply pending migrations (production-safe, uses __drizzle_migrations table)
npx drizzle-kit migrate --config=packages/core/drizzle.config.ts

# Inspect current DB state (dev only)
npx drizzle-kit studio --config=packages/core/drizzle.config.ts
```

`drizzle.config.ts` example:
```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Use aprumo_migration role for DDL
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public',
  },
});
```

### Custom SQL in Migrations (REVOKE, triggers, roles)

For DDL that Drizzle cannot generate (REVOKE, triggers, constraints, roles), use custom migration files:

```typescript
// migrations/0001_custom_roles_and_triggers.sql
-- Use drizzle-kit custom migrations (sql files in out dir)
REVOKE UPDATE, DELETE, TRUNCATE ON postings   FROM aprumo_app;
REVOKE UPDATE, DELETE, TRUNCATE ON raw_events FROM aprumo_app;

CREATE CONSTRAINT TRIGGER validate_double_entry
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_transaction_balance();
```

Custom `.sql` files in the `migrations/` directory are picked up by `drizzle-kit migrate` in order. Drizzle v0.45+ supports this fully.

### BIGINT Handling in Drizzle

```typescript
import { pgTable, bigint, text, timestamp } from 'drizzle-orm/pg-core';

// Use mode: 'bigint' for amount_cents — returns JS BigInt, not string
export const postings = pgTable('postings', {
  id:            bigint('id', { mode: 'bigint' }).primaryKey().generatedAlwaysAsIdentity(),
  transactionId: bigint('transaction_id', { mode: 'bigint' }).notNull(),
  accountId:     bigint('account_id', { mode: 'bigint' }).notNull(),
  amountCents:   bigint('amount_cents', { mode: 'bigint' }).notNull(),
  direction:     text('direction').notNull(), // 'debit' | 'credit'
});
```

`mode: 'bigint'` returns JS `bigint` primitives, not strings. Use `mode: 'number'` only when you are certain values will never exceed `Number.MAX_SAFE_INTEGER` (9 quadrillion cents = R$90 trillion — fine for most use cases but use `bigint` to be safe on a financial ledger).

---

## 4. Fastify v5 — HTTP Layer

**Confidence: HIGH** — Verified via Context7 + npm registry.

**Current version:** 5.8.5

### JSON Schema Validation

Fastify uses `ajv` under the hood. Schema validation is synchronous and runs before route handlers:

```typescript
import fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const app: FastifyInstance = fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    redact: {
      paths: ['req.headers.authorization', 'req.body.secret', '*.cpf', '*.email'],
      censor: '[REDACTED]',
    },
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          // Do NOT log body here — may contain PII
        };
      },
    },
  },
  // Custom AJV options for stricter validation
  ajv: {
    customOptions: {
      strict: true,
      coerceTypes: false, // Do not coerce '123' → 123 on a money API
      allErrors: true,
    },
  },
});
```

**Critical setting:** `coerceTypes: false` — never coerce string amounts to numbers. On a financial API this hides bugs silently.

### Error Handling Pipeline

Fastify v5 error encapsulation — the root error handler is the catch-all:

```typescript
// Root error handler (register BEFORE routes)
app.setErrorHandler((error, request, reply) => {
  // Serialization failures → 503 + retry hint
  if (error.code === '40001') {
    return reply.code(503).send({
      statusCode: 503,
      error: 'Service Unavailable',
      message: 'Transaction conflict, please retry',
      retryable: true,
    });
  }
  // Validation errors → 400
  if (error.validation) {
    return reply.code(400).send({
      statusCode: 400,
      error: 'Validation Error',
      message: error.message,
      details: error.validation,
    });
  }
  // Default — do not leak internal error details in production
  const statusCode = error.statusCode ?? 500;
  app.log.error({ err: error }, 'Unhandled error');
  return reply.code(statusCode).send({
    statusCode,
    error: error.name ?? 'Internal Server Error',
    message: process.env.NODE_ENV === 'production' ? 'Internal error' : error.message,
  });
});
```

### @fastify/swagger Plugin for OpenAPI

```typescript
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

await app.register(swagger, {
  openapi: {
    info: { title: 'Aprumo API', version: '0.1.0' },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer' },
      },
    },
  },
});

await app.register(swaggerUi, {
  routePrefix: '/docs',
  uiConfig: { docExpansion: 'list' },
});
```

Swagger schemas are inferred from the same JSON Schema objects used for validation. Define shared `$defs` in a schema registry via `app.addSchema()` to avoid duplication.

### Prometheus Metrics

```typescript
import metrics from 'fastify-metrics';

await app.register(metrics, {
  endpoint: '/metrics',
  defaultMetrics: { enabled: true },
  // Custom: add ledger-specific gauges
});

// Access prom-client registry for custom metrics:
import { Counter, Histogram } from 'prom-client';
const txCounter = new Counter({
  name: 'aprumo_transactions_total',
  help: 'Total transactions processed',
  labelNames: ['status'],
});
const balanceLagHistogram = new Histogram({
  name: 'aprumo_balance_lag_seconds',
  help: 'Lag between posting and account_balance update',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});
```

### Plugin Pattern for Monorepo

Each package exposes a Fastify plugin. The `@aprumo/webhooks` package registers on `@aprumo/core` as a plugin:

```typescript
// packages/webhooks/src/plugin.ts
import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';

export const webhooksPlugin = fp(async (app: FastifyInstance) => {
  app.post('/webhooks/:provider', { schema: webhookSchema }, webhookHandler);
});
```

`fastify-plugin` (`fp`) is used to break encapsulation when the plugin needs to share the parent's Drizzle DB decorations. Without `fp`, each plugin gets its own encapsulated scope.

---

## 5. Vitest v4 + v8 Coverage Gate

**Confidence: HIGH** — Verified via Context7 + npm registry.

**Current version:** Vitest 4.1.6, `@vitest/coverage-v8` 4.1.6

### Monorepo Config

Each package has its own `vitest.config.ts`. Coverage gate is per-package in CI:

```typescript
// packages/core/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false, // explicit imports preferred for clarity
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/types/**', 'src/migrations/**'],
      thresholds: {
        lines: 90,       // gate for @aprumo/core
        functions: 90,
        branches: 80,
        statements: 90,
      },
    },
    // Longer timeouts for testcontainers tests
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

For other packages (`connector-base`, `connector-starkbank`, `webhooks`), set thresholds to 80%.

### Testcontainers Pattern for Postgres Integration Tests

Use `globalSetup` to start a single Postgres container shared across all test files in a suite — avoids spawning one container per file:

```typescript
// packages/core/src/test/global-setup.ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer;

export async function setup() {
  container = await new PostgreSqlContainer('postgres:16')
    .withDatabase('aprumo_test')
    .withUsername('aprumo_migration')
    .withPassword('test')
    .start();

  // Run migrations against the test container
  process.env.DATABASE_URL = container.getConnectionUri();
  await runMigrations(process.env.DATABASE_URL);

  // Expose to test files via injected context
  return { databaseUrl: container.getConnectionUri() };
}

export async function teardown() {
  await container.stop();
}
```

```typescript
// vitest.config.ts — reference globalSetup
export default defineConfig({
  test: {
    globalSetup: ['./src/test/global-setup.ts'],
    // Each test file gets a clean DB via beforeEach TRUNCATE (not new container)
  },
});
```

**Critical:** Do NOT mock the Postgres connection in ledger tests. CLAUDE.md is explicit: "Não use mocks no caminho do PG do ledger. Use container real." The testcontainers approach is the correct implementation.

### Contract Test Framework Pattern

```typescript
// packages/connector-base/src/contract/index.ts
import { describe, it, expect } from 'vitest';
import type { LedgerConnector } from '../types';

export function runContractTests(
  connectorFactory: () => LedgerConnector,
  label: string,
) {
  describe(`Contract: ${label}`, () => {
    let connector: LedgerConnector;

    beforeEach(() => { connector = connectorFactory(); });

    it('createPayment returns a PaymentRef with a non-empty id', async () => {
      const result = await connector.createPayment(minimalPaymentInput());
      expect(result.id).toBeTruthy();
    });

    it('parseWebhook returns a NormalizedEvent with a stable event type', async () => {
      const event = connector.parseWebhook(sampleRawWebhook());
      expect(event.type).toMatch(/^(charge\.paid|charge\.failed|transfer\.confirmed|dispute\.opened)$/);
    });

    // ... all contract assertions
  });
}

// packages/connector-starkbank/src/index.test.ts
import { runContractTests } from '@aprumo/connector-base/contract';
import { StarkbankConnector } from './connector';

runContractTests(
  () => new StarkbankConnector({ sandbox: true }),
  'StarkbankConnector',
);
```

---

## 6. Money Handling in TypeScript

**Confidence: HIGH**

### BIGINT vs number — Use bigint Primitive

The PostgreSQL `BIGINT amount_cents` column should map to JS `bigint` primitive throughout the codebase:

- `bigint` has no precision loss for integers up to arbitrary size.
- `number` is safe up to 2^53 − 1 = 9,007,199,254,740,991 cents ≈ R$90 trillion. For a ledger that tracks cumulative account balances this could theoretically overflow in pathological cases.
- Consistency rule: never mix `bigint` and `number` arithmetic — TypeScript won't let you, which is good.

### JSON Serialization Problem

`JSON.stringify(42n)` throws `TypeError: Do not know how to serialize a BigInt`. Solutions:

**Recommended:** Serialize `bigint` as `string` in API responses. Money amounts in REST APIs should always be strings to avoid client-side float precision issues:

```typescript
// Fastify serialization — replace BigInt in response schemas
import fastify from 'fastify';

const app = fastify({
  // Custom serializer for BigInt → string
});

// Add a custom replacer in reply serialization, OR
// Use a schema that declares amount as string type and convert at boundary:

// In route handler:
reply.send({
  ...transaction,
  postings: transaction.postings.map(p => ({
    ...p,
    amountCents: p.amountCents.toString(), // BigInt → string for JSON
  })),
});
```

**API contract:** `amount_cents` is always a JSON `string` in requests and responses. Document this in OpenAPI schema with `type: 'string', pattern: '^[0-9]+$'`. Clients parse it with `BigInt()` or their language's equivalent. Never expose it as a JSON number.

**Internal representation:** Always `bigint`. Never convert to `number` for arithmetic — only convert to `string` at the serialization boundary.

### Dinero.js v2 — Verdict: Do Not Use as a Dependency

Dinero.js v2 supports `bigint` and is well-designed, but Aprumo's use case does not benefit from it:

- Aprumo handles only BRL in minor units (centavos). No multi-currency arithmetic, no formatting to human-readable strings (that is a UI/enterprise concern, not core OSS).
- The `Money` helper in `@aprumo/connector-base` should be a thin branded type, not a library dependency:

```typescript
// packages/connector-base/src/money.ts
export type Money = {
  readonly amountCents: bigint;
  readonly currency: 'BRL'; // v0.1 only BRL
};

export function money(amountCents: bigint): Money {
  if (amountCents < 0n) throw new Error('Money amounts must be non-negative');
  return { amountCents, currency: 'BRL' };
}

export function addMoney(a: Money, b: Money): Money {
  return money(a.amountCents + b.amountCents);
}
```

**Rationale:** Zero runtime dependencies on `@aprumo/connector-base` is a feature (it is the base package imported by every connector and by the core). Dinero.js would add 50kB+ to every consumer.

---

## 7. HMAC SHA-256 Webhook Signing

**Confidence: HIGH** — Based on industry-standard Stripe pattern + Node.js crypto module.

### Stripe-Style Signed Payload

The signed payload format: `{timestamp}.{raw_body_bytes}`. This ties the timestamp to the body, preventing replay attacks with a swapped timestamp.

**Incoming verification (Starkbank webhooks):**

Starkbank does NOT use HMAC SHA-256. It uses **ECDSA** with its own public key. The `starkbank.event.parse()` SDK method handles this automatically using the `digital-signature` header. Do NOT attempt to implement ECDSA verification manually — use the SDK:

```typescript
import starkbank from 'starkbank';

async function verifyStarkbankWebhook(
  rawBody: string,
  signature: string,
): Promise<starkbank.Event> {
  // Throws InvalidSignatureError if signature invalid
  return starkbank.event.parse({
    content: rawBody,
    signature: signature,
  });
}
```

**Outgoing signing (Aprumo → customer endpoints):**

Use Node.js built-in `crypto` module — no external dependency:

```typescript
import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCE_SECONDS = 300; // 5-minute replay window

export function signWebhook(
  secret: string,
  body: Buffer | string,
  timestamp: number = Math.floor(Date.now() / 1000),
): { signature: string; header: string } {
  const payload = `${timestamp}.${typeof body === 'string' ? body : body.toString('utf-8')}`;
  const sig = createHmac('sha256', secret).update(payload).digest('hex');
  return {
    signature: sig,
    header: `t=${timestamp},sha256=${sig}`,
  };
}

export function verifyWebhook(
  secret: string,
  rawBody: Buffer | string,
  header: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map(p => p.split('=')),
  ) as { t: string; sha256: string };

  const timestamp = Number(parts.t);
  if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return false;

  const { signature } = signWebhook(secret, rawBody, timestamp);
  const expected = Buffer.from(signature, 'hex');
  const received = Buffer.from(parts.sha256, 'hex');
  if (expected.length !== received.length) return false;

  // Constant-time comparison prevents timing attacks
  return timingSafeEqual(expected, received);
}
```

**Critical rules:**
1. Always use `timingSafeEqual` — never `===` for HMAC comparison (timing side-channel).
2. Read raw body bytes, not parsed JSON — JSON re-serialization changes byte order and spacing.
3. In Fastify, use `addContentTypeParser` to capture raw body before schema parsing:

```typescript
app.addContentTypeParser(
  'application/json',
  { parseAs: 'buffer' },
  (req, body, done) => {
    req.rawBody = body; // attach raw buffer for HMAC verification
    done(null, JSON.parse(body.toString('utf-8')));
  },
);
```

4. The `signWebhook`/`verifyWebhook` helpers live in `@aprumo/connector-base` so they are reusable across the core (outgoing) and connectors (incoming verification in tests).

---

## 8. Starkbank Node SDK

**Confidence: MEDIUM** — Official SDK confirmed, TypeScript type coverage is partial.

**Current version:** `starkbank` 2.40.0 (npm). Actively maintained (published ~1 month ago as of research date).

### Authentication

Starkbank uses ECDSA (secp256k1) for API authentication — not OAuth or API keys. Each request is signed with your private key:

```typescript
import starkbank from 'starkbank';

starkbank.user = new starkbank.Project({
  environment: process.env.STARKBANK_ENV as 'sandbox' | 'production',
  id: process.env.STARKBANK_PROJECT_ID!,
  privateKey: process.env.STARKBANK_PRIVATE_KEY!, // PEM format from env
});
```

### TypeScript Coverage Caveat

The SDK (`types/index.d.ts`) has hand-written types but they are **not always accurate or complete**. Expect to supplement with `as unknown as T` in a few places, with comments documenting why. The core methods (`balance`, `transfer`, `invoice`, `event.parse`) are typed.

### Webhook Event Parsing (ECDSA, not HMAC)

```typescript
// Fastify webhook handler for Starkbank
app.post('/webhooks/starkbank', {
  config: { rawBody: true }, // must receive raw body for ECDSA verification
}, async (request, reply) => {
  const signature = request.headers['digital-signature'] as string;
  if (!signature) return reply.code(400).send();

  let event: starkbank.Event;
  try {
    event = await starkbank.event.parse({
      content: (request as any).rawBody.toString('utf-8'),
      signature,
    });
  } catch (err) {
    // InvalidSignatureError → 401, not 500
    return reply.code(401).send({ error: 'invalid signature' });
  }

  // Dispatch to connector for normalization...
});
```

### Mock Server for Tests — Use MSW v2

**Do NOT use nock.** Nock patches Node's built-in `http` module and does not work with Node 18+ native fetch (which the Starkbank SDK may use internally). Nock is also not maintained for modern Node.

**Use MSW v2** (2.14.6, active development, Node 22 compatible):

```typescript
// packages/connector-starkbank/src/test/mocks/starkbank-handlers.ts
import { http, HttpResponse } from 'msw';

export const handlers = [
  http.get('https://sandbox.api.starkbank.com/v2/balance', () => {
    return HttpResponse.json({ balance: { amount: 1000000 } });
  }),

  http.post('https://sandbox.api.starkbank.com/v2/invoice', () => {
    return HttpResponse.json({ invoices: [{ id: 'mock-invoice-id', status: 'created' }] });
  }),
];

// In test setup:
import { setupServer } from 'msw/node';
const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

**Why MSW over nock:**
- Native fetch interception — works with Node 22.
- Same mock definitions can be reused in browser-side integration tests (future).
- `onUnhandledRequest: 'error'` will fail tests if the SDK makes an unexpected network call — important for security in a fintech codebase.

### Starkbank Sandbox

Starkbank provides a full sandbox at `sandbox.api.starkbank.com`. For integration tests that need to exercise the actual HTTP layer (beyond unit tests with MSW), use the sandbox with test credentials. Store credentials in `.env.test` and exclude from CI unless sandbox credentials are injected via CI secrets.

---

## 9. Supporting Libraries — Verified Versions

| Package | Version | Use | Notes |
|---------|---------|-----|-------|
| `pg` (node-postgres) | Latest | Drizzle PostgreSQL driver | Drizzle works with both `pg` and `postgres.js`; use `pg` for pg-boss compatibility (both use the same pool) |
| `pino` | 10.3.1 | Structured logging (bundled in Fastify) | Use `redact` config for PII |
| `pino-pretty` | Latest | Dev log formatting | Dev-only, never in production |
| `fastify-plugin` (`fp`) | Latest | Break plugin encapsulation for shared decorators | Required when sharing Drizzle db across plugins |
| `@fastify/formbody` | Latest | Parse URL-encoded bodies | Optional, for webhook compat |
| `dotenv` | Latest | .env loading in dev | Use `dotenv/config` import |
| `msw` | 2.14.6 | HTTP mock in tests | Node 22 compatible, replaces nock |
| `testcontainers` | 10.x | Container orchestration | Required by `@testcontainers/postgresql` |

---

## 10. What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `nock` | Does not work with Node 18+ native fetch | `msw` v2 |
| `trigger.dev`, `BullMQ`, `Redis` | Lose exact-once guarantee (ADR-003) | `pg-boss` |
| `prisma` | Cannot use `fromPrisma` tx adapter with pg-boss v10–v11 (only v12+ supports Prisma v7+); Drizzle already chosen | `drizzle-orm` |
| `numeric`/`decimal`/`float` for money | Floating-point precision loss | `BIGINT amount_cents`, JS `bigint` |
| `JSON.stringify` on `bigint` without replacer | `TypeError` at runtime | Serialize as `string` at API boundary |
| `dinero.js` | Unneeded dependency for single-currency integer math | Custom `Money` branded type |
| Kysely as migration tool | No migration diff/generation tooling | `drizzle-kit` |
| `CHECK` constraints for double-entry balance | NOT DEFERRABLE in PostgreSQL | Constraint trigger with `DEFERRABLE INITIALLY DEFERRED` |
| `===` for HMAC comparison | Timing side-channel attack | `crypto.timingSafeEqual()` |
| Global `BigInt.prototype.toJSON` monkey-patch | Affects entire runtime including dependencies | Explicit `.toString()` at serialization boundary |
| `pg-boss` v9 APIs (`publish`, `subscribe`) | Removed in v10 | `boss.send()`, `boss.work()` |
| `work()` expecting a single job | v10 changed to array | `work(name, async (jobs) => { for (const job of jobs) })` |

---

## Sources

- [pg-boss npm](https://www.npmjs.com/package/pg-boss) — version 12.18.2 confirmed
- [pg-boss GitHub Releases](https://github.com/timgit/pg-boss/releases) — v10/v11/v12 breaking changes
- [pg-boss Context7 docs](https://context7.com/timgit/pg-boss/llms.txt) — fromDrizzle adapter, queue API
- [drizzle-orm npm](https://www.npmjs.com/package/drizzle-orm) — version 0.45.2 confirmed
- [drizzle-kit npm](https://www.npmjs.com/package/drizzle-kit) — version 0.31.10 confirmed
- [Drizzle ORM docs (Context7)](https://context7.com/drizzle-team/drizzle-orm-docs) — migrations, raw SQL
- [Fastify npm](https://www.npmjs.com/package/fastify) — version 5.8.5 confirmed
- [Fastify docs v5 (Context7)](https://fastify.dev/docs/v5.1.x/) — validation, error handling, swagger
- [Vitest npm](https://www.npmjs.com/package/vitest) — version 4.1.6 confirmed
- [Vitest docs (Context7)](https://context7.com/vitest-dev/vitest) — coverage v8, monorepo config
- [@testcontainers/postgresql npm](https://www.npmjs.com/package/@testcontainers/postgresql) — version 11.14.0
- [starkbank npm](https://www.npmjs.com/package/starkbank) — version 2.40.0 confirmed
- [starkbank/sdk-node GitHub README](https://github.com/starkbank/sdk-node) — ECDSA auth, event.parse()
- [starkbank/ecdsa-node GitHub](https://github.com/starkbank/ecdsa-node) — ECDSA signature verification
- [MSW npm](https://www.npmjs.com/package/msw) — version 2.14.6 confirmed
- [MSW docs comparison](https://mswjs.io/docs/comparison/) — nock vs MSW analysis
- [PostgreSQL docs — Transaction Isolation](https://www.postgresql.org/docs/current/transaction-iso.html) — SERIALIZABLE/SSI behavior
- [PostgreSQL docs — SET CONSTRAINTS](https://www.postgresql.org/docs/current/sql-set-constraints.html) — DEFERRABLE constraint triggers
- [PostgreSQL docs — REVOKE](https://www.postgresql.org/docs/current/sql-revoke.html) — role permission management
- [Hookray — HMAC Webhook Verification 2026](https://hookray.com/blog/webhook-signature-verification-2026) — Stripe pattern reference
- [@biomejs/biome npm](https://www.npmjs.com/package/@biomejs/biome) — version 2.4.15 confirmed
- [@changesets/cli npm](https://www.npmjs.com/package/@changesets/cli) — version 2.31.0 confirmed
