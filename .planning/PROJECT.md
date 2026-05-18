# Aprumo

## What This Is

Camada open-source de razão financeira (livro razão / ledger) **agnóstica a provedor de pagamentos**, em Node + Postgres. Conecta a gateways/BaaS via conectores plugáveis e atua como **fonte da verdade contábil** sobre tudo que se movimenta nesses provedores — sem custodiar dinheiro. Persona-alvo: empresas brasileiras de receita recorrente (SaaS, assinaturas, ed-tech, infoprodutos) com 50–5.000 clientes pagantes.

## Core Value

Ledger imutável, ACID estrito, double-entry, agnóstico a PSP — se isso não funcionar com integridade contábil 100%, o produto não existe.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

(None yet — pre-alpha, design partners ainda hipotéticos)

### Active

<!-- v0.1 scope: ledger funcional ponta a ponta + 1º conector (Starkbank). REQ-IDs em REQUIREMENTS.md. -->

- [ ] Schema PG do ledger (accounts, transactions, postings, raw_events, account_balance, *_audit) com imutabilidade enforced em 3 camadas (permissão + função única + audit shadow)
- [ ] Função SQL `post_transaction(postings[])` com validação de balanceamento double-entry no COMMIT
- [ ] API REST Fastify: POST/GET transactions, POST/GET accounts, GET extrato paginado, health, OpenAPI
- [ ] Idempotência ponta a ponta (Idempotency-Key + UNIQUE(provider, provider_event_id))
- [ ] Worker incremental de saldo (lag p99 < 1s) + job diário de reconciliação com alerta de divergência
- [ ] `@aprumo/connector-base`: interface `LedgerConnector` + contract test suite + HMAC helpers
- [ ] Conector Starkbank (createPayment PIX/boleto/cartão, getBalance, withdraw, parseWebhook, mapeamento de erros) passando contract tests
- [ ] Webhooks de entrada: endpoint genérico, dispatch por registry, INSERT raw_events + enqueue pg-boss na **mesma tx Postgres** (exact-once), duplicata → 200 OK
- [ ] Worker `process-webhook` aplicando postings via `post_transaction`
- [ ] Worker de reconciliação automática (raw_events → postings)
- [ ] Webhooks de saída assinados (HMAC SHA-256), retry exponencial, dead-letter após 6 tentativas, admin replay
- [ ] Eventos de saída v0.1: `charge.paid`, `charge.failed`, `dispute.opened`, `transfer.confirmed`
- [ ] Monorepo pnpm scaffold (`@aprumo/core`, `@aprumo/connector-base`, `@aprumo/connector-starkbank`, `@aprumo/webhooks`)
- [ ] CI/CD: lint (Biome) + typecheck + Vitest com gate 90% LoC em `@aprumo/core` + contract tests + Changesets
- [ ] Dev env: docker-compose Postgres 16+, roles `aprumo_app` / `aprumo_migration`, `pnpm db:reset`, seed mínimo
- [ ] Migrations via Drizzle (ratificado — ADR-009)
- [ ] Documentação: quickstart self-host, Swagger, guia "como implementar um conector", concepts (double-entry/idempotência/imutabilidade)
- [ ] ADRs 001–008 escritas e versionadas em `docs/adr/`
- [ ] Release v0.1.0 dos pacotes no npm (`@aprumo/core`, `@aprumo/connector-starkbank`, `@aprumo/webhooks`)

### Out of Scope

<!-- Explicit boundaries. -->

- **Custódia de dinheiro** — vira Instituição de Pagamento (BACEN), inviável e contra o posicionamento. Aprumo nunca segura saldo.
- **Armazenamento de PAN** — mantém escopo PCI em SAQ-A; tokenização exclusiva dos gateways.
- **Dashboards / UI rica** — reservado para edição enterprise; OSS é backend + API + docs.
- **Moedas estrangeiras** — só BRL no MVP; persona é exclusivamente brasileira.
- **2º conector no v0.1** — AbacatePay fica para v0.5; Pagar.me/Stripe v1+.
- **Split de pagamento, smart routing real multi-PSP, dunning** — v0.5; v0.1 entrega ledger + 1 PSP.
- **Failover multi-PSP de verdade** — exige 3º conector; v0.1 entrega "failover lógico" (retry inteligente no mesmo PSP).
- **Hosted instance gerenciado** — design partners self-host via docker-compose. Hosted = enterprise futuro.
- **TigerBeetle/ScyllaDB/qualquer DB que não seja Postgres puro** — ADR-001 fechou; complexidade operacional sem ganho no MVP.
- **Fila externa (trigger.dev, BullMQ)** — pg-boss obrigatório por exact-once de webhook na mesma tx Postgres (ADR-003).
- **Branding/INPI/domínios/GitHub org setup** — fora do escopo das fases GSD; o usuário trata em paralelo.

