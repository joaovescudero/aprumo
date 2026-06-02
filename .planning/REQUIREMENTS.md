# Requirements: Aprumo

**Defined:** 2026-05-18
**Core Value:** Ledger imutável, ACID estrito, double-entry, agnóstico a PSP — fonte da verdade contábil sobre tudo que se movimenta nos PSPs, sem custodiar dinheiro.

> Derivado de PRD.md §5.1, complementado por gaps identificados em `.planning/research/SUMMARY.md` (refundPayment + getPayment no contrato, vocabulário 14 eventos, metadata jsonb em transactions, admin endpoint para raw_events não conciliados).

## v1 Requirements (v0.1 release)

### Foundation (FND) — Phase 2

- [x] **FND-01**: Schema PG do ledger criado via migration Drizzle: `accounts(id, type, metadata jsonb, owner_ref, created_at)` com `type IN (asset, liability, revenue, expense, equity)`
- [x] **FND-02**: Migration `transactions(id, idempotency_key UNIQUE NOT NULL, ts, description, source, metadata jsonb)` — reservar `metadata` desde v0.1
- [x] **FND-03**: Migration `postings(id, transaction_id FK, account_id FK, amount_cents BIGINT, direction IN(debit,credit))` — append-only
- [x] **FND-04**: Migration `raw_events(id, provider, provider_event_id, received_at, payload_jsonb, transaction_id FK NULL, status, UNIQUE(provider, provider_event_id))` — append-only
- [x] **FND-05**: Migration `account_balance(account_id PK FK, balance BIGINT, last_posting_id, updated_at)`
- [x] **FND-06**: Migration de tabelas `*_audit` (accounts_audit, configs_audit, customers_audit, outbound_endpoints_audit) com trigger `AFTER UPDATE/DELETE`
- [x] **FND-07**: Roles PG separadas: `aprumo_app` (SELECT/INSERT only, sem UPDATE/DELETE em postings/raw_events), `aprumo_migration` (DDL completo + DEFAULT PRIVILEGES)
- [x] **FND-08**: `REVOKE UPDATE, DELETE` em postings + raw_events para role `aprumo_app` (auditado por teste de CI que tenta UPDATE e espera falha)
- [x] **FND-09**: Função SQL `post_transaction(postings[])` valida balanceamento (SUM com sinal = 0), persiste transactions + postings atomicamente, é o ÚNICO caminho de escrita em postings
- [x] **FND-10**: CONSTRAINT TRIGGER (DEFERRABLE INITIALLY DEFERRED, NÃO CHECK) valida double-entry `SUM(amount_cents com sinal) = 0` por transaction_id no COMMIT
- [x] **FND-11**: CI verifica que constraint trigger está DEFERRABLE+DEFERRED ativa após cada migração (`pg_constraint` query)
- [x] **FND-12**: Docker-compose dev: Postgres 16+, com env-vars de roles, autovacuum tuning para pg-boss
- [x] **FND-13**: `pnpm db:reset` destrói e recria DB local; `pnpm db:migrate` aplica migrations
- [x] **FND-14**: Seed mínimo dev (1 customer, 2 contas, 1 transaction de exemplo) via `post_transaction` (nunca INSERT direto)
- [x] **FND-15**: Drizzle migration hash check em CI (falha em migração editada após commit)
- [x] **FND-16**: Testcontainers globalSetup com container Postgres compartilhado + isolamento por schema por arquivo de teste
- [x] **FND-17**: ADR-009 (Drizzle ratificado) escrita em `docs/adr/`
- [x] **FND-18**: ADRs 001–008 portadas para `docs/adr/` em formato MADR

### Infrastructure (INF) — Phase 1

