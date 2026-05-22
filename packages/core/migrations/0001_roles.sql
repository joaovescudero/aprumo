-- 0001_roles.sql
-- Creates the two application roles for Aprumo.
-- Roles are cluster-level; IF NOT EXISTS prevents failure on re-run after db:reset
-- Passwords set via docker-compose env vars or CI init script — never hardcoded here
-- See: CLAUDE.md Invariant #1 (aprumo_app must not UPDATE/DELETE postings/raw_events)
-- See: Pattern 4 in 02-RESEARCH.md — role permission model

CREATE ROLE IF NOT EXISTS aprumo_app NOLOGIN NOSUPERUSER;
CREATE ROLE IF NOT EXISTS aprumo_migration NOLOGIN NOSUPERUSER CREATEDB;
