---
phase: 1
slug: monorepo-scaffold-ci-dev-security
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.7, v8 coverage provider |
| **Config file** | `vitest.config.ts` (root, with `projects:` array per D-20 AMENDED) |
| **Quick run command** | `pnpm test -- --run --reporter=dot` |
| **Full suite command** | `pnpm test -- --run --coverage` |
| **Estimated runtime** | ~30 seconds (quick) / ~90 seconds (full + coverage) for scaffold-only |
| **Auxiliary check** | `pnpm lint && pnpm typecheck` (Biome + tsc --noEmit) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- --run --reporter=dot` (only changed-package scope via Turbo/`vitest related` if available; else full)
- **After every plan wave:** Run `pnpm test -- --run --coverage` + `pnpm lint` + `pnpm typecheck`
- **Before `/gsd:verify-work`:** Full suite green + coverage thresholds met (90% in `@aprumo/core`, 80% other) + CI dry-run via `act` or pushed branch
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> Filled in by planner. Each plan task gets one row.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-00-01 | 00 | 0 | INF-01..05 | T-1-01, T-1-02 | Infra assertions fail RED until Wave 1 creates scaffold | scaffold | `pnpm test -- --run tests/scaffold/infra.test.ts` | ❌ W0 | ⬜ pending |
| 1-00-01b | 00 | 0 | INF-04 | T-1-02 | Coverage gate exits non-zero when core coverage is below 90% | scaffold | `pnpm test -- --run tests/scaffold/coverage-gate-fires.test.ts` | ❌ W0 | ⬜ pending |
| 1-00-02 | 00 | 0 | INF-06, INF-07, INF-10 | T-1-01, T-1-SC | CI gate stubs fail RED until gitleaks/.gitignore/.changeset exist | scaffold | `pnpm test -- --run tests/ci/` | ❌ W0 | ⬜ pending |
| 1-01-01 | 01 | 1 | INF-01 | T-1-02 | pnpm workspace resolves; engine-strict blocks wrong Node version | integration | `pnpm install && pnpm -r list --depth=0` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | INF-02, INF-03, INF-07 | T-1-01, T-1-02 | tsconfig.base.json strict; biome noExplicitAny; .gitignore blocks .env* | unit | `pnpm typecheck && pnpm lint && grep -c '.env' .gitignore` | ❌ W0 | ⬜ pending |
| 1-02-01 | 02 | 1 | INF-01, INF-04 | T-1-02, T-1-SC | All 4 packages resolve; vitest pool:forks; biome extends "//"; tsconfig extends base | integration | `pnpm -r list --depth=0 && pnpm typecheck` | ❌ W0 | ⬜ pending |
| 1-02-02 | 02 | 1 | INF-01, INF-04 | T-1-02 | Full pipeline (lint, typecheck, build, test) passes on stubs | integration | `pnpm lint && pnpm typecheck && pnpm build && pnpm test` | ❌ W0 | ⬜ pending |
| 1-03-01 | 03 | 2 | INF-05, INF-06 | T-1-01, T-1-03, T-1-SC | gitleaks blocks EC key; lefthook wired; .gitleaks.toml has starkbank-private-key rule | unit | `gitleaks version && cat lefthook.yml \| grep -c gitleaks && cat .gitleaks.toml \| grep -c starkbank-private-key` | ❌ W0 | ⬜ pending |
| 1-03-02 | 03 | 2 | INF-05 | T-1-03 | commitlint rejects non-Conventional Commit; accepts valid format | unit | `echo 'bad message' \| pnpm commitlint; echo 'feat(scope): ok' \| pnpm commitlint` | ❌ W0 | ⬜ pending |
| 1-04-01 | 04 | 2 | INF-08, INF-10 | T-1-01, T-1-03, T-1-SC | setup action has no corepack enable; ci.yml has 7 jobs; gitleaks-history uses .gitleaks.toml | ci | `grep -c 'gitleaks-history' .github/workflows/ci.yml && grep -c 'corepack enable' .github/actions/setup/action.yml \|\| echo 0` | ❌ W0 | ⬜ pending |
| 1-04-02 | 04 | 2 | INF-08, INF-09 | T-1-04 | release.yml has id-token:write (D-23a); D-23b deferred comment present | ci | `grep -c 'id-token: write' .github/workflows/release.yml` | ❌ W0 | ⬜ pending |
| 1-05-01 | 05 | 3 | INF-09, INF-10 | T-1-04 | .changeset/config.json has correct fields; changeset:check npm script wired | unit | `node -e "const c=require('./.changeset/config.json'); console.log(c.access, c.updateInternalDependencies, c.baseBranch)"` | ❌ W0 | ⬜ pending |
| 1-06-01 | 06 | 3 | INF-01..10 | T-1-01, T-1-03 | OSS governance docs exist; all automated Wave 0 tests GREEN | integration | `ls README.md SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md && pnpm test -- --run` | ❌ W0 | ⬜ pending |
| 1-06-02 | 06 | 3 | INF-01..10 | T-1-03, T-1-04 | Branch protection + PVR enabled (human); CI green on GitHub | e2e | Human checkpoint — see Plan 06 Task 2 instructions | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Root `vitest.config.ts` with `projects:` array + glob coverage thresholds (specific-before-wildcard order per RESEARCH.md Pitfall 1 + D-20 AMENDED)
- [ ] `tests/scaffold/infra.test.ts` — failing tests that assert package.json fields, exports, tsconfig presence (RED for INF-01..05)
- [ ] `tests/scaffold/coverage-gate-fires.test.ts` — failing test that creates a 0%-covered fixture in packages/core/src/__fixtures__/, spawns vitest --coverage, asserts non-zero exit (RED for INF-04)
- [ ] `tests/ci/secret-scan.test.ts` — failing test that runs gitleaks on a fixture committing `-----BEGIN EC PRIVATE KEY-----` and expects non-zero exit (RED for INF-06, INF-07)
- [ ] `tests/ci/gitignore.test.ts` — failing test that checks .gitignore patterns for .env*, *.key, secrets/, dist/, coverage/ (RED for INF-07)
- [ ] `tests/ci/changeset-gate.test.ts` — failing test that calls the changeset-required check script against a fixture diff without changeset, expects non-zero (RED for INF-10)
- [ ] `pnpm-workspace.yaml`, root `package.json`, root `tsconfig.json` exist (Wave 0 installs)
- [ ] Biome v2 installed and root `biome.json` exists (RED: `pnpm lint` exits 0)

*Goal:* every Wave 0 test fails for the right reason before Wave 1 implementation lands. Per CLAUDE.md, TDD is non-negotiable.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fresh clone → `pnpm install` succeeds on Node 22 AND Node 24 | INF-01, INF-02 | Requires actual fresh git clone in clean directory (cannot be self-tested inside the repo) | `cd /tmp && git clone <url> apruma-fresh && cd apruma-fresh && nvm use 22 && pnpm install && pnpm test && nvm use 24 && pnpm install && pnpm test` — both must exit 0 |
| GitHub Actions matrix runs on push/PR | INF-09 | Requires actual GitHub-side execution; cannot be fully simulated by `act` | Push branch, open PR, confirm Actions UI shows lint+typecheck+test+coverage jobs green on both Node 22 and Node 24 |
| `pnpm changeset` produces a valid changeset file interactively | INF-10 | Interactive CLI prompt | Run `pnpm changeset`, answer prompts, assert file appears in `.changeset/*.md` with valid frontmatter |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`--run` enforced)
- [ ] Feedback latency < 60s for quick command
- [x] `nyquist_compliant: true` set in frontmatter (per-task map fully populated)

**Approval:** pending
