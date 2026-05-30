-- 0007_revoke_insert_append_only.sql
-- Revokes direct INSERT privilege on append-only tables from aprumo_app.
--
-- Context: 0002_grants.sql issued GRANT SELECT, INSERT ON ALL TABLES but only
-- revoked UPDATE and DELETE — INSERT was not revoked, leaving aprumo_app with
-- direct write access to postings and raw_events. This violates the SECURITY
-- DEFINER sole-write-path invariant described in 0003_post_transaction.sql and
-- CLAUDE.md Invariant #1.
--
-- post_transaction (SECURITY DEFINER, owned by aprumo_migration) is the ONLY
-- intended INSERT path into postings. aprumo_app must use the function via
-- EXECUTE privilege, not direct INSERT. This migration closes the gap.
--
-- See: CLAUDE.md Invariant #1
-- See: 0003_post_transaction.sql line 118 — "DO NOT grant INSERT ON postings to
--      aprumo_app here or anywhere (sole write path invariant)"

REVOKE INSERT ON TABLE postings FROM aprumo_app;
REVOKE INSERT ON TABLE raw_events FROM aprumo_app;
