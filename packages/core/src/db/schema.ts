/**
 * Drizzle schema for Aprumo ledger — source-of-truth for drizzle-kit generate.
 *
 * v0.5 column reservations in this file:
 *   - account_balance.pending_balance  (BIGINT NULL): Reserved for v0.5 pending balance tracking.
 *                                       Populated by balance worker. NULL in v0.1.
 *   - account_balance.available_balance (BIGINT NULL): Reserved for v0.5 available balance tracking.
 *                                        Populated by balance worker. NULL in v0.1.
 *
 * INVARIANTS (see CLAUDE.md):
 *   - postings and raw_events are append-only (REVOKE applied in migration 0002)
 *   - amount_cents MUST use bigint({ mode: 'bigint' }) — never bare bigint() or numeric
 *   - All money values stored as BIGINT cents, never float
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Account type — one of the standard accounting categories. */
    type: text("type").notNull(),
    /** Arbitrary metadata for the account (e.g. customer ID, description). */
    metadata: jsonb("metadata"),
    /** External reference for the owner of this account (e.g. customer_id). */
    owner_ref: text("owner_ref").notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check(
      "account_type_check",
      sql`${table.type} IN ('asset', 'liability', 'revenue', 'expense', 'equity')`,
    ),
  ],
);

// ---------------------------------------------------------------------------
// transactions
// ---------------------------------------------------------------------------

export const transactions = pgTable("transactions", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Caller-supplied deduplication key — UNIQUE NOT NULL enforces idempotency (FND-02). */
  idempotency_key: text("idempotency_key").notNull().unique(),
  /** Timestamp when the transaction occurred (not when it was recorded). */
  ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  description: text("description"),
  /**
   * Source system or event type (free-form convention: '<provider>' | 'manual' |
   * 'reconciliation' | 'seed').
   */
  source: text("source"),
  /** Arbitrary metadata (e.g. original webhook event ID, order ID). */
  metadata: jsonb("metadata"),
});

// ---------------------------------------------------------------------------
// postings  (append-only — REVOKE UPDATE/DELETE applied in migration 0002)
// ---------------------------------------------------------------------------

export const postings = pgTable(
  "postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    transaction_id: uuid("transaction_id")
      .notNull()
      .references(() => transactions.id),
    account_id: uuid("account_id")
      .notNull()
      .references(() => accounts.id),
    /**
     * Monetary amount in cents as a BigInt.
     * MUST use mode: 'bigint' to prevent JS number precision loss on values > 2^53.
     */
    amount_cents: bigint("amount_cents", { mode: "bigint" }).notNull(),
    /** Debit or credit — enforced by CHECK constraint. */
    direction: text("direction").notNull(),
    /**
     * Insertion timestamp — set by Postgres DEFAULT now() at INSERT time.
     * Used as the sort key for cursor pagination in GET /v1/accounts/:id/postings (D-04).
     * UUIDv4 IDs are random and non-monotonic; created_at is the only semantically
     * meaningful sort key (RESEARCH.md Pitfall 5).
     */
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("posting_direction_check", sql`${table.direction} IN ('debit', 'credit')`),
    // Index on transaction_id: required by the double-entry trigger's SUM aggregate query.
    index("postings_transaction_id_idx").on(table.transaction_id),
    // Index on created_at DESC: supports O(log N) cursor pagination ORDER BY created_at DESC.
    index("postings_created_at_idx").on(table.created_at),
  ],
);

// ---------------------------------------------------------------------------
// raw_events  (append-only — REVOKE UPDATE/DELETE applied in migration 0002)
// ---------------------------------------------------------------------------

export const rawEvents = pgTable(
  "raw_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Provider name (e.g. 'starkbank', 'abacatepay'). */
    provider: text("provider").notNull(),
    /** Provider's own ID for this event — used for deduplication. */
    provider_event_id: text("provider_event_id").notNull(),
    received_at: timestamp("received_at", { withTimezone: true }).defaultNow().notNull(),
    /** Full raw payload as JSONB — stored for audit and reprocessing. */
    payload_jsonb: jsonb("payload_jsonb").notNull(),
    /**
     * Linked transaction after reconciliation (nullable: set to NULL on arrival,
     * populated when event is reconciled into a ledger transaction).
     */
    transaction_id: uuid("transaction_id").references(() => transactions.id),
    /** Processing state. CHECK constraint enforces allowed values. */
    status: text("status").notNull().default("pending"),
  },
  (table) => [
    // Composite unique: prevents duplicate ingestion of the same provider event (FND-04).
    unique("raw_events_provider_event_id_unique").on(table.provider, table.provider_event_id),
    check("raw_event_status_check", sql`${table.status} IN ('pending', 'reconciled', 'failed')`),
    index("raw_events_provider_idx").on(table.provider),
    index("raw_events_status_idx").on(table.status),
  ],
);