- [ ] **INF-01**: `pnpm-workspace.yaml` + `package.json` raiz com pacotes `@aprumo/core`, `@aprumo/connector-base`, `@aprumo/connector-starkbank`, `@aprumo/webhooks`
- [ ] **INF-02**: `tsconfig.base.json` com `strict: true`, `noUncheckedIndexedAccess: true`, target Node 22+
- [ ] **INF-03**: Biome configurado para lint + format em todos os pacotes (Biome 2.4+)
- [ ] **INF-04**: Vitest configurado com coverage v8, gate 90% LoC em `@aprumo/core`, 80% nos demais
- [x] **INF-05**: `commitlint` + Conventional Commits em pre-commit hook
- [x] **INF-06**: Pre-commit secret scanning (lefthook + detect-secrets ou equivalente) — bloqueia commit de chaves ECDSA/HMAC
- [ ] **INF-07**: `.gitignore` cobre `.env*`, `*.key`, `secrets/`, build artifacts
- [x] **INF-08**: GitHub Actions: matriz Node 22/24, jobs lint+typecheck+test+coverage gate+contract tests+build
- [x] **INF-09**: Changesets configurado com `updateInternalDependencies: patch`, sem `linked`, para versionamento independente por pacote
- [x] **INF-10**: CI bloqueia PR sem changeset quando há mudanças em pacote publicável

### Core Ledger API (API) — Phase 3

- [x] **API-01**: Fastify 5+ configurado com `coerceTypes: false`, JSON Schema validation, `@fastify/swagger`
- [x] **API-02**: Serializer custom de BigInt → JSON string em todas as respostas (`amount_cents`, IDs); `JSON.stringify(bigint)` nunca permitido cru
- [x] **API-03**: `POST /transactions` aceita postings + `Idempotency-Key` header; chama `post_transaction()`; retorna 201 com transaction + postings persistidos
- [x] **API-04**: `POST /transactions` rejeita postings que não somam zero por transaction_id (erro 422 da CONSTRAINT TRIGGER mapeado)
- [x] **API-05**: Idempotência: `Idempotency-Key` duplicada retorna 200 com tx original (UNIQUE + ON CONFLICT pattern), nunca reprocessa
- [x] **API-06**: `GET /transactions/:id` retorna transaction + postings ordenados
- [x] **API-07**: `POST /accounts` cria conta com `type` (asset/liability/revenue/expense/equity) + `metadata`
- [x] **API-08**: `GET /accounts/:id` retorna metadata + saldo materializado de `account_balance`
- [x] **API-09**: `GET /accounts/:id/postings?cursor=&limit=` retorna extrato paginado por `posting.id` desc
- [x] **API-10**: `withRetryOnSerializationFailure` wrapper: captura SQLSTATE 40001, retry até 3x com backoff exponencial; envolve toda `db.transaction()`
- [x] **API-11**: Error handler global Fastify: 40001 esgotado → 503, validation → 422, idempotency conflict → 200 (com tx original)
- [x] **API-12**: `GET /health` (liveness + readiness, inclui check de PG)
- [x] **API-13**: OpenAPI spec gerado automaticamente, com `amount_cents` documentado como JSON string

### Balance Worker (BAL) — Phase 4

- [ ] **BAL-01**: pg-boss 12.18+ startup + graceful shutdown integrado ao processo worker
- [ ] **BAL-02**: Queue `balance-update` definida via `createQueue()` com config de retention
- [ ] **BAL-03**: Worker `balance-worker` consome postings WHERE id > last_posting_id ORDER BY id; aplica delta em `account_balance`
- [ ] **BAL-04**: Lock por `account_id` (`SELECT ... FOR UPDATE`) para concorrência
- [ ] **BAL-05**: Cursor `last_posting_id` persistido por worker; idempotente em restart
- [ ] **BAL-06**: Lag p99 < 1s entre commit do posting e atualização de balance (medido em teste de carga local)
- [ ] **BAL-07**: Job pg-boss diário recalcula saldo do zero, compara com `account_balance`, alerta em divergência
- [ ] **BAL-08**: Métrica Prometheus `aprumo_balance_worker_lag_seconds`, `aprumo_balance_worker_processed_total`

### Connector Interface (CNB) — Phase 5

