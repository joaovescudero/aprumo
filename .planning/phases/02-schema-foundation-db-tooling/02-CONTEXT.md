# Phase 2: Schema Foundation + DB Tooling - Context

**Gathered:** 2026-05-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Entrega `pnpm db:migrate` rodando do zero contra um Postgres 18 limpo (testcontainers), produzindo todas as tabelas do ledger (`accounts`, `transactions`, `postings`, `raw_events`, `account_balance`, `*_audit`, `outbound_endpoints`, `outbound_events`) com **imutabilidade aplicada em três camadas**: (1) roles PG (`aprumo_app` sem UPDATE/DELETE em `postings`/`raw_events`, `aprumo_migration` com DDL completo); (2) função SQL `post_transaction(postings[])` como único caminho de escrita em `postings`, validando double-entry balanceado; (3) `CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED` validando `SUM(amount_cents com sinal) = 0` por `transaction_id` no COMMIT. Inclui testcontainers globalSetup com isolamento por schema-per-arquivo, drift check de migration via `_journal.json` em CI, e ADRs 001–009 portadas para MADR 4.0 em `docs/adr/`.

Phase 2 NÃO inclui Fastify, endpoints REST, balance worker, ou qualquer código de aplicação — só schema + função + tooling. Phase 3 (Core Ledger API) consome o que esta fase produz.

</domain>

<decisions>
## Implementation Decisions

### Migrations: Drizzle ↔ raw SQL boundary
- **D-33:** Migrations híbridas. `schema.ts` do Drizzle declara tables/colunas/FKs/CHECK constraints/indexes; `drizzle-kit generate` emite `0000_init_tables.sql`. Migrations adicionais hand-written para tudo que Drizzle não modela: `CREATE ROLE`, `GRANT`/`REVOKE`, plpgsql functions, `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED`, audit triggers. Hand-written migrations registradas no `_journal.json` via `drizzle-kit generate --custom`.
- **D-34:** Ordenação linear por prefixo numérico, sequência única forward-only:
  1. `0000_init_tables.sql` — Drizzle-generated; cria `accounts`, `transactions`, `postings`, `raw_events`, `account_balance`, `outbound_endpoints`, `outbound_events`, e shadows `*_audit`.
  2. `0001_roles.sql` — `CREATE ROLE aprumo_app`, `CREATE ROLE aprumo_migration`.
  3. `0002_grants.sql` — `GRANT SELECT,INSERT ... TO aprumo_app`; `REVOKE UPDATE,DELETE ON postings,raw_events FROM aprumo_app`; default privileges.
  4. `0003_post_transaction.sql` — função plpgsql `post_transaction(postings[])`.
  5. `0004_double_entry_trigger.sql` — `CREATE CONSTRAINT TRIGGER assert_balanced ... DEFERRABLE INITIALLY DEFERRED`.
  6. `0005_audit_triggers.sql` — função genérica de audit + triggers `AFTER UPDATE OR DELETE` em tabelas mutáveis.
  7. `0006_seed_dev.sql` — seed mínimo (1 customer, 2 contas, 1 transaction via `post_transaction`); só rodado em dev (script à parte, não no `db:migrate` de prod).
- **D-35:** Drift check FND-15 = `_journal.json` commitado. CI step re-hasha cada `.sql` em `migrations/` e diffa byte-a-byte contra `_journal.json` commitado. Qualquer edit em migration aplicada falha CI. Sub-segundo, zero tooling extra. Defesa única (não duplicar com PG-side check — overhead sem ganho real).
- **D-36:** Localização monorepo = `packages/core/migrations/` + `packages/core/drizzle.config.ts`. Root `package.json` expõe `db:migrate`, `db:reset`, `db:generate`, `db:seed` delegando via `pnpm --filter @aprumo/core <script>`. Migrations publicadas no tarball npm via `files: ["dist", "migrations"]` em `@aprumo/core`.

