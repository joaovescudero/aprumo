// accounts.test.ts — Integration tests for POST /v1/accounts, GET /v1/accounts/:id,
// and GET /v1/accounts/:id/postings (cursor pagination).
//
// Reference decisions:
//   D-04: cursor pagination ordered by created_at DESC (+ id DESC tiebreaker)
//   D-05: cursor is opaque base64url-encoded (created_at, id) tuple — callers must not parse it
//   D-06: default limit=50, max=200; limit>200 → 422 (TypeBox maximum:200 enforced by Ajv)
//   API-07: POST /v1/accounts returns 201 with account shape + balance: null
//   API-08: GET /v1/accounts/:id returns balance from account_balance (null if worker hasn't run)
//   API-09: GET /v1/accounts/:id/postings returns cursor-paginated posting list

import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../../tests/helpers/createTestDb.js";
import { createServer } from "../server.js";
import { accountRoutes } from "./accounts.js"; // non-existent — RED state
import { transactionRoutes } from "./transactions.js";

let testDb: TestDb;
let drizzleDb: ReturnType<typeof drizzle>;
// biome-ignore lint/suspicious/noExplicitAny: FastifyInstance type from createServer, not importing Fastify
let app: any;

let account1Id: string;
let account2Id: string;

// ─────────────────────────────────────────────────────────────────────────────
// Test lifecycle
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  testDb = await createTestDb(import.meta.url);
  drizzleDb = drizzle(testDb.app);
  app = await createServer(drizzleDb);

  // Register the account routes under /v1 prefix
  await app.register(accountRoutes, { prefix: "/v1", db: drizzleDb });
  // Also register transaction routes so we can create postings for pagination tests
  await app.register(transactionRoutes, { prefix: "/v1", db: drizzleDb });
  await app.ready();

  // Seed 2 accounts via migration pool — used by pagination tests to create postings
  const result = await testDb.migration.query<{ id: string }>(
    `INSERT INTO accounts (id, type, metadata, owner_ref, created_at)
     VALUES
       (gen_random_uuid(), 'asset',     '{}'::jsonb, 'test-seed-owner', now()),
       (gen_random_uuid(), 'liability', '{}'::jsonb, 'test-seed-owner', now())
     RETURNING id`,
  );

  const rows = result.rows;
  if (rows.length !== 2) {
    throw new Error(`Expected 2 seed accounts, got ${rows.length}`);
  }
  account1Id = rows[0]!.id;
  account2Id = rows[1]!.id;
});

afterAll(async () => {
  await app.close();
  await testDb.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** POST /v1/accounts and return the parsed response body. */
async function createAccount(type: string, owner_ref: string, metadata?: Record<string, unknown>) {
  const response = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    headers: { "content-type": "application/json" },
    payload: { type, owner_ref, ...(metadata ? { metadata } : {}) },
  });
  return { statusCode: response.statusCode, body: JSON.parse(response.payload) };
}

/**
 * POST /v1/transactions to produce postings for an account.
 * Creates a balanced debit→credit transaction between account1 and account2.
 */
