# Phase 1: Monorepo Scaffold + CI + Dev Security - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 1-Monorepo Scaffold + CI + Dev Security
**Areas discussed:** Pre-commit stack + scope, Build/distribuição por pacote, Orquestrador de tarefas monorepo, Escopo de housekeeping no scaffold, TypeScript + Vitest config shape, Changesets release workflow, Coverage reporting + CI artifacts, Node/pnpm pinning, Biome config, .gitleaks.toml custom rules, .npmrc / pnpm config

---

## Pre-commit Stack + Scope

### Hook runner

| Option | Description | Selected |
|--------|-------------|----------|
| lefthook | YAML único, paralelismo nativo, sem dep Node | ✓ |
| husky | Mais popular Node, atrelado a npm install | |
| simple-git-hooks | Zero-dep minimalista; menos flexível | |

**User's choice:** lefthook (Recommended)

### Secret scanner

| Option | Description | Selected |
|--------|-------------|----------|
| gitleaks | Binário Go, sem dep Python, regras TOML | ✓ |
| detect-secrets | Padrão SUMMARY; exige Python | |
| trufflehog v3 | Verifica chaves contra APIs ao vivo; mais pesado | |

**User's choice:** gitleaks (Recommended)

### Pre-commit hook scope

| Option | Description | Selected |
|--------|-------------|----------|
| scan + commitlint + Biome (staged) | Sub-segundo; typecheck/test pra CI | ✓ |
| Mínimo: gitleaks + commitlint | Máxima velocidade | |
| Full: + typecheck + vitest related | Garantia local; >10s; estimula skip | |
| Você decide | Planner valida com benchmarks reais | |

**User's choice:** scan+commitlint+Biome staged (Recommended)

### Pre-push gate

| Option | Description | Selected |
|--------|-------------|----------|
| Sem pre-push, só CI | Push rápido; CI é gate único | |
| Pre-push: typecheck | Catch erros TS antes do PR | ✓ |
| Pre-push: typecheck + vitest --changed | Máxima rede; +20-60s | |

**User's choice:** Pre-push: typecheck

---

## Build/Distribuição por Pacote

### Build tool

| Option | Description | Selected |
|--------|-------------|----------|
| tsc + project references | Zero deps, monorepo-aware, tipos nativos | ✓ |
| tsup | esbuild rápido, dual ESM/CJS | |
| unbuild | Config mínima ESM-first | |

**User's choice:** tsc + project references (Recommended)

### Module format

| Option | Description | Selected |
|--------|-------------|----------|
| ESM-only | Node 22+; sem dual-package hazard | ✓ |
| Dual ESM + CJS | Compat máxima; risco de instâncias duplicadas | |
| CJS-only | Anti-pattern 2026 | |

**User's choice:** ESM-only (Recommended)

### Exports shape

| Option | Description | Selected |
|--------|-------------|----------|
| Subpaths declaradas | Lista explícita; encapsulamento + tree-shake | ✓ |
| Single entry só "." | Bloqueia contract suite separado | |
| Wildcard "./*" | Vaza internals | |

**User's choice:** Subpaths declaradas (Recommended)

### Dev resolution cross-package

| Option | Description | Selected |
|--------|-------------|----------|
| Conditional exports dev→src/ | Vitest/tsx lê TS direto; CI valida build | ✓ |
| exports apontam dist/ + tsc -w | Espelha publicação; build mais lento | |
| tsconfig paths alias | Não respeita exports real | |

**User's choice:** Conditional exports dev→src/ (Recommended)

---

## Orquestrador de Tarefas Monorepo

### Task runner

| Option | Description | Selected |
|--------|-------------|----------|
| pnpm -r cru | Zero dep, simples; 4 pkgs basta | ✓ |
| Turborepo | Cache local+remoto, only-affected | |
| Nx | Mais poder, mais peso | |

**User's choice:** pnpm -r cru (Recommended)

### CI workflows shape

| Option | Description | Selected |
|--------|-------------|----------|
| ci.yml único + composite action | Jobs paralelos, setup compartilhado | ✓ |
| Múltiplos workflows separados | Mais arquivos, cache fragmentado | |
| Reusable workflow | DRY, complexidade desnecessária | |

**User's choice:** ci.yml único + composite action (Recommended)

### Triggers & concurrency

| Option | Description | Selected |
|--------|-------------|----------|
| PR + push main + cancel-in-progress | Cobertura completa; cancela obsoletos | ✓ |
| Só pull_request | Sem gate contínuo em main | |
| PR + push em qualquer branch | Triplica gastos CI | |