- [ ] **CNB-01**: `@aprumo/connector-base` zero-dep, exporta interface `LedgerConnector` com 6 métodos: `createPayment`, `getPayment`, `refundPayment`, `getBalance`, `withdraw`, `parseWebhook`
- [ ] **CNB-02**: Tipos canônicos exportados: `PaymentRef`, `Money` (branded bigint), `NormalizedEvent`, `WithdrawalRef`, `RefundRef`, `RawWebhook`
- [ ] **CNB-03**: Helpers HMAC SHA-256: `signOutboundWebhook(payload, secret)`, `verifyInboundHmac(payload, signature, secret)` com `timingSafeEqual` e janela de tolerância timestamp
- [ ] **CNB-04**: Suite de contract tests exportada via subpath export `@aprumo/connector-base/contract` (TS pré-compilado); roda contra qualquer conector
- [ ] **CNB-05**: `FakeConnector` de referência em `@aprumo/connector-base` para validar que core não vazou conceitos do Starkbank
- [ ] **CNB-06**: CI valida que `@aprumo/core` NÃO importa `@aprumo/connector-*` (graph check via `pnpm why`)
- [ ] **CNB-07**: Docs: `docs/connectors.md` com guia "como implementar um conector" + exemplo FakeConnector

### Starkbank Connector (SBC) — Phase 6

- [ ] **SBC-01**: `@aprumo/connector-starkbank` usa SDK oficial `starkbank` 2.40+ como peer dep
- [ ] **SBC-02**: `createPayment` suporta PIX, boleto, cartão (via token gateway, sem armazenar PAN)
- [ ] **SBC-03**: `getPayment(ref)` para polling de fallback quando webhook é perdido
- [ ] **SBC-04**: `refundPayment(ref, amount?)` para devolução total ou parcial
- [ ] **SBC-05**: `getBalance` retorna saldo da conta Starkbank
- [ ] **SBC-06**: `withdraw` para PIX e TED
- [ ] **SBC-07**: `parseWebhook` usa `starkbank.event.parse({ content, signature })` (ECDSA via SDK, NUNCA HMAC manual); normaliza para `NormalizedEvent`
- [ ] **SBC-08**: Mapeamento de erros Starkbank → categorias canônicas (`retryable`, `terminal`, `validation`)
- [ ] **SBC-09**: Mock via MSW v2 (`onUnhandledRequest: 'error'`) para todos os testes; nunca nock
- [ ] **SBC-10**: Suite de contract tests do connector-base verde
- [ ] **SBC-11**: Spike documentado: taxonomia de eventos Starkbank (PIX, boleto, cartão, transfer, devolução) com payloads reais do sandbox em `docs/connectors/starkbank-events.md`

### Webhooks Inbound (WHI) — Phase 7

- [ ] **WHI-01**: `POST /webhooks/:provider` endpoint genérico em `@aprumo/webhooks`
- [ ] **WHI-02**: Connector registry (lookup por provider name) inicializado em boot
- [ ] **WHI-03**: Delega para `parseWebhook` do conector apropriado + valida assinatura (ECDSA via SDK Starkbank)
- [ ] **WHI-04**: Transação Postgres SERIALIZABLE: INSERT em `raw_events` + `boss.send('process-webhook', data, { db: fromDrizzle(tx, sql) })` na **mesma tx** (exact-once)
- [ ] **WHI-05**: Duplicata (mesma `(provider, provider_event_id)`) retorna 200 OK sem reprocessar, sem erro
- [ ] **WHI-06**: Worker `process-webhook` consome evento normalizado, aplica `post_transaction` baseado no tipo (`charge.paid`, `transfer.confirmed`, etc.)
- [ ] **WHI-07**: Worker `reconcile` consome `raw_events` ainda não conciliados (status='pending'); aplica regras de posting; marca como `reconciled` ou `failed`
- [ ] **WHI-08**: Dedup business-semantic: para eventos funcionalmente duplicados com diferentes `provider_event_id`, worker verifica se já existe posting para a entidade de negócio (charge.id) antes de aplicar
- [ ] **WHI-09**: Logging pino estruturado com `redact` para CPF, nome, email, tokens, secrets, payload bruto (LGPD)
- [ ] **WHI-10**: Teste de crash-injection: kill -9 entre INSERT e enqueue → recovery não duplica nem perde evento (provado em CI)
- [ ] **WHI-11**: Teste E2E: webhook Starkbank assinado (sandbox) → posting aplicado → saldo atualizado

### Webhooks Outbound (WHO) — Phase 8

