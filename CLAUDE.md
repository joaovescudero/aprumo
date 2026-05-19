# CLAUDE.md

Este arquivo orienta o Claude Code ao trabalhar neste repositório. Leia antes de qualquer mudança não-trivial.

**Documentos vivos** (em `.planning/`, mantidos pelo GSD):
- [`PROJECT.md`](./.planning/PROJECT.md) — contexto, Core Value, requirements (Validated/Active/Out of Scope), Key Decisions
- [`REQUIREMENTS.md`](./.planning/REQUIREMENTS.md) — 104 REQ-IDs v0.1 mapeados em fases (FND/INF/API/BAL/CNB/SBC/WHI/WHO/OBS/DOC)
- [`ROADMAP.md`](./.planning/ROADMAP.md) — 9 fases sequenciais com goals + success criteria + dependências
- [`research/SUMMARY.md`](./.planning/research/SUMMARY.md) — síntese de stack/features/architecture/pitfalls

PRD original (referência histórica): [`PRD.md`](./PRD.md).

## O que é o Aprumo

Camada open-source de razão financeira (livro razão / ledger) **agnóstica a provedor de pagamentos**. Conecta-se a gateways/BaaS via conectores plugáveis e funciona como **fonte da verdade contábil** sobre tudo o que se movimenta nesses provedores — sem custodiar dinheiro.

Persona-alvo: empresas de receita recorrente brasileiras (SaaS, assinaturas, ed-tech, infoprodutos).

## Stack — decisões fechadas (não revisitar sem ADR)

- **Linguagem**: TypeScript estrito, Node 22+
- **Framework HTTP**: Fastify
- **DB**: Postgres 16+ puro (single-DB). TigerBeetle foi avaliado e descartado.
- **Workflow/fila**: pg-boss (mesmo PG do ledger)
- **Testes**: Vitest + coverage v8, mínimo 90% LoC em `@aprumo/core`
- **Monorepo**: pnpm workspaces
- **Lint/format**: Biome
- **Migrations**: Drizzle (preferência) ou alternativa decidida em ADR
- **Releases**: Changesets

Justificativas em `docs/adr/`. Não troque essas escolhas sem escrever uma nova ADR.

## Invariantes críticos — NÃO VIOLAR

Este é um ledger financeiro. Violar os invariantes abaixo pode causar perda silenciosa de dinheiro ou inconsistência contábil irreversível.

1. **Imutabilidade**: tabelas `postings` e `raw_events` são append-only. Nunca escreva código que faça `UPDATE` ou `DELETE` nelas. A role `aprumo_app` não tem essas permissões — código que tente isso vai falhar em runtime, mas falhe primeiro no review.
2. **Double-entry balanceado**: toda transação contábil deve ter `SUM(amount_cents COM sinal) = 0` entre seus postings. Nunca crie postings fora da função `post_transaction(postings[])`, que valida isso no COMMIT.
3. **Idempotência**: todo endpoint que escreve no ledger aceita `Idempotency-Key`. Webhooks usam `UNIQUE (provider, provider_event_id)` em `raw_events`. Duplicatas retornam 200 OK sem reprocessar — nunca falham com erro.
4. **Exact-once de webhook**: o INSERT em `raw_events` e o enfileiramento do job pg-boss devem acontecer **na mesma transação Postgres**. Esse é o motivo de usar pg-boss e não trigger.dev/BullMQ. Se você for tentado a usar uma fila externa, leia ADR-003 primeiro.
5. **Isolation level**: operações que mexem no ledger usam `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`. Erros `40001` (serialization failure) devem ser tratados com retry no nível da aplicação (até 3 tentativas).
6. **Audit**: qualquer tabela mutável (configs, customers, endpoints) tem shadow `*_audit` populada por trigger `AFTER UPDATE/DELETE`. Não crie tabela mutável sem shadow.
7. **Sem PAN próprio**: nunca aceite/armazene número de cartão (PAN). Use exclusivamente tokens dos gateways. Isso mantém o escopo PCI em SAQ-A.
8. **Valores em centavos**: amounts são `BIGINT amount_cents`. Nunca use `float`/`numeric` para dinheiro. Nunca exponha API que aceite valores fracionados.

## Arquitetura — pacotes do monorepo

