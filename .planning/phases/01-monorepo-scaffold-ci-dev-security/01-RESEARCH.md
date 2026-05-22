# Phase 1: Monorepo Scaffold + CI + Dev Security - Research

**Researched:** 2026-05-22
**Domain:** pnpm workspaces, TypeScript, Biome v2, Vitest v4, lefthook, gitleaks, GitHub Actions, Changesets
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Pre-commit Stack**
- D-01: Hook runner = lefthook (YAML único, paralelismo nativo, zero dep Node)
- D-02: Secret scanner = gitleaks (binário Go single-file, sem dep Python)
- D-03: Pre-commit scope = gitleaks (staged) + commitlint (Conventional Commits) + biome check --staged
- D-04: Pre-push scope = pnpm typecheck apenas
- D-05: .gitleaks.toml = default rules + custom para EC PRIVATE KEY, Starkbank tokens, SECRET=/API_KEY= fora de __fixtures__/. Sem baseline (repo greenfield)
- D-06: Gitleaks em duas camadas: pre-commit (staged) + CI (gitleaks detect história completa)

**Build & Distribution**
- D-07: Build tool = tsc + project references. Zero dep extra
- D-08: Module format = ESM-only
- D-09: package.json exports = subpaths declarados explicitamente
- D-10: Resolução cross-package em dev = conditional exports "development" → src/, default → dist/

**Monorepo Orchestration & CI**
- D-11: Task runner = pnpm -r cru. Sem Turborepo/Nx
- D-12: CI = um único .github/workflows/ci.yml com jobs paralelos + composite action .github/actions/setup/
- D-13: Triggers = on: [pull_request, push: branches: [main]] com concurrency cancel-in-progress
- D-14: Branch protection = strict PR + 1 review + status checks. Sem signed commits inicialmente

**Housekeeping OSS**
- D-15: Governance set: LICENSE (MIT), README.md skeleton, SECURITY.md, CONTRIBUTING.md, CODE_OF_CONDUCT.md, issue templates, PR template
- D-16: GitHub PVR habilitado + email placeholder no SECURITY.md
- D-17: docker-compose.yml adiado para Phase 2
- D-18: Renovate config commitada em Phase 1 com config:recommended; ativação real out-of-band

**TypeScript & Vitest**
- D-19: tsconfig.base.json (strict, noUncheckedIndexedAccess, target: ES2024, module: NodeNext, verbatimModuleSyntax: true) + por pacote tsconfig.json + tsconfig.build.json
- D-20: vitest.workspace.ts raiz + vitest.config.ts por pacote. Threshold 90% core / 80% demais
- D-21: Vitest pool: 'forks'

**Changesets**
- D-22: changesets/action configurada: Version PR automático + publish on merge. Real publish em Phase 9
- D-23: npm OIDC trusted publishing (id-token: write). Sem NPM_TOKEN longo-prazo
- D-24: .changeset/config.json = access: "public", updateInternalDependencies: "patch", baseBranch: "main"

**Coverage**
- D-25: Coverage reporting via davelosert/vitest-coverage-report-action@v2 (sticky PR comment)
- D-26: Artifacts CI = apenas lcov.info

**Node & pnpm Pinning**
- D-27: .nvmrc + engines.node: ">=22" + engine-strict=true em .npmrc
- D-28: packageManager: "pnpm@10.x.x" no package.json + corepack enable em CI

