# Phase 3: Core Ledger API - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-30
**Phase:** 03-core-ledger-api
**Areas discussed:** Plans-exist gate, URL versioning, Error body shape, Pagination contract, Health endpoint, Idempotency-Key policy, Request correlation ID, Log redaction, JSON field casing, Pagination limits, ID exposure format

---

## Plans-exist gate

| Option | Description | Selected |
|--------|-------------|----------|
| Capture context + replan after | Discuss, write CONTEXT.md, then re-run plan-phase | ✓ |
| Capture context, keep plans | Document context but leave 7 plans as-is | |
| Skip — plans are fine | Cancel; go straight to execute | |

**User's choice:** Capture context + replan after
**Notes:** 7 plans (03-01..03-07) existed before any discussion; they will be regenerated to match captured decisions.

---

## URL versioning

| Option | Description | Selected |
|--------|-------------|----------|
| /v1 prefix | Versioned routes; evolve without breaking consumers/connectors | ✓ |
| Unprefixed | /transactions, /accounts per ROADMAP shorthand | |

**User's choice:** /v1 prefix
**Notes:** ROADMAP's unprefixed paths treated as shorthand; OpenAPI reflects /v1.

---

## Error body shape

| Option | Description | Selected |
|--------|-------------|----------|
| RFC 9457 problem+json | application/problem+json {type,title,status,detail,code} | ✓ |
| Custom envelope | {error, code, message} | |

**User's choice:** RFC 9457 problem+json
**Notes:** Stable machine-readable `code` strings; `instance` = correlation id.

---

## Pagination contract

| Option | Description | Selected |
|--------|-------------|----------|
| Opaque cursor (created_at,id) + {data,next_cursor} | Sort by created_at desc, id tiebreaker; opaque base64 cursor | ✓ |
| posting.id desc + {data,next_cursor} | Cursor = posting.id desc per API-09 literal | |
| You decide | Planner picks | |

**User's choice:** Opaque cursor (created_at, id)
**Notes:** Confirmed correct after discovering ids are UUID v4 (non-chronological) — id-only cursor would be wrong. Supersedes API-09 literal wording.

---

## Health endpoint

| Option | Description | Selected |
|--------|-------------|----------|
| Single GET /health with PG check | Liveness + readiness in one endpoint | ✓ |
| Split /health/live + /health/ready | k8s-style probes | |

**User's choice:** Single GET /health with PG check
**Notes:** Matches success criterion #5; sufficient for docker-compose v0.1. Split deferred.

---

## Idempotency-Key policy

| Option | Description | Selected |
|--------|-------------|----------|
| Required, reject 400 if missing | Force client-chosen key; no double-posting | ✓ |
| Optional, auto-generate if missing | Server UUID when absent | |

**User's choice:** Required, reject 400 if missing
**Notes:** Validate non-empty, max ~255. PG layer (migration 0008) handles concurrent dup → 200.

---

## Request correlation ID

| Option | Description | Selected |
|--------|-------------|----------|
| Generate + echo + use as problem instance | genReqId UUID, echo X-Request-Id, instance field | ✓ |
| Internal log only | reqId in logs, not exposed | |
| Skip for v0.1 | No correlation id | |

**User's choice:** Generate + echo + use as problem instance
**Notes:** Honor inbound X-Request-Id if present.

---

## Log redaction policy

| Option | Description | Selected |
|--------|-------------|----------|
| Strict: headers + bodies, allowlist fields | Redact auth/cookie/Idempotency-Key, no bodies, summary only | ✓ |
| Redact known-sensitive keys only | Fixed key list, allow other logging | |

**User's choice:** Strict: headers + bodies, allowlist fields
**Notes:** Never log amounts/owner_ref/metadata/PII. Aligns with CLAUDE.md + LGPD.

---

## JSON field casing

| Option | Description | Selected |
|--------|-------------|----------|
| snake_case | amount_cents, owner_ref, created_at — matches DB | ✓ |
| camelCase | amountCents, ownerRef — idiomatic JS, adds mapping | |

**User's choice:** snake_case
**Notes:** 1:1 with DB columns; consistent with amount_cents already in REQ/ROADMAP.

---

## Pagination limits

| Option | Description | Selected |
|--------|-------------|----------|
| default 50, max 200, reject >max with 400 | Explicit bounds, over-max is client error | ✓ |
| default 50, max 200, clamp silently | Quietly cap to 200 | |
| You decide | Planner picks numbers | |

**User's choice:** default 50, max 200, reject >max with 400
**Notes:** No silent truncation — fits strict ledger.

---

## ID exposure format

| Option | Description | Selected |
|--------|-------------|----------|
| UUID strings, cursor sorts by created_at | Expose UUID strings; confirm cursor by created_at | ✓ |
| Revisit — this changes something | Reconsider a prior decision | |

**User's choice:** UUID strings, cursor sorts by created_at
**Notes:** Schema confirmed uuid().defaultRandom() for all entities; money stays BigInt→string.

---

## Claude's Discretion

- TypeBox vs raw JSON Schema (research recommends type-provider-typebox).
- Internal module layout, file naming, retry backoff timings (≤3), test structure.
- Concrete problem+json `type`/`title` URN strings per error.

## Deferred Ideas

- Authentication / authorization (no auth in v0.1).
- Rate limiting (no auth/tenancy to scope to).
- CORS (no OSS UI).
- Split /health/live + /health/ready k8s probes (revisit for hosted/enterprise).
- OpenAPI security scheme (add when auth lands).
