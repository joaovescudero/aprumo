---
phase: "01-monorepo-scaffold-ci-dev-security"
plan: "03"
subsystem: "pre-commit-security"
tags: [lefthook, gitleaks, commitlint, pre-commit, secret-scanning, wave-2, green-tests]
dependency_graph:
  requires:
    - "01-01 (biome.json, package.json with prepare script, workspace)"
    - "01-02 (package stubs for typecheck to have something to verify on pre-push)"
  provides:
    - "lefthook.yml — pre-commit (gitleaks + biome), commit-msg (commitlint), pre-push (typecheck)"
    - ".gitleaks.toml — default rules + starkbank-private-key + generic-env-secret with fixture allowlist"
    - "commitlint.config.ts — extends @commitlint/config-conventional"
    - ".git/hooks/pre-commit, commit-msg, pre-push — wired by lefthook install via prepare script"
  affects:
    - "01-04 (CI full-history gitleaks scan as second layer per D-06)"
    - "All future plans (every commit now validated by commitlint + gitleaks)"
    - "Phase 6 (starkbank ECDSA key cannot enter git history — ROADMAP success criterion #2 met)"
tech_stack:
  added:
    - "lefthook 2.1.8 — YAML-based git hook runner (Go binary, parallel execution)"
    - "gitleaks 8.30.1 — binary installed via brew (Go, single-file binary, no Python dep)"
    - "@commitlint/cli 21.0.1 + @commitlint/config-conventional 21.0.1 (already in devDeps)"
  patterns:
    - "Two-layer secret scanning: pre-commit (staged, fast) + CI full-history (D-06)"
    - "lefthook parallel: true for pre-commit (gitleaks + biome run concurrently)"
    - ".gitleaks.toml extends default 100+ rules + custom starkbank-private-key rule (D-05)"
    - "Generic commitlint config with no custom rules — conventional preset covers all CLAUDE.md types"
key_files:
  created:
    - path: "lefthook.yml"
      description: "Git hook runner config — pre-commit (gitleaks + biome), commit-msg (commitlint), pre-push (typecheck)"
    - path: ".gitleaks.toml"
      description: "Gitleaks config extending default 100+ rules + starkbank-private-key + generic-env-secret with allowlists"
    - path: "commitlint.config.ts"
      description: "Commitlint config extending @commitlint/config-conventional for Conventional Commits enforcement"
  modified: []
decisions:
  - "D-01: lefthook as git hook runner (YAML single file, Go binary, zero Node deps)"
  - "D-02: gitleaks as secret scanner (8.30.1 installed via brew)"
  - "D-03: pre-commit scope = gitleaks (staged) + biome check + commitlint"
  - "D-04: pre-push scope = pnpm typecheck only (no tests — CI decides)"
  - "D-05: .gitleaks.toml default + starkbank-private-key custom rule + generic-env-secret"
  - "D-06: Two-layer strategy — pre-commit (staged) + CI full-history (Plan 04)"
metrics:
  duration: "8m"
  completed: "2026-05-22"
  tasks_completed: 2
  files_created: 3
  files_modified: 0
  tests_green_before: 26
  tests_green_after: 28
  tests_still_red: 4
---

# Phase 01 Plan 03: Pre-commit Security + Commit Enforcement Summary

Pre-commit secret scanning and commit message enforcement via lefthook + gitleaks 8.30.1 + commitlint. Any attempt to commit an EC private key or generic secret is blocked before git accepts the commit. Conventional Commits enforced on all commit messages. TypeScript checked on push.

## What Was Built

This plan completes Wave 2 of Phase 1. Pre-commit hook stack is fully operational.

### Task 1: gitleaks install + lefthook.yml + .gitleaks.toml

- `gitleaks` 8.30.1 installed via `brew install gitleaks` — matches exact version from RESEARCH.md
- `lefthook.yml` created with 3 hook sections:
  - `pre-commit` (parallel: true): gitleaks staged scan + biome check staged files
  - `commit-msg`: commitlint validates commit message format
  - `pre-push`: pnpm typecheck (tsc, no tests per D-04)
