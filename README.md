![pre-alpha](https://img.shields.io/badge/status-pre--alpha-red) ![MIT License](https://img.shields.io/badge/license-MIT-blue)

# Aprumo

Camada open-source de razão financeira (livro razão / ledger) **agnóstica a provedor de pagamentos**. Conecta-se a gateways/BaaS via conectores plugáveis e funciona como **fonte da verdade contábil** sobre tudo o que se movimenta nesses provedores — sem custodiar dinheiro.

Target persona: Brazilian recurring-revenue companies (SaaS, subscriptions, ed-tech, infoproducts).

## What it is

Aprumo is an open-source double-entry ledger that sits between your application and your payment service providers (PSPs). It records every financial event from your PSPs with ACID guarantees, maintains double-entry balance invariants, and provides a single source of truth for reconciliation — without ever holding funds or touching card data.

Key properties:
- **Double-entry, ACID-strict** — every transaction balances to zero, serializable isolation
- **Idempotent by design** — re-delivery of webhooks or API calls is safe at every layer
- **Pluggable connectors** — swap or add PSPs without changing your accounting logic
- **Append-only ledger** — `postings` and `raw_events` are immutable; no UPDATE/DELETE

## What it is NOT

- Not a payment processor — Aprumo never holds or moves money
- Not a PCI-in-scope card vault — no PAN storage, ever (SAQ-A scope maintained)
- Not a UI dashboard or analytics product — the core is an API + ledger engine; dashboards are enterprise-edition territory

## Stack

| Layer | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | Node 22+, ESM-only |
| HTTP Framework | Fastify 5 | |
| Database | Postgres 16+ | Single DB, no TigerBeetle |
| Job queue | pg-boss | Same PG instance as ledger |
| Tests | Vitest + coverage v8 | 90% LoC gate on `@aprumo/core` |
| Monorepo | pnpm workspaces | |
| Lint/format | Biome | `recommended` + strict rules |
| Migrations | Drizzle | |
| Releases | Changesets | Independent per-package versioning |

Stack decisions are closed — see `docs/adr/` for rationale. Do not propose alternatives without an ADR.

## Packages

```
packages/
  core/                    # @aprumo/core — ledger schema, post_transaction, REST API, balance worker
  connector-base/          # @aprumo/connector-base — LedgerConnector interface + contract tests
  connector-starkbank/     # @aprumo/connector-starkbank — first connector (v0.1)
  webhooks/                # @aprumo/webhooks — inbound webhook dispatcher + outbound delivery
```

## Quickstart

> Full quickstart available when Phase 2 (Schema Foundation) lands — see [ROADMAP](.planning/ROADMAP.md).

In the meantime, you can set up a development environment:

```bash
# Prerequisites: Node 22+, pnpm 10+, Docker
git clone https://github.com/<owner>/apruma.git
cd apruma
pnpm install

# Run tests (no Postgres required yet — Phase 1 is infrastructure only)
pnpm test
pnpm typecheck
pnpm lint
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for TDD requirements, Conventional Commits, Changesets workflow, and the full list of critical invariants you must respect.

## Security

See [SECURITY.md](SECURITY.md) for the vulnerability disclosure process.

## License

[MIT](LICENSE) — Copyright (c) 2026 Aprumo Contributors
