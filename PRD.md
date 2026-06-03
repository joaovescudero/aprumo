# Aprumo — Product Requirements Document

**Versão**: 0.1 (draft)
**Última atualização**: 2026-05-18
**Status**: pre-alpha, design partners apenas

---

## TL;DR

Aprumo é uma camada open-source de razão financeira (ledger / livro razão) totalmente agnóstica a provedor de pagamentos. Conecta-se a qualquer gateway/BaaS via uma interface padronizada de conectores e funciona como **fonte da verdade contábil** sobre tudo o que se movimenta nesses provedores — sem custodiar dinheiro.

O produto resolve três dores das empresas de receita recorrente brasileiras: redundância de BaaS feita à mão, split de pagamento caro e ruim, e fragmentação de dados financeiros entre provedores.

**Posicionamento**: *"O ledger imutável e o roteador de pagamentos que sua empresa de receita recorrente precisava ter desde o dia 1, sem ficar refém de um único PSP."*

---

## 1. Visão e objetivos

### 1.1 Visão de longo prazo
Tornar-se a camada padrão de razão financeira para fintechs, marketplaces e empresas de receita recorrente no Brasil — open-source, agnóstica a PSP, com ecossistema de conectores construído pela comunidade. Espelho moderno do papel que o Postgres ocupa em dados gerais, ou Kubernetes em orquestração.

### 1.2 Objetivos do MVP (v0.1)
1. Validar que o modelo agnóstico resolve dor real com 2-3 design partners brasileiros usando Starkbank.
2. Estabelecer credibilidade técnica (imutabilidade, ACID estrito, double-entry, contract tests de conector) que justifique adoção em produção.
3. Publicar como projeto OSS com licença MIT, repositório público no GitHub e primeiros pacotes no npm.

### 1.3 Não-objetivos do MVP
- Custódia de dinheiro / virar Instituição de Pagamento (BACEN).
- Armazenamento próprio de PAN (cartão).
- Dashboards / UI rica.
- Suporte a moedas estrangeiras.
- Mais de 2 conectores no MVP (Starkbank em v0.1, AbacatePay em v0.5).

---

## 2. Problema

### 2.1 Contexto de mercado
Empresas de receita recorrente brasileiras operam tipicamente com 1-2 PSPs (Stripe, Pagar.me, Asaas, Iugu, Starkbank, AbacatePay, etc.) e enfrentam:

- **Fragmentação de dados**: cada PSP expõe seu próprio modelo, formato de webhook, semântica de saldo, granularidade de evento. Conciliar é trabalho manual ou de scripts caseiros frágeis.
- **Risco de concentração**: depender de um único PSP gera risco operacional (outage, mudança de termos, deplataformização) e risco comercial (taxas, ausência de negociação).
- **Churn involuntário**: cartões que falham por motivos transitórios (rede, autorização, antifraude) frequentemente não são re-tentados de forma inteligente, virando cancelamento.
- **Split de pagamento ruim**: PSPs cobram adicional sobre o bruto para fazer split, e oferecem políticas pobres (proporção fixa, sem combinação multi-beneficiário, sem reconciliação clara).

### 2.2 Dores específicas (validar com design partners)
1. **Redundância manual**: "Quando o Stripe cai, perdemos faturamento. Implementar fallback para outro PSP exige refazer toda a integração."
2. **Split caro**: "Pagamos X% adicional só para o PSP fazer split, calculado sobre o bruto, e ainda assim a UX é pobre."
3. **Conciliação dolorosa**: "Fechamento de mês é uma planilha gigante onde cruzamos webhooks de 3 fontes diferentes."
4. **Sem fonte da verdade**: "Quando o time financeiro pergunta 'qual é o saldo a receber?', a resposta depende de qual sistema você consulta."

---

## 3. Persona-alvo (MVP)

**Empresa de receita recorrente brasileira**, faixa de 50–5.000 clientes pagantes, faturamento mensal recorrente de R$ 100k–R$ 10M.

