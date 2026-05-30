---
status: "Accepted"
date: "2026-05-18"
decision-makers: "Joao Escudero"
---

# ADR-006: Milestone Versioning — v0.1 and v0.5

> **Note on dating:** This decision was made during initial project design (2026-05-18) and documented here on 2026-05-22 as a back-fill from PRD.md §9. The `date` field reflects the original decision.

## Context and Problem Statement

Aprumo is an open-source financial ledger with a broad feature vision: ledger foundation, multiple PSP connectors, split payments, dispute lifecycle, dunning, recurring billing, and observability. Building all features before any design partner feedback creates high risk: wrong abstractions solidify, scope expands without validation, and time-to-first-feedback grows.

A milestone scoping decision is needed: **which features ship in v0.1 (first design partner release) and which are deferred to v0.5?**

The tradeoffs are:
- **Too ambitious (v0.1 = everything)**: delays first feedback. Risk of building the wrong thing.
- **Too minimal (v0.1 = only logging)**: insufficient for a real production ledger. Design partners cannot evaluate the system.
- **Right-sized MVP**: enough to validate the core value proposition (PSP-agnostic immutable double-entry ledger) while leaving room for v0.5 features validated by design partner feedback.

## Decision Drivers

* **Fastest path to design partner feedback**: v0.1 must be production-ready enough for 2–3 Brazilian companies using Starkbank to run their payments through Aprumo.
* **Core value proposition validation**: the central promise is "immutable double-entry ledger + PSP-agnostic connector." v0.1 must prove this with one real PSP (Starkbank).
* **OSS credibility**: v0.1 must publish `@aprumo/core`, `@aprumo/connector-starkbank`, and `@aprumo/webhooks` to npm with 90% test coverage. A credible OSS release justifies adoption.
* **YAGNI discipline**: v0.5 features that require significant design exploration (split payments, dispute lifecycle, dunning) must not block v0.1.
* **Forward-compatible schema**: v0.5 features that touch hot tables should be accounted for in v0.1 schema (reserved columns, not ad-hoc migrations) when the reservation cost is low.

## Considered Options

* **Option A: Phased milestone scoping — v0.1 MVP + v0.5 expanded** (chosen)
* **Option B: Single release — ship everything before any release**
* **Option C: Minimal v0.1 (ledger only, no connectors) + v0.5 (connectors)**

## Decision Outcome

**Chosen option: Option A — phased milestone scoping with a well-defined v0.1 and v0.5 boundary.**

### v0.1 Scope (this milestone)

**Core ledger (Phase 2):**
- `accounts`, `transactions`, `postings`, `raw_events`, `account_balance`, `*_audit`, `outbound_endpoints`, `outbound_events` schema.
- `post_transaction()` SQL function (sole write path, double-entry validated, SERIALIZABLE).
- Three-layer immutability: REVOKE + SECURITY DEFINER + DEFERRABLE CONSTRAINT TRIGGER.
- Role-based access: `aprumo_app` (SELECT/INSERT), `aprumo_migration` (DDL).

**REST API (Phase 3):**
- `POST /transactions`, `GET /transactions/:id`, `GET /accounts/:id` (with cursor-paginated postings), `POST /accounts`, `GET /health`.
- `withRetryOnSerializationFailure` wrapper (up to 3 retries on `40001`).
- BigInt→string serialization at API boundary.
- Idempotency via `Idempotency-Key` header.

**Balance worker (Phase 4):**
- pg-boss incremental worker with `last_posting_id` cursor.
- `account_balance.balance` reflects settled funds only.
- `pending_balance` / `available_balance` reserved as NULL.
- `aprumo_balance_worker_lag_seconds` Prometheus metric.

**Connector (Phase 5):**
- `@aprumo/connector-base`: `LedgerConnector` interface + contract tests + `Money` type.
- `@aprumo/connector-starkbank`: Starkbank connector implementing `LedgerConnector`.

**Webhooks (Phases 6–7):**
- Inbound: `POST /webhooks/:provider` with exact-once `raw_events` + pg-boss enqueue in same tx.
- Outbound: HMAC-SHA256 signed, exponential retry, dead-letter after 6 attempts.
- 14-event outbound vocabulary.

**Observability + release (Phase 9):**
- Pino structured logging with redact.
- Prometheus metrics at `/metrics`.
- OpenAPI spec via `@fastify/swagger`.
- `@aprumo/core@0.1.0`, `@aprumo/connector-starkbank@0.1.0`, `@aprumo/webhooks@0.1.0` on npm.

### v0.5 Scope (next milestone)

- **Second connector**: `@aprumo/connector-abacatepay`.
- **Pending balance**: `pending_balance` / `available_balance` worker implementation.
- **Split payments**: `splits` table + split-aware posting logic.
- **Dispute lifecycle**: `disputes` table + dispute workflow (evidence, won/lost, chargeback posting).
- **Dunning**: retry scheduling for failed recurring charges.
- **Recurring billing**: `createToken` on `LedgerConnector`, token-based charge flow.
- **Smart routing (true multi-PSP)**: real failover across multiple active connectors.
- **Full async settlement accounting**: pending posting at creation + settlement posting + reversal.

### Consequences

**Good:**
* v0.1 is achievable within the planning horizon. Design partners can evaluate a complete, production-quality ledger with one PSP.
* v0.5 scope is validated by design partner feedback from v0.1. Feature priorities may shift.
* Schema reservations (`pending_balance`, `available_balance`) avoid a blocking `ALTER TABLE` migration during upgrade.
* OSS release at v0.1 establishes credibility for community contributions before v0.5.

**Bad:**
* v0.1 `balance` shows settled funds only. Design partners cannot query pending amounts directly.
* No split payment or dispute handling in v0.1. Not suitable for marketplace use cases until v0.5.
* Only one connector (Starkbank) in v0.1. No true multi-PSP failover.

## Pros and Cons of the Options

### Option A: Phased milestone scoping — v0.1 + v0.5

**Pros:**
- Fastest path to design partner feedback.
- YAGNI: v0.5 features are built with validated requirements.
- Schema reservations make upgrade non-breaking.

**Cons:**
- v0.1 is limited in scope for marketplace/split use cases.

### Option B: Ship everything before any release

**Pros:**
- Complete feature set for first users.

**Cons:**
- Delays design partner validation by months.
- High risk of building wrong abstractions without feedback.
- Not appropriate for a pre-alpha OSS project.

### Option C: v0.1 = ledger only (no connectors)

**Pros:**
- Minimal v0.1 scope, fastest delivery.

**Cons:**
- Without a connector and webhooks, design partners cannot demonstrate end-to-end value (PSP event → ledger posting → outbound webhook). The core value proposition is unvalidatable.
- No connector means no contract test suite — a key quality signal.

## More Information

* [PRD.md §1.2 — MVP objectives](../PRD.md) — two-milestone plan.
* [PRD.md §1.3 — Non-objectives](../PRD.md) — features explicitly out of scope.
* See ADR-007 for smart routing scope decision (logical failover in v0.1, real multi-PSP in v0.5).
* See ADR-005 for accounting split deferral rationale (settlement-only in v0.1, pending in v0.5).
* See ADR-009, D-45 for schema reservation strategy.
