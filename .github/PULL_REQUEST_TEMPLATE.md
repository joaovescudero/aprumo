## Summary

<!-- What does this PR do? Why is this change needed? -->

## Changes

<!-- Bullet list of key changes -->

-
-

## Test Plan

<!-- How was this tested? What scenarios were covered? -->

-
-

## Checklist

- [ ] Tests added (or test suite passes unchanged for pure refactors)
- [ ] TDD followed — tests written **before** implementation (see `CLAUDE.md`)
- [ ] Changeset added (`pnpm changeset`) if a publishable package changed
- [ ] `pnpm lint && pnpm typecheck` pass locally
- [ ] `CLAUDE.md` invariants respected (double-entry balance, append-only postings/raw_events, idempotency, exact-once webhook, serializable isolation, audit shadow tables, no PAN, amounts in cents)
- [ ] No `any`, `as unknown as T`, or `@ts-ignore` without explanatory comment
- [ ] Relevant ADR linked if this changes an architectural decision

## Related Issues

<!-- Closes #issue_number or N/A -->
