---
phase: "01-monorepo-scaffold-ci-dev-security"
plan: "01"
subsystem: "monorepo-root-config"
tags: [pnpm, typescript, biome, gitignore, workspace, tdd, wave-1, green-tests]
dependency_graph:
  requires:
    - "01-00 (vitest.config.ts, package.json with devDependencies, Wave 0 RED tests)"
  provides:
    - "pnpm-workspace.yaml — workspace package glob (packages/*)"
    - "package.json — type:module, license:MIT, version:0.0.0 added"
    - "tsconfig.base.json — strict, noUncheckedIndexedAccess, NodeNext, ES2024"
    - "tsconfig.json — root composite references hub for all 4 packages"
    - "biome.json — noExplicitAny=error, noNonNullAssertion=error, useImportType=error"
    - ".gitignore — .env*, *.key, *.pem, secrets/, dist/, coverage/, node_modules/"
    - ".npmrc — engine-strict=true, strict-peer-dependencies=true, auto-install-peers=false"
    - ".nvmrc — 22.22.2 Node LTS pin"
    - "LICENSE — MIT 2026 Aprumo Contributors"
    - "renovate.json — config:recommended, every weekend, automerge:false"
    - "tests/tsconfig.json — tsconfig for vitest OXC transformer"
  affects:
    - "01-02 (package stubs need workspace glob + tsconfig.base.json)"
    - "01-03 (lefthook needs biome.json to be valid for staged lint)"
    - "01-04 (CI jobs need biome.json + tsconfig for lint/typecheck jobs)"
tech_stack:
  added:
    - "tsconfig.base.json pattern — NodeNext + strict + noUncheckedIndexedAccess (D-19)"
    - "Biome v2 files.includes negation syntax (not files.ignore — breaking change in Biome 2.x)"
    - "pnpm-workspace.yaml v10 format — packages: array"
  patterns:
    - "Composite TypeScript project references (root tsconfig.json -> packages/*/tsconfig.json)"
    - "Biome v2 files.includes with ! prefix for ignore patterns"
    - "tests/tsconfig.json for vitest OXC transformer resolution"
key_files:
  created:
    - path: "pnpm-workspace.yaml"
      description: "pnpm workspace package glob (packages/*)"
    - path: "tsconfig.base.json"
      description: "Shared TS compiler options: strict, noUncheckedIndexedAccess, NodeNext, ES2024"
    - path: "tsconfig.json"
      description: "Root composite reference hub pointing to all 4 packages"
    - path: "biome.json"
      description: "Root Biome lint+format config with noExplicitAny=error (Biome 2.4.15)"
    - path: ".gitignore"
      description: "Ignore patterns: .env*, *.key, *.pem, secrets/, dist/, coverage/, node_modules/"
    - path: ".npmrc"
      description: "engine-strict=true, strict-peer-dependencies=true, auto-install-peers=false"
    - path: ".nvmrc"
      description: "Node 22.22.2 LTS pin"
    - path: "LICENSE"
      description: "MIT license 2026 Aprumo Contributors"
    - path: "renovate.json"
      description: "Renovate config: recommended preset, every weekend, automerge:false"
    - path: "tests/tsconfig.json"
      description: "TypeScript config for tests/ directory (vitest OXC transformer fix)"
  modified:
    - path: "package.json"
      description: "Added type:module, license:MIT, version:0.0.0"
decisions:
  - "D-08: ESM-only — package.json type:module added"
  - "D-19: tsconfig layout — tsconfig.base.json + root composite references tsconfig.json"
  - "D-27: Node pin — .nvmrc 22.22.2 + engines.node >=22 + engine-strict=true"
  - "D-28: pnpm pin — packageManager:pnpm@10.13.1 in package.json"
  - "D-29: Biome ruleset — noExplicitAny=error, noNonNullAssertion=error, useImportType=error"
  - "D-31: .npmrc strict hoisting (no shamefully-hoist)"
  - "D-32: strict-peer-dependencies=true + auto-install-peers=false"
  - "Biome v2 files.includes negation (not files.ignore) — schema breaking change in Biome 2.x"
metrics:
  duration: "8m"
  completed: "2026-05-22"
  tasks_completed: 2
  files_created: 10
  files_modified: 1
  tests_red_before: 26
  tests_green_after: 22
  tests_still_red: 10
---

# Phase 01 Plan 01: Monorepo Skeleton Root Configs Summary

Root monorepo configuration files that turn Wave 0 RED tests GREEN for INF-01 (workspace), INF-02 (TypeScript strict), INF-03 (Biome), and INF-07 (gitignore), using pnpm-workspace.yaml + tsconfig.base.json + biome.json + .gitignore + LICENSE + renovate.json + .npmrc + .nvmrc.

## What Was Built

This plan creates all root-level workspace configuration files. Wave 0 RED tests for INF-01..03 and INF-07 flip GREEN: 22 of 32 tests now pass (was 6 before this plan).

### Task 1: pnpm workspace, root package.json, .npmrc, .nvmrc

