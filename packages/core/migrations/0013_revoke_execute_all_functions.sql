-- 0013_revoke_execute_all_functions.sql
-- Revokes the over-broad EXECUTE grant on all functions introduced in 0002_grants.sql.
--
-- Problem (WR-03): Migration 0002 issued:
--   GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO aprumo_app;
--   ALTER DEFAULT PRIVILEGES FOR ROLE aprumo_migration IN SCHEMA public
--     GRANT EXECUTE ON FUNCTIONS TO aprumo_app;
--
-- This pre-authorises any future SECURITY DEFINER function added via a new migration
-- for aprumo_app without an explicit per-function grant review. If such a function
-- performs privileged operations with insufficient input validation, aprumo_app can
-- invoke it immediately upon creation.
--
-- Fix: Revoke the broad grant (affects currently-existing functions) and revoke the
-- default privilege (prevents auto-grant on future functions). Each migration that
-- adds a function should explicitly GRANT EXECUTE on that function — consistent with
-- 0003_post_transaction.sql (line 119), 0010, and 0012 which already do this.
--
-- After this migration, aprumo_app retains EXECUTE on post_transaction because:
--   - 0003_post_transaction.sql:119 has an explicit GRANT EXECUTE on the function.
--   - 0010_fix_validation_order.sql and 0012_numeric_accumulator_post_transaction.sql
--     re-assert the same GRANT EXECUTE (idempotent — confirm at deploy time).
-- The explicit function-level grants are not affected by REVOKE ON ALL FUNCTIONS.
--
-- See: CLAUDE.md roles (aprumo_app: minimal privilege)
-- See: WR-03 review finding in 02-REVIEW.md

-- Revoke the broad grant on all currently-existing functions.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM aprumo_app;

-- Revoke the default-privilege clause so future functions are NOT automatically
-- executable by aprumo_app. Each function's migration must issue GRANT EXECUTE
-- explicitly.
ALTER DEFAULT PRIVILEGES FOR ROLE aprumo_migration IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM aprumo_app;

-- Re-assert explicit EXECUTE on post_transaction to ensure the revoke above does not
-- silently remove access that 0003/0010/0012 already granted. This is belt-and-
-- suspenders: the explicit function-level grants should survive REVOKE ON ALL FUNCTIONS,
-- but asserting here makes the intent explicit and protects against any future
-- PostgreSQL behavior change.
GRANT EXECUTE ON FUNCTION post_transaction(text, text, text, jsonb, posting_input[])
  TO aprumo_app;
