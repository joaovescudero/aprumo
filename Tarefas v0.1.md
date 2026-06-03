← [[Aprumo]]

Backlog detalhado até o primeiro release. **Pré-v0.1** cobre setup de marca, repositório e infraestrutura. **v0.1** cobre o ledger funcional ponta a ponta (ver [[Escopo do MVP]]). Tags por área (`#infra`, `#core`, `#db`, `#conector`, `#webhooks`, `#docs`) para filtragem via Obsidian Tasks ou Dataview.

> **TDD obrigatório** (ver [[Princípios]]). Toda tarefa de código segue Red → Green → Refactor: o teste vem antes da implementação. Uma tarefa só é "concluída" quando o teste correspondente está verde no CI. Em bugfix, comece reproduzindo o bug como teste falhando.

---

## Pré-v0.1 — Setup

### Marca e identidade `#infra`
- [ ] Registrar `aprumo.com`
- [ ] Registrar `aprumo.com.br` (via registro.br)
- [ ] Registrar `aprumo.io`
- [ ] Busca formal INPI nas classes 9 (software), 36 (financeiro), 42 (serviços técnicos)
- [ ] Depositar pedido de marca no INPI (se busca livre)
- [ ] Definir identidade visual mínima — wordmark + paleta (placeholder OK)

### GitHub e npm `#infra`
- [ ] Criar GitHub org `aprumo`
- [ ] Reservar npm scope `@aprumo` (com publicação de um pacote placeholder)
- [ ] Criar repositório público `aprumo/aprumo` (monorepo)
- [ ] Adicionar `LICENSE` (MIT)
- [ ] Adicionar `README.md` inicial com "pre-alpha" badge
- [ ] Adicionar `CONTRIBUTING.md`
- [ ] Adicionar `CODE_OF_CONDUCT.md` (Contributor Covenant)
- [ ] Configurar branch protection (main: require PR, status checks, no direct push)
- [ ] Criar GitHub Project com milestones `v0.1`, `v0.5`, `v1`
- [ ] Issue templates: bug, feature, RFC

### Monorepo e tooling `#infra`
- [ ] `pnpm-workspace.yaml` + `package.json` raiz
- [ ] Criar pacote `@aprumo/core`
- [ ] Criar pacote `@aprumo/connector-base` (interface `LedgerConnector` + tipos compartilhados)
- [ ] Criar pacote `@aprumo/connector-starkbank`
- [ ] Criar pacote `@aprumo/webhooks` (HTTP layer)
- [ ] `tsconfig.base.json` com strict mode + Node 22+ target
- [ ] Configurar Biome (lint + format)
- [ ] Configurar Vitest com coverage v8, threshold 90% LoC no `@aprumo/core`
- [ ] Configurar `commitlint` + Conventional Commits

### CI/CD `#infra`
- [ ] GitHub Actions: matriz de Node 22/24
- [ ] Job de lint + format check (Biome)
- [ ] Job de type-check (`tsc --noEmit`)
- [ ] Job de testes unitários com coverage gate (falha < 90% em `@aprumo/core`)
- [ ] Job de contract tests dos conectores
- [ ] Job de build dos pacotes
- [ ] Release automation com Changesets (versão + changelog)
- [ ] Publicação manual no npm com `npm publish --access public` para os primeiros releases

### Ambiente de dev `#infra` `#db`
- [ ] `docker-compose.yml` com Postgres 16+
- [ ] Decidir lib de migration (Drizzle vs Kysely vs node-pg-migrate) — preferência: Drizzle por DX e tipos
- [ ] Setup de roles PG: `aprumo_app` (sem DDL), `aprumo_migration` (DDL completo)
- [ ] Script `pnpm db:reset` para destruir + recriar local
- [ ] Seed mínimo (1 customer, 1 conta) para dev

### ADRs iniciais `#docs`
- [ ] ADR-001: Postgres puro (TigerBeetle descartado)
- [ ] ADR-002: Fastify como framework HTTP
- [ ] ADR-003: pg-boss como engine de workflow
- [ ] ADR-004: Worker incremental para saldo (vs view materializada)
- [ ] ADR-005: Split contábil instantâneo + liquidação assíncrona
- [ ] ADR-006: Faseamento v0.1 / v0.5
- [ ] ADR-007: Smart routing como failover lógico no MVP
- [ ] ADR-008: Licença MIT no core + edição enterprise

---

## v0.1 — Ledger funcional ponta a ponta

### Schema PG do ledger `#core` `#db`
- [ ] Migration `accounts(id, type, metadata, owner_ref, created_at)` com `type IN (asset, liability, revenue, expense, equity)`
- [ ] Migration `transactions(id, idempotency_key UNIQUE NOT NULL, ts, description, source)`
- [ ] Migration `postings(id, transaction_id FK, account_id FK, amount_cents BIGINT, direction)` com `direction IN (debit, credit)`
- [ ] Migration `raw_events(id, provider, provider_event_id, received_at, payload_jsonb, UNIQUE(provider, provider_event_id))`
- [ ] Migration `account_balance(account_id PK FK, balance BIGINT, last_posting_id, updated_at)`
- [ ] Migration de tabelas `*_audit` (configs, customers, outbound_endpoints) com trigger `AFTER UPDATE/DELETE`
- [ ] `REVOKE UPDATE, DELETE` em `postings` e `raw_events` para role `aprumo_app`
- [ ] Função SQL `post_transaction(postings[])`: valida balanceamento, persiste transaction + postings em uma operação
- [ ] Constraint deferred (via trigger ou check function) que valida `SUM(amount_cents WITH sign per direction) = 0` por `transaction_id` no COMMIT
- [ ] Teste de integração: tentar UPDATE em `postings` com role `aprumo_app` → falha