**User's choice:** PR + push main, concurrency cancel (Recommended)

### Branch protection

| Option | Description | Selected |
|--------|-------------|----------|
| Strict sem signed commits | PR + 1 review + status checks + linear | ✓ |
| Strict + signed commits | Fricção extra dev solo | |
| Só status checks, sem PR | Conflita CLAUDE.md | |

**User's choice:** Strict, sem signed commits (Recommended)

---

## Escopo de Housekeeping no Scaffold

### Governance set

| Option | Description | Selected |
|--------|-------------|----------|
| Full governance set | LICENSE, README, SECURITY, CONTRIBUTING, CoC, ISSUE+PR templates | ✓ |
| Mínimo legal | Só LICENSE + README skeleton | |
| Você decide | Planner escolhe convenção OSS | |

**User's choice:** Full governance set (Recommended)

### Disclosure channel

| Option | Description | Selected |
|--------|-------------|----------|
| GitHub PVR + email placeholder | Fluxo nativo + fallback genérico | ✓ |
| Só GitHub PVR | Sem email; depende 100% GitHub | |
| Só email | Independente host; sem CVE coordination | |

**User's choice:** GitHub PVR + email placeholder (Recommended)

### docker-compose.yml na Phase 1?

| Option | Description | Selected |
|--------|-------------|----------|
| Deixar pra Phase 2 | Phase 2 dona do schema/DB | ✓ |
| Stub Postgres 16 agora | DX inicial; risco de retrabalho | |
| Você decide | Planner valida com deps reais | |

**User's choice:** Deixar pra Phase 2 (Recommended)

### Bot de updates de deps

| Option | Description | Selected |
|--------|-------------|----------|
| Renovate config | Versionado; grouping; precisa app GH | ✓ |
| Dependabot | Builtin GH; grouping fraco | |
| Nenhum agora | Adicionar quando deps reais existirem | |

**User's choice:** Renovate config (Recommended)

---

## TypeScript + Vitest Config Shape

### tsconfig layout

| Option | Description | Selected |
|--------|-------------|----------|
| base + per-pkg + build variant | tsconfig.base + tsconfig.json + tsconfig.build | ✓ |
| Single root | Sem isolation; tests vazam dist | |
| Base + per-pkg só | Sem variant; exclude manual | |

**User's choice:** base + per-pkg + build variant (Recommended)

### Vitest config

| Option | Description | Selected |
|--------|-------------|----------|
| workspace + per-pkg | Suporta threshold 90/80 limpo | ✓ |
| Single root + projects inline | Threshold per-pkg gambiarra | |
| Per-pkg só, sem workspace | Sem coverage agregada | |

**User's choice:** workspace + per-pkg (Recommended)

### Vitest pool

| Option | Description | Selected |
|--------|-------------|----------|
| forks | Isolation forte; testcontainers PG futuro | ✓ |
| threads | Mais rápido CPU; problemas com nativos | |
| vmThreads | Experimental | |

**User's choice:** forks (Recommended)

---

## Changesets Release Workflow

### Release automation

| Option | Description | Selected |
|--------|-------------|----------|
| changesets/action GH Action | Version PR + publish on merge | ✓ |
| Manual local | Não reproduzível | |
| Tag-driven release-please | Redundante com Changesets | |

**User's choice:** changesets/action GH Action (Recommended)

### npm publish auth

| Option | Description | Selected |
|--------|-------------|----------|
| npm OIDC trusted publishing | Sem token; provenance nativo | ✓ |
| NPM_TOKEN + --provenance | Token longo-prazo; setup conhecido | |
| NPM_TOKEN sem provenance | Sem sinal de trust | |

**User's choice:** npm OIDC trusted publishing (Recommended)

### Access level

| Option | Description | Selected |
|--------|-------------|----------|
| public | Pacotes scoped públicos; MIT OSS | ✓ |
| restricted | Conflita posicionamento | |

**User's choice:** public (Recommended)

---

## Coverage Reporting + CI Artifacts

### Coverage report destination

| Option | Description | Selected |
|--------|-------------|----------|
| vitest-coverage-report sticky comment | Zero dep externa; PR comment | ✓ |
| Codecov | Trend histórico; dep externa | |
| Coveralls | OSS-friendly; menos features | |
| Só artifact + threshold gate | Sem visibilidade PR | |

**User's choice:** vitest-coverage-report sticky comment (Recommended)

