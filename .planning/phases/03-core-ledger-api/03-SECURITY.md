---
phase: 03
slug: core-ledger-api
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-01
---

# Phase 03 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Register authored at plan time across 7 plans (03-01 … 03-07). Retroactively verified by gsd-security-auditor.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| npm registry → node_modules | 6 new packages pulled from npm | package code (untrusted) |
| Migration SQL → Postgres DDL | Hand-written DDL alters append-only postings table | schema changes |
| HTTP request body → Fastify handler | Ajv validation gate (coerce/removeAdditional/protoPoisoning) | client JSON |
| HTTP POST body → post_transaction SQL | amount_cents / account_id must be parameterized | financial scalars |
| Idempotency-Key header → transactions.idempotency_key | user-supplied, length-bounded by TypeBox | dedup key |
| cursor query param → SQL WHERE clause | opaque base64 string; decode failure → 400 | pagination state |
| PG driver error → HTTP response | pgErrorHandler must not echo PG detail to client | error metadata |
| BigInt → JSON response | setSerializerCompiler before native JSON.stringify | money values |
| process.env → PG connection string | DATABASE_URL must not be logged | secret |
| Request logs → pino output | redact config; bodies never logged | PII / secrets |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-03-01-01 | Tampering | npm package install | mitigate | Blocking human-verify checkpoint; all 6 packages verified on npmjs.com before install (03-01-SUMMARY.md task 1) | closed |
| T-03-01-SC | Tampering | npm/pip/cargo installs | mitigate | Same blocking checkpoint covers slopcheck-unavailable fallback | closed |
| T-03-02-01 | Tampering | 0010_postings_created_at.sql | mitigate | `ALTER TABLE "postings" ADD COLUMN` only (0010:16); no data rewrite; append-only preserved | closed |
| T-03-02-02 | Tampering | postings table | accept | created_at DEFAULT now() set by PG; post_transaction() has no created_at param (see Accepted Risks) | closed |
| T-03-02-03 | Information Disclosure | migration-hashes.json | mitigate | scripts/check-migration-drift.mjs SHA-256 gate; ci.yml:34 runs it; hashes.json:12 has 0010 entry | closed |
| T-03-03a | Information Disclosure | pgErrorHandler 500 path | mitigate | pg-error-handler.ts:258-267 hardcodes `"An unexpected error occurred."`; never error.message/stack; tested pg-error-handler.test.ts:149-168 | closed |
| T-03-03b | Denial of Service | withRetryOnSerializationFailure | mitigate | with-retry.ts:14-16 MAX_RETRIES=3; backoff 50/100/200ms; 4th re-throws; tested with-retry.test.ts:43-58 | closed |
| T-03-03c | Tampering | error code discrimination | mitigate | with-retry.ts:35-39 type-safe guard (no `any`); pg-error-handler.ts:156-160 `code ?? cause?.code` | closed |
| T-03-04a | Tampering | Ajv coerceTypes | mitigate | server.ts:97 `coerceTypes:"array"` (settled value; see deviation note) — blocks array→scalar coercion | closed |
| T-03-04b | Tampering | Mass assignment | mitigate | server.ts:98 `removeAdditional:"all"` strips unknown body fields | closed |
| T-03-04c | Tampering | Prototype pollution | mitigate | server.ts:88 `onProtoPoisoning:"error"` rejects `__proto__` | closed |
| T-03-04d | Information Disclosure | pino request logs | mitigate | server.ts:82 redact authorization/cookie/idempotency-key; Fastify 5 never logs bodies | closed |
| T-03-04e | Information Disclosure | OpenAPI /docs | accept | /docs unauthenticated v0.1; spec has no secrets (see Accepted Risks) | closed |
| T-03-05a | Tampering | SQL injection via postings body | mitigate | transactions.ts:154-167 Drizzle sql template parameterization for all ROW(...) scalars | closed |
| T-03-05b | Tampering | amount_cents ≤0 | mitigate | schemas/transaction.ts:23 `Type.Integer({minimum:1})` | closed |
| T-03-05c | Tampering | amount_cents non-integer | mitigate | schemas/transaction.ts:23 `Type.Integer()` rejects floats; coerceTypes:'array' does not coerce body fields | closed |
| T-03-05d | Tampering | account_id not UUID | mitigate | schemas/transaction.ts:22 `Type.String({format:"uuid"})` | closed |
| T-03-05e | Tampering | Idempotency-Key replay by different caller | accept | no auth v0.1; key prevents accidental not malicious dups (see Accepted Risks) | closed |
| T-03-05f | Information Disclosure | 500 error responses | mitigate | Verified under T-03-03a (same pg-error-handler.ts 500 path) | closed |
| T-03-06a | Tampering | cursor decode | mitigate | accounts.ts:61-79 decodeCursor() try/catch; :237-245 throws invalid_cursor → 400 | closed |
| T-03-06b | Tampering | SQL injection via cursor values | mitigate | accounts.ts:254-256 keyset WHERE binds created_at + id as Drizzle params | closed |
| T-03-06c | Tampering | limit >200 | mitigate | schemas/account.ts:116-120 maximum:200; accounts.ts:231 `Math.min(...,200)` belt-and-suspenders | closed |
| T-03-06d | Tampering | accounts INSERT invalid type | mitigate | schemas/account.ts:20-28 union of 5 exact literals; Ajv rejects others | closed |
| T-03-06e | Information Disclosure | account_balance.balance in response | accept | balance numeric, not PII (see Accepted Risks) | closed |
| T-03-06f | Information Disclosure | metadata JSONB | mitigate | server.ts:82 redact; bodies never logged; metadata returned as-is, PII warning in API spec | closed |
| T-03-07a | Information Disclosure | GET /health 503 | mitigate | health.ts:65-69 `catch {}` no binding; 503 body hardcoded `"unreachable"`; tested health.test.ts:72-88 | closed |
| T-03-07b | Information Disclosure | main.ts startup logs | mitigate | main.ts:77 only `{port}` logged; databaseUrl never reaches pino | closed |
| T-03-07c | Denial of Service | missing SIGTERM handler | mitigate | main.ts:60-71 SIGTERM closes app + pgClient before process.exit(0) | closed |
| T-03-07d | Information Disclosure | DATABASE_URL in env | accept | env var standard; validated at startup; never logged (see Accepted Risks) | closed |
| T-03-07e | Information Disclosure | OpenAPI /docs | accept | duplicate of T-03-04e; no auth v0.1 (see Accepted Risks) | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-03-01 | T-03-02-02 | `created_at` DEFAULT now() set by Postgres at INSERT time. post_transaction() (migration 0003) has no created_at param. Application cannot inject arbitrary timestamps. | gsd-secure-phase | 2026-06-01 |
| AR-03-02 | T-03-04e / T-03-07e | `/docs` (Swagger UI) unauthenticated in v0.1. Spec contains schema docs only — no secrets/credentials. Acceptable for OSS self-hosted. Auth deferred per CONTEXT.md. | gsd-secure-phase | 2026-06-01 |
| AR-03-03 | T-03-05e | Idempotency-Key is a dedup key, not an auth credential. No per-caller auth in v0.1. Prevents accidental dups, not malicious replay. Auth deferred per CONTEXT.md. | gsd-secure-phase | 2026-06-01 |
| AR-03-04 | T-03-06e | `account_balance.balance` (BigInt cents) is a numeric amount — not PII — and core to the ledger API contract. Read-access callers inherently see balances. | gsd-secure-phase | 2026-06-01 |
| AR-03-05 | T-03-07d | `DATABASE_URL` provided via env var (standard container practice). Validated at startup (main.ts:34-36); value never logged (main.ts:77). Secret management is infra concern. | gsd-secure-phase | 2026-06-01 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-01 | 30 | 30 | 0 | gsd-security-auditor (verify-mitigations mode) |

