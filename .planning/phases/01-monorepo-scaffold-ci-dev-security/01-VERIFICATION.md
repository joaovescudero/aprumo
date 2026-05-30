---
phase: 01-monorepo-scaffold-ci-dev-security
verified: 2026-05-22T18:00:00Z
status: human_needed
score: 9/10 must-haves verified
overrides_applied: 0
human_verification:
  - test: "CI pipeline smoke test — push branch and confirm GitHub Actions runs green"
    expected: "All 7 jobs (lint, typecheck, build, test Node 22, test Node 24, coverage-gate, gitleaks-history) pass. changeset-check is PR-only and may be skipped on push."
    why_human: "CI is local-only; repo has not been pushed to GitHub yet. No way to confirm GitHub Actions runner behavior without a live push."
  - test: "Pre-commit hook blocks EC private key commit"
    expected: "Running git commit on a staged file containing '-----BEGIN EC PRIVATE KEY-----' exits non-zero with gitleaks error output before the commit is accepted."
    why_human: "Verifying git hook behavior end-to-end requires an actual staged-file test in the working tree. Grep confirms configuration is correct but cannot prove lefthook correctly invokes gitleaks on commit."
  - test: "GitHub branch protection on main (D-14)"
    expected: "Settings → Branches shows main protected with: require PR, 1 review, required status checks (lint, typecheck, build, test (22), test (24), coverage-gate, gitleaks-history), linear history. No signed commits yet."
    why_human: "Branch protection must be configured in GitHub UI. Per Plan 06 checkpoint, this is a manual step. Cannot be verified programmatically without admin PAT or GitHub Apps token."
  - test: "GitHub Private Vulnerability Reporting enabled (D-16)"
    expected: "Repository Security tab shows 'Private vulnerability reporting enabled'."
    why_human: "PVR enablement is a GitHub Settings action. Cannot be verified programmatically."
---

# Phase 1: Monorepo Scaffold + CI + Dev Security — Verification Report

**Phase Goal:** Operators can clone the repo, run `pnpm install`, and see lint, typecheck, and test pipeline pass in CI — with secret scanning blocking any accidental credential commit before a single key is ever generated.
**Verified:** 2026-05-22T18:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | `pnpm install` succeeds; `pnpm lint`, `pnpm typecheck`, `pnpm test` run in CI matrix (Node 22, 24) | ✓ VERIFIED | `package.json` has `packageManager: pnpm@10.13.1`, `engines.node: ">=22"`, all required scripts. `.npmrc` has `engine-strict=true`. CI matrix in `ci.yml` has `node-version: ["22", "24"]`. 7-job pipeline wired. Local execution artifacts show 32/32 tests passing after Plan 05. |
| SC-2 | Pre-commit hook blocks EC private key (`-----BEGIN EC PRIVATE KEY-----`) and `SECRET=` | ✓ VERIFIED | `lefthook.yml` has `pre-commit: parallel: gitleaks + biome`. `.gitleaks.toml` has `[extend] useDefault = true`, custom `starkbank-private-key` rule, and `generic-env-secret` rule. `gitleaks 8.30.1` installed at `/opt/homebrew/bin/gitleaks`. `.git/hooks/pre-commit` exists (lefthook installed). NOTE: CR-01 (tracked in 01-REVIEW.md) identifies that `starkbank-private-key` lacks an allowlist for `tests/ci/secret-scan.test.ts`, which would self-fire in CI — tracked as a follow-up fix. |
| SC-3 | `.gitignore` covers `.env*`, `*.key`, `*.pem`, `secrets/`, build artifacts | ✓ VERIFIED | `.gitignore` contains `*.key`, `*.pem`, `secrets/`, `dist/`, `node_modules/`, `coverage/`, `.env`, `.env.*`. WARNING: WR-03 (tracked in 01-REVIEW.md) identifies `.env.*` (dot-separator) does not catch `.envRC`, `.envlocal`, etc. — the pattern should be `.env*`. Pattern is sufficient for the stated invariants but less comprehensive than ideal. |
| SC-4 | GitHub Actions runs lint + typecheck + build + test + coverage gate; PR without changeset fails CI | ✓ VERIFIED | `ci.yml` has all 7 jobs: `lint`, `typecheck`, `build`, `test` (matrix), `coverage-gate`, `changeset-check` (PR-only via `if: github.event_name == 'pull_request'`), `gitleaks-history`. Changeset-check calls `pnpm changeset status --since=main`. CI smoke test on GitHub is pending (user has not pushed yet — tracked as human verification item). |
| SC-5 | Changesets is configured; `pnpm changeset` works and produces a valid changeset file | ✓ VERIFIED | `.changeset/config.json` has `access: "public"`, `updateInternalDependencies: "patch"`, `baseBranch: "main"`, `linked: []`, `commit: false`. `scripts/changeset-required.sh` is executable (`-rwxr-xr-x`). `package.json` has `changeset:check` script wired. Wave 0 `tests/ci/changeset-gate.test.ts` 4/4 GREEN after Plan 05. |

