---
phase: 01-monorepo-scaffold-ci-dev-security
plan: "06"
subsystem: infra
tags: [oss-governance, readme, security-disclosure, code-of-conduct, contributing, github-packages, decision-deviation]

# Dependency graph
requires:
  - phase: 01-03
    provides: "lefthook + commitlint installed — Conventional Commits enforced on every governance commit"
  - phase: 01-04
    provides: ".github/workflows/release.yml — target updated by this plan to GitHub Packages"
  - phase: 01-05
    provides: "Changesets configured — publishConfig now points at GHP instead of npm"
provides:
  - "README.md — pre-alpha badge, project description, stack, package map, quickstart placeholder, CONTRIBUTING/SECURITY/LICENSE links"
  - "SECURITY.md — GitHub PVR primary channel + email fallback, 90-day disclosure window, SAQ-A PCI scope statement"
  - "CONTRIBUTING.md — TDD mandate, Conventional Commits, Changesets gate, contract-tests note, critical-invariants short list"
  - "CODE_OF_CONDUCT.md — Contributor Covenant 2.1 reference form (link to canonical text)"
  - "packages/*/package.json publishConfig pointing to https://npm.pkg.github.com (4 packages)"
  - "release.yml updated for GitHub Packages: packages:write permission, setup-node registry-url=https://npm.pkg.github.com + scope=@aprumo, NODE_AUTH_TOKEN=GITHUB_TOKEN"
affects:
  - "Phase 9 release path — now publishes to GHP, not npm; first release uses GITHUB_TOKEN (no Trusted Publisher setup required)"
  - "PROJECT.md Key Decisions table — D-23 superseded by D-23-revised"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Contributor Covenant 2.1 reference form: link to canonical text instead of inlining"
    - "GitHub Packages auth pattern: setup-node sets registry-url + scope; npm publish picks NODE_AUTH_TOKEN; publishConfig.registry in package.json pins target"
    - "Provenance attestation works on GHP — id-token:write retained alongside packages:write"

key-files:
  created:
    - path: "README.md"
      description: "Repository landing page: pre-alpha + MIT badges, project description (PT-BR + EN), stack table, packages map, dev quickstart, CONTRIBUTING/SECURITY/LICENSE links"
    - path: "SECURITY.md"
      description: "Vulnerability disclosure: GitHub PVR primary, security@aprumo.dev placeholder email, 90-day window, in-scope/out-of-scope, SAQ-A PCI statement"
    - path: "CONTRIBUTING.md"
      description: "Setup + TDD section (RED-GREEN-REFACTOR) + Conventional Commits table + Changesets requirement + contract-tests note + critical-invariants short list with link to CLAUDE.md"
    - path: "CODE_OF_CONDUCT.md"
      description: "Contributor Covenant 2.1 by reference (link to canonical contributor-covenant.org URL) + scope + enforcement contact placeholder"
  modified:
    - path: "packages/core/package.json"
      description: "publishConfig.registry → https://npm.pkg.github.com, access:public"
    - path: "packages/connector-base/package.json"
      description: "publishConfig.registry → https://npm.pkg.github.com, access:public"
    - path: "packages/connector-starkbank/package.json"
      description: "publishConfig.registry → https://npm.pkg.github.com, access:public"
    - path: "packages/webhooks/package.json"
      description: "publishConfig.registry → https://npm.pkg.github.com, access:public"
    - path: ".github/workflows/release.yml"
      description: "packages:write permission added, actions/setup-node@v4 step configured for GHP, NODE_AUTH_TOKEN=GITHUB_TOKEN, header comments updated to D-23-revised"

key-decisions:
  - "D-15 delivered: README, SECURITY, CONTRIBUTING, CODE_OF_CONDUCT governance set"
  - "D-16 delivered: GitHub PVR documented as primary disclosure channel; placeholder email security@aprumo.dev"
  - "D-23-REVISED: publish target switched from npm to GitHub Packages per user direction at checkpoint. Supersedes D-23a (npm OIDC trusted publishing) and D-23b (npm Trusted Publisher per-package, deferred to Phase 9). Migration to public npm registry may be revisited in a future milestone."
  - "CoC delivered by reference form rather than inlined text — content-equivalent to canonical Contributor Covenant 2.1; satisfies plan acceptance criterion (grep -c \"Contributor Covenant\" >= 1)."

deviations:
  - "Plan said publish via npm OIDC (D-23a delivered Plan 04). User approved checkpoint with the direction \"change npm to GitHub Packages for now\" — release.yml rewired and publishConfig added in 4 packages. Recorded as D-23-revised."
  - "CoC written as reference form (link to canonical text + scope + enforcement section) instead of inlining the full Contributor Covenant 2.1 body. Equivalent in policy; minimizes copy of upstream-maintained text. Plan acceptance grep passes (4 occurrences)."

