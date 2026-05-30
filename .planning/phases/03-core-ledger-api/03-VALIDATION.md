---
phase: 3
slug: core-ledger-api
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-29
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + coverage v8 (testcontainers PG for ledger path) |
| **Config file** | `packages/core/vitest.config.ts` (existing) |
| **Quick run command** | `pnpm --filter @aprumo/core test` |
| **Full suite command** | `pnpm --filter @aprumo/core test --coverage` |
| **Estimated runtime** | ~60 seconds (testcontainers PG startup amortized via globalSetup) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @aprumo/core test`
- **After every plan wave:** Run `pnpm --filter @aprumo/core test --coverage`
- **Before `/gsd:verify-work`:** Full suite green + 90% LoC coverage gate on `@aprumo/core`
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> Filled by planner. Every API requirement maps to an automated testcontainers test. The five
> critical ledger behaviors below are Nyquist-critical — each MUST have an explicit failing test
> written BEFORE the implementation (TDD non-negotiable per CLAUDE.md).

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | API-02 | — | BigInt amount_cents/IDs render as JSON string, never raw bigint | integration | `pnpm --filter @aprumo/core test` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | API-03/04 | — | Balanced postings → 201 persisted; unbalanced → 422 (constraint trigger mapped) | integration | `pnpm --filter @aprumo/core test` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | API-05 | — | Concurrent duplicate Idempotency-Key (Promise.all) → both 200, identical body, no reprocess | integration | `pnpm --filter @aprumo/core test` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | API-10/11 | — | 40001 wraps full db.transaction(), retries ≤3x backoff; exhausted → 503 | integration | `pnpm --filter @aprumo/core test` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | API-08/09 | — | Account balance from materialized account_balance; cursor pagination by ordering col desc | integration | `pnpm --filter @aprumo/core test` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Integration test scaffolds (RED) for the five Nyquist-critical behaviors above — reuse Phase 2 testcontainers `createTestDb` schema-per-file helper
- [ ] No new framework install needed — vitest + testcontainers already configured in Phase 2
- [ ] BigInt-string assertion helper (response `amount_cents` is `typeof === 'string'`)

*Phase 2 testcontainers infrastructure covers the ledger PG path. No mocks on the ledger PG path (CLAUDE.md).*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `GET /docs` OpenAPI UI renders | API-13 | Visual swagger UI render not asserted in unit test | Start server, open `/docs`, confirm `amount_cents` shows `type: string` |

*All ledger-critical behaviors have automated verification. Only the swagger UI visual render is manual.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