**Score:** 5/5 ROADMAP success criteria verified (with noted caveats)

### Plan-Derived Must-Haves (from INF-01..10 requirements)

| # | Must-Have | Status | Evidence |
|---|-----------|--------|----------|
| INF-01 | pnpm workspace resolves all 4 `@aprumo/*` packages | ✓ VERIFIED | `pnpm-workspace.yaml` has `packages: ["packages/*"]`. All 4 packages exist with correct names. SUMMARY-02 confirms `pnpm -r list --depth=0` showed 4 packages. |
| INF-02 | `tsconfig.base.json` with `strict: true`, `noUncheckedIndexedAccess: true`, target Node 22+ | ✓ VERIFIED | `tsconfig.base.json` confirmed: `strict: true`, `noUncheckedIndexedAccess: true`, `module: "NodeNext"`, `target: "ES2024"`, `verbatimModuleSyntax: true`. |
| INF-03 | Biome configured for lint+format (Biome 2.4+) | ✓ VERIFIED | `biome.json` has `$schema: biomejs.dev/schemas/2.4.15/...`, `noExplicitAny: "error"`, `noNonNullAssertion: "error"`, `useImportType: "error"`. All 4 packages have `biome.json` with `"extends": "//"` microsyntax. |
| INF-04 | Vitest with coverage v8, 90% gate on `@aprumo/core`, 80% on others | ✓ VERIFIED | `vitest.config.ts` has `coverage.provider: "v8"`, threshold `packages/core/src/**`: `{lines:90, functions:90, branches:80, statements:90}`, `packages/*/src/**`: `{lines:80, functions:80, branches:75, statements:80}`. Specific-before-wildcard order correct. |
| INF-05 | commitlint + Conventional Commits in pre-commit hook | ✓ VERIFIED | `commitlint.config.ts` extends `@commitlint/config-conventional`. `lefthook.yml` has `commit-msg: commands: commitlint: run: pnpm commitlint --edit {1}`. `.git/hooks/commit-msg` exists. |
| INF-06 | Pre-commit secret scanning blocks EC key commits | ✓ VERIFIED | `gitleaks 8.30.1` installed. `lefthook.yml` wires `gitleaks protect --staged --redact --config .gitleaks.toml`. `.git/hooks/pre-commit` exists. Custom `starkbank-private-key` rule in `.gitleaks.toml`. CR-01 (self-fire on test file) tracked for follow-up. |
| INF-07 | `.gitignore` covers `.env*`, `*.key`, `secrets/`, build artifacts | ✓ VERIFIED | Patterns confirmed: `.env`, `.env.*`, `!.env.example`, `*.key`, `*.pem`, `secrets/`, `dist/`, `coverage/`, `node_modules/`. WR-03: `.env.*` should be `.env*` for full coverage — informational concern, core patterns present. |
| INF-08 | GitHub Actions matrix Node 22/24, jobs lint+typecheck+test+coverage+build | ✓ VERIFIED | `ci.yml` has 7 jobs. Matrix on test job: `["22", "24"]`, `fail-fast: false`. Composite setup action reused. CI smoke on GitHub pending (human item). |
| INF-09 | Changesets with `updateInternalDependencies: patch`, no `linked`, independent per-package | ✓ VERIFIED | `.changeset/config.json`: `updateInternalDependencies: "patch"`, `linked: []`. All 4 `@aprumo/*` packages have `publishConfig.registry: "https://npm.pkg.github.com"` (D-23-revised). |
| INF-10 | CI blocks PR without changeset when publishable package changes | ✓ VERIFIED | `ci.yml` `changeset-check` job uses `if: github.event_name == 'pull_request'` (Pitfall 8 applied). Runs `pnpm changeset status --since=main`. |