### Core API REST `#core`
- [ ] `POST /transactions` — registra transação double-entry com idempotency key
- [ ] `GET /transactions/:id` — consulta transação + postings
- [ ] `POST /accounts` — cria conta
- [ ] `GET /accounts/:id` — retorna metadata + saldo materializado
- [ ] `GET /accounts/:id/postings` — extrato paginado
- [ ] Validação Fastify via JSON Schema em todos os endpoints
- [ ] Tratamento global de `SerializationFailure` com retry (até 3x)
- [ ] Health check `GET /health` (liveness + readiness)
- [ ] OpenAPI/Swagger gerado automaticamente via `@fastify/swagger`

### Worker de saldo `#core`
- [ ] Worker incremental: SELECT postings WHERE id > last_posting_id ORDER BY id, aplica delta em `account_balance`
- [ ] Lock por `account_id` para concorrência (`SELECT ... FOR UPDATE`)
- [ ] Cursor de retomada persistido por worker
- [ ] Health check com `last_processed_at`
- [ ] Job pg-boss diário: recalcula saldo do zero + compara com `account_balance`, alerta em divergência
- [ ] Métrica: lag de saldo (segundos entre posting e atualização)

### `@aprumo/connector-base` `#conector`
- [ ] Interface `LedgerConnector` (createPayment, getBalance, withdraw, parseWebhook)
- [ ] Tipos compartilhados: `PaymentRef`, `Money`, `NormalizedEvent`, `WithdrawalRef`
- [ ] Suite de contract tests que qualquer conector tem que passar
- [ ] Helper `signWebhook` / `verifyWebhook` (HMAC SHA-256 reutilizável)
- [ ] Documentação: "como implementar um conector"

### Conector Starkbank `#conector`
- [ ] Cliente HTTP do Starkbank (usar SDK oficial se existir)
- [ ] `createPayment` — PIX, boleto, cartão (com tokenização do gateway)
- [ ] `getBalance` — saldo da conta Starkbank
- [ ] `withdraw` — PIX e TED
- [ ] `parseWebhook` — normaliza eventos de cobrança paga/falhou/dispute/transfer
- [ ] Validação de assinatura do webhook (HMAC do Starkbank)
- [ ] Mapeamento de erros do Starkbank → categorias do core (`retryable`, `terminal`, `validation`)
- [ ] Mock server para testes locais (MSW ou nock)
- [ ] Passar suite de contract tests do `@aprumo/connector-base`

### Webhooks de entrada `#webhooks`
- [ ] `POST /webhooks/:provider` — endpoint genérico
- [ ] Registry de conectores (lookup por provider name)
- [ ] Delegação para `parseWebhook` + validação de assinatura
- [ ] INSERT em `raw_events` + enfileiramento pg-boss `process-webhook` na **mesma transação**
- [ ] Worker `process-webhook`: aplica `post_transaction` baseado no evento normalizado
- [ ] Tratamento de duplicata: UNIQUE constraint em `(provider, provider_event_id)` → 200 OK sem reprocessar
- [ ] Logging estruturado sem dados sensíveis (LGPD)
- [ ] Teste end-to-end: webhook do Starkbank → posting aplicado → saldo atualizado

### Webhooks de saída `#webhooks`
- [ ] Schema `outbound_endpoints(id, customer_id, url, secret, active, event_types[])`
- [ ] Schema `outbound_events(id, endpoint_id, type, payload_jsonb, status, attempts, last_error, created_at)`
- [ ] Worker dispatcher pg-boss: lê eventos `status='pending'`, envia POST com HMAC SHA-256
- [ ] Política de retry exponencial: 1s, 5s, 30s, 5min, 30min, 2h (configurável)
- [ ] Dead-letter após N tentativas (default 6)
- [ ] Endpoint admin `POST /admin/outbound/:id/replay` para reprocessar
- [ ] Tipos de evento: `charge.paid`, `charge.failed`, `dispute.opened`, `transfer.confirmed`

### Conciliação automática `#core`
- [ ] Worker `reconcile` consome `raw_events` pendentes (sem posting associado)
- [ ] Aplica `post_transaction` conforme regra do tipo de evento
- [ ] Marca evento como conciliado (relação `event_id → transaction_id`)
- [ ] Métrica: tempo entre `received_at` e conciliação
- [ ] Endpoint admin para forçar reconciliação de evento específico

### Documentação `#docs`
- [ ] README com quickstart (`docker-compose up`, primeiro `POST /transactions`)
- [ ] Documentação da API (link para Swagger)
- [ ] Guia de implementação de conector (`docs/connectors.md`)
- [ ] CHANGELOG inicial com release v0.1.0
- [ ] Seção "Concepts" no docs: double-entry, idempotência, imutabilidade

### Launch v0.1 `#docs`
- [ ] Identificar 2-3 design partners (empresas SaaS BR de receita recorrente já usando Starkbank)
- [ ] Reuniões de feedback com cada partner antes do release
- [ ] Rascunho de anúncio (HN, Twitter, LinkedIn, comunidades dev BR)
- [ ] Decidir embargo: anuncia público no GitHub vs lança direto v0.1.0 com release notes
- [ ] Publicar `@aprumo/core@0.1.0`, `@aprumo/connector-starkbank@0.1.0`, `@aprumo/webhooks@0.1.0` no npm

---

## Visão de longo prazo (não detalhar agora)
- v0.5: AbacatePay, [[Split de Pagamento]], [[Smart Routing]] (políticas), [[Dunning]] — épicos a refinar quando v0.1 estiver perto
- v1: 3º conector de cartão (Pagar.me vs Stripe — ver [[Decisões]]), failover multi-PSP real, edição enterprise