Perfil:
- SaaS B2B/B2C, assinaturas, ed-tech, infoprodutos, marketplaces de serviço.
- Time de engenharia entre 5 e 50 pessoas; pelo menos 1 dev sênior backend.
- Já usa pelo menos 1 PSP. Sente alguma dor em conciliação ou churn por cartão.
- Stack majoritariamente Node/TypeScript ou comparável (Python, Go) — vai consumir API REST + webhooks.
- Não tem (e não quer ter) licença de IP do BACEN.

Comprador econômico: CTO, head de engenharia ou head financeiro. Decisão técnica + decisão de risco operacional.

---

## 4. Solução

### 4.1 Conceito
Um serviço em backend (Node + Postgres) que:

1. **Registra** toda movimentação financeira como lançamentos contábeis double-entry num PG configurado como livro razão imutável.
2. **Ingere** eventos dos PSPs via webhooks; cada conector normaliza o payload do seu PSP para um modelo canônico.
3. **Reconcilia** automaticamente: para cada evento normalizado, o core aplica os postings corretos no ledger.
4. **Emite** webhooks de saída assinados para os clientes do Aprumo (a empresa que está usando o produto), permitindo que eles reajam a "cobrança paga", "transferência confirmada", etc., a partir de uma fonte única.
5. **Orquestra** ações externas (criar cobrança, sacar, transferir) via conectores, abstraindo o PSP por trás.

### 4.2 Princípios não-negociáveis
- **Imutabilidade**: tabelas de fato são append-only, garantido em três camadas (permissão PG, API interna única, audit shadow).
- **ACID estrito**: isolamento `SERIALIZABLE`. Idempotência por design.
- **Agnosticismo**: nenhum conector é privilegiado. Mover de PSP A para PSP B é trocar um pacote npm.
- **Sem custódia**: dinheiro permanece nos PSPs. Aprumo nunca segura saldo dos clientes.
- **Qualidade industrial**: 90% cobertura LoC em testes unitários, edge cases obrigatórios, contract tests para conectores.

### 4.3 Componentes
- **Core ledger** (`@aprumo/core`): API REST, schema PG, função `post_transaction`, worker incremental de saldo, job de reconciliação.
- **Connector base** (`@aprumo/connector-base`): interface `LedgerConnector` + suite de contract tests + helpers (HMAC, money).
- **Conectores específicos**: `@aprumo/connector-starkbank` (v0.1), `@aprumo/connector-abacatepay` (v0.5), futuramente Pagar.me/Stripe.
- **Webhooks** (`@aprumo/webhooks`): endpoint genérico de ingestão + dispatcher de saída.

---

## 5. Requisitos funcionais

### 5.1 v0.1 — Ledger funcional ponta a ponta

#### RF-1: Registrar transação double-entry
- API: `POST /transactions` com array de postings (mínimo 2, soma zero).
- Aceita `Idempotency-Key` header → UNIQUE em `transactions.idempotency_key`.
- Persiste atomicamente em `transactions` + `postings`.
- Rejeita transações que não somem zero por `transaction_id` (constraint deferred).
- Retorna `transaction_id` e os postings persistidos.

#### RF-2: Consultar conta e extrato
- `GET /accounts/:id` → metadata + saldo materializado (de `account_balance`).
- `GET /accounts/:id/postings?cursor=&limit=` → extrato paginado, ordenado por `posting.id` desc.

#### RF-3: Criar conta
- `POST /accounts` com `type` (asset/liability/revenue/expense/equity) e `metadata`.

#### RF-4: Conector Starkbank
- Implementa `createPayment` (PIX, boleto, cartão via tokenização).
- Implementa `getBalance`.
- Implementa `withdraw` (PIX, TED).
- Implementa `parseWebhook` normalizando eventos do Starkbank em `NormalizedEvent` canônico.
- Valida assinatura do webhook do Starkbank.
- Mapeia erros do Starkbank em categorias do core (`retryable`, `terminal`, `validation`).