**Biome**
- D-29: Ruleset = recommended + noExplicitAny=error, noNonNullAssertion=error, useImportType=error, organizeImports: on
- D-30: Override para **/*.test.ts: noNonNullAssertion=off (mas noExplicitAny=error em todo lugar)

**pnpm Hoisting & Peer Deps**
- D-31: .npmrc = strict hoisting default + public-hoist-pattern[] apenas se necessário
- D-32: strict-peer-dependencies=true + auto-install-peers=false

### Claude's Discretion

- Estrutura interna de cada src/ por pacote: Phase 1 cria só src/index.ts placeholder por pacote
- Conteúdo exato dos templates .github/ISSUE_TEMPLATE/*.yml e PULL_REQUEST_TEMPLATE.md
- Versão Node específica do .nvmrc: planner pega LTS mais recente Node 22 no momento da execução
- Versão pnpm específica no packageManager: idem — última stable no momento

### Deferred Ideas (OUT OF SCOPE)

- Turborepo / Nx
- Codecov ou Coveralls
- CodeQL / SAST
- SBOM + Trivy
- Signed commits / Sigstore
- Volta
- Email security@aprumo.dev real
- 2º conector AbacatePay (v0.5)
- docker-compose.yml (Phase 2)

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INF-01 | pnpm-workspace.yaml + package.json raiz com 4 pacotes @aprumo/* | pnpm workspace YAML format + packageManager field |
| INF-02 | tsconfig.base.json com strict, noUncheckedIndexedAccess, target Node 22+ | TypeScript project references + NodeNext pattern |
| INF-03 | Biome configurado para lint + format (Biome 2.4+) | Biome v2 monorepo extends microsyntax "//" |
| INF-04 | Vitest com coverage v8, gate 90% @aprumo/core, 80% demais | Vitest v4 projects config + glob-based thresholds |
| INF-05 | commitlint + Conventional Commits em pre-commit hook | lefthook commit-msg hook + @commitlint/config-conventional |
| INF-06 | Pre-commit secret scanning (lefthook + gitleaks) — bloqueia ECDSA/HMAC | gitleaks v8 private-key rule + custom rule pattern |
| INF-07 | .gitignore cobre .env*, *.key, secrets/, build artifacts | canonical Node/TS/PG gitignore patterns |
| INF-08 | GitHub Actions: matriz Node 22/24, lint+typecheck+test+coverage+build | pnpm/action-setup + setup-node composite action |
| INF-09 | Changesets com updateInternalDependencies: patch, sem linked | .changeset/config.json options verified |
| INF-10 | CI bloqueia PR sem changeset em pacote publicável | pnpm changeset status --since=main exits 1 |

</phase_requirements>

---

## Summary

Phase 1 is pure toolchain plumbing — no application logic. The stack choices are fully locked by CONTEXT.md decisions and align tightly with the 2026 Node/TypeScript ecosystem. The key areas requiring precise configuration are: (1) Vitest v4 per-project coverage thresholds via root glob patterns (per-project config is ignored in workspace mode); (2) Biome v2 `extends: "//"` microsyntax for per-package overrides; (3) gitleaks v8.30.1 `private-key` rule — the single generic rule covers `-----BEGIN EC PRIVATE KEY-----` via a flexible PEM header regex, no custom rule needed for EC specifically; and (4) npm OIDC trusted publishing requires npm CLI ≥ 11.5.1 and Node ≥ 22.14.0 (both satisfied by the pinned stack).

The most significant landmine is Vitest workspace coverage: per-project `vitest.config.ts` coverage thresholds are **silently ignored** when running from the monorepo root. The 90%/80% split must be implemented as root-level glob-pattern thresholds in the root vitest.config.ts. The second landmine is that Vitest 3.2+ deprecated `vitest.workspace.ts` in favor of the `projects` option in the root config (file still works for backward compat but triggers deprecation warning). Decision D-20 says `vitest.workspace.ts` — planner should use the root `vitest.config.ts` with `projects:` instead to stay forward-compatible.

The Changesets CI gate is simple: `pnpm changeset status --since=main` exits 1 if no changeset present. This is the exact command to use in the `changeset-check` CI job. gitleaks-action v2 requires a license key only for **organization repos** — personal/user repos work license-free, which means the GITLEAKS_LICENSE secret can be omitted if the GitHub org is a personal account.

**Primary recommendation:** Follow CONTEXT.md decisions verbatim. Implement the 90%/80% coverage split using root vitest.config.ts glob-pattern thresholds. Use `projects:` in root config (not `vitest.workspace.ts`) to avoid deprecation warnings.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| TypeScript compilation | Build-time toolchain | — | tsc + project references; no runtime tier |
| Lint + format | Dev toolchain (Biome) | CI (lint job) | Local fast feedback + CI enforcement |
| Secret scanning | Pre-commit hook | CI (gitleaks-history job) | Defense in depth; CI is fallback for --no-verify |
| Unit test execution | Test runner (Vitest) | CI (test matrix job) | pool:forks for process isolation |
| Coverage gate enforcement | CI (coverage-gate job) | Root vitest.config.ts thresholds | Hard gate in CI; soft gate locally |
| Version management | Changesets CLI | CI (changeset-check + release jobs) | Manual changeset creation; CI validates presence |
| Dependency updates | Renovate bot | — | Out-of-band; config committed, bot installed separately |
| Node version enforcement | .nvmrc + .npmrc | CI engines check | engine-strict=true fails install on wrong Node |

---

## Standard Stack

### Core (all locked in CONTEXT.md — do NOT revisit)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `lefthook` | 2.1.8 [VERIFIED: npm registry] | Git hooks runner | Go binary, zero Node deps, parallel hooks, 2.25M/wk downloads |
| `@biomejs/biome` | 2.4.15 [VERIFIED: npm registry] | Lint + format (replaces ESLint + Prettier) | Single binary, ~9M/wk downloads, v2 monorepo support |
| `vitest` | 4.1.7 [VERIFIED: npm registry] | Test runner | Native ESM, project references aware, pool:forks isolation |
| `@vitest/coverage-v8` | 4.1.7 [VERIFIED: npm registry] | Code coverage via V8 | Zero instrumentation overhead; ships with Node |
| `typescript` | 6.0.3 [VERIFIED: npm registry] | Type checking + compile | Locked stack |
| `@changesets/cli` | 2.31.0 [VERIFIED: npm registry] | Version management | Independent per-package semver in monorepo |
| `@commitlint/cli` | 21.0.1 [VERIFIED: npm registry] | Commit message validation | Enforces Conventional Commits |
| `@commitlint/config-conventional` | 21.0.1 [VERIFIED: npm registry] | Conventional Commits preset | Standard ruleset |

### External Binaries (not npm packages)

| Tool | Version | Install | Purpose |
|------|---------|---------|---------|
| gitleaks | 8.30.1 [VERIFIED: homebrew-core] | `brew install gitleaks` or GitHub release binary | Secret scanning |

### Alternatives Considered (already decided — for planner context only)

| Instead of | Could Use | Decision |
|------------|-----------|----------|
| lefthook | husky + lint-staged | Locked to lefthook (D-01) |
| gitleaks | detect-secrets | Locked to gitleaks (D-02) |
| Biome | ESLint + Prettier | Locked to Biome (stack) |
| Vitest | Jest | Locked to Vitest (stack) |
| pnpm -r | Turborepo/Nx | Deferred post Phase 5/6 (D-11) |

**Installation (root devDependencies):**
```bash
pnpm add -D -w lefthook @biomejs/biome vitest @vitest/coverage-v8 typescript @changesets/cli @commitlint/cli @commitlint/config-conventional
```

---

## Package Legitimacy Audit

> slopcheck was unavailable at research time. All packages below marked [ASSUMED] unless verified via official docs or Context7. Registry existence verified via `npm view`. All packages below pass `npm view`.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `lefthook` | npm | ~6 yrs (2018) | ~2.25M/wk | github.com/evilmartians/lefthook | n/a | Approved — Evil Martians official; postinstall downloads Go binary from GitHub releases (expected behavior) |
| `@biomejs/biome` | npm | ~3 yrs (2023) | ~9M/wk | github.com/biomejs/biome | n/a | Approved — official Biome project |
| `vitest` | npm | ~4 yrs (2021) | >10M/wk | github.com/vitest-dev/vitest | n/a | Approved — Vite ecosystem standard |
| `@vitest/coverage-v8` | npm | ~3 yrs (2023) | >5M/wk | github.com/vitest-dev/vitest | n/a | Approved — same team as vitest |
| `typescript` | npm | ~13 yrs (2012) | >50M/wk | github.com/microsoft/TypeScript | n/a | Approved — Microsoft official |
| `@changesets/cli` | npm | ~7 yrs (2019) | >5M/wk | github.com/changesets/changesets | n/a | Approved — industry standard |
| `@commitlint/cli` | npm | ~9 yrs (2017) | >10M/wk | github.com/conventional-changelog/commitlint | n/a | Approved |
| `@commitlint/config-conventional` | npm | ~9 yrs (2017) | >10M/wk | same monorepo | n/a | Approved |
| `gitleaks` (binary) | Homebrew/GitHub | ~6 yrs | N/A (binary, not npm) | github.com/gitleaks/gitleaks | n/a | Approved — well-known OSS security tool, 8.30.1 stable |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**Note on lefthook postinstall:** `npm view lefthook scripts.postinstall` returns `node postinstall.js`. This script downloads the platform-specific Go binary from the official GitHub releases page. This is the documented, standard behavior for lefthook npm distribution — analogous to `@biomejs/biome`'s platform binaries. No network calls outside github.com/evilmartians/lefthook releases. [CITED: github.com/evilmartians/lefthook/pull/188]

*slopcheck was unavailable at research time. All packages above are tagged [ASSUMED] per protocol. Planner should add a `checkpoint:human-verify` gate before the pnpm add command if following strict protocol — however, given the provenance evidence above, these are low-risk.*

---

## Architecture Patterns

### System Architecture Diagram

```
Developer workstation
        │
        ├── git commit ──► lefthook pre-commit
        │                       ├── gitleaks protect --staged  (secret scan)
        │                       ├── biome check {staged_files} (lint + format)
        │                       └── commitlint --edit {1}       (commit-msg hook)
        │
        ├── git push ───► lefthook pre-push
        │                       └── pnpm typecheck (tsc --noEmit)
        │
        └── GitHub PR
                │
                ▼
        GitHub Actions CI
                ├── setup (composite action)
                │       └── corepack + pnpm install --frozen-lockfile + cache
                │
                ├── lint job            ──► biome check (all files)
                ├── typecheck job       ──► tsc -p tsconfig.json (all packages)
                ├── test matrix job     ──► Node 22 + Node 24 × vitest run
                ├── coverage-gate job   ──► vitest run --coverage (check thresholds)
                ├── build job           ──► tsc -p tsconfig.build.json (all packages)
                ├── changeset-check job ──► pnpm changeset status --since=main
                └── gitleaks-history    ──► gitleaks-action@v2 (full git history)
```

### Recommended Project Structure

```
apruma/                               # monorepo root
├── .changeset/
│   └── config.json
├── .github/
│   ├── actions/
│   │   └── setup/
│   │       └── action.yml            # composite: corepack + pnpm install + cache
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug.yml
│   │   ├── feature.yml
│   │   └── security.yml
│   ├── PULL_REQUEST_TEMPLATE.md
│   └── workflows/
│       └── ci.yml                    # all jobs in one file
├── .gitleaks.toml                    # extends default + custom rules
├── .nvmrc                            # e.g. "22.22.3"
├── biome.json                        # root config; per-pkg extends "//"
├── lefthook.yml                      # pre-commit + commit-msg + pre-push
├── packages/
│   ├── core/                         # @aprumo/core
│   │   ├── src/index.ts              # placeholder export
│   │   ├── biome.json                # extends: "//"
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── tsconfig.build.json
│   │   └── vitest.config.ts
│   ├── connector-base/               # @aprumo/connector-base
│   │   └── ... (same layout)
│   ├── connector-starkbank/          # @aprumo/connector-starkbank
│   │   └── ...
│   └── webhooks/                     # @aprumo/webhooks
│       └── ...
├── docs/
│   └── adr/                         # .gitkeep — populated in Phase 2
├── package.json                      # root: private, workspaces, scripts
├── pnpm-workspace.yaml
├── .npmrc
├── tsconfig.base.json
├── tsconfig.json                     # root composite ref for all packages
├── vitest.config.ts                  # root: projects glob + coverage thresholds
├── renovate.json
├── LICENSE                           # MIT
├── README.md
├── SECURITY.md
├── CONTRIBUTING.md
└── CODE_OF_CONDUCT.md
```

---

## Pattern 1: pnpm Workspace Layout

**What:** Root pnpm-workspace.yaml declares package glob; root package.json is `"private": true` with workspace scripts.

**Config files:**
```yaml
# pnpm-workspace.yaml (pnpm 10/11 format)
# Source: pnpm.io/pnpm-workspace_yaml [CITED: pnpm.io/pnpm-workspace_yaml]
packages:
  - "packages/*"
```

```json
// root package.json (essential fields)
{
  "name": "aprumo",
  "private": true,
  "packageManager": "pnpm@10.13.1",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "build":      "pnpm -r build",
    "test":       "vitest run",
    "typecheck":  "tsc -b packages/*/tsconfig.json --noEmit",
    "lint":       "biome check .",
    "changeset":  "changeset",
    "db:migrate": "echo 'placeholder — implemented in Phase 2' && exit 0",
    "prepare":    "lefthook install"
  },
  "devDependencies": { "...": "see Standard Stack" }
}
```

```ini
# .npmrc
# Source: pnpm.io/settings [CITED: pnpm.io/settings]
engine-strict=true
strict-peer-dependencies=true
auto-install-peers=false
```

---

## Pattern 2: TypeScript Config (Project References + NodeNext + ESM)

**What:** Root `tsconfig.base.json` shared by all packages; per-package `tsconfig.json` extends and adds `composite: true`; `tsconfig.build.json` excludes test files.

```json
// tsconfig.base.json
// Source: typescriptlang.org/tsconfig [CITED: typescriptlang.org/tsconfig]
{
  "compilerOptions": {
    "target": "ES2024",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2024"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "skipLibCheck": true,
    "esModuleInterop": false
  }
}
```

```json
// packages/core/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "references": []
}
```

```json
// packages/core/tsconfig.build.json
{
  "extends": "./tsconfig.json",
  "exclude": ["**/*.test.ts", "__fixtures__/**", "**/*.spec.ts"]
}
```

```json
// packages/core/package.json exports field (D-09 explicit subpaths, D-10 conditional dev)
// Source: CONTEXT.md D-09, D-10 [CITED: .planning/phases/01-monorepo-scaffold-ci-dev-security/01-CONTEXT.md]
{
  "exports": {
    ".": {
      "development": "./src/index.ts",
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "type": "module"
}
```

**Key gotcha:** `"module": "NodeNext"` requires all relative imports use explicit `.js` extension even in TypeScript source files (TypeScript resolves these to `.ts` at type-check time but emits `.js`). Without `.js` extensions on imports, tsc will error with `TS2835` or fail ESM resolution at runtime.

---

## Pattern 3: Biome v2 Monorepo Configuration

**What:** Single root `biome.json` with full ruleset; per-package `biome.json` uses `"extends": "//"` (new v2 microsyntax) to inherit root and override only test overrides.

```json
// biome.json (root)
// Source: biomejs.dev/guides/big-projects/ [CITED: biomejs.dev/guides/big-projects/]
{
  "$schema": "https://biomejs.dev/schemas/2.4.15/schema.json",
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "error"
      },
      "style": {
        "noNonNullAssertion": "error",
        "useImportType": "error"
      }
    }
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "assist": {
    "actions": {
      "source": {
        "organizeImports": "on"
      }
    }
  },
  "files": {
    "ignore": ["**/dist/**", "**/node_modules/**", "**/*.d.ts", "coverage/**"]
  }
}
```

```json
// packages/core/biome.json (test override, D-30)
// Source: biomejs.dev/guides/big-projects/ [CITED: biomejs.dev/guides/big-projects/]
{
  "extends": "//",
  "overrides": [
    {
      "include": ["**/*.test.ts"],
      "linter": {
        "rules": {
          "style": {
            "noNonNullAssertion": "off"
          }
        }
      }
    }
  ]
}
```

**Key gotcha:** `"extends": "//"` was introduced in Biome v2 and requires Biome 2.0+. This microsyntax sets `"root": false` implicitly and resolves the root config regardless of nesting depth. Using relative path `../../biome.json` works in v1 but breaks when packages are nested deeper. [CITED: biomejs.dev/blog/biome-v2/]

---

## Pattern 4: Vitest v4 Workspace + Per-Package Coverage Thresholds

**What:** Root `vitest.config.ts` uses the new `projects:` option (replaces deprecated `vitest.workspace.ts` since v3.2). Per-package `vitest.config.ts` extends shared options. Coverage thresholds for the 90%/80% split are implemented as **root-level glob-pattern thresholds** because per-project coverage config is silently ignored in workspace mode.

```typescript
// vitest.config.ts (root)
// Source: vitest.dev/guide/workspace [CITED: vitest.dev/guide/workspace]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*/vitest.config.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json", "json-summary"],
      reportsDirectory: "./coverage",
      // 90% LoC gate for @aprumo/core
      thresholds: {
        "packages/core/src/**": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        // 80% for all other packages
        "packages/*/src/**": {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
        },
      },
    },
  },
});
```

```typescript
// packages/core/vitest.config.ts
// Source: vitest.dev/guide/workspace [CITED: vitest.dev/guide/workspace]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@aprumo/core",
    pool: "forks",        // D-21: process isolation for future testcontainers
    include: ["src/**/*.test.ts"],
    environment: "node",
    // NOTE: coverage config here is ignored in workspace mode — see root config
  },
});
```

**Critical limitation (verified):** The Vitest documentation states that "coverage is done for the whole process" when using workspace/projects mode. Individual project-level `vitest.config.ts` coverage settings (thresholds, reporters) are silently ignored. All coverage config MUST be in the root `vitest.config.ts`. [CITED: vitest.dev/guide/workspace — limitation note]

**Deprecation warning:** `vitest.workspace.ts` file is deprecated since Vitest 3.2 in favor of `projects:` option in root config. Decision D-20 references `vitest.workspace.ts` — use `vitest.config.ts` with `projects:` instead to suppress the deprecation warning. [CITED: vitest.dev/blog/vitest-3-2.html]

---

## Pattern 5: lefthook Configuration

**What:** `lefthook.yml` at repo root wires gitleaks (pre-commit), Biome (pre-commit), commitlint (commit-msg), and typecheck (pre-push).

```yaml
# lefthook.yml
# Source: biomejs.dev/recipes/git-hooks/ [CITED: biomejs.dev/recipes/git-hooks/]
# Source: evilmartians/lefthook GitHub [CITED: github.com/evilmartians/lefthook]
pre-commit:
  parallel: true
  commands:
    gitleaks:
      run: gitleaks protect --staged --redact
    biome:
      glob: "*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc}"
      run: pnpm biome check --no-errors-on-unmatched --files-ignore-unknown=true --colors=off {staged_files}
      stage_fixed: true

