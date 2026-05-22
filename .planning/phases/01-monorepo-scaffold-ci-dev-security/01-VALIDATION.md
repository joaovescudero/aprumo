---
phase: 1
slug: monorepo-scaffold-ci-dev-security
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-22
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (latest 3.x), v8 coverage provider |
| **Config file** | `vitest.config.ts` (root, with `projects:` array per RESEARCH.md §Vitest Workspace) |
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

> Filled in by planner. Each plan task gets one row. Wave 0 stubs precede first executable wave.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-00-01 | 00 | 0 | INF-01..10 | — | Stubs exist for every INF requirement | scaffold | `pnpm test -- --run tests/scaffold/` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Root `vitest.config.ts` with `projects:` array + glob coverage thresholds (specific-before-wildcard order per RESEARCH.md landmine)
- [ ] `packages/core/src/__tests__/scaffold.test.ts` — failing tests that assert package.json fields, exports, tsconfig presence (RED for INF-01..05)
- [ ] `tests/ci/secret-scan.test.ts` — failing test that runs gitleaks on a fixture committing `-----BEGIN EC PRIVATE KEY-----` and expects non-zero exit (RED for INF-06, INF-07)
- [ ] `tests/ci/gitignore.test.ts` — failing test that `touch`es `.env`, `*.key`, `secrets/foo`, runs `git status --porcelain --ignored` and expects them ignored (RED for INF-08)
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
- [ ] `nyquist_compliant: true` set in frontmatter after planner finalizes per-task map

**Approval:** pending