- [ ] **WHO-01**: Schema `outbound_endpoints(id, customer_id, url, secret, active, event_types[], created_at)` + `outbound_endpoints_audit`
- [ ] **WHO-02**: Schema `outbound_events(id, endpoint_id, type, payload_jsonb, status, attempts, last_error, next_attempt_at, created_at)`
- [ ] **WHO-03**: `POST /outbound-endpoints` valida secret mínimo 32 bytes; registro retorna endpoint id (secret nunca retornado em GET)
- [ ] **WHO-04**: Worker `outbound-dispatcher` consome `outbound_events status='pending'`; envia POST com header `X-Aprumo-Signature: t=<unix>,sha256=<hmac>` (padrão Stripe)
- [ ] **WHO-05**: Retry exponencial configurável: 1s, 5s, 30s, 5min, 30min, 2h (default)
- [ ] **WHO-06**: Dead-letter após 6 tentativas; eventos marcados `status='dead_letter'`
- [ ] **WHO-07**: `POST /admin/outbound/:id/replay` reprocessa evento em DL
- [ ] **WHO-08**: `GET /admin/raw-events?status=unreconciled` retorna eventos não conciliados para inspeção operacional
- [ ] **WHO-09**: Vocabulário de eventos v0.1 (14 tipos): `charge.pending`, `charge.paid`, `charge.failed`, `charge.captured`, `charge.expired`, `charge.refunded`, `charge.partially_refunded`, `dispute.opened`, `dispute.won`, `dispute.lost`, `transfer.confirmed`, `transfer.failed`, `boleto.paid_overdue`, `pix.refund.completed`
- [ ] **WHO-10**: Schema validation de outbound payload (sem PII; só campos canônicos)
- [ ] **WHO-11**: Teste E2E: ledger posting → outbound event enfileirado → POST recebido pelo cliente com assinatura HMAC válida

### Observability & Compliance (OBS) — Phase 9

- [ ] **OBS-01**: pino redact configurado globalmente: CPF, nome, email, RG, tokens, secrets, raw payload, headers de autorização
- [ ] **OBS-02**: Métricas Prometheus expostas em `/metrics`: latência por endpoint, lag de balance worker, fila pg-boss (jobs pending/active/failed/dead), outbound webhook (sent/failed/dead)
- [ ] **OBS-03**: Health check `/health` (liveness) e `/health/ready` (readiness com check de PG + pg-boss)
- [ ] **OBS-04**: Trace context (W3C traceparent) propagado entre HTTP e worker
- [ ] **OBS-05**: Política de retenção documentada em `docs/lgpd.md` (retenção de logs, basis legal, processo de export)

### Documentation & Release (DOC) — Phase 9

- [ ] **DOC-01**: README com badge "pre-alpha", quickstart (`docker-compose up`, primeiro `POST /transactions`)
- [ ] **DOC-02**: Documentação da API via Swagger UI publicado e link no README
- [ ] **DOC-03**: Guia de implementação de conector (`docs/connectors.md`) com exemplo de FakeConnector
- [ ] **DOC-04**: Seção "Concepts" no docs: double-entry, idempotência, imutabilidade, exact-once de webhook, retry SERIALIZABLE
- [ ] **DOC-05**: `CONTRIBUTING.md` com regras (TDD obrigatório, Conventional Commits, Changesets, contract tests)
- [ ] **DOC-06**: `CODE_OF_CONDUCT.md` (Contributor Covenant)
- [ ] **DOC-07**: `SECURITY.md` com processo de disclosure (responsible disclosure)
- [ ] **DOC-08**: CHANGELOG inicial via Changesets com release notes v0.1.0
- [ ] **DOC-09**: docker-compose de produção self-host: serviço `migrate` explícito (depends_on com `service_completed_successfully`), `api`, `worker` separados, env vars documentadas
- [ ] **DOC-10**: Publicação no npm: `@aprumo/core@0.1.0`, `@aprumo/connector-base@0.1.0`, `@aprumo/connector-starkbank@0.1.0`, `@aprumo/webhooks@0.1.0`

## v2 Requirements (v0.5+)

### Multi-PSP Capabilities