#### RF-5: Webhooks de entrada (ingestão)
- `POST /webhooks/:provider` — endpoint genérico.
- Despacha para o conector apropriado, valida assinatura, persiste em `raw_events`.
- Enfileira job pg-boss `process-webhook` **na mesma transação Postgres** (exact-once).
- Worker `process-webhook` aplica postings via `post_transaction`.
- Duplicatas (mesma `(provider, provider_event_id)`) retornam 200 OK sem reprocessar.

#### RF-6: Webhooks de saída
- Cliente do Aprumo registra URLs via `POST /outbound-endpoints` com `secret` e tipos de evento desejados.
- Dispatcher pg-boss envia eventos com `X-Aprumo-Signature: sha256=<hmac>` header.
- Retry exponencial (1s, 5s, 30s, 5min, 30min, 2h — configurável).
- Dead-letter após 6 tentativas. Endpoint admin para reprocessar.
- Tipos de evento v0.1: `charge.paid`, `charge.failed`, `dispute.opened`, `transfer.confirmed`.

#### RF-7: Worker de saldo
- Worker incremental consome `postings` em ordem desde `last_posting_id`.
- Atualiza `account_balance(account_id, balance, last_posting_id, updated_at)`.
- Lock por `account_id` para concorrência (`SELECT FOR UPDATE`).
- Job diário recalcula do zero e compara, alerta em divergência.
- Métrica de lag exposta (segundos entre posting e atualização).

#### RF-8: Conciliação automática
- Worker `reconcile` consome `raw_events` ainda não conciliados.
- Para cada evento, identifica a regra do tipo e aplica `post_transaction`.
- Marca evento como conciliado (relação `event_id ↔ transaction_id`).

### 5.2 v0.5 — Capacidades de produto

#### RF-9: Conector AbacatePay
Mesma interface do RF-4, focado em PIX.

#### RF-10: Split de pagamento
- Cobrança aceita array de beneficiários com `account_id` + valor/percentual.
- Gera múltiplos postings na mesma transação (split contábil em t=0).
- Liquidação física desacoplada: worker observa contas internas com saldo "a transferir" + regras de cadência (T+N, threshold mínimo, dia útil) e orquestra `withdraw` via conector.
- Cada transferência gera novo conjunto de postings.

#### RF-11: Smart routing (failover lógico)
- Políticas configuráveis por tipo de cobrança e conector:
  - Timeout (ms)
  - Política de retry (número de tentativas, backoff)
  - Classificação de erro retryável vs. terminal
- Aplicação no MVP: retry inteligente no **mesmo PSP**. Multi-PSP fica para v1 com 3º conector.

#### RF-12: Dunning
- Política de retry no tempo (1d, 3d, 7d — configurável).
- Marcação de assinaturas em `past_due` após falhas consecutivas.
- Notificação via webhook de saída (`charge.failed`).
- Implementado sobre pg-boss schedules.

---

## 6. Requisitos não-funcionais

### 6.1 Garantias do ledger
- **Imutabilidade**: tabelas `postings` e `raw_events` são append-only. `REVOKE UPDATE, DELETE` na role da aplicação. Auditado em CI por teste que tenta `UPDATE` e espera falha.
- **ACID**: isolation level `SERIALIZABLE`. Retry de `40001` (serialization failure) em até 3 tentativas no nível de aplicação.
- **Double-entry**: constraint deferred valida `SUM(amount_cents) = 0` por `transaction_id` no COMMIT. Único caminho de escrita é a função SQL `post_transaction(postings[])`.
- **Idempotência**: `UNIQUE (idempotency_key)` em `transactions`, `UNIQUE (provider, provider_event_id)` em `raw_events`.

### 6.2 Disponibilidade e performance
- **Target inicial** (v0.1): 100 RPS sustentados em hardware modesto (4 vCPU, 16GB), p99 < 200ms para `POST /transactions`.
- **Lag de saldo**: < 1s entre commit do posting e atualização de `account_balance` em condição normal.
- **Throughput de webhook**: 50 eventos/s entrada, com exact-once garantido.

