# Feature Landscape: Aprumo Ledger

**Domain:** Open-source double-entry financial ledger, PSP-agnostic, Brazilian recurring-revenue SaaS
**Researched:** 2026-05-18
**Reference products:** Formance, Fragment, Modern Treasury Ledgers, Blnk, Adyen, Stripe, Asaas, Starkbank

---

## Table Stakes

Features users expect from any credible financial ledger. Absence causes immediate abandonment or blocks adoption entirely.

| Feature | Why Expected | Complexity | In v0.1? | Notes |
|---------|--------------|------------|----------|-------|
| Double-entry posting API | Foundational invariant. No ledger without it. | Low | YES (RF-1) | `post_transaction(postings[])` |
| Idempotent writes | Webhooks retry. Idempotency prevents double-counting. | Low | YES (RF-1) | `Idempotency-Key` header + UNIQUE constraint |
| Account CRUD | Can't post without accounts. | Low | YES (RF-3) | 5 canonical types |
| Account statement / posting history | Finance team's primary interrogation interface. | Low | YES (RF-2) | Paginated, cursor-based |
| Materialized balance | Real-time balance is the #1 query. Deriving it on-demand at scale is too slow. | Medium | YES (RF-7) | Incremental worker with lag metric |
| Exact-once webhook ingestion | At-least-once delivery from PSPs is a given. Without exact-once, duplicate postings are a silent data corruption. | Medium | YES (RF-5) | pg-boss + same-tx enqueue |
| Webhook signature validation | Security baseline. PSP impersonation attack otherwise trivial. | Low | YES (RF-4,5) | HMAC-SHA256 |
| Outbound webhooks with retry | Clients need to react to ledger events. Dead-letter + replay is table stakes the moment the first webhook fails silently. | Medium | YES (RF-6) | Exponential backoff, 6 attempts |
| Observability: structured logs + Prometheus | Operators can't trust what they can't observe. Ledger drift is invisible without metrics. | Low | YES (RNF-6.3) | pino + Prometheus metrics |
| Health endpoint | Required by every k8s/load-balancer deployment. | Low | YES | `/health` |
| Automatic reconciliation | Without it, orphan raw_events accumulate and nobody knows what's unprocessed. | Medium | YES (RF-8) | Worker consuming unreconciled `raw_events` |
| OpenAPI/Swagger spec | Developers require machine-readable API contract before adoption. | Low | YES | `@fastify/swagger` |
| **Refund / reversal postings** | Every PSP refunds. Without ledger-side refund modeling, the books are wrong the first time a refund happens. | Medium | **NO** | See gap analysis below |
| **Dead-letter inspection + replay CLI** | When a webhook fails all retries, ops needs to inspect and force-replay without writing ad-hoc SQL. | Low | Partial (RF-6 has admin endpoint) | `/admin/outbound/:id/replay` exists but a CLI and DLQ inspection view are missing |
| **Transaction search by metadata** | Finance teams ask "show me all transactions for customer X" on day 1. | Medium | **NO** | Not in v0.1 schema |
| **Pending / in-flight balances** | Users need posted + pending balance distinction. Modern Treasury, Fragment, and Formance all expose this. Without it, balance is misleading when there are authorized-but-not-captured card payments or scheduled PIX. | Medium | **NO** | v0.1 only has posted balance |

---

## Differentiators

Features not universally expected but conferring significant competitive advantage for the Brazilian recurring-revenue SaaS persona.