- **CN5-01**: `@aprumo/connector-abacatepay` com paridade de contract tests (PIX focus)
- **CN5-02**: `createToken` para fluxos MIT/recurring de cartão
- **CN5-03**: `cancelPayment` (cancelamento pré-captura/pré-liquidação)
- **CN5-04**: `listEvents` para auditoria histórica via API do PSP

### Product Features (v0.5)

- **PR5-01**: Split de pagamento contábil (multi-beneficiário, postings simultâneos em t=0)
- **PR5-02**: Liquidação física desacoplada (worker observa saldo "a transferir" + regras T+N + threshold)
- **PR5-03**: Smart routing — retry inteligente no mesmo PSP com políticas configuráveis (timeout, retries, error categorization)
- **PR5-04**: Dunning — retry no tempo (1d/3d/7d), assinatura → `past_due`, notificação via webhook
- **PR5-05**: `pending_balance` / `available_balance` distinction (separar postings pendentes)
- **PR5-06**: Dispute lifecycle completo (evidence_submitted, refund/chargeback workflow)
- **PR5-07**: Boleto partial payment (acrescimos modelados como postings separados)

## Out of Scope (v0.1)

| Feature | Reason |
|---------|--------|
| Custódia de dinheiro | Vira Instituição de Pagamento (BACEN); contra o posicionamento |
| Armazenamento de PAN | PCI fora de SAQ-A; usar exclusivamente tokens do gateway |
| Dashboards / UI rica | Reservado para edição enterprise; OSS é backend + API + docs |
| Moedas estrangeiras | Só BRL; persona exclusivamente brasileira |
| Conector AbacatePay | Vai para v0.5 (RF-9 do PRD) |
| Conector Pagar.me/Stripe | v1+ |
| Failover multi-PSP real | Exige 3º conector; v0.1 entrega "failover lógico" via retry |
| Hosted instance gerenciado | Design partners self-host via docker-compose; hosted = enterprise futuro |
| TigerBeetle / outro DB | ADR-001 fechado; Postgres puro |
| Fila externa (trigger.dev, BullMQ) | ADR-003: exact-once exige enqueue na mesma tx PG |
| Subscription management / billing | Anti-feature; Aprumo é ledger, não billing engine |
| Invoice generation | Anti-feature; clientes geram invoices fora |
| Tax calculation | Anti-feature; fora do escopo de ledger |
| P&L / Balance Sheet reports | Anti-feature; ledger é fonte de dados, não reporting |
| Multi-tenancy gerenciado | Anti-feature no OSS; cada cliente = uma instância self-host |
| Branding, INPI, domínios, GitHub org | Usuário trata em paralelo; fora das fases GSD |

## Traceability