### 6.3 Observabilidade
- Logging estruturado (pino), com redact de PII e secrets.
- Métricas Prometheus: latência por endpoint, lag de worker de saldo, fila pg-boss (jobs pending/active/failed), dead-letter de webhook saída.
- Health checks `GET /health` (liveness + readiness, com check de PG).

### 6.4 Segurança
- Nenhum PAN armazenado (PCI-DSS SAQ-A).
- Secrets via env vars ou secret manager — nunca em código.
- HMAC SHA-256 em webhooks de entrada e saída.
- Logs sem PII e sem payload bruto em produção.

### 6.5 Qualidade de código
- **Test-Driven Development obrigatório**. Todo código de produção começa por um teste falhando. Ciclo Red → Green → Refactor aplicado a toda mudança que altera comportamento observável. PRs sem teste correspondente não são aceitos — exceções: docs, refactor puro (sem mudança de comportamento), tooling/build. Bugfixes começam reproduzindo o bug como teste falhando.
- TypeScript estrito, sem `any`.
- 90% cobertura LoC em `@aprumo/core` (gate de CI) — consequência natural do TDD, não substituto.
- Contract tests obrigatórios para conectores.
- Conventional Commits, Changesets, PR review obrigatório no `main`.

---

## 7. Compliance e regulação

- **BACEN**: não vira Instituição de Pagamento (sem custódia). Não precisa de licença, capital mínimo, nem reporting regulatório.
- **PCI-DSS**: SAQ-A (sem PAN no nosso sistema), via tokenização exclusiva dos gateways. Documentado e auditável desde o commit 1.
- **LGPD**: dados financeiros + PII de pagador. Bases legais definidas, política de retenção, logs sem PII. Direito de portabilidade via export.
- **SOC2 / ISO 27001**: não exigido no MVP, mas pavimentado (audit trail nativo do ledger é a base).

---

## 8. Arquitetura (resumo)

### 8.1 Stack
- TypeScript estrito, Node 22+
- Fastify (HTTP)
- Postgres 16+ puro (single-DB; TigerBeetle avaliado e descartado)
- pg-boss (workflow/fila no mesmo PG)
- Vitest + coverage v8
- pnpm workspaces (monorepo)
- Biome (lint + format)
- Drizzle (migrations, preferência — ratificar em ADR)
- Changesets (release)

### 8.2 Modelo do ledger
- `accounts` (asset/liability/revenue/expense/equity)
- `transactions` (com `idempotency_key UNIQUE`)
- `postings` (append-only, balanceados via constraint)
- `raw_events` (append-only, `UNIQUE (provider, provider_event_id)`)
- `account_balance` (materializado por worker incremental)
- `outbound_endpoints`, `outbound_events` (webhooks de saída)
- `*_audit` shadow para tabelas mutáveis

### 8.3 Interface do conector
```ts
interface LedgerConnector {
  createPayment(input: CreatePaymentInput): Promise<PaymentRef>
  getBalance(account: AccountRef): Promise<Money>
  withdraw(input: WithdrawInput): Promise<WithdrawalRef>
  parseWebhook(raw: RawWebhook): NormalizedEvent
}
```
Contract tests em `@aprumo/connector-base` garantem comportamento consistente.

---

## 9. Decisões arquiteturais fechadas

ADRs vivem em `docs/adr/`. Resumo:

| # | Decisão | Justificativa |
|---|---|---|
| ADR-001 | Postgres puro como engine do ledger | Maturidade, ecossistema, performance suficiente. TigerBeetle adiciona complexidade operacional sem ganho significativo no MVP. |
| ADR-002 | Fastify como framework HTTP | Maduro, performante, JSON Schema nativa, padrão de facto em fintechs Node. Hono descartado (caso edge stateless). |
| ADR-003 | pg-boss como engine de workflow | Mesmo PG do ledger → exact-once de webhook por construção (enfileiramento na mesma tx). trigger.dev no radar para v1+. |
| ADR-004 | Worker incremental para saldo | Latência sub-segundo, O(delta) sempre. View materializada cresce O(N) sobre o histórico. |
| ADR-005 | Split contábil + liquidação assíncrona | Funciona em qualquer PSP, mesmo sem split nativo. Ledger é fonte da verdade. |
| ADR-006 | Faseamento v0.1 / v0.5 | Encurta ciclo até primeiro feedback real. |
| ADR-007 | Smart routing como failover lógico no MVP | Failover multi-PSP exigiria 3º conector (custo alto). MVP foca em retry inteligente. |
| ADR-008 | Licença MIT no core + edição enterprise | Máxima adoção via OSS. Monetização via dashboards, SLAs, multi-tenancy gerenciado. |