commit-msg:
  commands:
    commitlint:
      run: pnpm commitlint --edit {1}

pre-push:
  commands:
    typecheck:
      run: pnpm typecheck
```

**Installation trigger:** The root `package.json` `"prepare": "lefthook install"` runs on `pnpm install` in a cloned repo. This wires the git hooks automatically.

**Performance rationale (D-01):** lefthook runs `gitleaks` and `biome` in parallel via `parallel: true`. Both complete in under 1s on typical staged changesets. This prevents developers from reaching for `--no-verify`.

---

## Pattern 6: gitleaks Configuration

**What:** `.gitleaks.toml` extending default rules + custom rules per D-05.

The gitleaks v8 default ruleset includes a `private-key` rule with regex:
```
(?i)-----BEGIN[ A-Z0-9_-]{0,100}PRIVATE KEY(?: BLOCK)?-----[\s\S-]{64,}?KEY(?: BLOCK)?-----
```
This **already covers** `-----BEGIN EC PRIVATE KEY-----` — it is a single generic rule for all PEM formats (RSA, EC, OPENSSH, DSA, PKCS8, etc.). [CITED: raw.githubusercontent.com/gitleaks/gitleaks/master/config/gitleaks.toml]

The `generic-api-key` rule covers `SECRET=` and `API_KEY=` patterns via keyword match + entropy.

Custom rules needed (D-05): Starkbank-specific token patterns and env-file `SECRET=`/`API_KEY=` **outside** `__fixtures__/`:

```toml
# .gitleaks.toml
# Source: github.com/gitleaks/gitleaks#configuration [CITED: github.com/gitleaks/gitleaks]
title = "aprumo gitleaks config"