```
packages/
  core/                    # @aprumo/core — schema PG, função post_transaction, API REST, worker de saldo
  connector-base/          # @aprumo/connector-base — interface LedgerConnector + contract tests
  connector-starkbank/     # @aprumo/connector-starkbank — primeiro conector (v0.1)
  connector-abacatepay/    # @aprumo/connector-abacatepay — segundo conector (v0.5)
  webhooks/                # @aprumo/webhooks — endpoint genérico de entrada + dispatcher de saída
```

Responsabilidades:
- `core` não conhece conectores. Conectores dependem de `connector-base`. `webhooks` orquestra entre `core` e os conectores via registry.
- Cada conector é um pacote independente publicável separadamente no npm.
- Mudanças em `connector-base` que quebram contrato são MAJOR — afetam todos os conectores.

## Schema do ledger (Postgres)

Tabelas principais (DDL completo em `packages/core/migrations/`):

- `accounts(id, type, metadata, owner_ref, created_at)` — `type IN (asset, liability, revenue, expense, equity)`
- `transactions(id, idempotency_key UNIQUE NOT NULL, ts, description, source)`
- `postings(id, transaction_id, account_id, amount_cents, direction)` — `direction IN (debit, credit)`. Append-only.
- `raw_events(id, provider, provider_event_id, received_at, payload_jsonb)` — `UNIQUE (provider, provider_event_id)`. Append-only.
- `account_balance(account_id PK, balance, last_posting_id, updated_at)` — materializada por worker incremental.
- `outbound_endpoints`, `outbound_events` — para webhooks de saída.

Roles:
- `aprumo_app`: SELECT/INSERT em todas; sem UPDATE/DELETE em `postings`/`raw_events`.
- `aprumo_migration`: DDL completo. Só usada em migrations.

## Comandos comuns

```bash
# Setup inicial
pnpm install
docker compose up -d postgres
pnpm db:migrate

# Dev
pnpm dev                          # roda core + workers em watch
pnpm --filter @aprumo/core dev    # só o core

# Testes
pnpm test                         # todos os pacotes
pnpm --filter @aprumo/core test --coverage
pnpm test:contract                # contract tests dos conectores

# Type-check + lint
pnpm typecheck
pnpm lint

# Migrations
pnpm db:migrate
pnpm db:rollback
pnpm db:reset                     # destrutivo, só dev

# Build
pnpm build

# Release (Changesets)
pnpm changeset                    # registra mudança
pnpm changeset version            # bumpa versões
pnpm changeset publish            # publica no npm
```

## Convenções de código

- **TypeScript estrito**: `strict: true`, `noUncheckedIndexedAccess: true`, sem `any`. Use `unknown` + type guards.
- **Imports**: paths absolutos via `@aprumo/*` entre pacotes. Dentro do pacote, paths relativos.
- **Nomes de arquivo**: `kebab-case.ts`. Testes em `*.test.ts` ao lado do código.
- **Errors**: classes próprias estendendo `Error`. Não use `throw 'string'`. Discriminar com `name` ou `code`.
- **SQL**: queries em arquivos `.sql` quando longas, ou via query builder do Drizzle. Não interpole strings SQL — sempre parameterized.
- **Logging**: estruturado (pino). Nunca logue PII (CPF, nome, email do pagador) nem dados sensíveis (tokens, secrets). Use `redact` config do pino.
- **Datas**: sempre `timestamp with time zone` no PG. Sempre UTC em código. Apenas formate localmente na borda da UI/relatório.
- **Money**: `BIGINT amount_cents`. Helper `Money` em `@aprumo/connector-base`.

## Test-Driven Development — obrigatório

TDD é **não-negociável** neste projeto. **Toda mudança de código de produção começa por um teste falhando.**

Ciclo Red → Green → Refactor:
1. Escreva o teste que descreve o comportamento desejado. Rode. Veja falhar (**Red**).
2. Escreva o código mínimo para o teste passar. Rode. Veja passar (**Green**).
3. Refatore com testes verdes como rede de segurança (**Refactor**).