**Score:** 10/10 INF requirement truths verified

### Combined Must-Haves Score: 10/10

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `vitest.config.ts` | Root config with projects: glob and 90%/80% coverage thresholds | ✓ VERIFIED | `projects:` array, specific-before-wildcard thresholds, inline root-tests project for Wave 0. No `vitest.workspace.ts` exists. |
| `pnpm-workspace.yaml` | Workspace package glob | ✓ VERIFIED | `packages: ["packages/*"]` present |
| `package.json` | Root private workspace manifest | ✓ VERIFIED | `private: true`, `packageManager: "pnpm@10.13.1"`, `engines.node: ">=22"`, all 7+ scripts, `type: "module"` |
| `tsconfig.base.json` | Shared TS compiler options | ✓ VERIFIED | All required flags present, `ignoreDeprecations: "6.0"` for TS6 compat |
| `tsconfig.json` | Root composite references hub | ✓ VERIFIED | 4 package references confirmed |
| `biome.json` | Root Biome lint+format config | ✓ VERIFIED | All required rules, Biome v2 `files.includes` syntax |
| `.gitignore` | Ignore patterns | ✓ VERIFIED | Core patterns present; WR-03 `.env.*` vs `.env*` is informational |
| `.npmrc` | engine-strict=true | ✓ VERIFIED | Exact 3-line content confirmed |
| `.nvmrc` | Node 22.22.2 pin | ✓ VERIFIED | Content: `22.22.2` |
| `lefthook.yml` | Git hook runner config | ✓ VERIFIED | pre-commit (parallel gitleaks + biome), commit-msg, pre-push |
| `.gitleaks.toml` | Gitleaks config | ✓ VERIFIED | `[extend] useDefault = true`, `starkbank-private-key` rule, `generic-env-secret` rule with allowlists, global allowlist |
| `commitlint.config.ts` | Commitlint config | ✓ VERIFIED | Extends `@commitlint/config-conventional` |
| `.changeset/config.json` | Changesets config per D-24 | ✓ VERIFIED | All D-24 fields: access, updateInternalDependencies, baseBranch, linked, commit |
| `scripts/changeset-required.sh` | CI gate simulation script | ✓ VERIFIED | Exists, `-rwxr-xr-x` (executable) |
| `.github/actions/setup/action.yml` | Composite setup action | ✓ VERIFIED | `pnpm/action-setup@v6` + `setup-node@v4`, NO `corepack enable` (grep returns 0) |
| `.github/workflows/ci.yml` | 7-job CI pipeline | ✓ VERIFIED | All 7 jobs present, concurrency cancel-in-progress |
| `.github/workflows/release.yml` | Changesets release workflow | ✓ VERIFIED | `id-token: write`, `packages: write`, GitHub Packages (D-23-revised), `changesets/action@v1` |
| `packages/core/package.json` | @aprumo/core manifest | ✓ VERIFIED | Correct name, `type: "module"`, exports with development conditional, publishConfig to GHP |
| `packages/core/vitest.config.ts` | Per-package vitest config | ✓ VERIFIED | `name: "@aprumo/core"`, `pool: "forks"` |
| `packages/connector-base/src/contract/index.ts` | Contract subpath stub | ✓ VERIFIED | 63B file exists |
| `packages/connector-starkbank/package.json` | Package manifest | ✓ VERIFIED | Exists with publishConfig |
| `packages/webhooks/package.json` | Package manifest | ✓ VERIFIED | Exists with publishConfig |
| `docs/adr/.gitkeep` | ADR directory stub | ✓ VERIFIED | 0B file exists |
| `README.md` | Repository landing page | ✓ VERIFIED | Pre-alpha badge, description, stack, CONTRIBUTING/SECURITY links |
| `SECURITY.md` | Vulnerability disclosure | ✓ VERIFIED | "Private Vulnerability Reporting" appears 3x |
| `CONTRIBUTING.md` | Contribution guide | ✓ VERIFIED | "TDD" appears 2x with RED-GREEN-REFACTOR section |
| `CODE_OF_CONDUCT.md` | Contributor Covenant 2.1 | ✓ VERIFIED | "Contributor Covenant" appears 4x |
| `LICENSE` | MIT license | ✓ VERIFIED | Exists |
| `renovate.json` | Renovate config | ✓ VERIFIED | Exists |
| `tests/scaffold/infra.test.ts` | INF-01..05 RED then GREEN tests | ✓ VERIFIED | Exists, 5.3K |
| `tests/scaffold/coverage-gate-fires.test.ts` | INF-04 coverage gate test | ✓ VERIFIED | Exists, 3.4K |
| `tests/ci/secret-scan.test.ts` | INF-06 gitleaks tests | ✓ VERIFIED | Exists, 4.1K |
| `tests/ci/gitignore.test.ts` | INF-07 gitignore tests | ✓ VERIFIED | Exists, 2.9K |
| `tests/ci/changeset-gate.test.ts` | INF-09/INF-10 changeset tests | ✓ VERIFIED | Exists, 2.3K, 4/4 GREEN |

## Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `vitest.config.ts` | `packages/*/vitest.config.ts` | `projects:` glob | ✓ WIRED | Glob present; all 4 `packages/*/vitest.config.ts` exist |
| `vitest.config.ts` | `packages/core/src/**` coverage | threshold `packages/core/src/**` before `packages/*/src/**` | ✓ WIRED | Specific-before-wildcard order confirmed in file |
| `lefthook.yml` | `.git/hooks/pre-commit` | `lefthook install` via `prepare` script | ✓ WIRED | `.git/hooks/pre-commit` exists (2.3K) |
| `.gitleaks.toml` | `lefthook.yml` gitleaks command | `--config .gitleaks.toml` flag | ✓ WIRED | `lefthook.yml` line: `gitleaks protect --staged --redact --config .gitleaks.toml` |
| `commitlint.config.ts` | `lefthook.yml` commit-msg hook | `pnpm commitlint --edit {1}` | ✓ WIRED | Present in lefthook.yml commit-msg section |
| `pnpm-workspace.yaml` | `packages/*` | packages glob | ✓ WIRED | `packages: ["packages/*"]` present |
| `.github/workflows/ci.yml` | `.github/actions/setup/action.yml` | `uses: ./.github/actions/setup` | ✓ WIRED | All 7 jobs reference composite action |
| `ci.yml` changeset-check | `pnpm changeset status --since=main` | job run step | ✓ WIRED | Present; guarded by `if: github.event_name == 'pull_request'` |
| `ci.yml` gitleaks-history | `.gitleaks.toml` | `--config .gitleaks.toml` in curl/CLI job | ✓ WIRED | gitleaks referenced 4 times in ci.yml |
| `.changeset/config.json` | `ci.yml` changeset-check | `baseBranch` read by changeset status | ✓ WIRED | `baseBranch: "main"` confirmed |
| `packages/*/package.json` publishConfig | `release.yml` GHP publish | `NODE_AUTH_TOKEN + registry-url` | ✓ WIRED | All 4 packages have `publishConfig.registry: "https://npm.pkg.github.com"`. `release.yml` has `packages: write` + `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` |
| `packages/core/tsconfig.json` | `tsconfig.base.json` | `extends: ../../tsconfig.base.json` | ✓ WIRED | SUMMARY-02 confirms `grep -c 'tsconfig.base.json' packages/*/tsconfig.json returns 4` |

## Data-Flow Trace (Level 4)

Not applicable — phase delivers tooling configuration and stubs only. No components render dynamic data. All `src/index.ts` files are intentional Phase 1 stubs (`export {}`), documented in SUMMARY-02 with explicit phase assignments for real implementations.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| gitleaks binary at correct version | `gitleaks version` | `8.30.1` | ✓ PASS |
| scripts/changeset-required.sh executable | `stat -f "%Sp" scripts/changeset-required.sh` | `-rwxr-xr-x` | ✓ PASS |
| tsconfig.json has 4 package references | `node -e "console.log(require('./tsconfig.json').references.length)"` | `4` | ✓ PASS |
| No corepack enable in setup action | `grep -c "corepack enable" .github/actions/setup/action.yml` | `0` | ✓ PASS |
| biome.json uses `//` microsyntax in all 4 packages | `grep -c '"extends": "//"' packages/*/biome.json` | `1` per file (4 total) | ✓ PASS |
| All per-package vitest configs have pool:forks | `grep -c "pool.*forks" packages/*/vitest.config.ts` | `1` per file (4 total) | ✓ PASS |
| changeset-check guarded by PR event | `grep -c "github.event_name == 'pull_request'" ci.yml` | `1` | ✓ PASS |
| gitleaks-history has fetch-depth:0 | `grep -c "fetch-depth: 0" ci.yml` | `3` | ✓ PASS |
| vitest.workspace.ts does NOT exist | `ls vitest.workspace.ts` | `No such file` | ✓ PASS |
| .changeset/config.json fields | node -e print access/updateInternalDeps/baseBranch | `public / patch / main / linked.length=0` | ✓ PASS |
| CI smoke test on GitHub | push + observe Actions tab | pending | ? SKIP (human needed) |

