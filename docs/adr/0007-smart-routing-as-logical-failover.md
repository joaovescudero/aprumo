---
status: "Accepted"
date: "2026-05-18"
decision-makers: "Joao Escudero"
---

# ADR-007: Smart Routing as Logical Failover in v0.1

> **Note on dating:** This decision was made during initial project design (2026-05-18) and documented here on 2026-05-22 as a back-fill from PRD.md §9. The `date` field reflects the original decision.

## Context and Problem Statement

One of Aprumo's stated value propositions is PSP redundancy: "When one PSP is down, route to another." This is "smart routing" — the ability to intelligently select which PSP connector to use for a given payment, and to fail over to a backup PSP if the primary is unavailable.

True multi-PSP smart routing requires:
1. At least two active PSP connectors.
2. A routing algorithm that selects among connectors based on health, cost, or user rules.
3. A fallback path: if Connector A fails, retry with Connector B.
4. Consistent ledger state regardless of which PSP ultimately processes the payment.

In v0.1, Aprumo ships with **one connector** (Starkbank). True multi-PSP failover is architecturally impossible with a single connector. The question is: **what should "smart routing" mean in v0.1?**

## Decision Drivers

* **v0.1 has one connector (Starkbank)**: real multi-PSP failover requires at least two connectors. Building a routing framework in v0.1 would be unused scaffolding.
* **Retry is always needed**: even with a single PSP, transient errors (Starkbank API timeout, network hiccup, temporary 503) require retry logic. This retry logic is the minimum viable "smart routing" for v0.1.
* **Honest positioning**: the PRD acknowledges that v0.1 smart routing is logical failover (same PSP retry), not true multi-PSP redundancy. Marketing copy must not overstate the capability.
* **Connector registry exists**: the `@aprumo/webhooks` connector registry (`Record<string, LedgerConnector>`) is designed for multiple connectors. Adding a second connector in v0.5 automatically enables real routing without an architecture change.
* **YAGNI**: a routing decision algorithm (cost-based, latency-based, rule-based) is complex and requires product decisions about routing rules. Deferring to v0.5 when there are two connectors and real design partner feedback on routing preferences is correct.

## Considered Options

* **Option A: Logical failover — exponential retry on same PSP (v0.1)** (chosen)
* **Option B: Build full multi-PSP routing framework in v0.1 (unused)**
* **Option C: No retry — surface PSP errors directly to caller**

## Decision Outcome

**Chosen option: Option A — v0.1 smart routing = exponential backoff retry on the same PSP connector**. The routing framework (connector selection, health scoring, inter-PSP failover) is deferred to v0.5 when two connectors are available.

Retry policy (v0.1):
- Initial retry: 1 second.
- Backoff: exponential (1s → 2s → 4s → ...).
- Max retries: 3 (after 3 failures, surface the error as a dead-letter job for admin replay).
- Idempotency: all retried charges use the same `Idempotency-Key` to prevent duplicate charges on the PSP side.
- Scope: applies to the Starkbank connector's `createPayment()`, `withdraw()`, and any outbound API calls that surface transient errors.

### Consequences

**Good:**
* Simple, correct implementation: retry with exponential backoff is well-understood.
* Idempotency keys prevent double-charges on retry.
* No routing algorithm complexity in v0.1 — no product decisions needed before design partner feedback.
* Connector registry design already supports multiple connectors. Adding Starkbank + AbacatePay in v0.5 naturally enables real routing without an architecture rewrite.
* Honest marketing: "logical failover via retry" is accurate and not misleading.

**Bad:**
* True PSP redundancy (failover to a different PSP when Starkbank is down for extended periods) is not available in v0.1. Design partners must accept this limitation.
* v0.1 routing is "retry policy" not "routing policy" — the distinction must be clear in documentation and sales conversations.

## Pros and Cons of the Options

### Option A: Logical failover — exponential retry on same PSP

**Pros:**
- Simple, well-understood implementation.
- Idempotency prevents duplicate charges on retry.
- No wasted engineering on unused routing framework.
- Real routing enabled automatically when v0.5 adds second connector.

**Cons:**
- Not true multi-PSP failover.
- Starkbank downtime affects all payments in v0.1.

### Option B: Full multi-PSP routing framework in v0.1

**Pros:**
- Feature-complete from day one.

**Cons:**
- Requires two connectors to be testable. With one connector, the routing framework is dead code in v0.1.
- Routing algorithm requires product decisions (cost-based? latency-based? rule-based?) that cannot be validated without two live connectors and design partner feedback.
- Engineering cost is high; benefit is zero in v0.1.

### Option C: No retry — surface PSP errors directly

**Pros:**
- Simplest implementation.

**Cons:**
- Transient Starkbank API errors (network timeouts, rate limits) would bubble up as failures to design partners. Unacceptable user experience for a production ledger.
- No dead-letter mechanism for failed payments.

## More Information

* [PRD.md §11 — Risks](../PRD.md): "Smart routing limited (only Starkbank in MVP, no real multi-PSP failover). Reposition MVP as logical failover + immutable ledger."
* See ADR-006 for v0.1 vs. v0.5 scope boundary.
* See ADR-003 for pg-boss retry mechanism used in the outbound webhook dispatcher.
* v0.5: AbacatePay connector enables real two-PSP routing. Routing algorithm design should be a product decision informed by design partner feedback on routing preferences.
* The connector registry in `@aprumo/webhooks` uses `Record<string, LedgerConnector>` — adding a second entry is the only code change needed to enable real routing in v0.5.