| Feature | Value Proposition | Complexity | Target Phase | Notes |
|---------|-------------------|------------|--------------|-------|
| **PSP-agnostic connector contract** | Any PSP hot-swap with one npm install. Formance is not connector-oriented; Fragment is managed-SaaS; neither is OSS with pluggable connectors. | Medium | v0.1 | Core thesis. Already in design. |
| **PIX-native event model** | PIX is Brazil's dominant push-payment rail. Correct modeling of `invoice.paid`, `invoice.overdue`, `deposit.created`, `brcode-payment.*` with devolution semantics is absent from all Western ledgers. | Medium | v0.1 | Starkbank connector scope |
| **Boleto lifecycle semantics** | Boleto is idiosyncratic (partial payment, post-due tolerance, `boleto-holmes` fraud check, expiration). No OSS ledger models this correctly. | Medium | v0.1 | Starkbank connector; see BR specifics section |
| **Split payment contábil (v0.5)** | Revenue split modeled as multi-posting at T=0, liquidation async. No extra PSP fee. Formance can model splits in Numscript but requires custom scripting; Aprumo does it declaratively with a BR-aware connector. | High | v0.5 | RF-10 |
| **Smart routing / dunning (v0.5)** | Retry logic reducing involuntary churn. Formance has no dunning. Fragment is acquired by Stripe and not OSS. | High | v0.5 | RF-11, RF-12 |
| **Exact-once semantics documented and tested** | Many ledgers claim idempotency; few prove it with serializable isolation + deferred constraint + pg-boss same-tx enqueue. OSS audit trail = trust. | Medium | v0.1 | Invariant tested in CI |
| **Account metadata / tags on postings** | Allows slicing the ledger by `customer_id`, `product_line`, `region` without schema changes. Formance has metadata on accounts; Modern Treasury has metadata on ledger accounts and transactions. | Low | v0.1+ | Should be in `transactions.metadata jsonb` even if not queryable in v0.1 |
| **Connector contract tests as OSS** | Community can build new connectors with confidence. No comparable OSS offers this. | Medium | v0.1 | `@aprumo/connector-base/contract` |
| **Balance reconciliation diff report** | Daily full-recalculation diff. If incremental worker drifts, the diff catches it. Nobody else surfaces this as a first-class feature. | Low | v0.1 | RF-7 already plans daily job; expose as structured report |

---

## Brazilian-Specific Features

### PIX Semantics

PIX is a Central Bank of Brazil (BACEN) instant payment rail. Key modeling requirements:

**Instant vs. Scheduled PIX:**
- Instant (`pix-out`): irrevocable within milliseconds. No cancel after completion. Webhook event arrives in seconds.
- Scheduled PIX (`agendado`): can be canceled up to the scheduled date. Creates a "pending" posting until execution date.
- Implication for Aprumo: connector must model `pix.scheduled.created`, `pix.scheduled.canceled`, `pix.executed` as distinct events. A simple `charge.paid` is insufficient.

**Devolution (Refund) Window:**
- Regular devolução: 90-day window from original transaction, enforced by BACEN. After 90 days, PSP cannot process the devolução via standard API.
- MED (Mecanismo Especial de Devolução): fraud-triggered, different flow, 7-day blocking period. Not standard refund.
- Partial devoluções are allowed (multiple partials up to original amount).
- Implication for Aprumo: `refund.initiated`, `refund.completed`, `refund.partial.completed` are required events. Refund idempotency key must link back to original transaction.

**PIX Keys and DICT:**
- Payments reference chave PIX (CPF, CNPJ, email, phone, EVP). The chave resolves to account; Aprumo does not need to store it (PCI/LGPD), but the `NormalizedEvent` should carry a hashed/tokenized reference for correlation.

### Boleto Idiosyncrasies

Boleto is a bank slip with complex lifecycle; naively modeling it as "paid or expired" loses critical events:

| Event | Ledger Implication |
|-------|-------------------|
| `boleto.created` | No posting yet. Boleto is a receivable intent, not a transaction. |
| `boleto.paid` (on time) | Post full amount to revenue. |
| `boleto.overdue` + `boleto.paid` (late) | Post amount + fine/interest (acrescimos). These are separate postings. |
| `boleto.paid` (partial) | Adyen explicitly notes shoppers can pay more or less. Post actual amount paid, create residual receivable. |
| `boleto.expired` | No posting. Boleto must be re-emitted. |
| `boleto-holmes` (fraud check) | Background investigation. No posting until resolved. |

**Post-due tolerance:** Brazilian boletos typically have a 3-day grace period after vencimento where banks still accept payment. Starkbank and Asaas both fire a webhook when late payment is confirmed. Ledger must model this as `paid.overdue` not just `paid`.

**Partial payment:** Adyen boleto explicitly states "shopper can pay more or less than the original amount." This requires a `boleto.partial_paid` event type and a residual-receivable posting model.

### Card Tokenization Patterns (BR)

**CIT vs. MIT:**
- CIT (Cardholder-Initiated Transaction): first charge in a subscription. Strong authentication required. Adyen/Pagar.me require 3DS2.
- MIT (Merchant-Initiated Transaction): subsequent recurring charges. No cardholder present. Token from CIT is used. Acquirer requires MIT flag.
- Implication: `createPayment` in the connector must distinguish `initiationType: 'CIT' | 'MIT'`. Contract tests must cover both.

**Mandate / token storage:**
- Aprumo never stores PAN (SAQ-A). The token is the PSP's own token (Starkbank tokenized card).
- Connector must support `createToken` as a separate operation (returns `token_ref` stored by the customer application) and `createPaymentFromToken(token_ref, ...)`.
- Currently missing from the 4-method `LedgerConnector` interface.