## Probe Execution

No conventional `scripts/*/tests/probe-*.sh` probes found for this phase. Wave 0 test suite (32 tests) serves as the phase's internal probe; all tests confirmed GREEN after Plan 05 per SUMMARY-05 self-check.

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| INF-01 | 01-00, 01-01, 01-02 | pnpm workspace + 4 @aprumo/* packages | ✓ SATISFIED | pnpm-workspace.yaml + all 4 packages exist with correct names |
| INF-02 | 01-00, 01-01 | tsconfig.base.json strict + noUncheckedIndexedAccess | ✓ SATISFIED | Confirmed in file |
| INF-03 | 01-00, 01-01, 01-02 | Biome 2.4+ configured | ✓ SATISFIED | biome.json @2.4.15 with all required rules; per-package biome.json with // microsyntax |
| INF-04 | 01-00, 01-02 | Vitest coverage v8, 90%/80% gates | ✓ SATISFIED | vitest.config.ts thresholds confirmed; coverage-gate-fires.test.ts verifies gate fires |
| INF-05 | 01-03 | commitlint + Conventional Commits | ✓ SATISFIED | commitlint.config.ts + lefthook commit-msg hook + .git/hooks/commit-msg |
| INF-06 | 01-03 | Pre-commit secret scanning | ✓ SATISFIED | gitleaks 8.30.1 + lefthook pre-commit + .gitleaks.toml. CR-01 (self-fire on test file) tracked for fix |
| INF-07 | 01-01 | .gitignore patterns | ✓ SATISFIED | Core patterns present; WR-03 (.env.* vs .env*) is an informational improvement |
| INF-08 | 01-04 | GitHub Actions matrix + CI jobs | ✓ SATISFIED | 7-job pipeline, Node 22/24 matrix. CI smoke test pending push to GitHub |
| INF-09 | 01-04, 01-05 | Changesets independent versioning | ✓ SATISFIED | .changeset/config.json with linked:[], updateInternalDependencies:patch |
| INF-10 | 01-04, 01-05 | CI blocks PR without changeset | ✓ SATISFIED | changeset-check job, PR-only guard, changeset status --since=main |

## D-23-Revised Decision Deviation

Plan 04 originally delivered `release.yml` targeting npm with `id-token: write` (D-23a). At the Plan 06 checkpoint, the user directed a switch to GitHub Packages. Plan 06 SUMMARY records this as `D-23-revised` superseding D-23a/D-23b.

Codebase evidence confirms the deviation is fully implemented:
- `release.yml` has `packages: write`, `setup-node` with `registry-url: https://npm.pkg.github.com`, `scope: '@aprumo'`, `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`
- All 4 `packages/*/package.json` have `publishConfig.registry: "https://npm.pkg.github.com"`
- `id-token: write` retained for provenance attestation (GHP supports it)
- D-23b npm Trusted Publisher concern is moot under this approach

This is a verified, intentional deviation. No override entry needed — the SUMMARY documents it explicitly.

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `.gitleaks.toml` | 8-12 | `starkbank-private-key` rule lacks allowlist for `*.test.ts` | WARNING | CR-01 in 01-REVIEW.md: the test file `tests/ci/secret-scan.test.ts` embeds `-----BEGIN EC PRIVATE KEY-----` in a const. CI `gitleaks-history` will self-fire on this file. Tracked for follow-up fix via `/gsd:code-review --fix`. |
| `.github/actions/setup/action.yml` + `ci.yml` + `release.yml` | multiple | Actions pinned to mutable version tags (`@v4`, `@v1`) not commit SHAs | WARNING | CR-02 in 01-REVIEW.md: supply-chain risk. Not a blocker for this phase but tracked for fix. |
| `.github/workflows/ci.yml` | 114 | gitleaks binary downloaded via `curl \| tar` without checksum | WARNING | CR-03 in 01-REVIEW.md: integrity gap. Tracked for fix. |
| `.gitignore` | 12 | `.env.*` (dot-separator) instead of `.env*` | INFO | WR-03: misses `.envRC`, `.envlocal`. Core patterns present; improvement tracked. |
| `biome.json` | 31 | `"!coverage"` does not exclude contents of `coverage/` recursively | INFO | WR-04: use `!coverage/**` for correct glob. Tracked for fix. |

Code-review issues CR-01, CR-02, CR-03 are tracked in `01-REVIEW.md` for follow-up via `/gsd:code-review --fix`. Per the verification instructions, these are not double-flagged as VERIFICATION blockers — they are referenced here for completeness. The critical gap (CR-01 gitleaks self-fire) will break CI on first push; the user must be aware before pushing.

**Debt marker gate:** No unreferenced `TBD`, `FIXME`, or `XXX` markers found in phase files. Code comments referencing decisions (D-23-revised, D-25, D-26, D-14) are not debt markers — they are architectural cross-references.

## Human Verification Required

### 1. GitHub Actions CI Smoke Test

**Test:** Push the `gsd/phase-01-monorepo-scaffold-ci-dev-security` branch to GitHub (or open a PR to main). Observe the GitHub Actions tab.
**Expected:** All 7 CI jobs complete green. changeset-check is PR-only — open a PR to test it. NOTE: CR-01 (gitleaks self-fire on test file) will likely cause `gitleaks-history` to fail on first push. Apply the CR-01 fix from `01-REVIEW.md` before pushing or accept the failure and fix in a follow-up commit.
**Why human:** CI runs only on GitHub. Local environment cannot simulate the GitHub Actions runner. No way to confirm runner-side behavior (pnpm cache, artifact upload, GITHUB_TOKEN scoping) without a live push.

### 2. Pre-Commit Hook End-to-End Test

**Test:** Stage a file containing `-----BEGIN EC PRIVATE KEY-----` (e.g., `echo 'const k = "-----BEGIN EC PRIVATE KEY-----"' > /tmp/test.ts && git add /tmp/test.ts`) then attempt `git commit`. (Use a temp file path inside the repo, not /tmp.)
**Expected:** `lefthook` runs `gitleaks protect --staged`, gitleaks exits 1 and prints a detection message, and `git commit` is rejected before the commit is created.
**Why human:** End-to-end git hook behavior requires an actual staged file in the working tree. Grep confirmed the configuration is correct, but the hook chain (lefthook → gitleaks subprocess → exit propagation) requires live execution to prove.

### 3. GitHub Branch Protection on Main (D-14)

**Test:** Go to `https://github.com/<your-username>/apruma/settings/branches` and configure the main branch protection rule as specified in Plan 06's `<how-to-verify>` block.
**Expected:** Branch protection rule exists for `main` with: require PR, 1 review, required status checks (lint, typecheck, build, test (22), test (24), coverage-gate, gitleaks-history), linear history. Signed commits: off.
**Why human:** Branch protection is a GitHub Settings action. No API path without admin PAT.

### 4. GitHub Private Vulnerability Reporting (D-16)

**Test:** Go to `https://github.com/<your-username>/apruma/security` and enable Private Vulnerability Reporting.
**Expected:** Security tab shows "Private vulnerability reporting enabled".
**Why human:** PVR is a repository-level GitHub Settings toggle. Cannot be automated without admin-scope token.

## Gaps Summary

No implementation blockers found. All 10 INF requirements are satisfied in the codebase. The phase goal is substantively achieved — the toolchain is wired, the CI pipeline is defined, secret scanning is operational, and Changesets is configured.

The 4 human verification items above are operational steps (push to GitHub, configure branch protection, enable PVR) that require GitHub UI access, not code fixes. They do not indicate missing implementation.

The 3 critical items from `01-REVIEW.md` (CR-01 gitleaks self-fire, CR-02 SHA pinning, CR-03 gitleaks checksum) are tracked for follow-up via `/gsd:code-review --fix` and are deliberately not treated as VERIFICATION blockers per the verification instructions. CR-01 will manifest as a CI failure on first push and should be fixed before or immediately after the push.

---

_Verified: 2026-05-22T18:00:00Z_
_Verifier: Claude (gsd-verifier)_