// ---------------------------------------------------------------------------
// account_balance  (materialised by incremental balance worker — Plan 04)
// ---------------------------------------------------------------------------

export const accountBalance = pgTable("account_balance", {
  /** PK and FK: one balance row per account. */
  account_id: uuid("account_id")
    .primaryKey()
    .references(() => accounts.id),
  /** Current ledger balance in cents (debit minus credit, signed per account type). */
  balance: bigint("balance", { mode: "bigint" }).notNull().default(sql`0`),
  /** Last posting processed by the incremental worker (cursor for restartability). */
  last_posting_id: uuid("last_posting_id").references(() => postings.id),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  /**
   * Reserved for v0.5 pending balance tracking.
   * Populated by v0.5 balance worker. NULL in v0.1. (D-45)
   */
  pending_balance: bigint("pending_balance", { mode: "bigint" }),
  /**
   * Reserved for v0.5 available balance tracking.
   * Populated by v0.5 balance worker. NULL in v0.1. (D-45)
   */
  available_balance: bigint("available_balance", { mode: "bigint" }),
});

// ---------------------------------------------------------------------------
// outbound_endpoints
// ---------------------------------------------------------------------------

export const outboundEndpoints = pgTable("outbound_endpoints", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Customer/tenant this endpoint belongs to. */
  customer_id: text("customer_id").notNull(),
  /** Webhook delivery URL. */
  url: text("url").notNull(),
  /** HMAC secret hash — never store the plaintext secret. */
  secret_hash: text("secret_hash").notNull(),
  active: boolean("active").notNull().default(true),
  /** JSON array of event types this endpoint subscribes to (null = all events). */
  event_types: jsonb("event_types"),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// outbound_events
// ---------------------------------------------------------------------------

export const outboundEvents = pgTable("outbound_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  endpoint_id: uuid("endpoint_id")
    .notNull()
    .references(() => outboundEndpoints.id),
  /** Event type string (e.g. 'transaction.created', 'reconciliation.completed'). */
  type: text("type").notNull(),
  payload_jsonb: jsonb("payload_jsonb").notNull(),
  status: text("status").notNull().default("pending"),
  /** Number of delivery attempts so far. */
  attempts: bigint("attempts", { mode: "bigint" }).notNull().default(sql`0`),
  /** Last error message, if any. */
  last_error: text("last_error"),
  /** When to next attempt delivery (null = ready immediately). */
  next_attempt_at: timestamp("next_attempt_at", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ---------------------------------------------------------------------------
// Audit shadow tables
// Shadow tables are populated by AFTER UPDATE/DELETE triggers (migration 0004).
// They are created here so 0000_init_tables.sql includes them; triggers are added later.
// ---------------------------------------------------------------------------

const auditColumns = {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The table that generated this audit record. */
  table_name: text("table_name").notNull(),
  /** The DML operation: 'UPDATE' or 'DELETE'. */
  operation: text("operation").notNull(),
  /** Row data before the change (NULL on INSERT). */
  old_data: jsonb("old_data"),
  /** Row data after the change (NULL on DELETE). */
  new_data: jsonb("new_data"),
  /** The database role that performed the change (current_user). */
  changed_by: text("changed_by").notNull(),
  changed_at: timestamp("changed_at", { withTimezone: true }).defaultNow().notNull(),
};

export const accountsAudit = pgTable("accounts_audit", auditColumns);

export const outboundEndpointsAudit = pgTable("outbound_endpoints_audit", auditColumns);

/**
 * INTENTIONALLY UNPOPULATED shadow table (WR-02).
 *
 * Migration 0011 dropped the audit trigger on outbound_events because delivery-status
 * updates are high-frequency operational writes that would cause unbounded growth in
 * this table (no TTL, no partition strategy). See 0011_drop_outbound_events_audit_trigger.sql.
 *
 * The table is retained in the schema to avoid a destructive DDL migration, but it will
 * NOT receive any rows from the audit trigger. Delivery attempt history for debugging
 * belongs in a dedicated table with explicit TTL — that is a Phase 7+ concern.
 *
 * DO NOT query this table expecting audit content. It will be empty in production.
 * CLAUDE.md Invariant 6 (audit requirement) applies to CONFIG tables (accounts,
 * outbound_endpoints) — not high-frequency operational tables like outbound_events.
 */
export const outboundEventsAudit = pgTable("outbound_events_audit", auditColumns);
