---
"@aprumo/core": patch
---

Phase 02 follow-up: post-review hardening and gap closure.

- Migrations 0010–0015: fix double-entry validation ordering, drop spurious
  outbound_events audit trigger, numeric accumulator in post_transaction,
  REVOKE EXECUTE on all functions, re-grant INSERT on raw_events, and
  SET search_path on the double-entry constraint trigger.
- seed.ts: extract exported `assertSeedStructure` guard (WR-06) tolerant of
  leading SQL line-comments; db:seed accepts comment-headed seed files.
- migrate.ts: 10-attempt exponential backoff readWithRetry for concurrent I/O;
  orphaned-hash detection in check-migration-drift.
- testcontainers globalSetup: atomic idempotent role creation across worker forks.