**Dispute / Chargeback (BR card networks):**
- BR networks (Elo, Hipercard, Mastercard, Visa) follow slightly different chargeback timelines than US networks.
- Full chargeback cycle: `dispute.opened` → `dispute.awaiting_evidence` → `dispute.evidence_submitted` → `dispute.won | dispute.lost` → `dispute.funds_reinstated | dispute.funds_debited`.
- v0.1 only emits `dispute.opened`. Missing: `dispute.won`, `dispute.lost`, `dispute.funds_reinstated`.

---

## Connector Contract Surface Analysis

The current 4-method interface is insufficient for production use:

```typescript
// Current (v0.1)
interface LedgerConnector {
  createPayment(input: CreatePaymentInput): Promise<PaymentRef>
  getBalance(account: AccountRef): Promise<Money>
  withdraw(input: WithdrawInput): Promise<WithdrawalRef>
  parseWebhook(raw: RawWebhook): NormalizedEvent
}
```

### Missing Methods (Required Before First Design Partner)

| Missing Method | Priority | Why Critical |
|----------------|----------|-------------|
| `refundPayment(ref: PaymentRef, amount?: Money): Promise<RefundRef>` | HIGH | Every PSP has refunds. Without this, customer cannot handle customer complaints. Refund is day-2 operation required in week 1. |
| `getPayment(ref: PaymentRef): Promise<PaymentStatus>` | HIGH | Webhook may be lost. Polling fallback is required for reconciliation. Also needed for MED PIX flows. |
| `cancelPayment(ref: PaymentRef): Promise<void>` | MEDIUM | Scheduled PIX and pre-captured cards need explicit cancel. |
| `createToken(cardDetails: CardTokenInput): Promise<TokenRef>` | MEDIUM | Required for CIT→MIT card recurring flows. Without it, recurring card charging is impossible. |
| `listEvents(since: Date): Promise<NormalizedEvent[]>` | MEDIUM | Backfill / gap-fill when webhooks are missed during downtime. |

### Methods That Can Remain in v0.5

| Deferred Method | Reason |
|-----------------|--------|
| `createMandate(...)` | Direct debit mandates. Only needed for debit card recurring, not PIX/boleto. |
| `partialCapture(ref: PaymentRef, amount: Money)` | Auth-capture flow. Not needed for PIX/boleto-first MVP. |
| `getSettlementReport(period: DateRange)` | Batch reconciliation. Worker-based approach covers v0.1. |

---

## Webhook Event Vocabulary

### v0.1 Current (4 events — insufficient)

```
charge.paid
charge.failed
dispute.opened
transfer.confirmed
```

### Recommended v0.1 Event Set (14 events)

The 4 current events miss critical lifecycle states. Based on Stripe taxonomy, Adyen eventCode taxonomy, and Asaas Brazilian payment events:

**Payment / Charge:**
```
charge.paid              # Payment fully settled (boleto, PIX, card)
charge.failed            # Payment failed (retryable or terminal — include reason_code)
charge.pending           # Authorization obtained, awaiting capture (card only)
charge.captured          # Previously authorized payment captured
charge.expired           # Authorization expired without capture
charge.refunded          # Full refund processed
charge.partially_refunded  # Partial refund — amount and remainder in payload
```

**Dispute:**
```
dispute.opened           # Cardholder initiated chargeback
dispute.evidence_submitted  # Merchant submitted defense
dispute.won              # Merchant won — funds reinstated
dispute.lost             # Merchant lost — funds debited
```

**Transfer / Payout:**
```
transfer.confirmed       # PSP transfer settled (already in v0.1)
transfer.failed          # Transfer rejected by receiving bank
```

**Boleto-specific:**
```
boleto.paid_overdue      # Boleto paid after vencimento (fine/interest apply)
boleto.expired           # Boleto expired without payment
```

**PIX-specific:**
```
pix.refund.completed     # Devolução settled (90-day window)
pix.refund.failed        # Devolução rejected (e.g., account closed)
```

### v0.5 Additional Events

```
subscription.past_due    # Dunning triggered (RF-12)
subscription.canceled    # After max dunning failures
split.disbursed          # Split liquidation completed (RF-10)
```

---

## Observability / Admin Features

### Table Stakes for Operators

