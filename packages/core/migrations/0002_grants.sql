-- 0002_grants.sql
-- Grants minimal privileges to aprumo_app and applies REVOKE on append-only tables.
-- See: CLAUDE.md Invariant #1 (aprumo_app must not UPDATE/DELETE postings/raw_events)
-- See: Pattern 4 in 02-RESEARCH.md — role permission model
-- See: FND-07, FND-08 (role separation + REVOKE enforcement)

-- Grant SELECT + INSERT on all existing tables to aprumo_app
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA public TO aprumo_app;

-- Revoke mutation access on append-only immutable tables (CLAUDE.md Invariant #1)
REVOKE UPDATE, DELETE ON TABLE postings FROM aprumo_app;
REVOKE UPDATE, DELETE ON TABLE raw_events FROM aprumo_app;

-- Default privileges: future tables created by aprumo_migration inherit the same grants
ALTER DEFAULT PRIVILEGES FOR ROLE aprumo_migration IN SCHEMA public
  GRANT SELECT, INSERT ON TABLES TO aprumo_app;

-- Sequences: aprumo_app needs USAGE for INSERT with serial/identity columns
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO aprumo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aprumo_migration IN SCHEMA public
  GRANT USAGE ON SEQUENCES TO aprumo_app;

-- Functions: aprumo_app needs EXECUTE for post_transaction (SECURITY DEFINER)
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO aprumo_app;
ALTER DEFAULT PRIVILEGES FOR ROLE aprumo_migration IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO aprumo_app;