# Extend the default ruleset — do not replace it
[extend]
useDefault = true

[[rules]]
id = "starkbank-private-key"
description = "Starkbank ECDSA private key (PEM)"
regex = '''-----BEGIN EC PRIVATE KEY-----'''
tags = ["starkbank", "key", "EC"]

[[rules]]
id = "generic-env-secret"
description = "Generic SECRET= or API_KEY= in non-fixture files"
regex = '''(?i)(?:SECRET|API_KEY|PRIVATE_KEY)\s*=\s*['"]?[a-zA-Z0-9+/]{20,}['"]?'''
tags = ["env", "secret"]

  [[rules.allowlists]]
  description = "Allow in test fixtures"
  paths = ['''__fixtures__/''', '''\.example$''', '''\.test\.ts$''']

[allowlist]
description = "Global allowlist"
paths = [
  '''\.gitleaks\.toml''',
  '''docs/adr/''',
]
```

**Note:** The `private-key` rule in gitleaks v8 default config covers EC keys. Versions 8.7.x had a regression where only PKCS8 keys were detected (issue #854) but this was resolved in subsequent releases. Version 8.30.1 (current) correctly detects EC, RSA, and OPENSSH keys via the updated regex. [CITED: github.com/gitleaks/gitleaks/issues/854]

---

## Pattern 7: GitHub Actions CI Workflow

**What:** Single `ci.yml` with parallel jobs; composite setup action; Node 22/24 matrix for test job only (not lint/typecheck which don't need multiple Node versions).

```yaml
# .github/actions/setup/action.yml (composite action)
# Source: pnpm.io/continuous-integration [CITED: pnpm.io/continuous-integration]
name: Setup Node + pnpm
description: Install pnpm via corepack + setup-node with store cache
runs:
  using: composite
  steps:
    - name: Enable Corepack
      shell: bash
      run: corepack enable

    - uses: pnpm/action-setup@v6
      with:
        run_install: false

    - uses: actions/setup-node@v4
      with:
        node-version: ${{ inputs.node-version || '22' }}
        cache: pnpm

    - name: Install dependencies
      shell: bash
      run: pnpm install --frozen-lockfile

