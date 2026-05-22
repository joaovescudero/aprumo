# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for Aprumo. ADRs document significant architectural decisions made during the design and development of the system, including the context, options considered, and rationale for each choice.

## Format

All ADRs use the [MADR 4.0](https://adr.github.io/madr/) (Markdown Any Decision Records) format with the following structure:

- **Frontmatter**: `status`, `date`, `decision-makers`
- **Context and Problem Statement**: what problem prompted the decision
- **Decision Drivers**: the requirements and constraints that guided the choice
- **Considered Options**: alternatives evaluated
- **Decision Outcome**: the chosen option
- **Consequences**: trade-offs accepted
- **Pros and Cons of the Options**: detailed comparison

## Naming Convention

Files follow the pattern `NNNN-slug.md` where `NNNN` is a zero-padded sequential number. The slug is a short, kebab-case description of the decision. No external tooling (`adr-tools`, `log4brains`) is required — the naming convention is the interface.

## Status Field

| Status | Meaning |
|--------|---------|
| Accepted | Decision is in effect and being implemented |
| Deprecated | Decision was accepted but superseded by a newer ADR |
| Superseded by ADR-NNN | This ADR is no longer in effect; see the referenced ADR |

## Index

| Number | Title | Status | Decided | Documented |
|--------|-------|--------|---------|------------|
| [ADR-001](./0001-postgres-as-ledger-engine.md) | Use PostgreSQL as the Ledger Engine | Accepted | 2026-05-18 | 2026-05-22 |
| [ADR-002](./0002-fastify-http-framework.md) | Use Fastify as HTTP Framework | Accepted | 2026-05-18 | 2026-05-22 |
| [ADR-003](./0003-pg-boss-workflow.md) | Use pg-boss for Workflow Queue | Accepted | 2026-05-18 | 2026-05-22 |
| [ADR-004](./0004-incremental-balance-worker.md) | Incremental Balance Worker with Cursor | Accepted | 2026-05-18 | 2026-05-22 |
| [ADR-005](./0005-accounting-split-async-settlement.md) | Accounting Split with Async Settlement | Accepted | 2026-05-18 | 2026-05-22 |
| [ADR-006](./0006-versioning-v01-v05.md) | Milestone Versioning: v0.1 and v0.5 | Accepted | 2026-05-18 | 2026-05-22 |
| [ADR-007](./0007-smart-routing-as-logical-failover.md) | Smart Routing as Logical Failover | Accepted | 2026-05-18 | 2026-05-22 |
| [ADR-008](./0008-mit-core-enterprise-edition.md) | MIT Core + Enterprise Edition | Accepted | 2026-05-18 | 2026-05-22 |
| [ADR-009](./0009-drizzle-orm-migrations.md) | Drizzle ORM + Hybrid Migration Strategy | Accepted | 2026-05-22 | 2026-05-22 |

## Notes on Dating

ADRs 001–008 were decided during initial project design on 2026-05-18 (documented in PRD.md §9) and documented here on 2026-05-22 as a back-fill. Each ADR contains an explicit note explaining this. The `decided` date reflects the original decision; `documented` reflects when the ADR was written in MADR 4.0 format. This is honest back-fill, not invented process.

ADR-009 is a net-new decision made on 2026-05-22 during Phase 2 planning. It has no back-fill dating note.

## Adding New ADRs

1. Pick the next sequential number.
2. Copy the frontmatter and section structure from an existing ADR.
3. Name the file `NNNN-short-slug.md`.
4. Set `status: "Proposed"` until the decision is finalized; change to `"Accepted"` at decision time.
5. Add a row to the index table above.
6. If the new ADR supersedes an existing one, update the old ADR's `status` to `"Superseded by ADR-NNN"`.