### Testcontainers + Vitest integration
- **D-37:** Estratégia de isolamento = um container PG global iniciado em `tests/globalSetup.ts`, schema-por-arquivo-de-teste. Cada test file em `beforeAll` chama helper `createTestDb()` que: (a) computa `schema_name = 'test_' + sha1(testPath).slice(0,12)`; (b) `CREATE SCHEMA test_xxx`; (c) `SET search_path = test_xxx, public`; (d) roda migrations contra esse schema; (e) retorna pools. `afterAll` chama `cleanup()` → `DROP SCHEMA test_xxx CASCADE`. Vitest `pool: 'forks'` (D-21 do Phase 1) garante um processo por arquivo, evitando colisão de search_path entre arquivos.
- **D-38:** Sem cache de migration estado. Cada arquivo de teste roda migrations no seu schema do zero. Estimativa: 50–200ms overhead/arquivo. Revisitar (cache via template schema + `pg_dump`/`pg_restore`) só se a suíte de integração ultrapassar 30s só em migration setup.
- **D-39:** Helper de teste retorna `{ app: Pool, migration: Pool, schema: string, cleanup(): Promise<void> }`. `app` autentica como `aprumo_app` (rota normal de produção); `migration` como `aprumo_migration` (só para aplicar migrations + setup). FND-08 (teste de REVOKE) usa `app.query('UPDATE postings ...')` e espera erro PG `42501`. Espelha topologia de prod onde código de aplicação nunca usa role de migration.
- **D-40:** Imagem PG = `postgres:18-alpine` pinned por digest em `tests/setup/container.ts` (uma constante única). Mesma digest em CI + máquinas locais de dev — reprodutibilidade total. `.withReuse()` desabilitado por padrão; habilitável via env var `APRUMO_TEST_REUSE=1` para acelerar iteração local de desenvolvedor (CI sempre fresh).

### ADRs (back-port 001–008 + ADR-009 net-new)
- **D-41:** Profundidade = expansão fiel. Cada ADR ~1 página, MADR 4.0 com seções Status / Context / Decision / Drivers / Considered Options / Decision Outcome / Consequences. Conteúdo derivado de `PRD.md §9`, `.planning/research/SUMMARY.md`, `CLAUDE.md` — sem nova pesquisa, sem benchmarks novos. Alternativas são as que o PRD nomeia (ex.: TigerBeetle para ADR-001, Hono para ADR-002, trigger.dev/BullMQ para ADR-003).
- **D-42:** Escopo = ADR-001 a ADR-009 apenas. Decisões de implementação Phase 2 (Drizzle+raw SQL boundary, testcontainers schema-per-file, drift via journal) vivem em CONTEXT.md/PLAN, **não** em ADR. ADR fica reservada para decisões arquiteturais que cruzam múltiplas fases. Evita ADR sprawl.
- **D-43:** Layout = MADR 4.0; arquivos `docs/adr/0001-postgres-as-ledger-engine.md`, `0002-fastify-http-framework.md`, `0003-pg-boss-workflow.md`, `0004-incremental-balance-worker.md`, `0005-accounting-split-async-settlement.md`, `0006-versioning-v01-v05.md`, `0007-smart-routing-as-logical-failover.md`, `0008-mit-core-enterprise-edition.md`, `0009-drizzle-orm-migrations.md`. Index manual em `docs/adr/README.md` (tabela: number, title, status, decided, documented). Sem dependência de `adr-tools` CLI nem `log4brains` — naming convention é a interface.
- **D-44:** Status semantics = `Status: Accepted`; campos duplos no front-matter: `decided: 2026-05-18` (data original do PRD para 001–008; `2026-05-22` para ADR-009) + `documented: 2026-05-22` (data desta fase). Honesto sobre back-fill sem inventar processo retroativo.

### Schema reservation for v0.5
- **D-45:** Reservar **apenas** `pending_balance BIGINT NULL` e `available_balance BIGINT NULL` em `account_balance`. Worker v0.1 escreve só `balance`; ambas colunas permanecem NULL até v0.5 worker popular. Resolve o blocker registrado em STATE.md ("pending_balance schema reservation decision needed before Phase 2 migrations are committed").
- **D-46:** Não reservar outras colunas v0.5 (`transactions.parent_transaction_id` para splits, `transactions.dispute_id`, `raw_events.dispute_thread_id`). Features v0.5 maiores (split, dispute lifecycle, MIT tokens) devem introduzir **tabelas novas** (`splits`, `disputes`, `payment_methods`), não colunas em tabelas hot existentes — custo de migração é menor lá. Disciplina YAGNI mantida exceto onde STATE explicitamente flagged.
- **D-47:** Documentação tripla de reservas: (a) `COMMENT ON COLUMN account_balance.pending_balance IS 'Reserved for v0.5 pending balance tracking; populated by worker, NULL in v0.1.'` + mesmo para `available_balance`; (b) header comment block em `0000_init_tables.sql` listando todas as reservas; (c) parágrafo em ADR-009 ("Reservation pattern") explicando a estratégia.