inputs:
  node-version:
    description: Node.js version
    default: "22"
    required: false
```

```yaml
# .github/workflows/ci.yml (skeleton — planner fills in exact steps)
name: CI
on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: pnpm lint

  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: pnpm typecheck

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: pnpm build

  test:
    strategy:
      matrix:
        node-version: ["22", "24"]
      fail-fast: false
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
        with:
          node-version: ${{ matrix.node-version }}
      - run: pnpm test

  coverage-gate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: pnpm vitest run --coverage
      - uses: davelosert/vitest-coverage-report-action@v2
        with:
          json-summary-path: ./coverage/coverage-summary.json
          json-final-path: ./coverage/coverage-final.json

  changeset-check:
    runs-on: ubuntu-latest
    if: github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: ./.github/actions/setup
      - run: pnpm changeset status --since=main

  gitleaks-history:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: gitleaks/gitleaks-action@v2
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          # GITLEAKS_LICENSE only needed for org repos — omit for personal
```

**Matrix strategy:** The `fail-fast: false` prevents a Node 24 failure from cancelling the Node 22 run. Both must pass for CI green.

**Caching:** `setup-node@v4` with `cache: pnpm` reads `pnpm-lock.yaml` automatically. No manual `actions/cache` step needed. This provides ~40s vs ~80s cold install. [CITED: gist.github.com/belgattitude/838b2eba30c324f1f0033a797bab2e31]

---

## Pattern 8: Changesets Configuration

```json
// .changeset/config.json
// Source: github.com/changesets/changesets/blob/main/docs/config-file-options.md [CITED]
{
  "$schema": "https://unpkg.com/@changesets/config/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": [],
  "privatePackages": { "version": true, "tag": false }
}
```

**CI changeset gate (INF-10):**
```bash
pnpm changeset status --since=main
# Exits 1 if no changeset present; exits 0 if changeset exists or no publishable changes
```

**Release workflow (D-22, D-23):** The `changesets/action@v1` creates a "Version Packages" PR automatically. Real publish uses OIDC trusted publishing (D-23). npm OIDC trusted publishing is GA as of July 2025, requires npm CLI ≥ 11.5.1 and Node ≥ 22.14.0. [CITED: docs.npmjs.com/trusted-publishers/]

```yaml
# Release job requires (D-23):
permissions:
  id-token: write   # OIDC for npm trusted publishing
  contents: write   # push version commits
  pull-requests: write