async function createTransaction(
  acct1Id: string,
  acct2Id: string,
  amount = 100,
  key?: string,
): Promise<string> {
  const idempotencyKey = key ?? randomUUID();
  const response = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: {
      "idempotency-key": idempotencyKey,
      "content-type": "application/json",
    },
    payload: {
      postings: [
        { account_id: acct1Id, amount_cents: amount, direction: "debit" },
        { account_id: acct2Id, amount_cents: amount, direction: "credit" },
      ],
      description: "pagination test transaction",
    },
  });

  if (response.statusCode !== 201) {
    throw new Error(`createTransaction failed: ${response.statusCode} ${response.payload}`);
  }

  return (JSON.parse(response.payload) as { id: string }).id;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /v1/accounts
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /v1/accounts", () => {
  it("returns 201 with correct shape for a valid asset account (API-07)", async () => {
    const { statusCode, body } = await createAccount("asset", "cust-test-001");

    expect(statusCode).toBe(201);
    // Must have UUID id
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(body.type).toBe("asset");
    expect(body.owner_ref).toBe("cust-test-001");
    // balance: null — no account_balance row exists yet (API-07)
    expect(body.balance).toBeNull();
    // created_at is an ISO datetime string
    expect(typeof body.created_at).toBe("string");
    expect(() => new Date(body.created_at)).not.toThrow();
  });

  it("returns 422 for invalid account type (TypeBox enum validation, T-03-06d)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/accounts",
      headers: { "content-type": "application/json" },
      payload: { type: "invalid_type", owner_ref: "cust-001" },
    });

    expect(response.statusCode).toBe(422);
    const parsed = JSON.parse(response.payload);
    expect(parsed.status).toBe(422);
  });

  it("returns 422 when owner_ref is missing (TypeBox required field)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/accounts",
      headers: { "content-type": "application/json" },
      payload: { type: "asset" }, // missing owner_ref
    });

    expect(response.statusCode).toBe(422);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/accounts/:id
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /v1/accounts/:id", () => {
  it("returns 200 with balance: null when no account_balance row exists (API-08)", async () => {
    // Create an account via POST
    const { statusCode: createStatus, body: created } = await createAccount(
      "liability",
      "cust-balance-null-test",
    );
    expect(createStatus).toBe(201);

    // GET the account — no account_balance row has been inserted yet
    const response = await app.inject({
      method: "GET",
      url: `/v1/accounts/${created.id}`,
    });

    expect(response.statusCode).toBe(200);
    const fetched = JSON.parse(response.payload);
    expect(fetched.id).toBe(created.id);
    expect(fetched.type).toBe("liability");
    // balance MUST be JSON null — not 0, not '0', not undefined
    expect(fetched.balance).toBeNull();
  });

  it("returns 404 with problem+json for non-existent account UUID", async () => {
    const nonExistentId = randomUUID();

    const response = await app.inject({
      method: "GET",
      url: `/v1/accounts/${nonExistentId}`,
    });

    expect(response.statusCode).toBe(404);
    const parsed = JSON.parse(response.payload);
    expect(parsed.code).toBe("not_found");
    expect(parsed.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/application\/problem\+json/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /v1/accounts/:id/postings
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /v1/accounts/:id/postings", () => {
  it("returns {data:[], next_cursor:null} for account with no postings (API-09)", async () => {
    // Create a fresh account with no postings
    const { body: account } = await createAccount("expense", "cust-no-postings");

    const response = await app.inject({
      method: "GET",
      url: `/v1/accounts/${account.id}/postings`,
    });

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.payload);
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data).toHaveLength(0);
    expect(parsed.next_cursor).toBeNull();
  });

  it("returns postings ordered by created_at DESC for account with multiple postings (D-04)", async () => {
    // Create 3 transactions against account1 (debit) — creates 3 postings for account1
    await createTransaction(account1Id, account2Id, 100);
    await createTransaction(account1Id, account2Id, 200);
    await createTransaction(account1Id, account2Id, 300);

    const response = await app.inject({
      method: "GET",
      url: `/v1/accounts/${account1Id}/postings`,
    });

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.payload);
    expect(Array.isArray(parsed.data)).toBe(true);
    expect(parsed.data.length).toBeGreaterThanOrEqual(3);

    // Verify ordering: created_at DESC — each item's timestamp >= the next
    for (let i = 0; i < parsed.data.length - 1; i++) {
      const curr = new Date(parsed.data[i].created_at).getTime();
      const next = new Date(parsed.data[i + 1].created_at).getTime();
      expect(curr).toBeGreaterThanOrEqual(next);
    }
  });

  it("amount_cents in postings response is a string (BigInt serialization, API-02)", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/v1/accounts/${account1Id}/postings`,
    });

    expect(response.statusCode).toBe(200);
    const parsed = JSON.parse(response.payload);
    expect(parsed.data.length).toBeGreaterThan(0);

    // Every amount_cents must be a string, not a number (BigInt precision preservation)
    for (const posting of parsed.data) {
      expect(typeof posting.amount_cents).toBe("string");
    }
  });

  it("cursor pagination: page 1 returns next_cursor; page 2 uses cursor and returns null next_cursor (D-05)", async () => {
    // Create a new dedicated account pair so we can control the exact number of postings
    const { body: paginationAccount } = await createAccount("revenue", "pagination-owner");
    const { body: counterAccount } = await createAccount("equity", "pagination-counter");

    // Insert 3 postings for paginationAccount (as debit side)
    await createTransaction(paginationAccount.id, counterAccount.id, 101);
    await createTransaction(paginationAccount.id, counterAccount.id, 102);
    await createTransaction(paginationAccount.id, counterAccount.id, 103);

    // Page 1: limit=2
    const page1Response = await app.inject({
      method: "GET",
      url: `/v1/accounts/${paginationAccount.id}/postings?limit=2`,
    });

    expect(page1Response.statusCode).toBe(200);
    const page1 = JSON.parse(page1Response.payload);
    expect(page1.data).toHaveLength(2);
    expect(page1.next_cursor).not.toBeNull();
    expect(typeof page1.next_cursor).toBe("string");

    // Page 2: use cursor from page 1
    const page2Response = await app.inject({
      method: "GET",
      url: `/v1/accounts/${paginationAccount.id}/postings?limit=2&cursor=${page1.next_cursor}`,
    });

    expect(page2Response.statusCode).toBe(200);
    const page2 = JSON.parse(page2Response.payload);
    expect(page2.data).toHaveLength(1);
    // Last page — no more results
    expect(page2.next_cursor).toBeNull();

    // Verify no overlap between pages: all IDs are unique across both pages
    const page1Ids = page1.data.map((p: { id: string }) => p.id);
    const page2Ids = page2.data.map((p: { id: string }) => p.id);
    const overlap = page1Ids.filter((id: string) => page2Ids.includes(id));
    expect(overlap).toHaveLength(0);
  });

  it("returns 422 when limit > 200 (D-06, TypeBox maximum:200 via Ajv, T-03-06c)", async () => {
    const { body: account } = await createAccount("asset", "limit-test-owner");

    const response = await app.inject({
      method: "GET",
      url: `/v1/accounts/${account.id}/postings?limit=201`,
    });

    // TypeBox GetPostingsQuerySchema has maximum:200 — Ajv rejects before handler runs
    expect(response.statusCode).toBe(422);
  });

  it("returns 400 for invalid (non-base64url) cursor (T-03-06a)", async () => {
    const { body: account } = await createAccount("asset", "cursor-test-owner");

    const response = await app.inject({
      method: "GET",
      url: `/v1/accounts/${account.id}/postings?cursor=not-valid-base64!@#`,
    });

    expect(response.statusCode).toBe(400);
    const parsed = JSON.parse(response.payload);
    expect(parsed.code).toBe("invalid_cursor");
    expect(parsed.status).toBe(400);
  });

  it("returns 400 for a well-formed cursor missing the id field (T-03-06a)", async () => {
    const { body: account } = await createAccount("asset", "cursor-missing-id");
    // Valid base64url JSON, but no `id` — must be rejected before any SQL runs.
    const cursor = Buffer.from(
      JSON.stringify({ created_at: "2026-03-04 05:06:07.123456+00" }),
      "utf-8",
    ).toString("base64url");

    const response = await app.inject({
      method: "GET",
      url: `/v1/accounts/${account.id}/postings?cursor=${cursor}`,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).code).toBe("invalid_cursor");
  });

  it("returns 400 for a cursor whose created_at is not a PG timestamp (T-03-06a)", async () => {
    const { body: account } = await createAccount("asset", "cursor-bad-ts");
    // Well-formed base64url JSON with both fields, but created_at is garbage.
    // Must be rejected by the format guard so it never reaches the ::timestamptz cast.
    const cursor = Buffer.from(
      JSON.stringify({ created_at: "definitely-not-a-timestamp", id: randomUUID() }),
      "utf-8",
    ).toString("base64url");

    const response = await app.inject({
      method: "GET",
      url: `/v1/accounts/${account.id}/postings?cursor=${cursor}`,
    });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.payload).code).toBe("invalid_cursor");
  });
});
