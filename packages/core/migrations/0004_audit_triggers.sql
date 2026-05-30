-- Migration: 0004_audit_triggers
-- Implements CLAUDE.md Invariant #6: any mutable table has a shadow *_audit table
-- populated by AFTER UPDATE/DELETE trigger.
--
-- This migration creates:
--   1. audit_row_change() — generic SECURITY DEFINER plpgsql function that routes to
--      the per-table shadow (e.g. accounts → accounts_audit) via EXECUTE format().
--   2. AFTER UPDATE OR DELETE triggers on mutable tables: accounts, outbound_endpoints,
--      outbound_events.
--
-- NOTE: No audit trigger on postings or raw_events. Those tables are append-only
-- (REVOKE UPDATE/DELETE granted by 0002_grants.sql). Audit triggers are NOT needed
-- on tables that cannot be mutated.
--
-- Shadow tables (*_audit) were created in 0000_init_tables.sql with columns:
--   id, table_name, operation, old_data jsonb, new_data jsonb, changed_by, changed_at.

-- Section A: Generic audit function
-- SECURITY DEFINER ensures current_user captured at the time the trigger fires,
-- even if the caller switches roles.
-- SET search_path = public prevents search-path injection attacks (T-2-03).
CREATE OR REPLACE FUNCTION audit_row_change()
  RETURNS TRIGGER
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
BEGIN
  -- Route to the per-table audit shadow via EXECUTE format with %I (identifier quoting).
  -- %I prevents SQL injection even though TG_TABLE_NAME is an internal trigger variable.
  -- TG_OP is always 'UPDATE' or 'DELETE' since this function is only attached to
  -- AFTER UPDATE OR DELETE triggers — INSERT path is excluded.
  EXECUTE format(
    'INSERT INTO %I (table_name, operation, old_data, new_data, changed_by, changed_at)
     VALUES ($1, $2, $3, $4, $5, $6)',
    TG_TABLE_NAME || '_audit'
  )
  USING
    TG_TABLE_NAME,
    TG_OP,
    to_jsonb(OLD),
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(NEW) ELSE NULL END,
    current_user,
    now();

  -- AFTER triggers must RETURN NULL (return value is ignored by Postgres for AFTER triggers).
  RETURN NULL;
END;
$$;

-- Section B: Attach triggers to mutable tables
-- Trigger on accounts — captures metadata changes and any other column updates.
CREATE TRIGGER accounts_audit_trigger
  AFTER UPDATE OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Trigger on outbound_endpoints — captures changes to webhook endpoint configuration.
CREATE TRIGGER outbound_endpoints_audit_trigger
  AFTER UPDATE OR DELETE ON outbound_endpoints
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Trigger on outbound_events — captures status updates (pending→delivered/failed).
CREATE TRIGGER outbound_events_audit_trigger
  AFTER UPDATE OR DELETE ON outbound_events
  FOR EACH ROW EXECUTE FUNCTION audit_row_change();

-- Section C: Explicit exclusion comment
-- NOTE: No audit trigger on postings or raw_events. Those tables are append-only
-- (REVOKE UPDATE/DELETE from aprumo_app in 0002_grants.sql). Mutations are impossible
-- at the DB role level — there is nothing to audit.
-- See CLAUDE.md Invariant #1 (imutabilidade) and Invariant #6 (audit).
