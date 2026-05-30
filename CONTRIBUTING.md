# Contributing to Aprumo

Thank you for your interest in contributing to Aprumo. This guide covers the technical process for submitting changes. For the full list of critical invariants, coding conventions, and "What NOT to do", see [CLAUDE.md](CLAUDE.md).

## TDD is Mandatory

**Test-Driven Development is non-negotiable in this project. Every production code change starts with a failing test.**

Follow the RED-GREEN-REFACTOR cycle:

1. **RED** — Write a test that describes the desired behavior. Run it. Watch it fail.
2. **GREEN** — Write the minimum code to make the test pass. Run it. Watch it pass.
3. **REFACTOR** — Clean up the code with the green tests as your safety net.

Practical rules:
- **Prefer separate commits when possible:** `test: add failing case for X` followed by `feat: implement X`. A single commit is not forbidden, but the PR diff must make it evident that tests precede the code.
- **A PR without a new test is not accepted** if the change alters observable behavior. Exceptions: docs, pure refactor (no behavior change, provable by a green suite before and after), tooling/build.
- **Bug fixes:** Start by reproducing the bug as a failing test. Fix only after. Without this step, the bug comes back.
- **Reviewers enforce this:** A PR without a test corresponding to the feature is grounds for `request changes`, not a nit.
- **Coverage is a consequence of TDD**, not a substitute. If you do TDD correctly, you will naturally reach 90% LoC on `@aprumo/core`. Coverage below threshold signals loose TDD.

For the ledger specifically, accounting invariants (double-entry, idempotency, immutability, exact-once webhook) **must have explicit tests before implementation**. This is not negotiable.

## Conventional Commits

All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>: <description>

[optional body]
```

Allowed types:

| Type | When to use |
|------|-------------|
| `feat` | New feature, endpoint, or component |
| `fix` | Bug fix or error correction |
| `refactor` | Code cleanup with no behavior change |
| `docs` | Documentation only |
| `test` | Test-only changes |
| `chore` | Config, tooling, or dependencies |
| `perf` | Performance improvement without behavior change |
| `ci` | CI/CD pipeline changes |

The pre-commit hook enforces this format via commitlint. A commit with an invalid format will be rejected before it is recorded.

## Changesets Required

Every pull request that modifies a publishable package (`@aprumo/core`, `@aprumo/connector-base`, `@aprumo/connector-starkbank`, `@aprumo/webhooks`) **must include a changeset file**.

```bash
# Register your change type and description
pnpm changeset

# Check if a changeset is required for your current diff
pnpm changeset:check
```

CI enforces this — the `changeset-check` job will fail on PRs that modify publishable packages without a changeset entry. If your PR only touches documentation, tests for non-published code, or configuration, a changeset is not required.

## Setup

```bash
# Prerequisites: Node 22+, pnpm 10+, Docker (for Postgres in Phase 2+)

git clone https://github.com/<owner>/apruma.git
cd apruma
pnpm install

# Run the full test suite
pnpm test

# Type check all packages
pnpm typecheck

# Lint and format check
pnpm lint

# Build all packages
pnpm build
```

Pre-commit hooks are installed automatically by lefthook when you run `pnpm install`. They run:
- **gitleaks** (staged files) — blocks secrets and credentials from entering the repo
- **biome check** (staged files) — lint and format
- **commitlint** — enforces Conventional Commits format

Pre-push hooks run `pnpm typecheck` to catch type errors before they reach CI.

## Contract Tests (Phase 5+)

Every connector must implement the `LedgerConnector` interface from `@aprumo/connector-base` and pass the contract test suite before any PR can be merged:

```bash
pnpm test:contract
```

A connector PR without a green contract suite will not be reviewed. See `packages/connector-base/` for the interface definition and contract test harness.

## Critical Invariants

This is a financial ledger. Violating the invariants below can cause silent money loss or irreversible accounting inconsistency. Before making any change that touches ledger data, read the full list in [CLAUDE.md § Invariantes críticos](CLAUDE.md).

Short summary:
1. `postings` and `raw_events` are append-only — no UPDATE or DELETE
2. Every transaction must have `SUM(amount_cents with sign) = 0` across its postings
3. Every write endpoint must accept `Idempotency-Key`; duplicates return `200 OK`
4. Webhook INSERT and job enqueue happen in the **same Postgres transaction**
5. Ledger operations use `SERIALIZABLE` isolation; `40001` errors get up to 3 retries
6. Every mutable table has a `*_audit` shadow table populated by trigger
7. No PAN storage — use gateway tokens only
8. Amounts are `BIGINT amount_cents` — no floats, no fractional API values

## Code of Conduct

This project adheres to the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.