---

## 10. Métricas de sucesso

### 10.1 v0.1 (validação de tese)
- **2-3 design partners** integrando e em uso real (não apenas avaliação).
- **Cobertura de testes** ≥ 90% LoC em `@aprumo/core`.
- **Zero perda de dado** em ingestão de webhook ao longo de 30 dias de operação dos design partners.
- **Lag de saldo** p99 < 1s em condições normais.
- **GitHub**: 100+ stars, 5+ contribuidores externos identificados (mesmo que sem PR ainda).

### 10.2 v0.5 (capacidades de produto)
- 2º conector (AbacatePay) com paridade de contract tests.
- Split em produção em pelo menos 1 design partner.
- Smart routing reduzindo churn por cartão em ≥10% nos design partners que tiverem volume.
- 200+ stars no GitHub, 10+ contribuidores.

---

## 11. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| **Smart routing limitado** (só Starkbank no MVP, sem failover real multi-PSP) | Reposicionar comunicação do MVP como "failover lógico + ledger imutável"; failover multi-PSP entra com 3º conector na v1. |
| **Confusão de marca com Aprimo (DAM, USA)** — 1 letra de diferença | Aceitar como custo de SEO gerenciável; investir em autoridade própria (conteúdo técnico, posts, palestras). |
| **AWS-style fork da edição enterprise** | Moat tem que vir de execução, comunidade e ecossistema de conectores — não da licença. |
| **Adoção lenta no Brasil** (mercado conservador) | Design partners primeiro, conteúdo técnico de qualidade, foco em casos concretos (case studies). |
| **Bug em produção causando perda contábil** | Invariantes em camadas (permissão PG + função única + audit). Testes obrigatórios de edge cases. Reconciliação diária com alerta. |
| **PSP muda API quebra conector** | Contract tests pegam a quebra antes do release. Versionamento estrito do conector (SemVer). |

---

## 12. Decisões em aberto

1. **Registro INPI** nas classes 9, 36, 42 antes do launch público de v0.1.
2. **Aquisição de domínios** `aprumo.com`, `aprumo.com.br`, `aprumo.io`.
3. **GitHub org + npm scope** `aprumo` / `@aprumo`.
4. **Lib de migration**: Drizzle (preferência) vs Kysely vs node-pg-migrate — ratificar em ADR.
5. **3º conector de cartão** (Pagar.me vs Stripe) — decidir antes de iniciar v0.5.
6. **Identidade visual** (wordmark, paleta) — placeholder OK para v0.1, refinar para launch público.

---

## 13. Inspirações de mercado

- [Formance](https://formance.com) — ledger open-source, linguagem Numscript própria.
- [Modern Treasury Ledgers](https://www.moderntreasury.com/products/ledgers) — ledger gerenciado SaaS.
- [TigerBeetle](https://tigerbeetle.com/) — DB de transações financeiras em Zig (avaliado e descartado para v0.1).
- [Hyperswitch](https://hyperswitch.io/) — orquestrador de pagamentos OSS da Juspay (Apache 2.0).
- [Fragment](https://fragment.dev/) — ledger-as-a-service adquirido pela Stripe.

---

## 14. Histórico de revisões

| Data | Versão | Mudanças |
|---|---|---|
| 2026-05-18 | 0.1 (draft inicial) | Documento criado a partir do vault Obsidian. Naming "Aprumo" fechado. Decisões técnicas ADR-001 a 008 fechadas. |