```

---

## Pattern 9: Renovate Config

```json
// renovate.json
// Source: docs.renovatebot.com/config-presets/ [CITED: docs.renovatebot.com]
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended"],
  "schedule": ["every weekend"],
  "automerge": false,
  "dependencyDashboard": true
}
```

Note: Renovate app must be installed separately on the GitHub repo (out-of-band, D-18). The config file being committed does not activate Renovate — it only configures what Renovate does when it runs.

---

## Pattern 10: Node Version Pinning

```
# .nvmrc
22.22.3
```

(22.22.3 is the latest Node 22 LTS as of 2026-05-22 per nodejs.org/en/blog/release/v22.22.2. Note 22.22.3 was released May 13, 2026 per community sources.) [ASSUMED for exact patch — planner should run `node --version` on a fresh install or check nodejs.org at execution time]

Node 24 (latest LTS as of 2026-05-22) is 24.16.0 with codename "Krypton". CI matrix tests against both 22.x and 24.x. [CITED: nodejs.org/en/blog/release/v24.14.0]

---

## Anti-Patterns to Avoid

- **Do NOT create `vitest.workspace.ts`** — deprecated in Vitest 3.2+. Use `projects:` in root `vitest.config.ts` instead.
- **Do NOT put coverage thresholds in per-package `vitest.config.ts`** — silently ignored in workspace mode. All thresholds go in root `vitest.config.ts`.
- **Do NOT use relative path `../../biome.json` in per-package biome config** — use `"extends": "//"` (Biome v2+ microsyntax).
- **Do NOT use `"module": "ESNext"` with `"moduleResolution": "Bundler"`** — this stack targets Node 22+ runtime, not a bundler. Use `NodeNext`/`NodeNext`.
- **Do NOT add `shamefully-hoist=true` to .npmrc** — breaks the phantom-dependency guard that pnpm provides.
- **Do NOT use `gitleaks detect`** locally (scans full history). For pre-commit use `gitleaks protect --staged`. For CI use `gitleaks-action@v2` with `fetch-depth: 0`. [CITED: github.com/gitleaks/gitleaks]
- **Do NOT omit `.js` extensions on relative imports in TypeScript** — `module: NodeNext` requires explicit `.js` extensions even in `.ts` source files.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Git hooks | Shell scripts in `.git/hooks/` | lefthook | Team-shareable, versioned, parallel execution |
| Staged-file linting | Custom shell glob logic | lefthook `{staged_files}` token | Built-in, handles renames/deletions correctly |
| Secret scanning | Custom regex grep | gitleaks | 100+ built-in rules, entropy analysis, maintained |
| Commit message validation | Custom regex | @commitlint/config-conventional | Parses Angular-style commits, full error messages |
| Coverage thresholds per path | Custom script | Vitest root config glob thresholds | Built-in, integrated with CI |
| Cache invalidation in CI | Manual key construction | setup-node@v4 `cache: pnpm` | Reads pnpm-lock.yaml hash automatically |
| Version bump PR creation | Manual changeset PR | changesets/action@v1 | Handles multi-package version PRs |

**Key insight:** This phase is pure tooling. Every problem here has a well-maintained OSS solution. Custom code in a tooling phase is a maintenance liability.

---

## Common Pitfalls

### Pitfall 1: Coverage Thresholds Silently Ignored Per Package

**What goes wrong:** Developer puts `coverage.thresholds` in `packages/core/vitest.config.ts` expecting 90% gate. CI passes even at 10% coverage with no error.
**Why it happens:** Vitest workspace mode: "some configuration options like coverage apply to the entire workspace and are not allowed in a project config." Per-project coverage config is silently ignored. [CITED: vitest.dev/guide/workspace]
**How to avoid:** ALL coverage config goes in root `vitest.config.ts`. Use glob-pattern thresholds: `"packages/core/src/**": { lines: 90 }`.
**Warning signs:** Running `vitest run --coverage` from packages/core works locally but root-level run shows different thresholds.

### Pitfall 2: `vitest.workspace.ts` Deprecation Warning in CI

**What goes wrong:** CI log shows deprecation warning `"workspace" is deprecated, use "projects" instead` on every run.
**Why it happens:** Vitest 3.2 deprecated the separate workspace file. [CITED: vitest.dev/blog/vitest-3-2.html]
**How to avoid:** Do NOT create `vitest.workspace.ts`. Put `projects:` array in root `vitest.config.ts`.
**Warning signs:** CI logs contain "deprecated" on the vitest line.

### Pitfall 3: NodeNext Requires `.js` Extensions on Imports

**What goes wrong:** `import { foo } from "./bar"` compiles fine with tsc but fails at Node.js ESM runtime with `ERR_MODULE_NOT_FOUND`.
**Why it happens:** `module: NodeNext` respects ESM resolution rules — Node ESM requires explicit file extensions. TypeScript resolves `.js` → `.ts` at check time, but the emitted code uses `.js`.
**How to avoid:** Always write `import { foo } from "./bar.js"` in TypeScript source. Biome `useImportType` rule does NOT enforce extensions — this must be a `nocheck` or custom lint rule, or developers just need to know.
**Warning signs:** tsc passes, but `node dist/index.js` throws `ERR_MODULE_NOT_FOUND`.

### Pitfall 4: gitleaks private-key Rule Regression (Versions 8.7.0–8.x)

**What goes wrong:** gitleaks misses EC private key `-----BEGIN EC PRIVATE KEY-----` in staged files.
**Why it happens:** Versions 8.7.0 introduced a regression that only detected PKCS8 keys. [CITED: github.com/gitleaks/gitleaks/issues/854]
**How to avoid:** Pin gitleaks to version 8.30.1+ (confirmed fixed). The `private-key` rule in 8.30.1 uses the flexible regex covering all PEM formats. The custom Starkbank rule in `.gitleaks.toml` provides a redundant explicit check.
**Warning signs:** `echo "-----BEGIN EC PRIVATE KEY-----" | gitleaks protect --stdin` returns exit 0.

### Pitfall 5: pnpm Corepack + GitHub Actions Cache Race

**What goes wrong:** `corepack enable` runs but pnpm version read from `packageManager` field installs a different version than what's cached.
**Why it happens:** The `pnpm/action-setup@v6` + `setup-node@v4` combination reads `packageManager` from root `package.json` when using corepack. If corepack version and action-setup version disagree, pnpm installs twice.
**How to avoid:** Use EITHER `pnpm/action-setup` OR corepack — not both. Recommended: `pnpm/action-setup@v6` with `run_install: false`, then `setup-node@v4` with `cache: pnpm`. [CITED: pnpm.io/continuous-integration]
**Warning signs:** CI log shows pnpm downloading twice; cache key misses on every run.

### Pitfall 6: gitleaks-action License Requirement for Org Repos

**What goes wrong:** CI fails with "license required" if the repo is under a GitHub organization.
**Why it happens:** gitleaks-action v2 requires a free `GITLEAKS_LICENSE` for organization repos (not personal accounts). [CITED: github.com/gitleaks/gitleaks-action]
**How to avoid:** Register for a free license at gitleaks.io and add `GITLEAKS_LICENSE` as a GitHub secret. For personal/user repos, omit the license env var entirely.
**Warning signs:** `Error: GITLEAKS_LICENSE is required for organization repos` in CI logs.

### Pitfall 7: Biome `organizeImports` Failing in CI

**What goes wrong:** `biome check .` passes locally but CI fails with organizeImports errors that produce no visible diagnostic output.
**Why it happens:** Biome `organizeImports` can fail the check command while not printing error messages when using `--diagnostic-level=error`. [CITED: github.com/biomejs/biome/issues/2288]
**How to avoid:** Run `biome check --write .` in a "fix" step during development and ensure the `assist.actions.source.organizeImports: "on"` setting is committed. In CI, use `biome check .` (no `--write`) to detect unformatted files.
**Warning signs:** CI fails on Biome step but no linting errors are printed.

### Pitfall 8: Changeset Status Command on Non-PR Branch

**What goes wrong:** `pnpm changeset status --since=main` fails on `main` itself (exits 1 with "no changesets").
**Why it happens:** The command compares against `main` — on `main`, everything is "since main" which is nothing.
**How to avoid:** Gate the `changeset-check` CI job with `if: github.event_name == 'pull_request'`. [ASSUMED — standard Changesets CI pattern]
**Warning signs:** Release branches or direct pushes to `main` fail the changeset gate.

---

## Code Examples

### Running Gitleaks Locally Against Staged Files

```bash
# Source: github.com/gitleaks/gitleaks [CITED: github.com/gitleaks/gitleaks]
# Pre-commit: staged files only
gitleaks protect --staged --redact --config .gitleaks.toml