### CI artifacts

| Option | Description | Selected |
|--------|-------------|----------|
| Só lcov.info | Mínimo necessário; SBOM/Trivy Phase 9 | ✓ |
| lcov + JUnit XML | Test annotations explícitas | |
| Tudo (lcov + JUnit + SBOM + Trivy) | Premature; Phase 9 é dona | |

**User's choice:** Só lcov.info (Recommended)

---

## Node/pnpm Pinning

### Node version pin

| Option | Description | Selected |
|--------|-------------|----------|
| .nvmrc + engines + engineStrict | Bloqueia install errado | ✓ |
| Volta | Auto-switch; não-padrão | |
| Só CI matrix | Descobre erro tarde | |

**User's choice:** .nvmrc + engines + engineStrict (Recommended)

### pnpm version pin

| Option | Description | Selected |
|--------|-------------|----------|
| packageManager + Corepack | Reproduzível dev+CI; oficial Node 22 | ✓ |
| Install global em CI | Drift dev/CI | |
| Só setup-node cache | Dev local livre | |

**User's choice:** packageManager + Corepack (Recommended)

---

## Biome Config

### Ruleset strictness

| Option | Description | Selected |
|--------|-------------|----------|
| recommended + bloqueios CLAUDE | noExplicitAny=error, noNonNullAssertion=error, useImportType=error | ✓ |
| Só recommended | Não bloqueia any | |
| Custom strict-everything | Muito ruído inicial | |

**User's choice:** recommended + bloqueios CLAUDE (Recommended)

### Test overrides

| Option | Description | Selected |
|--------|-------------|----------|
| Relaxar noNonNullAssertion em *.test.ts | Mantém no-any; permite ! em fixtures | ✓ |
| Sem override (strict tudo) | Boilerplate em testes | |
| Override granular fixtures+mocks | Mais regras | |

**User's choice:** Relaxar noNonNullAssertion em *.test.ts (Recommended)

---

## .gitleaks.toml Custom Rules

### Profundidade das regras

| Option | Description | Selected |
|--------|-------------|----------|
| Default + custom ECDSA/Starkbank/.env | Cobre PSP-key; sem baseline (greenfield) | ✓ |
| Só default rules | Pode passar PEM especiais | |
| Custom + baseline file vazio | Allowlist preparada | |

**User's choice:** Default + custom ECDSA/Starkbank/.env (Recommended)

### Scan scope

| Option | Description | Selected |
|--------|-------------|----------|
| Pre-commit + CI full histórico | Belt+suspenders; defende contra --no-verify | ✓ |
| Só pre-commit | Bypass possível | |
| Só CI | Leak já entrou no commit | |

**User's choice:** Pre-commit + CI full histórico (Recommended)

---

## .npmrc / pnpm Config

### Hoisting policy

| Option | Description | Selected |
|--------|-------------|----------|
| Strict + public-hoist on-demand | Detecta phantom deps; opt-in para tools | ✓ |
| shamefully-hoist=true | Mata isolation | |
| Strict puro sem hoist | Pode quebrar tools específicos | |

**User's choice:** Strict + public-hoist quando preciso (Recommended)

### Peer dependencies policy

| Option | Description | Selected |
|--------|-------------|----------|
| strict + auto-install off | Falha cedo; transparente | ✓ |
| Default novo pnpm (auto-install) | Mascara problemas | |
| Mix | Sem ganho | |

**User's choice:** strict + auto-install off (Recommended)

---

## Claude's Discretion

- Estrutura interna de cada `src/` por pacote (arquitetura interna fica para o planner por pacote).
- Conteúdo exato de templates `.github/ISSUE_TEMPLATE/*.yml` e `PULL_REQUEST_TEMPLATE.md`.
- Versão Node exata no `.nvmrc` (LTS mais recente Node 22 no momento da execução).
- Versão pnpm exata em `packageManager` (última stable no momento).

## Deferred Ideas

- Turborepo / Nx — reavaliar em Phase 5/6 se gargalo.
- Codecov ou Coveralls — pós-v0.1 se útil.
- CodeQL / SAST — considerar Phase 9 ou pós-v0.1.
- SBOM + Trivy — Phase 9.
- Signed commits / Sigstore — quando trouxer colaboradores externos.
- Volta — reavaliar se contribuidores reclamarem.
- Email `security@aprumo.dev` real — depende de domínio (out-of-band branding).
- 2º conector AbacatePay — v0.5 (já em PROJECT.md Out of Scope).
