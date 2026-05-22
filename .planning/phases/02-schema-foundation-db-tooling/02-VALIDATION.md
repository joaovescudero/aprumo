---
phase: 2
slug: schema-foundation-db-tooling
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-22
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 2.x + @testcontainers/postgresql + v8 coverage |
| **Config file** | `vitest.config.ts` (root + per-package) |
| **Quick run command** | `pnpm --filter @aprumo/core test --run` |
| **Full suite command** | `pnpm test --coverage` |
| **Estimated runtime** | ~30s (after first container pull; <5s with `APRUMO_TEST_REUSE=1`) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm --filter @aprumo/core test --run`
- **After every plan wave:** Run `pnpm test --coverage`
- **Before `/gsd:verify-work`:** Full suite must be green AND coverage ≥ 90% LoC in `@aprumo/core`
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-XX-XX | TBD  | TBD  | FND-01..FND-18 | TBD | TBD | unit/integration | `pnpm --filter @aprumo/core test --run` | ❌ W0 | ⬜ pending |

*Populated by planner during PLAN.md generation. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/core/tests/globalSetup.ts` — start PG container, expose URI via Vitest `inject('pgUri')`
- [ ] `packages/core/tests/setup/container.ts` — pinned `postgres:18-alpine` digest constant
- [ ] `packages/core/tests/setup/createTestDb.ts` — schema-per-file helper returning `{ app, migration, schema, cleanup }`
- [ ] `packages/core/vitest.config.ts` — register `globalSetup`, `pool: 'forks'` (inherited from Phase 1)
- [ ] `@testcontainers/postgresql`, `postgres`, `drizzle-orm`, `drizzle-kit` installed in `@aprumo/core`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| ADRs 001–009 readable as MADR 4.0 by humans | FND-17, FND-18 | Prose quality is judgment-bound; structure can be automated | Open each `docs/adr/*.md`; confirm frontmatter has `status`, `date`, `decision-makers`; confirm sections Context/Drivers/Options/Outcome/Consequences exist |
| `docs/adr/README.md` index reflects all 9 ADRs | FND-18 | Index curation requires human judgment on titles/summaries | Visual diff against `docs/adr/` listing |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (testcontainers setup, helper, vitest globalSetup wiring)
- [ ] No watch-mode flags (CI runs `--run`)
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter after planner fills task rows

**Approval:** pending
