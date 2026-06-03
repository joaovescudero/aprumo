---
phase: 02
slug: schema-foundation-db-tooling
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-29
---

# Phase 02 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.
> Built retroactively from the `<threat_model>` blocks present in all 14 PLAN.md files
> (`register_authored_at_plan_time: true`) and the `## Threat Flags` sections of the SUMMARYs.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| aprumo_app → postings/raw_events | App role must never UPDATE/DELETE/direct-INSERT append-only tables | Ledger postings, raw webhook events |
| post_transaction (SECURITY DEFINER) → postings | Only the function may INSERT postings; sum(amount_cents)=0 enforced | Balanced double-entry sets |
| mutable table → *_audit shadow | AFTER UPDATE/DELETE captures change before mutation | accounts, outbound_endpoints, outbound_events |
| committed migration → deployed DB | Any edit to a committed migration caught before deploy | DDL / migration SQL |
| schema.ts → generated DDL | drizzle-kit output must be reviewed; bigint precision exact | amount_cents (BIGINT) |
| developer → npm registry | Package installs gated by human checkpoint | Dependencies |
| test schema → production schema | Schema-per-file isolation prevents test pollution | Ephemeral test data |
| .env.example / migration SQL → git | No real secrets or hardcoded passwords committed | Credentials |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-2-01 | Tampering / Priv. Escalation | aprumo_app UPDATE/DELETE/INSERT on postings & raw_events | mitigate | Three-layer immutability: `REVOKE UPDATE, DELETE` in `0002_grants.sql` (2 matches); `post_transaction` SECURITY DEFINER owns INSERT (`0003`); deferred constraint trigger at COMMIT (`0005`). Integration tests assert `42501` on direct write. | closed |
| T-2-02 | Tampering | Schema drift between environments | mitigate | `migration-hashes.json` committed + `migration-drift.test.ts` / CI drift gate exits 1 on any edit or missing `_journal.json` hash. | closed |
| T-2-03 | Tampering | Unbalanced postings & amount_cents precision | mitigate | `bigint({ mode: 'bigint' })` on all 5 money columns (no float; no bare `bigint()`); `post_transaction` validates sum=0 (P0001, positivity check before arithmetic to dodge BIGINT_MIN overflow); deferred trigger re-validates at COMMIT. | closed |
| T-2-04 | Info Disclosure / Spoofing | Credentials in migrations; search_path injection | mitigate | No passwords in `0001_roles.sql` (grep=0); passwords via env only; gitleaks (Phase 1) blocks slips; `SET search_path = public` in all SECURITY DEFINER functions. | closed |
| T-2-05 | Tampering | Test data leakage / schema collision | mitigate | Schema-per-file via SHA1(testPath); per-schema `_drizzle_migrations`; `afterAll` runs `DROP SCHEMA CASCADE`; forks pool isolates state. | closed |
| T-2-06 | Injection | `EXECUTE format()` SQLi via `TG_TABLE_NAME` | mitigate | `%I` identifier quoting in `0004_audit_triggers.sql` (3 matches); `audit_row_change()` is SECURITY DEFINER. | closed |
| T-2-SC | Tampering | Supply chain — npm/pip/cargo installs | transfer | Blocking human checkpoint in Plan 01 before any install; packages reviewed against RESEARCH.md. No new packages in later plans. | closed |
| T-02-12-01/02 | Tampering | Test SQL rewrite & schema param | mitigate | `rewritePublicQualifier` runs in test paths only (never `migrate.ts`); schema name is SHA1-derived, bounded to `test_[a-f0-9]{12}`; postgres-js identifier escaping. | closed |
| T-02-13-01 | Tampering | PG_IMAGE digest value | accept | SHA-256 digest pinning — tampered image fails Docker pull verification. This is the security property digest pinning provides. | closed |
| T-02-14-01 | Tampering | globalSetup admin connection | accept | Loopback testcontainers instance only; no external network; ephemeral container destroyed after run. | closed |
| T-02-14-02 | Denial of Service | postgres-js admin conn leak | mitigate | `finally { await adminSql.end() }` closes connection even on DO-block throw. | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-02-01 | T-02-13-01 | Digest pinning is self-enforcing: a tampered image changes the SHA-256 digest and fails the Docker pull. No additional control needed. | gsd-secure-phase | 2026-05-29 |
| AR-02-02 | T-02-14-01 | Admin connection is loopback-only to an ephemeral testcontainer; not reachable externally and destroyed after the test run. | gsd-secure-phase | 2026-05-29 |
| AR-02-03 | T-2-SC | Supply-chain risk transferred to a human approval checkpoint (Plan 01); no new packages introduced in Plans 02–14. | gsd-secure-phase | 2026-05-29 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-29 | 11 | 11 | 0 | gsd-secure-phase (orchestrator, short-circuit: register_authored_at_plan_time=true, threats_open=0) |
| 2026-06-02 | 11 | 11 | 0 | gsd-security-auditor (mitigations verified in implementation — file:line evidence per threat; no short-circuit). Doc fix: money columns 9→5. |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-29