---

## Deviation Note — T-03-04a coerceTypes

Plan declared `coerceTypes: false`. Implementation uses `coerceTypes: 'array'` (server.ts:97). Documented bug-fix (03-06-SUMMARY.md): querystring values arrive as strings at the HTTP layer, so `false` rejected valid `?limit=2` requests. `'array'` coerces scalar query strings to integers but does NOT coerce arrays-to-scalars — security intent of T-03-04a (no silent coercion of body values) is preserved. **Follow-up:** update the 03-04 plan threat register to record the settled value `'array'` so future audits do not re-flag.

---

## Unregistered Implementation Flags (informational, not blockers)

| Flag | Description | Resolution |
|------|-------------|------------|
| Drizzle error wrapping | `DrizzleQueryError` stores SQLSTATE on `error.cause.code`, not `error.code` | Handled: pg-error-handler.ts:160 + with-retry.ts:37-38 check `code ?? cause?.code`; gap-closure commits 15db583 + 698ea4b added test + fix |
| Concurrent idempotency fallback | After 3 SERIALIZABLE retries exhausted, fallback SELECT needed to satisfy Invariant #3 | Handled: transactions.ts:187-211 fallback SELECT → 200 on duplicate |
| coerceTypes deviation | Plan `false`; impl `'array'` for querystring integers | Handled: see Deviation Note above |

---

## Future Phase Notes

1. **Auth gap (T-03-05e, T-03-04e, T-03-07e):** three accepted threats share one root cause — no auth in v0.1. When auth lands, re-audit all three and close with code evidence.
2. **`coerceTypes: 'array'` scope:** safe for current querystring use. Re-review if new endpoints accept array-typed query params.
3. **PAN storage invariant:** no card-data paths in this phase. Verify CLAUDE.md Invariant §7 when connector packages (Phase 5+) land.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-01