### Claude's Discretion (planner decide)
- Schema exato e mensagem de erro da `CONSTRAINT TRIGGER` de double-entry — desde que `SUM(amount_cents com sinal) = 0` por `transaction_id` no COMMIT seja aplicado e erro mapeável para 422 na Phase 3.
- Implementação interna de `post_transaction(postings[])`: assinatura (composite type vs array de jsonb), validação de `accounts.type`, handling de `idempotency_key` colisão. Contrato externo: aceita postings balanceados, persiste atomicamente, é o único INSERT em `postings`.
- Função de audit trigger: uma função plpgsql genérica `audit_row_change()` com `TG_TABLE_NAME` vs funções por-tabela; payload de audit (JSONB do OLD + JSONB do NEW vs colunas espelhadas). Requisito: capture `current_user` e `now()`.
- Vocabulário inicial de `raw_events.status` (provavelmente `pending|reconciled|failed`) — definir como CHECK constraint agora ou deixar para Phase 7. Recomendação: CHECK com o tripleto acima, expandível depois.
- Vocabulário de `transactions.source` (provavelmente livre, com convenção `<provider>` ou `manual`/`reconciliation`/`seed`).
- Estratégia de senha de role em dev (env-vars `.env.example`) + CI (init script do container ou step de migration). Requisito: passwords nunca commitados em valores reais.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Projeto & Requisitos
- `.planning/PROJECT.md` — Core Value, Validated/Active/Out of Scope, stack fechado.
- `.planning/REQUIREMENTS.md` §`Foundation (FND) — Phase 2` — FND-01 a FND-18, todos os 18 requirements desta fase.
- `.planning/ROADMAP.md` §`Phase 2: Schema Foundation + DB Tooling` — Goal, Depends on (Phase 1), 6 Success Criteria.
- `.planning/research/SUMMARY.md` — confirmação de pg-boss exact-once (mesma tx), justificativa de Postgres puro sobre TigerBeetle, padrão de testcontainers Node 22.
- `.planning/STATE.md` §`Blockers/Concerns` — bloqueador `pending_balance` resolvido por D-45.
- `.planning/phases/01-monorepo-scaffold-ci-dev-security/01-CONTEXT.md` — D-19 (tsconfig layout), D-20 (Vitest projects array), D-21 (`pool: 'forks'`) — herdadas; testcontainers depende de forks.

### PRD & Convenções
- `PRD.md` §8.2 (modelo do ledger), §9 (ADRs 001–008 summary table — fonte para back-port), §10–11 (métricas + riscos).
- `CLAUDE.md` — Invariantes críticos 1 (imutabilidade), 2 (double-entry), 5 (SERIALIZABLE), 6 (audit), 8 (BIGINT cents); §Schema do ledger (tabelas + roles); §Testes (testcontainers, 90% coverage).
- `Tarefas v0.1.md` — backlog cross-reference.

### ADRs (a publicar nesta fase)
- `docs/adr/` — diretório existe vazio com `.gitkeep` desde Phase 1. Phase 2 popula com 9 ADRs em MADR 4.0 + index `docs/adr/README.md`.

### Especificações externas
- Drizzle ORM custom migrations — `https://orm.drizzle.team/docs/kit-custom-migrations`.
- Drizzle `_journal.json` schema — `https://orm.drizzle.team/docs/kit-overview#migrations-folder`.
- Postgres CONSTRAINT TRIGGER + DEFERRABLE — `https://www.postgresql.org/docs/16/sql-createtrigger.html`.
- MADR 4.0 template — `https://adr.github.io/madr/`.
- Testcontainers Node.js (`@testcontainers/postgresql`) — `https://node.testcontainers.org/modules/postgresql/`.
- Vitest `globalSetup` — `https://vitest.dev/config/#globalsetup`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`packages/core/`** stub do Phase 1: `package.json` (publish target = GitHub Packages, ESM-only, `exports` declarado), `tsconfig.json`, `vitest.config.ts`, `src/index.ts` placeholder. Phase 2 vai popular `src/db/`, `src/sql/`, `migrations/`, `schema.ts`, `drizzle.config.ts`, e `seed.ts`. Atualizar `files: [dist, migrations]` em `package.json`.
- **`vitest.config.ts` root** (Phase 1) já configurado com `pool: 'forks'` e projects array. Phase 2 adiciona `globalSetup: 'tests/globalSetup.ts'` no projeto root e referência ao schema-per-file helper de `@aprumo/core/test-utils`.
- **CI matrix Node 22/24** (Phase 1) já roda `test` job. Phase 2 adiciona migration drift check (re-hash + diff `_journal.json`) como step novo no job de lint, e novo job de integration test que requer Docker (testcontainers).
- **Pre-commit + CI gitleaks** (Phase 1) cobre acidente de commitar `.env` com senha real de role.

