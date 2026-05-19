# Phase 1: Monorepo Scaffold + CI + Dev Security - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Entrega clone-to-green-CI: um operador clona o repo, roda `pnpm install` e vê o pipeline (`pnpm lint`, `pnpm typecheck`, `pnpm test`) passar verde em CI matrix Node 22/24, com pre-commit secret scanning bloqueando qualquer credencial acidental — **antes** de uma única chave Starkbank ECDSA ser gerada. Inclui scaffold dos 4 pacotes (`@aprumo/core`, `@aprumo/connector-base`, `@aprumo/connector-starkbank`, `@aprumo/webhooks`), `.gitignore`, Changesets, governance OSS mínima e CI estruturado. Phase 1 NÃO inclui Postgres, schema, ou qualquer código de produção — só plumbing.

</domain>

<decisions>
## Implementation Decisions

### Pre-commit Stack
- **D-01:** Hook runner = **lefthook** (YAML único, paralelismo nativo, zero dep Node, alinha com `.planning/research/SUMMARY.md`).
- **D-02:** Secret scanner = **gitleaks** (binário Go single-file, sem dep Python). INF-06 permite "equivalente"; gitleaks substitui a sugestão original detect-secrets.
- **D-03:** Pre-commit scope = `gitleaks` (staged) + `commitlint` (Conventional Commits) + `biome check --staged` (lint+format). Alvo sub-segundo para não estimular `--no-verify`.
- **D-04:** Pre-push scope = `pnpm typecheck` apenas (sem testes — quem decide é o CI).
- **D-05:** `.gitleaks.toml` = default rules + regras custom para `-----BEGIN EC PRIVATE KEY-----` (ROADMAP success #2), padrões de token Starkbank, e `SECRET=`/`API_KEY=` em arquivos fora de `__fixtures__/`. Sem baseline file (repo greenfield).
- **D-06:** Gitleaks roda em **duas camadas**: pre-commit (staged) + CI (`gitleaks detect` no histórico completo) — CI é a defesa contra `--no-verify`.

### Build & Distribuição por Pacote
- **D-07:** Build tool = **`tsc` + project references**. Zero dep extra, types nativos primeira classe, alinha com filosofia zero-deps de `CLAUDE.md`.
- **D-08:** Module format = **ESM-only**. Persona = Node 22+ moderno; elimina dual-package hazard (crítico em libs com estado como helpers HMAC/Money).
- **D-09:** `package.json` `exports` = **subpaths declarados explicitamente** (`"."`, `"./contract"` quando aplicável, e.g. `@aprumo/connector-base/contract`). Sem wildcard `"./*"`.
- **D-10:** Resolução cross-package em dev = **conditional exports** com `"development"` apontando para `src/` e default apontando para `dist/`. Vitest e `tsx` consomem TS direto; CI valida sempre contra `dist/` para refletir o publicado.

### Monorepo Orchestration & CI Shape
- **D-11:** Task runner = **`pnpm -r`** cru. Sem Turborepo/Nx — 4 pacotes não justifica, dev solo, e CI matrix Node 22/24 anula benefício de cache. Reavaliar se virar gargalo.
- **D-12:** CI workflows = um único `.github/workflows/ci.yml` com jobs paralelos (`lint`, `typecheck`, `test` matrix, `build`, `coverage-gate`, `changeset-check`, `gitleaks-history`). Setup compartilhado via composite action `.github/actions/setup/` (setup-node + Corepack + pnpm install com cache).
- **D-13:** Triggers = `on: [pull_request, push: branches: [main]]` com `concurrency: { group: ci-${{ github.ref }}, cancel-in-progress: true }` (cancela runs obsoletos do mesmo PR).
- **D-14:** Branch protection em `main` = strict: PR obrigatório, 1 review, status checks (lint+typecheck+test+coverage+changeset+gitleaks), linear history. **Sem** signed commits inicialmente — ativar quando vierem colaboradores externos.

### Housekeeping OSS na Phase 1
- **D-15:** Governance set completo na Phase 1: `LICENSE` (MIT), `README.md` skeleton (status pre-alpha + propósito + link pra docs), `SECURITY.md`, `CONTRIBUTING.md` (TDD-first + Conventional Commits + DCO opcional; link a `CLAUDE.md`), `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `.github/ISSUE_TEMPLATE/{bug,feature,security}.yml`, `.github/PULL_REQUEST_TEMPLATE.md`.
- **D-16:** Vulnerability disclosure = GitHub Private Vulnerability Reporting (PVR) **habilitado** + email placeholder genérico no `SECURITY.md` para trocar quando o domínio existir (branding está fora de escopo GSD).
- **D-17:** `docker-compose.yml` **adiado para Phase 2** (dona do schema + DB). Phase 1 não precisa rodar Postgres.
- **D-18:** Renovate config (`renovate.json`) commitada na Phase 1 com preset `config:recommended` + grouping weekly + auto-merge desabilitado. Ativação real depende de instalar o app Renovate GitHub (ação out-of-band).

### TypeScript & Vitest Config Shape
- **D-19:** tsconfig layout = `tsconfig.base.json` (compiler options: `strict`, `noUncheckedIndexedAccess`, `target: ES2024`, `module: NodeNext`, `verbatimModuleSyntax: true`) + por pacote `tsconfig.json` (extends + `references` para deps internas) + `tsconfig.build.json` (exclui `**/*.test.ts`, `__fixtures__/**`). INF-02 cumprido aqui.
- **D-20:** Vitest = `vitest.workspace.ts` raiz + `vitest.config.ts` por pacote. Único caminho que suporta limpo o threshold 90/80 (INF-04) via `coverage.thresholds` por projeto.
- **D-21:** Vitest `pool: 'forks'`. Isolation forte; testcontainers PG (Phase 2+) e ledger transações concorrentes exigem isolation real, não threads.

### Changesets Release Workflow
- **D-22:** `changesets/action` (GitHub Action) configurada na Phase 1 com Version PR automático + publish on merge. `pnpm changeset publish` real só dispara em Phase 9 (release v0.1.0), mas o workflow já está pronto.
- **D-23:** Auth npm = **npm OIDC trusted publishing** (`id-token: write` no GH Actions + trusted publisher config no npm). Sem `NPM_TOKEN` longo-prazo. Provenance attestation nativa.
- **D-24:** `.changeset/config.json` = `access: "public"`, `updateInternalDependencies: "patch"`, sem `linked`, `baseBranch: "main"`. INF-09 cumprido.

### Coverage Reporting & CI Artifacts
- **D-25:** Coverage reporting via `davelosert/vitest-coverage-report-action` (sticky PR comment). Zero dep externa, sem dependência de Codecov. Threshold gate continua hard em Vitest config.
- **D-26:** Artifacts CI = **apenas `lcov.info`**. Sem upload de `dist/`, sem SBOM/Trivy (esses ficam Phase 9 quando houver Docker image + código de produção).

### Node & pnpm Pinning
- **D-27:** Pin Node = `.nvmrc` (versão exata) + `engines.node: ">=22"` no `package.json` raiz + `engine-strict=true` em `.npmrc`. Falha install em versão errada (não só warning).
- **D-28:** Pin pnpm = campo `packageManager: "pnpm@10.x.x"` no `package.json` raiz + `corepack enable` em CI. `actions/setup-node@v4` com `cache: pnpm` lê automaticamente.

### Biome Config
- **D-29:** Ruleset Biome = `recommended` + bloqueios explícitos: `noExplicitAny=error`, `noNonNullAssertion=error`, `useImportType=error`, `organizeImports: on`. Atende a proibição de `any`/`as unknown as T`/`@ts-ignore` sem comentário declarada em `CLAUDE.md`.
- **D-30:** Override Biome para `**/*.test.ts` = relaxa `noNonNullAssertion=off`. Mantém `noExplicitAny=error` em **todo lugar** (sem exceção para testes).

### pnpm Hoisting & Peer Deps
- **D-31:** `.npmrc` = strict hoisting (default pnpm) + `public-hoist-pattern[]` adicionado caso ferramenta específica exija (provavelmente `@biomejs/*` plugins futuros). Sem `shamefully-hoist=true`.
- **D-32:** `strict-peer-dependencies=true` + `auto-install-peers=false`. Falha cedo se peer dep faltar — ledger não pode mascarar problema de dependência transitiva.

### Claude's Discretion
- Estrutura interna de cada `src/` por pacote: arquitetura interna fica para o planner por pacote. Phase 1 cria só `src/index.ts` placeholder (export vazio ou stub) por pacote, suficiente para typecheck e build não-vazios.
- Conteúdo exato dos templates `.github/ISSUE_TEMPLATE/*.yml` e `PULL_REQUEST_TEMPLATE.md`: usar Contributor Covenant 2.1 para CoC; templates seguem padrão GitHub de bug/feature/security; planner define campos exatos.
- Versão Node específica do `.nvmrc` (ex: 22.11.0 vs 22.12.0): planner pega a LTS mais recente Node 22 no momento da execução.
- Versão pnpm específica no `packageManager`: idem — última stable no momento.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Projeto & Requisitos
- `.planning/PROJECT.md` — Core Value, Validated/Active/Out of Scope, Constraints (stack fechado), contexto pre-alpha.
- `.planning/REQUIREMENTS.md` §`Infrastructure (INF) — Phase 1` — INF-01 a INF-10. Define os 10 requirements desta fase.
- `.planning/ROADMAP.md` §`Phase 1: Monorepo Scaffold + CI + Dev Security` — Goal, Depends on, Requirements, 5 Success Criteria.
- `.planning/research/SUMMARY.md` — Pitfall #5 (chave Starkbank em git é compromisso imediato); citação de `lefthook + detect-secrets` como ponto de partida (sobrescrito por D-02 que usa gitleaks).

### PRD & Convenções
- `PRD.md` — referência histórica, vision, NFRs, ADRs 001–008 (não publicadas ainda).
- `CLAUDE.md` — Invariantes críticos (1-8), Stack fechado, Convenções de código (incl. proibição de `any`), regra TDD obrigatória, padrão de PR/commit, "O que NÃO fazer".
- `Tarefas v0.1.md` — backlog detalhado pré-v0.1 + v0.1 com tags por área (referência cruzada).

### ADRs (a publicar — ainda não existem em disco)
- `docs/adr/` — diretório ainda vazio. ADRs 001–009 serão escritas em fases subsequentes (Phase 2 começa publicação). Phase 1 **não** publica ADR — só prepara estrutura para `docs/adr/` existir em README.

### Especificações externas relevantes para a Phase 1
- Lefthook config schema — `https://lefthook.dev/configuration/` (referência durante implementação).
- Gitleaks rules schema — `https://github.com/gitleaks/gitleaks#configuration` (TOML).
- Changesets config — `https://github.com/changesets/changesets/blob/main/docs/config-file-options.md`.
- npm OIDC trusted publishing — `https://docs.npmjs.com/trusted-publishers`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Nenhum.** Repo greenfield. Apenas `.planning/`, `PRD.md`, `Tarefas v0.1.md`, `CLAUDE.md` em disco. Zero código de produção.

### Established Patterns
- **TDD obrigatório** (`CLAUDE.md` §Test-Driven Development) — qualquer código de produção começa por teste falhando. Phase 1 tem pouca lógica de produção, mas a configuração de Vitest + workspace + coverage gate **é** a infraestrutura que torna TDD viável. Sem ela, Phase 2+ não consegue TDD do schema.
- **Stack fechado** (`CLAUDE.md` §Stack) — não revisitar TypeScript, Fastify, Postgres puro, pg-boss, Vitest, pnpm workspaces, Biome, Drizzle, Changesets sem ADR. Phase 1 cumpre INF-01 a INF-10 dentro desse stack — sem desvios.
- **Conventional Commits + Changesets** — todo PR que mexe em pacote publicável precisa de changeset. CI bloqueia (INF-10). Phase 1 cria e testa esse gate.
- **`any` proibido** — Biome (D-29) enforça em CI.

### Integration Points
- **Phase 2 (Schema Foundation)** depende de Phase 1 para: `pnpm db:migrate` script (placeholder em Phase 1 — comando no `package.json` raiz que faz `echo`/exit 0); workspace funcionando; CI passando; Vitest configurado com pool forks (necessário para testcontainers).
- **`docs/adr/`** — diretório criado em Phase 1 (vazio com `.gitkeep`); Phase 2 começa a popular.
- **Domínio + npm scope `@aprumo`** — out-of-band: usuário precisa reservar `@aprumo` no npm. CLAUDE.md observa que branding está fora de escopo GSD. Phase 1 **assume** que `@aprumo` está disponível; se não estiver, decidir novo scope é Phase 1.5 urgent insert.

</code_context>

<specifics>
## Specific Ideas

- "operadores rodam `pnpm install` e CI fica verde" como cenário-norte para todas as escolhas de DX (D-08 ESM-only, D-27/D-28 pinning estrito).
- Postura **explícita** sobre supply chain trust desde dia 1: npm OIDC (D-23), provenance attestation, Renovate config (D-18), gitleaks CI full histórico (D-06). Aprumo é projeto financeiro; mensagem para design partners é "supply chain levado a sério desde commit zero".
- Phase 1 é o **único** momento antes de qualquer chave PSP existir — D-01 a D-06 (pre-commit + CI scan) precisam estar verdes **antes** do dev em Phase 6 (Starkbank connector) gerar a primeira chave ECDSA. Se algo aqui escapar, ROADMAP success criterion #2 falha e a chave vaza no histórico.

</specifics>

<deferred>
## Deferred Ideas

- **Turborepo / Nx** — adiar até 4 pacotes virar 8+ ou CI pipeline ficar lento o suficiente para justificar. Reavaliar em Phase 5/6.
- **Codecov ou Coveralls** — coverage hoje é sticky PR comment + gate Vitest; histórico/trend pode entrar futuramente se virar útil (provavelmente Phase 9 ou pós-v0.1).
- **CodeQL / SAST** — não habilitado na Phase 1. Considerar Phase 9 (release) ou pós-v0.1.
- **SBOM + Trivy** — Phase 9 (release + Docker image).
- **Signed commits / Sigstore** — quando trouxer colaboradores externos (pós-v0.1).
- **Volta** — não adotado em Phase 1; reavaliar se a comunidade de contribuidores reclamar de `.nvmrc`.
- **Email `security@aprumo.dev` real** — depende de domínio registrado (out-of-band branding).
- **2º conector AbacatePay** — fora do v0.1 (já PROJECT.md Out of Scope) → v0.5.

### Reviewed Todos (not folded)
(none — sem todos pendentes no índice do projeto)

</deferred>

---

*Phase: 1-Monorepo Scaffold + CI + Dev Security*
*Context gathered: 2026-05-18*