human_checkpoint:
  status: approved
  approved_at: 2026-05-22
  user_action_required:
    - "Enable branch protection on main (D-14 — Required status checks: lint, typecheck, build, test (22), test (24), coverage-gate, gitleaks-history)"
    - "Enable GitHub Private Vulnerability Reporting (D-16)"
    - "Push branch to GitHub and verify CI smoke test goes green"
  deferred:
    - "npm Trusted Publisher (D-23b) → SUPERSEDED by D-23-revised. No npm action needed. First release publishes to GHP via GITHUB_TOKEN."

# Self-check
self_check: PASSED
notes:
  - "All 4 governance files committed in single commit ace920c per plan acceptance criterion"
  - "GHP migration committed separately as 4922016 to isolate the deviation"
  - "Wave 0 RED → GREEN: 32/32 tests stable (no new tests; this plan adds OSS docs and adjusts release target only)"
---

# Plan 01-06 SUMMARY — OSS Governance + GHP Migration

## What was built

### Task 1 — OSS governance files (auto)

4 documents satisfy the D-15 governance set:

- `README.md` — pre-alpha + MIT badges, ledger-purpose paragraph, what-it-is / what-it-isn't, stack table, packages map, dev quickstart, links out to CONTRIBUTING / SECURITY / LICENSE.
- `SECURITY.md` — GitHub Private Vulnerability Reporting as preferred channel with explicit deep-link to `../../security/advisories/new`, security@aprumo.dev fallback email (placeholder until domain registration), 90-day disclosure window, CVE-on-request policy, in-scope/out-of-scope lists, explicit SAQ-A PCI scope note.
- `CONTRIBUTING.md` — TDD mandate verbatim from CLAUDE.md (RED-GREEN-REFACTOR), Conventional Commits type table, Changesets gate, setup instructions, contract-tests note (Phase 5+), critical-invariants short list with link to CLAUDE.md.
- `CODE_OF_CONDUCT.md` — Contributor Covenant 2.1 by reference (link to canonical text on contributor-covenant.org) + scope statement + enforcement contact (same security@aprumo.dev placeholder).

Plan acceptance grep checks all pass:
- `grep -c "Private Vulnerability Reporting" SECURITY.md` → 3
- `grep -c "TDD" CONTRIBUTING.md` → 2
- `grep -c "Contributor Covenant" CODE_OF_CONDUCT.md` → 4

Commit: `ace920c docs(01-06): add OSS governance files (README, SECURITY, CONTRIBUTING, CoC) (INF-01..10)`

### Task 2 — Human checkpoint (approved with deviation)

User approved the checkpoint with the direction to switch publishing from npm to GitHub Packages. Implemented inline:

- Each `packages/*/package.json` gains `publishConfig.registry: "https://npm.pkg.github.com"` and `access: "public"`.
- `.github/workflows/release.yml`:
  - Adds `packages: write` permission.
  - Inserts `actions/setup-node@v4` with `registry-url: 'https://npm.pkg.github.com'` and `scope: '@aprumo'` — writes the GHP auth token into `~/.npmrc` before publish.
  - Passes `NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` to the changesets/action step.
  - Retains `id-token: write` for provenance attestation (GHP supports it).
- Header comments updated: D-23a/D-23b superseded by D-23-revised.

Commit: `4922016 feat(01-06): switch publish target from npm to GitHub Packages (D-23-revised)`

## Decision deviation: D-23-revised

| | D-23 (original) | D-23-revised (this plan) |
|---|---|---|
| Target registry | npmjs.com | npm.pkg.github.com |
| Auth | OIDC + Trusted Publisher per package | GITHUB_TOKEN |
| Phase 9 work needed | Configure Trusted Publisher per package on npmjs.com | None |
| Provenance | Yes (npm provenance) | Yes (GHP attestation via id-token:write) |
| Phase 1 deliverable | id-token:write in release.yml | publishConfig + setup-node + NODE_AUTH_TOKEN |

D-23a delivered in Plan 04 (id-token:write) remains accurate but is now used for GHP attestation rather than npm OIDC. D-23b (npm Trusted Publisher deferral) is moot under D-23-revised — there is no chicken-and-egg npm prerequisite.

## Manual user steps still owed (post-checkpoint)

1. **GitHub branch protection on `main`** (D-14) — required status checks: lint, typecheck, build, test (22), test (24), coverage-gate, gitleaks-history. Linear history on. Signed commits off (per D-14).
2. **GitHub Private Vulnerability Reporting** — Settings → Security → enable.
3. **Push branch + smoke-test CI** — open a PR to confirm green pipeline.

These three steps were explicitly listed in the plan's `<how-to-verify>` block and need to happen on github.com (no CLI path without admin PAT).

## INF requirements satisfied

All 10 INF requirements (INF-01 through INF-10) covered by the cumulative Phase 1 work. This plan adds the OSS governance dimension and finalizes the release target. Plan-level requirements list pinned to INF-01..INF-10 per frontmatter.

## Self-check

- [x] All 4 governance files exist and grep checks pass
- [x] publishConfig present in all 4 packages
- [x] release.yml has packages:write + GHP setup
- [x] Conventional Commit format honored (commits 4922016, ace920c pass commitlint at commit time)
- [x] No --no-verify used
- [x] Decision deviation recorded as D-23-revised in this SUMMARY and ready to propagate to PROJECT.md