## Context

**Pré-trabalho extenso já existe no repo:**
- `PRD.md` v0.1 (draft) — vision, problem, persona, RF-1 a RF-12, NFRs, ADRs 001–008, métricas de sucesso, riscos.
- `CLAUDE.md` (project) — invariantes críticos, stack fechado, schema, comandos, convenções, regras TDD.
- `Tarefas v0.1.md` — backlog detalhado pré-v0.1 + v0.1 com tags por área.

**Inspirações de mercado:** Formance (Numscript), Modern Treasury Ledgers (SaaS), TigerBeetle (avaliado/descartado), Hyperswitch (orquestrador OSS Juspay), Fragment (ledger-as-a-service, Stripe).

**Dores validadas hipoteticamente** (precisam confirmação com design partners):
1. Redundância manual entre PSPs.
2. Split caro cobrado pelos PSPs sobre o bruto.
3. Conciliação dolorosa entre webhooks de múltiplas fontes.
4. Ausência de fonte única da verdade contábil.

**Status atual:** pre-alpha. Zero código de produção escrito. Repo greenfield com docs apenas. Design partners ainda **hipotéticos** — outreach é parte do trabalho do MVP.

## Constraints

- **Tech stack (fechado)**: TypeScript estrito Node 22+, Fastify, Postgres 16+ puro, pg-boss, Vitest+v8, pnpm workspaces, Biome, Drizzle, Changesets. Trocar exige ADR nova.
- **Time**: dev solo. Implica granularidade conservadora, escopo defendido com rigor.
- **Timeline**: sem deadline duro. Qualidade > velocidade. TDD não-negociável.
- **Cobertura**: gate 90% LoC em `@aprumo/core`, 80% nos outros pacotes. Reprovação de CI bloqueia merge.
- **Compliance**: PCI SAQ-A (sem PAN), LGPD (logs sem PII, retenção definida), sem licença BACEN (não custodiar).
- **Performance v0.1**: 100 RPS sustentado em 4 vCPU/16GB, p99 `POST /transactions` < 200ms, lag de saldo p99 < 1s, throughput webhook 50 eventos/s.
- **Licença**: MIT no core; edição enterprise (paga) reservada para dashboards/SLAs/multi-tenant gerenciado.
- **Distribuição**: design partners self-host via docker-compose; não há instância gerenciada no MVP.
- **Invariantes**: imutabilidade, double-entry balanceado, idempotência, exact-once de webhook, isolation SERIALIZABLE, audit shadow obrigatório, sem PAN, valores em `BIGINT amount_cents`. Violação = bug grave.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| ADR-001: Postgres puro como engine do ledger (TigerBeetle descartado) | Maturidade, ecossistema, performance suficiente; complexidade operacional do TB sem ganho no MVP | ✓ Good |
| ADR-002: Fastify como framework HTTP | Padrão de facto em fintechs Node, JSON Schema nativo | ✓ Good |
| ADR-003: pg-boss como engine de workflow | Mesmo PG do ledger → exact-once de webhook por construção (enqueue na mesma tx) | ✓ Good |
| ADR-004: Worker incremental para saldo (vs view materializada) | Latência sub-segundo, O(delta) sempre vs O(N) histórico | ✓ Good |
| ADR-005: Split contábil instantâneo + liquidação assíncrona | Funciona em qualquer PSP mesmo sem split nativo | — Pending (v0.5) |
| ADR-006: Faseamento v0.1 / v0.5 | Encurta ciclo até primeiro feedback real | ✓ Good |
| ADR-007: Smart routing como failover lógico no MVP | Failover multi-PSP exige 3º conector; v0.1 foca retry inteligente | — Pending (v0.5) |
| ADR-008: Licença MIT no core + edição enterprise | Adoção máxima via OSS; monetização via dashboards/SLAs/multi-tenant | — Pending |
| ADR-009: Drizzle como lib de migrations | Preferência por DX e tipos; ratificado durante questioning | — Pending (escrever ADR no Phase 1) |
| Pré-v0.1 brand/INPI/domains fora do escopo GSD | Usuário trata em paralelo; GSD foca código + dev env + docs | — Pending |
| Design partners hipotéticos no início do projeto | Outreach é parte do trabalho do MVP; não bloqueia construção do ledger | — Pending |
| Dev solo | Granularidade conservadora; defende escopo | — Pending |
| Self-host via docker-compose para design partners | Coerente com posicionamento OSS; hosted = enterprise futuro | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-18 after initialization*