| Feature | Why Expected | In v0.1? | Complexity | Notes |
|---------|--------------|----------|------------|-------|
| Dead-letter inspection endpoint | First webhook failure will happen within 48h of production. Without inspection, root cause is guesswork. | YES (partial) | Low | `/admin/outbound/:id/replay` exists. Need GET for DLQ listing. |
| Balance audit log (daily diff) | Required to detect incremental worker drift before it becomes a material misstatement. | YES (RF-7) | Low | Job exists; expose as structured report endpoint. |
| Prometheus metrics: webhook delivery, reconciliation lag | SRE needs alerting on lag and failure rate. | YES (RNF-6.3) | Low | Already planned. |
| `GET /admin/raw-events?status=unreconciled` | Operators must be able to see events that failed reconciliation and why. | **NO** | Low | Add in v0.1. |
| Force reconcile specific event | When a rule was wrong and fixed, ops must re-run reconciliation for specific event(s). | YES (RF-8) | Low | Endpoint planned. |
| Worker health metrics (last_processed_at) | Detect stalled workers before balance lag accumulates. | YES (RF-7) | Low | Already planned. |

### Differentiating (v0.5+)

| Feature | Value | Complexity |
|---------|-------|------------|
| Event replay from raw_events | Re-apply all postings from scratch (disaster recovery, rule change). | High |
| Reconciliation report (CSV/JSON export) | Finance team Month-End close artifact. | Medium |
| Balance export (point-in-time) | Historical balance at any date for accounting audit. | Medium |
| Mass posting tool (CLI) | Migrate from another system by bulk-importing historical transactions. | High |
| Admin UI (enterprise edition) | Dashboard for DLQ, reconciliation status, event log. OSS gets CLI. Enterprise gets UI. | High |

---

## Anti-Features

Features Aprumo must explicitly NOT build to maintain ledger focus and avoid scope creep.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **Subscription management** | Subscriptions involve plan definitions, upgrade/downgrade logic, proration, trial periods. This is a billing engine, not a ledger. Lago, Stripe Billing, and Chargebee own this space. | Emit `charge.paid` / `charge.failed` events; let the billing engine call back. |
| **Invoice generation** | Generating PDFs, managing invoice sequences, NF-e/NFS-e (Brazilian fiscal notes) are entirely separate concerns. SEFAZ integration is a compliance minefield. | Emit events; integrate with fiscal software (Omie, ContaAzul) at the customer's layer. |
| **Tax calculation** | Brazilian tax (ISS, PIS, COFINS, ICMS) calculation is PSP- and product-type-specific. Wrong tax = legal liability. This is a solved problem (Sovos, Avalara, Plugnotas). | Carry `tax_amount_cents` in metadata if PSP provides it; do not calculate. |
| **UI / dashboard** | OSS ledger has no UI. This is the enterprise edition moat (ADR-008). Building OSS UI fragments the maintainer's focus and hands the fork argument to any competitor. | Enterprise edition. CLI for OSS ops. |
| **FX / multi-currency** | Multi-currency requires exchange rate sourcing, revaluation, translation entries (GAAP/IFRS compliant). This is a major complexity multiplier. The target persona (Brazilian SaaS) transacts in BRL exclusively. | Design schema to support `currency` field on `postings` from day 1 (YAGNI but low-cost future-proofing), but do not implement FX logic. |
| **Custody / float management** | Holding client money = Instituição de Pagamento (BACEN license, capital requirements). Non-negotiable no. | Aprumo is read-only on money; PSP custodies it. |
| **PAN storage / card vault** | PCI scope explosion, SAQ-A becomes SAQ-D. Legal liability. | Use PSP token exclusively. |
| **Billing retry / dunning UI** | Dunning logic is `pg-boss` schedules (RF-12, v0.5). A UI for configuring retry policies is enterprise. | Expose config via API; UI is enterprise. |
| **Accounting reports (P&L, Balance Sheet)** | General-purpose accounting reports require chart-of-accounts mapping to GAAP/IFRS standards. That's an ERP, not a ledger. | Export posting data; let ERP (ContaAzul, QuickBooks, SAP) consume it. |
| **Multi-tenancy managed service** | SaaS hosting of Aprumo for multiple customers = managed service. This is the enterprise offering. OSS is self-hosted. | Enterprise edition with tenant isolation and SLAs. |

---

## Feature Dependencies

```
RF-1 (post_transaction) ─────────────────────────────┐
  └─→ RF-7 (balance worker)                           │
  └─→ RF-8 (reconciliation worker)                    │
       └─→ RF-5 (webhook ingestion)                   │
            └─→ RF-4 (Starkbank connector)             │
  └─→ RF-6 (outbound webhooks) ──→ DLQ admin endpoint │
RF-3 (create account) ──────────────────────────────→ RF-2 (query account + postings)
```

