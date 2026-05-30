---
phase: 1
slug: monorepo-scaffold-ci-dev-security
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-22
updated: 2026-05-29
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
| 1-00-01 | 00 | 0 | INF-01..05 | T-1-01, T-1-02 | Infra assertions green; monorepo scaffold present | scaffold | `pnpm vitest run --project=root-tests tests/scaffold/infra.test.ts` | ✅ | ✅ green |
| 1-00-01b | 00 | 0 | INF-04 | T-1-02 | Coverage gate exits non-zero on under-covered code (isolated temp project — decoupled from core's real coverage) | unit | `pnpm vitest run --project=root-tests tests/scaffold/coverage-gate-fires.test.ts` | ✅ | ✅ green |
| 1-00-02 | 00 | 0 | INF-06, INF-07, INF-10 | T-1-01, T-1-SC | CI gate tests green (gitleaks/.gitignore/.changeset present) | scaffold | `pnpm vitest run --project=root-tests tests/ci/` | ✅ | ✅ green |
| 1-01-01 | 01 | 1 | INF-01 | T-1-02 | pnpm workspace resolves; engine-strict blocks wrong Node version | integration | `pnpm install && pnpm -r list --depth=0` | ✅ | ✅ green |
| 1-01-02 | 01 | 1 | INF-02, INF-03, INF-07 | T-1-01, T-1-02 | tsconfig strict; biome noExplicitAny + per-package `extends "//"`; .gitignore blocks .env* | unit | `pnpm vitest run --project=root-tests tests/scaffold/infra.test.ts` | ✅ | ✅ green |
| 1-02-01 | 02 | 1 | INF-01, INF-04 | T-1-02, T-1-SC | All 4 packages resolve; vitest pool:forks; biome extends "//"; tsconfig extends base | integration | `pnpm -r list --depth=0 && pnpm typecheck` | ✅ | ✅ green |
| 1-02-02 | 02 | 1 | INF-01, INF-04 | T-1-02 | Full pipeline (lint, typecheck, build, test) passes | integration | `pnpm lint && pnpm typecheck && pnpm build && pnpm test` | ✅ | ✅ green |
| 1-03-01 | 03 | 2 | INF-05, INF-06 | T-1-01, T-1-03, T-1-SC | gitleaks blocks EC key; lefthook wired; .gitleaks.toml has starkbank-private-key rule | unit | `pnpm vitest run --project=root-tests tests/ci/secret-scan.test.ts` | ✅ | ✅ green |
| 1-03-02 | 03 | 2 | INF-05 | T-1-03 | commitlint rejects non-Conventional; accepts valid; lefthook commit-msg hook wired | unit | `pnpm vitest run --project=root-tests tests/ci/commitlint.test.ts` | ✅ | ✅ green |
| 1-04-01 | 04 | 2 | INF-08, INF-10 | T-1-01, T-1-03, T-1-SC | ci.yml 7 jobs; Node 22/24 matrix; gitleaks fetch-depth:0; changeset-check PR-guarded; no corepack enable | ci | `pnpm vitest run --project=root-tests tests/ci/github-actions.test.ts` | ✅ | ✅ green |
| 1-04-02 | 04 | 2 | INF-08, INF-09 | T-1-04 | release.yml has id-token:write (D-23-revised → GitHub Packages publish) | ci | `grep -c 'id-token: write' .github/workflows/release.yml` | ✅ | ✅ green |
| 1-05-01 | 05 | 3 | INF-09, INF-10 | T-1-04 | .changeset/config.json fields; changeset:check script; changeset-required.sh wires `--since=main` | unit | `pnpm vitest run --project=root-tests tests/ci/changeset-gate.test.ts` | ✅ | ✅ green |
| 1-06-01 | 06 | 3 | INF-01..10 | T-1-01, T-1-03 | OSS governance docs exist; all automated tests GREEN | integration | `ls README.md SECURITY.md CONTRIBUTING.md CODE_OF_CONDUCT.md && pnpm test -- --run` | ✅ | ✅ green |
| 1-06-02 | 06 | 3 | INF-01..10 | T-1-03, T-1-04 | Branch protection + PVR enabled (human); CI green on GitHub | e2e | Human checkpoint — see Manual-Only table + `01-HUMAN-UAT.md` | n/a | ⬜ pending (human) |

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
| GitHub Actions matrix runs green on push/PR (CI smoke) | INF-08 | Requires actual GitHub-side execution; cannot be fully simulated by `act` | Push branch, open PR, confirm Actions UI shows all 7 jobs green on both Node 22 and Node 24. NOTE: apply CR-01 fix (`.test.ts` allowlist on `starkbank-private-key` in `.gitleaks.toml`) first, else `gitleaks-history` self-fires on `tests/ci/secret-scan.test.ts` |
| Pre-commit hook blocks EC private key commit (end-to-end) | INF-05, INF-06 | git hook chain (lefthook → gitleaks subprocess → exit propagation) requires a live staged-file commit in the working tree | Create a repo file containing `-----BEGIN EC PRIVATE KEY-----`, `git add` it, attempt `git commit` — commit must be rejected non-zero with gitleaks output |
| GitHub branch protection on `main` (D-14) | INF-08 | GitHub Settings action; no API path without admin-scope PAT | Settings → Branches: require PR + 1 review + required status checks (lint, typecheck, build, test (22), test (24), coverage-gate, gitleaks-history) + linear history |
| GitHub Private Vulnerability Reporting (D-16) | INF-08 | Repository Security-tab toggle requiring repo admin | Security tab shows "Private vulnerability reporting enabled" |
| `pnpm changeset` produces a valid changeset file interactively | INF-10 | Interactive CLI prompt | Run `pnpm changeset`, answer prompts, assert file appears in `.changeset/*.md` with valid frontmatter |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (`--run` enforced)
- [x] Feedback latency < 60s for quick command
- [x] `nyquist_compliant: true` set in frontmatter (per-task map fully populated)

**Approval:** automated validation complete (62/62 root-suite tests green). Human UAT pending — see Manual-Only table + `01-HUMAN-UAT.md` (CI smoke, pre-commit E2E, branch protection, PVR).

---

## Validation Audit 2026-05-29

Retroactive Nyquist audit (State A). 5 automatable gaps found and resolved; the broken INF-04 guard test reworked to be decoupled from `@aprumo/core`'s evolving real coverage.

| Metric | Count |
|--------|-------|
| Gaps found | 5 |
| Resolved | 5 |
| Escalated | 0 |

**Gaps resolved:**
- INF-04 — `tests/scaffold/coverage-gate-fires.test.ts` reworked: runs vitest `--coverage` against an **isolated temp project** with a 0%-covered source + 90% threshold, asserting non-zero exit + "does not meet". Previously a false-negative FAIL (Phase 2 covered code made the old core-targeted run exit 0).
- INF-03 — `tests/scaffold/infra.test.ts` extended: each of the 4 `packages/*/biome.json` exists and contains `"extends": "//"`.
- INF-05 — new `tests/ci/commitlint.test.ts`: rejects non-Conventional message, accepts valid, asserts `lefthook.yml` commit-msg hook wires commitlint.
- INF-08 — new `tests/ci/github-actions.test.ts`: asserts `ci.yml` 7 jobs, Node 22/24 matrix, gitleaks `fetch-depth: 0`, no `corepack enable`.
- INF-10 — `github-actions.test.ts` asserts `changeset-check` PR-guard; `tests/ci/changeset-gate.test.ts` extended for `scripts/changeset-required.sh` (exists, executable, wires `--since=main`).

**Result:** `pnpm vitest run --project=root-tests` → 62 passed / 0 failed. All INF-01..10 now have automated coverage; remaining items are inherently manual (GitHub UI / live git-hook / interactive CLI).

**Out of scope (tracked elsewhere):** CR-01 gitleaks self-fire, CR-02 SHA-pinning, CR-03 gitleaks checksum — see `01-REVIEW.md`.
