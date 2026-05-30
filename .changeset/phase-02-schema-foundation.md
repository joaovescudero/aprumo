---
"@aprumo/core": minor
---

Schema foundation + DB tooling (FND): ledger tables (accounts, transactions,
postings, raw_events, account_balance, outbound), append-only enforcement via
role REVOKEs, balanced double-entry `post_transaction()`, audit triggers,
Drizzle migrations, testcontainers per-schema isolation, and migration drift
gate.