**Connector method expansion (pre-GA):**
```
parseWebhook ─→ refundPayment (must exist before first chargeback)
parseWebhook ─→ getPayment (must exist before first missed webhook)
createPayment ─→ createToken (must exist before first MIT card charge)
```

**Webhook event vocabulary expansion:**
```
charge.paid (v0.1) ─→ charge.refunded (needed with refundPayment)
dispute.opened (v0.1) ─→ dispute.won/lost (needed for chargeback resolution)
```

---

## MVP Recommendation

### Ship in v0.1 (Current Plan — Confirmed)

All RF-1 through RF-8 as specified. The gap analysis identifies items to add within v0.1 scope:

1. `refundPayment` method on `LedgerConnector` interface (connector-base contract must include it; Starkbank connector must implement it).
2. `getPayment(ref)` on `LedgerConnector` (needed for reconciliation gap-fill; without it, the reconciliation worker has no fallback when a webhook is missed).
3. Extend outbound event vocabulary from 4 to 14 events (the cost is low — just additional `NormalizedEvent` mappings).
4. Add `metadata jsonb` to `transactions` table (low migration cost now; expensive to retrofit later when customers have data).
5. Add `GET /admin/raw-events?status=unreconciled` endpoint.

### Defer to v0.5

- `createToken`, `cancelPayment`, `listEvents` on connector interface.
- `pending_balance` / `available_balance` distinction (requires schema change — design now, implement v0.5).
- Account metadata query API (filtering transactions by metadata).
- Boleto partial payment handling.
- Full dispute lifecycle events (`dispute.won`, `dispute.lost`, `dispute.funds_reinstated`).

### Never Build (Anti-features listed above)

Subscription management, invoice generation, tax calculation, PAN storage, FX, P&L reports, managed multi-tenancy in OSS.

---

## Confidence Assessment

| Area | Confidence | Source | Notes |
|------|------------|--------|-------|
| Table stakes (core ledger) | HIGH | Modern Treasury journal, Formance docs, Fragment docs, Blnk GitHub | Strong convergence across 4 independent reference products |
| Stripe/Adyen webhook taxonomy | HIGH | Official Stripe API docs, Adyen docs fetched directly | Primary sources |
| BR-specific PIX semantics | HIGH | BACEN MED guide, Pismo PIX docs, Asaas event list | BACEN regulation is authoritative |
| Boleto idiosyncrasies | MEDIUM | Adyen boleto docs, Asaas event list, Braintree boleto guide | Consistent across PSPs; partial payment claim verified via Adyen |
| Connector interface gaps | MEDIUM | Hyperswitch add_connector.md, payment orchestration patterns | Based on industry patterns; Starkbank Node SDK content not fully accessible |
| Anti-features boundary | HIGH | Formance scope statements, PRD.md non-objectives, industry separation-of-concerns | Well-documented product positioning |
| Multi-currency deferral | HIGH | PRD explicitly excludes FX; BR persona is BRL-only | Clear product decision |

---

## Sources

- [Stripe Webhook Event Types](https://docs.stripe.com/api/events/types) — complete taxonomy
- [Adyen Webhook Types](https://docs.adyen.com/development-resources/webhooks/webhook-types) — eventCode taxonomy
- [Asaas Payment Events](https://docs.asaas.com/docs/payment-events) — BR-specific boleto/PIX/card events
- [Pismo PIX Instant Payments](https://developers.pismo.io/pismo-docs/docs/pix-instant-payments) — PIX event types and reversal semantics
- [Modern Treasury How to Scale a Ledger](https://www.moderntreasury.com/journal/how-to-scale-a-ledger-part-ii) — balance types, table-stakes features
- [Formance Ledger GitHub](https://github.com/formancehq/ledger) — OSS ledger scope and positioning
- [Fragment Sync Payments](https://fragment.dev/docs/sync-payments) — connector/link API surface
- [Hyperswitch add_connector.md](https://github.com/juspay/hyperswitch/blob/main/add_connector.md) — required connector methods (authorize, capture, refund, sync)
- [Blnk Finance GitHub](https://github.com/blnkfinance/blnk) — OSS ledger feature set comparison
- [BACEN MED PIX Guide](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Guia_MED.pdf) — PIX devolution regulation
- [Starkbank Webhook Types](https://starkbank.com/docs/api) — subscription types: transfer, invoice, deposit, brcode-payment, boleto, boleto-holmes, boleto-payment, utility-payment
- [Adyen Boleto Bancário](https://docs.adyen.com/payment-methods/boleto-bancario) — boleto partial payment confirmation