### Established Patterns
- **TDD obrigatório** (CLAUDE.md). Phase 2 começa por test failing: testar que `aprumo_app` recebe `42501` em UPDATE (FND-08) é o RED clássico; só depois do REVOKE estar em migration o teste passa.
- **Stack fechado** — não revisitar Postgres/Drizzle/Vitest sem ADR. ADR-009 é a ratificação de Drizzle escrita nesta fase.
- **`any` proibido** (D-29 Biome) — aplica a `drizzle.config.ts` e helpers de teste; tipos `Pool` do `pg`/`postgres-js` direto.
- **TypeScript estrito + `noUncheckedIndexedAccess`** — drizzle queries retornam arrays; código de teste precisa lidar com `result[0]` possivelmente undefined.

### Integration Points
- **Phase 3 (Core Ledger API)** consome diretamente: `post_transaction(postings[])`, schema completo, role `aprumo_app` (Fastify connection pool), `account_balance` para `GET /accounts/:id`. Erro mapping: `42501` → 503/422, constraint violation no COMMIT → 422.
- **Phase 4 (Balance Worker)** consome: `account_balance` + `last_posting_id` cursor pattern, `pending_balance`/`available_balance` reservados mas NULL (v0.5).
- **Phase 7 (Webhooks Inbound)** consome: `raw_events` table + `UNIQUE (provider, provider_event_id)`, `status` column vocabulary (definido aqui).
- **CI release pipeline** (Phase 1) — `@aprumo/core` 0.1.0 publicação inclui `migrations/` no tarball; consumer self-host roda `npx aprumo-migrate` ou equivalente em Phase 9.

</code_context>

<specifics>
## Specific Ideas

- **Drift check é a defesa principal contra "alguém editou uma migration aplicada".** Em ledger, isso é catastrófico: dois ambientes (dev + prod do design partner) com esquemas divergentes silenciosamente é exatamente o tipo de bug que produz perda contábil. D-35 elevado a hard gate.
- **`pending_balance` reservation é uma aposta arquitetural deliberada**, não YAGNI violation. O custo (2 nullable columns + COMMENT) é trivial; o benefício é evitar `ALTER TABLE account_balance ADD COLUMN ...` em design partners com milhões de linhas durante upgrade v0.1 → v0.5.
- **Schema-per-test-file (vs DB-per-test ou container-per-test)** é a escolha que permite 90%+ coverage com tempo de suíte aceitável. DB-per-test é caro; container-per-test é absurdo. Schema-per-file aproveita que vitest forks pool isola processo (search_path não vaza entre arquivos).
- **MADR back-port honest dating** (D-44) sinaliza para futuros leitores que ADRs 001–008 foram decididas antes de virarem documento. Padrão raro mas defensável — alternativa é fingir que tudo foi decidido em 2026-05-22, o que cria dissonância para quem lê PRD.md depois.
- **ADR-001 (Postgres puro)** é a ADR mais frequentemente questionada por contribuidores externos ("por que não TigerBeetle?"). Investir em alternativas + drivers + consequences é o melhor uso de tempo dentre os 9.

</specifics>

<deferred>
## Deferred Ideas

- **Template-DB caching para testcontainers** (CREATE DATABASE ... TEMPLATE) — D-38 deixou para revisitar se suíte > 30s só em migrations.
- **`available_balance` worker logic** — coluna reservada D-45 mas não populada. Implementação em v0.5.
- **`splits`, `disputes`, `payment_methods` tables** — D-46 deferred para v0.5 phases. Não adicionar colunas em transactions/raw_events agora.
- **PG-side migration drift check (re-hash `__drizzle_migrations` table)** — D-35 ficou em journal-only; PG-side só se journal-only se mostrar insuficiente.
- **`adr-tools` CLI / log4brains static site** — D-43 ficou em naming-convention only. Considerar quando ADRs > 20 ou contributors pedirem.
- **Migration rollback (down migrations)** — Drizzle suporta mas convenção do projeto é forward-only. Rollback = nova migration + data fix. Documentar em CONTRIBUTING.md.
- **`SET ROLE` em helpers de teste** — alternativa rejeitada em D-39. Helper expõe pools separados; tests jamais fazem `SET ROLE`.

### Reviewed Todos (not folded)
(nenhum — STATE.md "Pending Todos" é "None yet")

</deferred>

---

*Phase: 2-Schema Foundation + DB Tooling*
*Context gathered: 2026-05-22*