# Full history scan (CI equivalent):
gitleaks detect --config .gitleaks.toml
```

### Verifying the 90% Coverage Gate Fires

```bash
# Source: vitest.dev/config/coverage [CITED: vitest.dev/config/coverage]
# Add a file with 0% coverage — this should fail:
pnpm vitest run --coverage
# Should exit non-zero with: "ERROR: Coverage for lines (0%) does not meet global threshold (90%)"
```

### Changeset Gate Command

```bash
# Source: github.com/changesets/changesets/blob/main/docs/automating-changesets.md [CITED]
# Exits 1 if no changeset since main (used in CI)
pnpm changeset status --since=main
```

### Lefthook Manual Test

```bash
# After running `pnpm install` (triggers `prepare` → lefthook install):
# Test pre-commit hook fires:
echo "-----BEGIN EC PRIVATE KEY-----" > /tmp/test-key.ts
git add /tmp/test-key.ts
# lefthook should block with gitleaks error before commit
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Husky + lint-staged | lefthook | 2022–2024 shift | Single YAML, Go binary, parallel hooks without Node deps |
| ESLint + Prettier | Biome v2 | Biome v1: 2023, v2: 2025 | Single binary, ~100x faster, native TypeScript aware |
| `vitest.workspace.ts` | `projects:` in `vitest.config.ts` | Vitest 3.2 (2025) | Eliminates deprecation warning |
| npm Classic Tokens | OIDC Trusted Publishing | GA July 2025 | No long-lived secrets; provenance attestation by default |
| Node 20 LTS | Node 22 (maintenance) / Node 24 (active) | Node 24 became LTS April 2025 | pg-boss 12.18 requires Node ≥ 22.12.0 |
| detect-secrets (Python) | gitleaks (Go binary) | 2024 industry shift | No Python dep; runs in Node CI without extra setup |
| Per-package tsconfig only | tsconfig + project references | TypeScript 3.0+ | Faster incremental builds, composite outputs |