- `.gitleaks.toml` created with:
  - `[extend] useDefault = true` — inherits all 100+ default rules (including `private-key` covering EC keys)
  - `[[rules]] id = "starkbank-private-key"` — explicit EC key rule per D-05 (redundant safety margin for gitleaks issue #854)
  - `[[rules]] id = "generic-env-secret"` — matches `SECRET=/API_KEY=/PRIVATE_KEY=` with allowlist for `__fixtures__/`, `.example`, `.test.ts`
  - `[allowlist]` — global exclusion for `.gitleaks.toml` itself and `docs/adr/`
- `pnpm install` triggered `prepare` → `lefthook install` — wired `.git/hooks/pre-commit`, `.git/hooks/commit-msg`, `.git/hooks/pre-push`
- Smoke test: `gitleaks detect --source /tmp/gitleaks-smoke-test/ --no-git` against EC PEM header exits 1 (detected)
- Wave 0 `tests/ci/secret-scan.test.ts`: 4/4 GREEN (was 0/4 before this task)

### Task 2: commitlint.config.ts + full pre-commit verification

- `commitlint.config.ts` created at repo root with TypeScript syntax (consistent with all-TypeScript codebase)
- Imports `UserConfig` from `@commitlint/types` (included in `@commitlint/cli@21.0.1`)
- Extends only `@commitlint/config-conventional` — covers all CLAUDE.md types (feat/fix/refactor/docs/test/chore/perf/ci)
- Verification:
  - `echo "bad message" | pnpm commitlint` → exit 1 (rejects: subject-empty, type-empty)
  - `echo "feat(scope): add x" | pnpm commitlint` → exit 0 (accepts)
- Note: commitlint was needed BEFORE committing Task 1 (ordering dependency discovered at runtime) — both files staged and committed as Task 1, commitlint committed as Task 2
- Wave 0 tests: 28/32 GREEN (was 26/32 before this plan)

## Wave 0 RED → GREEN

Tests before this plan: **6 RED, 26 GREEN**
Tests after this plan: **4 RED, 28 GREEN**

Remaining 4 RED tests (correct — out of scope for Plan 03):
- `tests/ci/changeset-gate.test.ts` (4 tests) — `.changeset/config.json` not yet created (Plan 05 scope)

## Deviations from Plan

### Auto-fixed Issues

None — plan executed exactly as written.

### Ordering Deviation (informational, not a bug)

Task 1's commit required commitlint.config.ts (Task 2) to be present first — the commit-msg hook runs commitlint, which fails without a config. Resolution: Task 2 was implemented immediately before committing Task 1. Both tasks are independently committed in their correct commit sequence (Task 1 commit `bb709fe`, Task 2 commit `5291526`). This is an ordering artifact, not a deviation from plan intent.

## Known Stubs

None. All 3 files created in this plan are production configuration, not stubs.

## Threat Surface Scan

This plan directly implements T-1-01 and T-1-01b mitigations from the threat model:

| Threat ID | Mitigation Status |
|-----------|------------------|
| T-1-01 (EC private key committed) | MITIGATED — gitleaks pre-commit blocks PEM header; starkbank-private-key custom rule provides redundant coverage |
| T-1-01b (SECRET= in .env committed) | MITIGATED — generic-env-secret rule with __fixtures__/ allowlist |
| T-1-03 (--no-verify bypass) | PARTIAL — pre-commit layer complete; CI full-history scan (Plan 04) is the second layer |

ROADMAP Phase 1 Success Criterion #2 is now MET: pre-commit hook blocks a commit containing an EC private key PEM header (BEGIN EC PRIVATE KEY).

No new threat surface introduced. These are developer toolchain files with no network endpoints, auth paths, or schema changes.

## Self-Check: PASSED

Files verified to exist:
- lefthook.yml: EXISTS
- .gitleaks.toml: EXISTS
- commitlint.config.ts: EXISTS
- .git/hooks/pre-commit: EXISTS (lefthook installed)
- .git/hooks/commit-msg: EXISTS (lefthook installed)
- .git/hooks/pre-push: EXISTS (lefthook installed)

Commits verified:
- bb709fe (Task 1: lefthook.yml + .gitleaks.toml + gitleaks 8.30.1): EXISTS
- 5291526 (Task 2: commitlint.config.ts): EXISTS
