---
status: "Accepted"
date: "2026-05-18"
decision-makers: "Joao Escudero"
---

# ADR-005: Accounting Split with Async Settlement

> **Note on dating:** This decision was made during initial project design (2026-05-18) and documented here on 2026-05-22 as a back-fill from PRD.md §9. The `date` field reflects the original decision.

## Context and Problem Statement

Brazilian payment rails (PIX and boleto) have asynchronous settlement semantics: a charge is created at time `t=0` (capture/authorization), but funds are not settled to the merchant account until `t+N` (PIX: near-instant; boleto: 1–3 business days; credit card: D+30). During the window between creation and settlement, the charge is "pending" — money is reserved but not yet available.

Aprumo must model this lifecycle in double-entry bookkeeping. The key question is: **when does the ledger record the posting for a payment, and how are pending/reserved funds represented?**

Options:
1. Post at charge creation (capture/authorization event): creates a posting for the full amount immediately, even though settlement has not occurred.
2. Post at settlement event (webhook confirming fund receipt): only record postings when money has actually moved.
3. Post at both times: a "pending" posting at creation, a "settlement" posting when confirmed, with a reversal of the pending posting.

## Decision Drivers

* **Double-entry purity**: every posting must correspond to an actual event that has occurred. Posting before settlement records money that has not yet moved — this violates the accounting principle of revenue recognition at the point of settlement.
* **v0.1 MVP scope**: implementing the full pending/settlement accounting split (Option 3) requires `pending_balance` and `available_balance` columns, a separate "pending" account type, and a reversal pattern. This is out of scope for v0.1.
* **PSP agnosticism**: the settlement model must work for any PSP, including those that do not provide a distinct "pending" event (only a "settled" event). Posting at settlement works for all PSPs; posting at creation requires a "creation" event for every PSP.
* **Connector simplicity**: normalizing events for v0.1 Starkbank connector is simpler if the ledger only posts on settlement (`charge.paid`, `pix.confirmed`, `boleto.paid`). No reversal logic needed in v0.1.
* **v0.5 reserved columns**: `pending_balance BIGINT NULL` and `available_balance BIGINT NULL` are reserved in `account_balance` (ADR-009, D-45) but populated by the v0.5 worker. This is the forward-compatible reservation for the full accounting split.

## Considered Options

* **Option A: Post at settlement event only (v0.1 scope)** (chosen)
* **Option B: Post at charge creation (synchronous)**
* **Option C: Full accounting split — pending posting at creation + settlement posting + reversal (v0.5)**

## Decision Outcome

**Chosen option: Option A — post at settlement event only for v0.1**, with Option C deferred to v0.5. `account_balance.balance` reflects settled funds only. `pending_balance` column is reserved in schema (NULL in v0.1) for the v0.5 worker.

### Consequences

**Good:**
* Simple v0.1 model: one ledger posting per settled payment event. No reversal logic, no pending account type.
* Works for any PSP: settlement webhook is universal. No PSP-specific "creation" event handling required.
* `account_balance.balance` has clear, unambiguous semantics in v0.1: settled funds only.
* Connector normalization is simpler: Starkbank `charge.paid` / PIX confirmed / boleto paid → one normalized event → one `post_transaction()` call.
* Schema reservations (`pending_balance`, `available_balance`) avoid a hot table `ALTER TABLE ADD COLUMN` migration during v0.1 → v0.5 upgrade.

**Bad:**
* v0.1 `balance` shows only settled funds. Design partners cannot query "how much is pending?" in v0.1 — they must consult the PSP dashboard directly.
* No real-time pending balance visibility until v0.5. This is a known limitation, documented in design partner onboarding materials.
* v0.5 accounting split requires new account types and the reversal/settlement pattern. This is a planned migration with schema reserved, not a surprise.

## Pros and Cons of the Options

### Option A: Post at settlement event only (v0.1)

**Pros:**
- Simple, unambiguous: `balance` = settled funds.
- No reversal logic, no pending account type.
- PSP-agnostic: every PSP emits a settlement event.
- Connector normalization is minimal.

**Cons:**
- No pending balance visibility in v0.1.
- Design partners see a "lag" between charge creation and balance update.

### Option B: Post at charge creation (synchronous)

Post a debit/credit pair at the moment a charge is created (before settlement), treating captured funds as immediately settled in the ledger.

**Why Option B was not chosen:**
- Violates accounting accuracy: `balance` would include funds that have not settled. A boleto created on Monday and paid on Thursday would appear in Tuesday's balance — incorrect.
- Requires reversal postings if a charge expires or is cancelled — adding reversal complexity to v0.1.
- PIX devolution (BACEN 90-day window, MED disputes) becomes complicated: a posting already exists for a payment that may be partially reversed.
- Not PSP-agnostic: requires a distinct "creation" event for every PSP, and some PSPs do not emit these.

### Option C: Full accounting split — pending + settlement postings (v0.5)

The full accounting split posts two pairs of entries per payment:
1. At creation: debit `accounts_receivable` (pending), credit `income_pending`.
2. At settlement: debit `income_pending`, credit `revenue` (realized); debit `bank` (asset), credit `accounts_receivable`.

**Why Option C is deferred to v0.5 (not rejected):**
- Correct and complete double-entry model for async settlement.
- Requires `pending_balance` worker, new account types (`accounts_receivable`, `income_pending`), and reversal posting logic.
- Out of scope for v0.1 MVP. Schema reservations (`pending_balance BIGINT NULL`, `available_balance BIGINT NULL` in `account_balance`) ensure no blocking migration is needed when v0.5 introduces this pattern.
- Design partners will be informed of the v0.5 upgrade path in onboarding documentation.

## More Information

* [BACEN PIX devolution regulation](https://www.bcb.gov.br/estabilidadefinanceira/pix) — 90-day return window (MED) is a v0.5 concern.
* `account_balance` schema: `balance BIGINT NOT NULL`, `pending_balance BIGINT NULL` (reserved, v0.5), `available_balance BIGINT NULL` (reserved, v0.5).
* See ADR-009 for reservation pattern documentation (D-45, D-47).
* See ADR-006 for v0.1 vs. v0.5 milestone scoping rationale.
* Phase 4 (Balance Worker) implements the v0.1 settlement-only balance worker.
* Phase 3 (Reconciliation) defines the outbound event vocabulary including `charge.paid`, `pix.confirmed`, `boleto.paid`.