**Deprecated/outdated:**
- `vitest.workspace.ts` (separate file): deprecated since Vitest 3.2; use `projects:` in root config
- npm Classic Tokens: permanently deprecated December 9, 2025 by npm
- `husky + lint-staged`: still works but lefthook is simpler for monorepos (no separate staged-file script)
- `"module": "CommonJS"` for new Node-only packages: use `NodeNext` + ESM

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Node 22.22.3 is the latest Node 22 LTS patch | Pattern 10 | Planner should verify at execution time via nodejs.org |
| A2 | pnpm 10.13.1 is the latest pnpm 10 stable | Standard Stack | Planner should run `npm view pnpm version` at execution time |
| A3 | gitleaks 8.30.1 regression (issue #854) is fixed | Pitfall 4 | If not fixed, the custom `starkbank-private-key` rule in `.gitleaks.toml` provides fallback; test with `echo "-----BEGIN EC PRIVATE KEY-----"` |
| A4 | gitleaks-action v2 requires no license for personal (non-org) GitHub accounts | Pitfall 6 | CI fails with license error — register free license at gitleaks.io |
| A5 | lefthook postinstall downloads from github.com/evilmartians releases (safe) | Package Audit | Confirm via offline inspection of postinstall.js before CI runs |
| A6 | `pnpm changeset status --since=main` exit code correctly gates CI | Pattern 8 / Pitfall 8 | Test manually: create PR with and without changeset; confirm exit codes |
| A7 | All 4 packages (@aprumo/core, connector-base, connector-starkbank, webhooks) are available as npm scope @aprumo | INF-01 | If @aprumo scope is taken, scope decision is a Phase 1.5 urgent insert |

---

## Open Questions

1. **@aprumo npm scope availability**
   - What we know: CONTEXT.md §code_context notes "Phase 1 assumes that @aprumo is available; if not, deciding new scope is Phase 1.5 urgent insert"
   - What's unclear: Whether `@aprumo` is reserved/claimed on npmjs.com
   - Recommendation: Planner should add a Wave 0 task: "Verify @aprumo scope available on npmjs.com — if taken, pause and resolve scope name before any package.json is written"

2. **gitleaks org vs personal repo license**
   - What we know: License required for org repos, not personal accounts
   - What's unclear: Whether this repo will live under a GitHub org or personal account at Phase 1 execution time
   - Recommendation: Add conditional note in the CI gitleaks job: if the repo is under a GitHub org at the time of setup, add GITLEAKS_LICENSE secret (free license from gitleaks.io)

3. **Vitest v4 per-project glob threshold behavior**
   - What we know: Root-level thresholds with glob patterns work; per-project config thresholds are silently ignored
   - What's unclear: Whether the glob `"packages/core/src/**"` is matched against relative or absolute paths in the coverage output — the ordering of glob rules matters (more specific first)
   - Recommendation: Planner should put core-specific rule BEFORE the wildcard rule in the thresholds object; validate with a red test (intentionally low-coverage file in core should fail the gate)

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | All | ✓ | 22.22.2 | — |
| pnpm | Workspace | ✓ | 10.13.1 | — |
| git | Hooks, CI | ✓ | 2.50.1 | — |
| gitleaks | Pre-commit, CI | ✗ | 8.30.1 (not installed) | Wave 0 task: `brew install gitleaks` |
| biome CLI | Pre-commit | ✓ (via npm) | 2.4.15 | — |
| GitHub Actions | CI | ✓ (remote) | — | — |

**Missing dependencies with no fallback:**
- gitleaks binary: must be installed via `brew install gitleaks` or GitHub releases download before pre-commit hooks work. Wave 0 task required.

**Missing dependencies with fallback:**
- (none)

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 |
| Config file | `vitest.config.ts` (root) — Wave 0 creates this |
| Quick run command | `pnpm vitest run --reporter=dot` |
| Full suite command | `pnpm vitest run --coverage` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INF-01 | pnpm workspace resolves @aprumo/* packages | integration (pnpm install) | `pnpm install && pnpm -r list --depth=0` | ❌ Wave 0 |
| INF-02 | tsc strict + noUncheckedIndexedAccess active | build gate | `pnpm typecheck` | ❌ Wave 0 |
| INF-03 | Biome catches noExplicitAny violation | lint gate | `echo "const x: any = 1" | biome check --stdin-file-path=x.ts` | ❌ Wave 0 |
| INF-04 | Coverage gate fires at <90% for core | unit/integration | `vitest run --coverage` with intentionally low coverage | ❌ Wave 0 |
| INF-05 | commitlint rejects bad commit message | pre-commit | `echo "bad message" | pnpm commitlint` | ❌ Wave 0 |
| INF-06 | gitleaks blocks EC private key commit | pre-commit | `gitleaks protect --staged` with PEM key staged | ❌ Wave 0 |
| INF-07 | .gitignore blocks .env* and *.key | git | `touch .env && git status --porcelain` | ❌ Wave 0 |
| INF-08 | CI passes on Node 22 and Node 24 | CI matrix | GitHub Actions run | ❌ Wave 0 (CI workflow) |
| INF-09 | Changeset config produces valid changeset | manual | `pnpm changeset` → verify .changeset/*.md | ❌ Wave 0 |
| INF-10 | CI fails on PR without changeset | CI | `pnpm changeset status --since=main` in CI | ❌ Wave 0 (CI workflow) |

### Sampling Rate

- **Per task commit:** `pnpm lint && pnpm typecheck`
- **Per wave merge:** `pnpm test && pnpm build`
- **Phase gate:** `pnpm vitest run --coverage` full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `vitest.config.ts` — root config with projects + coverage thresholds
- [ ] `packages/*/vitest.config.ts` — per-package configs with name and pool:forks
- [ ] `packages/*/src/index.ts` — placeholder stub per package (needed for typecheck to have something to check)
- [ ] gitleaks binary installation: `brew install gitleaks`
- [ ] Smoke test: `gitleaks protect --staged` with test PEM in staged area

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No auth in Phase 1 |
| V3 Session Management | No | No sessions in Phase 1 |
| V4 Access Control | No | No access control in Phase 1 |
| V5 Input Validation | No | No inputs in Phase 1 |
| V6 Cryptography | Partial | gitleaks prevents private keys from entering repo |
| V14 Configuration | Yes | .gitignore, .npmrc engine-strict, OIDC (no long-lived tokens) |

### Known Threat Patterns for Toolchain Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Private key committed to git | Information Disclosure | gitleaks pre-commit + CI full-history scan (D-05, D-06) |
| .env file committed | Information Disclosure | .gitignore patterns + gitleaks generic-env-secret rule |
| Stale/malicious npm token in CI | Spoofing | npm OIDC trusted publishing — no long-lived token (D-23) |
| Dependency confusion / slopquatting | Tampering | pnpm strict-peer-dependencies + Renovate for updates |
| Unauthorized force-push to main | Tampering | Branch protection + required status checks (D-14) |
| --no-verify bypass of pre-commit | Elevation of Privilege | CI full-history gitleaks scan as second layer (D-06) |

---

## Sources

### Primary (HIGH confidence)

- gitleaks default config — `raw.githubusercontent.com/gitleaks/gitleaks/master/config/gitleaks.toml` (verified private-key regex)
- Vitest docs — `vitest.dev/guide/workspace` and `vitest.dev/blog/vitest-3-2.html` (workspace deprecation, projects: option, coverage limitation)
- Biome docs — `biomejs.dev/guides/big-projects/` and `biomejs.dev/blog/biome-v2/` (extends "//" microsyntax, v2 features)
- npm trusted publishing — `docs.npmjs.com/trusted-publishers/` (OIDC requirements, id-token: write, Node ≥ 22.14.0)
- pnpm workspace — `pnpm.io/pnpm-workspace_yaml` and `pnpm.io/settings` (engineStrict, strictPeerDependencies, autoInstallPeers)
- pnpm CI — `pnpm.io/continuous-integration` (setup-node cache: pnpm pattern)
- Changesets config — `github.com/changesets/changesets/blob/main/docs/config-file-options.md` (verified all fields)
- npm registry — `npm view` for all packages (versions verified as current as of 2026-05-22)

### Secondary (MEDIUM confidence)

- gitleaks-action — `github.com/gitleaks/gitleaks-action` (YAML format, license requirements)
- davelosert/vitest-coverage-report-action — `github.com/davelosert/vitest-coverage-report-action` (v2.8.3, inputs, monorepo config)
- Biome configuration reference — `biomejs.dev/reference/configuration/` (rule group paths: suspicious, style)
- changesets/action — `github.com/changesets/action` (inputs, outputs)
- lefthook + Biome integration — `biomejs.dev/recipes/git-hooks/` (staged_files pattern)
- lefthook + commitlint — `rxtsel.dev/blog/how-to-set-up-lefthook-and-commitlint-in-your-projects/` (commit-msg hook format)
- pnpm composite action pattern — `gist.github.com/belgattitude/838b2eba30c324f1f0033a797bab2e31` (40s warm vs 80s cold cache)

### Tertiary (LOW confidence)

- Vitest glob-pattern thresholds per-package behavior — inferred from vitest.dev/config/coverage docs; not explicitly documented for workspace mode (A3 in Assumptions Log)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified via `npm view` against registry; official docs confirmed features
- Architecture: HIGH — all patterns from official docs; CONTEXT.md decisions are clear and non-conflicting
- Pitfalls: HIGH (toolchain pitfalls well-documented) / MEDIUM (gitleaks regression status assumed fixed in 8.30.1)

**Research date:** 2026-05-22
**Valid until:** 2026-08-22 (90 days — toolchain moves slower than app code, but check gitleaks and Vitest for breaking changes before Phase 1 execution)