- `pnpm-workspace.yaml` — workspace package glob `packages/*` in pnpm 10 YAML format
- `package.json` updated — added `"type": "module"`, `"license": "MIT"`, `"version": "0.0.0"` (D-08 ESM-only)
- `.npmrc` — three directives: `engine-strict=true`, `strict-peer-dependencies=true`, `auto-install-peers=false`
- `.nvmrc` — `22.22.2` (Node 22 LTS, confirmed per RESEARCH.md Environment Availability)
- `pnpm install` succeeds with workspace configuration

### Task 2: tsconfig.base.json, tsconfig.json, biome.json, .gitignore, LICENSE, renovate.json

- `tsconfig.base.json` — strict TypeScript: `strict`, `noUncheckedIndexedAccess`, `module: NodeNext`, `moduleResolution: NodeNext`, `target: ES2024`, `verbatimModuleSyntax`, `isolatedModules`, no `rootDir`/`outDir` (those belong in per-package tsconfigs)
- `tsconfig.json` — root composite references hub; `"files": []`, `references` to all 4 packages (core, connector-base, connector-starkbank, webhooks)
- `biome.json` — Biome 2.4.15 config with `noExplicitAny: error`, `noNonNullAssertion: error`, `useImportType: error`, `organizeImports: on`. Uses `files.includes` with `!` negation (not `files.ignore` — breaking change in Biome v2)
- `.gitignore` — all required patterns: `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*`, `!.env.example`, `*.key`, `*.pem`, `secrets/`, `*.tsbuildinfo`, `.DS_Store`, `.turbo/`
- `LICENSE` — MIT license, year 2026, "Aprumo Contributors"
- `renovate.json` — `config:recommended`, `every weekend`, `automerge: false`, `dependencyDashboard: true`
- `tests/tsconfig.json` — enables vitest OXC transformer to compile tests/ directory (deviation — see below)

## Wave 0 RED → GREEN

Tests before this plan: **26 RED, 6 GREEN**
Tests after this plan: **10 RED, 22 GREEN**

Remaining 10 RED tests (correct — out of scope for Plan 01):
- `tests/ci/changeset-gate.test.ts` (4 tests) — `.changeset/config.json` not yet created (Plan 05 scope)
- `tests/ci/secret-scan.test.ts` (2 tests) — `gitleaks` binary not installed, `.gitleaks.toml` not created (Plan 03 scope)
- `tests/scaffold/infra.test.ts` (4 tests) — package stubs `packages/*/src/index.ts` not created (Plan 02 scope)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Biome v2 files.ignore → files.includes**
- **Found during:** Task 2 verification (`biome check --diagnostic-level=info .`)
- **Issue:** `biome.json` used `files.ignore` (Biome v1 schema). Biome v2 renamed this key — `files.ignore` is an unknown key and causes a deserialize error: "Found an unknown key `ignore`".
- **Fix:** Changed to `files.includes` with negation patterns (`"!**/dist/**"`, etc.) per Biome v2 `FilesConfiguration` schema
- **Files modified:** `biome.json`
- **Commit:** 6c11ba9

**2. [Rule 3 - Blocking] tests/tsconfig.json — vitest OXC transformer resolution**
- **Found during:** Task 2 verification (running test suite after creating tsconfig.json)
- **Issue:** Creating `tsconfig.json` at root level with `"files": []` caused Vite's OXC transformer to fail with `TSCONFIG_ERROR: Failed to load tsconfig for 'tests/ci/changeset-gate.test.ts': Tsconfig not found`. The OXC transformer scans upward, finds root tsconfig.json but cannot use it for tests/ files (files:[] excludes everything). Before tsconfig.json existed, OXC fell back to esbuild which worked without tsconfig discovery.
- **Fix:** Created `tests/tsconfig.json` extending `tsconfig.base.json` with `include: ["**/*.ts"]` and `noEmit: true`. This gives OXC a valid tsconfig to use for test file compilation.
- **Files modified:** `tests/tsconfig.json` (created)
- **Commit:** 6c11ba9

## Known Stubs

None — this plan creates tooling configuration only, no application code.

## Threat Surface Scan

**T-1-01 (Information Disclosure — .gitignore missing patterns): MITIGATED**
`.gitignore` created with all required patterns per threat register:
- `.env*` — environment files with credentials
- `*.key` — private key files
- `*.pem` — PEM-encoded certificates and keys
- `secrets/` — secrets directory

**T-1-02 (Tampering — engine-strict=false): MITIGATED**
`.npmrc` with `engine-strict=true` ensures install fails on Node <22.

No new security-relevant surface introduced beyond what's in the threat model.

## Self-Check: PASSED

Files verified to exist:
- pnpm-workspace.yaml: EXISTS
- tsconfig.base.json: EXISTS
- tsconfig.json: EXISTS
- biome.json: EXISTS
- .gitignore: EXISTS
- .npmrc: EXISTS
- .nvmrc: EXISTS
- LICENSE: EXISTS
- renovate.json: EXISTS
- tests/tsconfig.json: EXISTS

Commits verified:
- 3ed74ab (Task 1: pnpm-workspace.yaml, .npmrc, .nvmrc, package.json update): EXISTS
- 6c11ba9 (Task 2: tsconfig.base.json, tsconfig.json, biome.json, .gitignore, LICENSE, renovate.json, tests/tsconfig.json): EXISTS