Regras práticas:
- **Commits separados quando possível**: prefira `test: add failing case for X` seguido de `feat: implement X`. Não é proibido um commit único, mas o diff do PR precisa evidenciar que os testes precedem o código.
- **PR sem teste novo não é aceito** se a mudança altera comportamento observável. Exceções: docs, refactor puro (sem mudança de comportamento, comprovado pela suite verde antes e depois), tooling/build.
- **Bugfix**: comece reproduzindo o bug como teste falhando. Só então corrija. Sem essa etapa o bug volta.
- **Reviewers verificam isso**: PR sem teste correspondente à feature é motivo para `request changes`, não nit.
- **Cobertura de 90% LoC é consequência do TDD**, não substituto. Se você está fazendo TDD direito, vai bater 90% naturalmente. Cobertura abaixo é sinal de TDD frouxo.

No ledger, invariantes contábeis (double-entry, idempotência, imutabilidade, exact-once de webhook) precisam ter **teste explícito antes da implementação**. Não é negociável.

## Testes

- Padrão Vitest. Coverage threshold: **90% LoC** em `@aprumo/core` (gate de CI). Outros pacotes: 80%.
- Mocks de DB via testcontainers PG ou container compartilhado da suite.
- **Contract tests**: todo conector implementa `LedgerConnector` e passa a suite de `@aprumo/connector-base/contract`. Sem essa suite verde, o conector não é mergeado.
- **Edge cases obrigatórios** para qualquer feature que toca o ledger: idempotência (mesma chave duas vezes), race condition (duas tx concorrentes na mesma conta), valores no limite (0, MAX_SAFE_INTEGER cents, negativos), timezone (DST, midnight), webhook duplicado, retry após `40001`.
- **Não use mocks no caminho do PG do ledger**. Use container real. Mock só do mundo externo (HTTP dos PSPs).

## Padrão de PR / commit

- Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`).
- Toda mudança que afeta produção tem Changeset. CI falha sem ele.
- PRs descrevem **o quê**, **por quê** e **como verificar**. Mudanças em invariantes (acima) precisam de ADR linkado.
- Branch protection em `main`: PR obrigatório, status checks (lint, typecheck, test, coverage gate, contract tests), 1 review.

## Quando tiver dúvida

1. **Decisões de produto/arquitetura**: leia [`PRD.md`](./PRD.md) e `docs/adr/`.
2. **Como modelar algo no ledger**: comece pelo schema, depois função SQL, depois TS. Se está pensando em mutabilidade, pare e leia "Invariantes críticos" acima.
3. **Vai adicionar dependência**: justifique no PR. Prefira zero-deps quando possível. Nunca adicione lib que pede credenciais/telemetria em runtime sem opt-in.
4. **Vai mexer em conector**: rode contract tests antes de pedir review.
5. **Vai fazer mudança grande**: abra issue/RFC primeiro. Discussão pública é o padrão (projeto OSS, roadmap aberto).

## O que NÃO fazer

- Não crie UI/dashboards no core OSS — isso é da edição enterprise.
- Não adicione lógica de custódia (vire IP regulada). Aprumo nunca segura dinheiro.
- Não armazene PAN. Nunca.
- Não troque pg-boss por fila externa sem ADR + discussão de exact-once.
- Não adicione TigerBeetle, ScyllaDB, Cassandra ou outro DB. Postgres é a escolha.
- Não use `any`, `as unknown as T`, `@ts-ignore` sem comentário explicando porquê.
- Não logue payloads de webhook brutos em produção (pode conter PII). Logue resumo.
- Não faça `UPDATE` ou `DELETE` em `postings`/`raw_events`. Se você acha que precisa, está errado.
- Não escreva código de produção sem teste falhando primeiro. Ver "Test-Driven Development — obrigatório".

---

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Antes de usar Edit, Write ou outras ferramentas que modificam arquivos, comece o trabalho por um comando GSD para que os artefatos de planejamento e o contexto de execução fiquem em sincronia.

Use estes entry points:
- `/gsd-quick` para fixes pequenos, atualização de docs e tarefas ad-hoc
- `/gsd-debug` para investigação e correção de bugs
- `/gsd-execute-phase` para trabalho de fase planejada
- `/gsd:plan-phase N` para planejar a próxima fase em `.planning/ROADMAP.md`

Não faça edições diretas no repo fora de um workflow GSD a menos que o usuário peça explicitamente para bypassar.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` — do not edit manually.
<!-- GSD:profile-end -->