Mapped by gsd-roadmapper on 2026-05-18. All 104 v1 requirements mapped to phases.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INF-01 | Phase 1 | Complete |
| INF-02 | Phase 1 | Complete |
| INF-03 | Phase 1 | Complete |
| INF-04 | Phase 1 | Complete |
| INF-05 | Phase 1 | Complete |
| INF-06 | Phase 1 | Complete |
| INF-07 | Phase 1 | Complete |
| INF-08 | Phase 1 | Complete |
| INF-09 | Phase 1 | Complete |
| INF-10 | Phase 1 | Complete |
| FND-01 | Phase 2 | Complete |
| FND-02 | Phase 2 | Complete |
| FND-03 | Phase 2 | Complete |
| FND-04 | Phase 2 | Complete |
| FND-05 | Phase 2 | Complete |
| FND-06 | Phase 2 | Complete |
| FND-07 | Phase 2 | Complete |
| FND-08 | Phase 2 | Complete |
| FND-09 | Phase 2 | Complete |
| FND-10 | Phase 2 | Complete |
| FND-11 | Phase 2 | Complete |
| FND-12 | Phase 2 | Complete |
| FND-13 | Phase 2 | Complete |
| FND-14 | Phase 2 | Complete |
| FND-15 | Phase 2 | Complete |
| FND-16 | Phase 2 | Complete |
| FND-17 | Phase 2 | Complete |
| FND-18 | Phase 2 | Complete |
| API-01 | Phase 3 | Complete |
| API-02 | Phase 3 | Complete |
| API-03 | Phase 3 | Complete |
| API-04 | Phase 3 | Complete |
| API-05 | Phase 3 | Complete |
| API-06 | Phase 3 | Complete |
| API-07 | Phase 3 | Complete |
| API-08 | Phase 3 | Complete |
| API-09 | Phase 3 | Complete |
| API-10 | Phase 3 | Complete |
| API-11 | Phase 3 | Complete |
| API-12 | Phase 3 | Complete |
| API-13 | Phase 3 | Complete |
| BAL-01 | Phase 4 | Pending |
| BAL-02 | Phase 4 | Pending |
| BAL-03 | Phase 4 | Pending |
| BAL-04 | Phase 4 | Pending |
| BAL-05 | Phase 4 | Pending |
| BAL-06 | Phase 4 | Pending |
| BAL-07 | Phase 4 | Pending |
| BAL-08 | Phase 4 | Pending |
| CNB-01 | Phase 5 | Pending |
| CNB-02 | Phase 5 | Pending |
| CNB-03 | Phase 5 | Pending |
| CNB-04 | Phase 5 | Pending |
| CNB-05 | Phase 5 | Pending |
| CNB-06 | Phase 5 | Pending |
| CNB-07 | Phase 5 | Pending |
| SBC-01 | Phase 6 | Pending |
| SBC-02 | Phase 6 | Pending |
| SBC-03 | Phase 6 | Pending |
| SBC-04 | Phase 6 | Pending |
| SBC-05 | Phase 6 | Pending |
| SBC-06 | Phase 6 | Pending |
| SBC-07 | Phase 6 | Pending |
| SBC-08 | Phase 6 | Pending |
| SBC-09 | Phase 6 | Pending |
| SBC-10 | Phase 6 | Pending |
| SBC-11 | Phase 6 | Pending |
| WHI-01 | Phase 7 | Pending |
| WHI-02 | Phase 7 | Pending |
| WHI-03 | Phase 7 | Pending |
| WHI-04 | Phase 7 | Pending |
| WHI-05 | Phase 7 | Pending |
| WHI-06 | Phase 7 | Pending |
| WHI-07 | Phase 7 | Pending |
| WHI-08 | Phase 7 | Pending |
| WHI-09 | Phase 7 | Pending |
| WHI-10 | Phase 7 | Pending |
| WHI-11 | Phase 7 | Pending |
| WHO-01 | Phase 8 | Pending |
| WHO-02 | Phase 8 | Pending |
| WHO-03 | Phase 8 | Pending |
| WHO-04 | Phase 8 | Pending |
| WHO-05 | Phase 8 | Pending |
| WHO-06 | Phase 8 | Pending |
| WHO-07 | Phase 8 | Pending |
| WHO-08 | Phase 8 | Pending |
| WHO-09 | Phase 8 | Pending |
| WHO-10 | Phase 8 | Pending |
| WHO-11 | Phase 8 | Pending |
| OBS-01 | Phase 9 | Pending |
| OBS-02 | Phase 9 | Pending |
| OBS-03 | Phase 9 | Pending |
| OBS-04 | Phase 9 | Pending |
| OBS-05 | Phase 9 | Pending |
| DOC-01 | Phase 9 | Pending |
| DOC-02 | Phase 9 | Pending |
| DOC-03 | Phase 9 | Pending |
| DOC-04 | Phase 9 | Pending |
| DOC-05 | Phase 9 | Pending |
| DOC-06 | Phase 9 | Pending |
| DOC-07 | Phase 9 | Pending |
| DOC-08 | Phase 9 | Pending |
| DOC-09 | Phase 9 | Pending |
| DOC-10 | Phase 9 | Pending |

**Coverage:**
- v1 requirements: 104 total (FND:18, INF:10, API:13, BAL:8, CNB:7, SBC:11, WHI:11, WHO:11, OBS:5, DOC:10)
- Mapped to phases: 104/104 (100%) ✓
- Unmapped: 0 ✓

---
*Requirements defined: 2026-05-18*
*Last updated: 2026-05-18 — traceability populated by gsd-roadmapper*
