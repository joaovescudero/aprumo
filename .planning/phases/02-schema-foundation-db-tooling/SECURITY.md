---
phase: 02
slug: schema-foundation-db-tooling
status: verified
threats_open: 0
asvs_level: 1
audited: 2026-06-02
auditor: gsd-security-auditor (adversarial verification pass)
---

# Phase 02 — Security Audit (Verification Pass)

> This file records the results of the adversarial verification pass performed by
> gsd-security-auditor. Every declared mitigation in the threat register was confirmed
> by grep match or direct file inspection. Accepted risks were confirmed by Accepted
> Risks Log entries in 02-SECURITY.md.

---

## Audit Summary

| Total Threats | Closed | Open (BLOCKER) | Unregistered Flags |
|---------------|--------|----------------|--------------------|
| 11 | 11 | 0 | 0 |

---

## Threat Verification Table

| Threat ID | Category | Disposition | Status | Evidence (file:line) |
|-----------|----------|-------------|--------|----------------------|
| T-2-01 | Tampering / PrivEsc | mitigate | CLOSED | `0002_grants.sql:11-12` — REVOKE UPDATE, DELETE on postings + raw_events; `0007_revoke_insert_append_only.sql:18-19` — REVOKE INSERT on both tables; `0003_post_transaction.sql:35` — SECURITY DEFINER; `0005_double_entry_trigger.sql:53-57` — CONSTRAINT TRIGGER DEFERRABLE; `revoke.integration.test.ts:25-48` — 42501 asserted on UPDATE/DELETE; `post-transaction.integration.test.ts:251-276` — 42501 asserted on direct INSERT |
| T-2-02 | Tampering | mitigate | CLOSED | `migration-hashes.json:1-14` — SHA-256 hashes for all 12 migration files; `migration-drift.test.ts:59-67` — exits non-zero on tamper; `migration-drift.test.ts:82-88` — exits non-zero on missing file; `check-migration-drift.mjs:86-98` — hash comparison + reverse check logic |
| T-2-03 | Tampering | mitigate | CLOSED | `schema.ts:91` — `bigint("amount_cents", { mode: "bigint" })`; all 5 bigint columns use `mode: "bigint"` (no bare bigint); `0010_fix_validation_order.sql:59-64` — amount_cents positivity validated BEFORE arithmetic; `0010_fix_validation_order.sql:80-85` — signed sum = 0 check with P0001; `0005_double_entry_trigger.sql:36-44` — deferred COMMIT-time balance check |
| T-2-04 | Info Disclosure / Spoofing | mitigate | CLOSED | `0001_roles.sql:1-17` — no PASSWORD clause in CREATE ROLE; `0002_grants.sql` — zero password occurrences (grep confirmed); `0003_post_transaction.sql:36` + `0004_audit_triggers.sql:26` + `0008_post_transaction_idempotency_race.sql:29` + `0010_fix_validation_order.sql:28` — SET search_path = public in all 4 SECURITY DEFINER functions |
| T-2-05 | Tampering | mitigate | CLOSED | `createTestDb.ts:35` — `test_${sha1(testPath).slice(0,12)}`; `createTestDb.ts:134` — `DROP SCHEMA IF EXISTS ${schema} CASCADE`; `applyMigrationsToSchema.ts:322-325` — per-schema `__drizzle_migrations` tracking table; separate `app` and `migration` Pool instances per test file |
| T-2-06 | Injection | mitigate | CLOSED | `0004_audit_triggers.sql:34` — `EXECUTE format('INSERT INTO %I ...', TG_TABLE_NAME || '_audit')` — %I identifier quoting (3 matches in file); `0004_audit_triggers.sql:25` — SECURITY DEFINER; `applyMigrationsToSchema.ts` — rewritePublicQualifier/rewriteForTestSchema absent from production `migrate.ts` (grep returned 0 matches in src/) |
| T-2-SC | Tampering | transfer | CLOSED | `02-SECURITY.md:60` — AR-02-03: transfer documented; human checkpoint declared in Plan 01; no new packages introduced post-Plan 01 (confirmed: phase adds no new npm packages beyond existing deps) |
| T-02-12-01/02 | Tampering | mitigate | CLOSED | `applyMigrationsToSchema.ts:179-181` — rewritePublicQualifier scoped to test helper only; `migrate.ts:1-169` — no rewrite functions present; `createTestDb.ts:35` — schema bounded to `test_[a-f0-9]{12}` (SHA1 12-hex); postgres-js tagged template for schema name (`schemaSql(schema)`) at `createTestDb.ts:56` |
| T-02-13-01 | Tampering | accept | CLOSED | `02-SECURITY.md:58` — AR-02-01 entry present; `container.ts:7` — `postgres:16-alpine@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229` digest pin confirmed |
| T-02-14-01 | Tampering | accept | CLOSED | `02-SECURITY.md:59` — AR-02-02 entry present; loopback-only testcontainers instance confirmed |
| T-02-14-02 | Denial of Service | mitigate | CLOSED | `globalSetup.ts:72-73` — `} finally { await adminSql.end(); }` closes connection on any exit path |

---

## Accepted Risks Log (confirmed present in 02-SECURITY.md)

| Risk ID | Threat Ref | Confirmed In |
|---------|------------|--------------|
| AR-02-01 | T-02-13-01 | `02-SECURITY.md:58` |
| AR-02-02 | T-02-14-01 | `02-SECURITY.md:59` |
| AR-02-03 | T-2-SC | `02-SECURITY.md:60` |

---

## Unregistered Flags

None detected. All threat flags from 02-SECURITY.md `## Threat Flags` map to existing threat IDs.

---

## Notable Findings (non-blocking observations)

1. **T-2-03 "9 money columns" count discrepancy**: The SECURITY.md register claims "all 9 money columns"; `schema.ts` contains 5 bigint columns: `amount_cents`, `balance`, `pending_balance`, `available_balance`, `attempts`. All 5 correctly use `mode: "bigint"`. No bare `bigint()` calls found. The count "9" appears to be an overestimate in the documentation; the actual control is complete. **Not a gap** — all defined columns are correctly typed.

2. **0004_audit_triggers.sql outbound_events trigger dropped by 0011**: The SECURITY.md register (T-2-01, Invariant #6) notes mutable tables need audit triggers. `0011_drop_outbound_events_audit_trigger.sql` removes the `outbound_events` trigger. The migration comment at lines 1-24 documents this as intentional (high-frequency operational noise, not a config table). This is within scope of CLAUDE.md Invariant #6 which applies to config tables. **Not a gap.**

3. **post_transaction superseded 3 times** (0003 → 0008 → 0010): The active version is in `0010_fix_validation_order.sql`. All three replacements preserve `SECURITY DEFINER` and `SET search_path = public`. The final version at `0010_fix_validation_order.sql:27-28` is the one applied at runtime. **Mitigation intact.**

---

## Sign-Off

- [x] All 11 threats verified by direct code inspection
- [x] 3 accepted risks confirmed in Accepted Risks Log
- [x] 1 transferred risk confirmed documented
- [x] `threats_open: 0` confirmed
- [x] Implementation files not modified

**Audit result: SECURED**
**Audited:** 2026-06-02
