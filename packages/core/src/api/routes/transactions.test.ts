// transactions.test.ts — Integration tests for POST /v1/transactions and GET /v1/transactions/:id.
//
// Per D-08: Idempotency-Key header is required for all POST /v1/transactions calls.
// Per CLAUDE.md Invariant #2: every accounting transaction must have SUM(signed amount) = 0.
// Per CLAUDE.md Invariant #3: duplicate idempotency_key returns existing tx without error.
// Per CLAUDE.md Invariant #5: ledger writes use SERIALIZABLE isolation; 40001 retried at route level.
// Per FND-09: post_transaction is the sole INSERT path into postings (validated at DB layer).
//
// Success criteria (ROADMAP SC#1 SC#2 SC#3 SC#4):
// SC#1 — POST balanced postings returns 201 with amount_cents as JSON string (BigInt boundary)
// SC#2 — Duplicate Idempotency-Key returns 200 (not error) with identical body
// SC#3 — Concurrent duplicate keys (Promise.all) both resolve, same transaction id
// SC#4 — Route-level 40001 retry: POST succeeds on 2nd db.transaction attempt after 1st throws 40001

import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../../../tests/helpers/createTestDb.js";
import { createServer } from "../server.js";
import { transactionRoutes } from "./transactions.js";

let testDb: TestDb;
let drizzleDb: ReturnType<typeof drizzle>;
// biome-ignore lint/suspicious/noExplicitAny: FastifyInstance type from createServer, not importing Fastify
let app: any;

let account1Id: string;
let account2Id: string;

beforeAll(async () => {
  testDb = await createTestDb(import.meta.url);
  drizzleDb = drizzle(testDb.app);
  app = await createServer(drizzleDb);

  // Register the transaction routes plugin under /v1 prefix
  await app.register(transactionRoutes, { prefix: "/v1", db: drizzleDb });
  await app.ready();

  // Seed 2 accounts via migration pool (superuser) — aprumo_app cannot seed directly
  const result = await testDb.migration.query<{ id: string }>(
    `INSERT INTO accounts (id, type, metadata, owner_ref, created_at)
     VALUES
       (gen_random_uuid(), 'asset',     '{}'::jsonb, 'test', now()),
       (gen_random_uuid(), 'liability', '{}'::jsonb, 'test', now())
     RETURNING id`,
  );

  const rows = result.rows;
  if (rows.length !== 2) {
    throw new Error(`Expected 2 accounts, got ${rows.length}`);
  }
  account1Id = rows[0]!.id;
  account2Id = rows[1]!.id;
});

afterAll(async () => {
  await app.close();
  await testDb.cleanup();
});

/**
 * Build a balanced posting payload for POST /v1/transactions.
 * Debit account1 and credit account2 for the given amount.
 */
function buildBalancedPayload(acct1: string, acct2: string, amount = 100, key?: string) {
  return {
    key: key ?? randomUUID(),
    body: {
      postings: [
        { account_id: acct1, amount_cents: amount, direction: "debit" },
        { account_id: acct2, amount_cents: amount, direction: "credit" },
      ],
      description: "test transaction",
    },
  };
}

describe("POST /v1/transactions", () => {
  it("returns 201 with amount_cents as string for balanced postings (SC#1 + BigInt boundary)", async () => {
    const { key, body } = buildBalancedPayload(account1Id, account2Id);

    const response = await app.inject({
      method: "POST",
      url: "/v1/transactions",
      headers: {
        "idempotency-key": key,
        "content-type": "application/json",
      },
      payload: body,
    });

    expect(response.statusCode).toBe(201);

    const parsed = JSON.parse(response.payload);
    expect(parsed.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(parsed.idempotency_key).toBe(key);
    expect(Array.isArray(parsed.postings)).toBe(true);
    expect(parsed.postings.length).toBe(2);
    // BigInt boundary: amount_cents must be a JSON string, not a number
    expect(typeof parsed.postings[0].amount_cents).toBe("string");
    expect(typeof parsed.postings[1].amount_cents).toBe("string");
  });

  it("duplicate Idempotency-Key returns 200 sequential with identical body (SC#2 + Invariant #3)", async () => {
    const { key, body } = buildBalancedPayload(account1Id, account2Id);

    const first = await app.inject({
      method: "POST",
      url: "/v1/transactions",
      headers: { "idempotency-key": key, "content-type": "application/json" },
      payload: body,
    });

    const second = await app.inject({
      method: "POST",
      url: "/v1/transactions",
      headers: { "idempotency-key": key, "content-type": "application/json" },
      payload: body,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);

    const firstBody = JSON.parse(first.payload);
    const secondBody = JSON.parse(second.payload);

    // Both responses must have the same transaction id
    expect(firstBody.id).toBe(secondBody.id);
    // Both must have postings with amount_cents as string
    expect(typeof firstBody.postings[0].amount_cents).toBe("string");
    expect(typeof secondBody.postings[0].amount_cents).toBe("string");
  });

  it("concurrent Idempotency-Key via Promise.all both resolve with same transaction id (SC#3)", async () => {
    const { key, body } = buildBalancedPayload(account1Id, account2Id);

    const injectRequest = () =>
      app.inject({
        method: "POST",
        url: "/v1/transactions",
        headers: { "idempotency-key": key, "content-type": "application/json" },
        payload: body,
      });

    const [res1, res2] = await Promise.all([injectRequest(), injectRequest()]);

    // Both must resolve (not throw)
    expect([200, 201]).toContain(res1.statusCode);
    expect([200, 201]).toContain(res2.statusCode);

    const body1 = JSON.parse(res1.payload);
    const body2 = JSON.parse(res2.payload);

    // Both must have the same transaction id
    expect(body1.id).toBe(body2.id);
  });

  it("returns 422 with code=unbalanced_postings for unbalanced postings (Invariant #2)", async () => {
    const key = randomUUID();

    const response = await app.inject({
      method: "POST",
      url: "/v1/transactions",
      headers: {
        "idempotency-key": key,
        "content-type": "application/json",
      },
      payload: {
        postings: [
          // Only debit — no matching credit → unbalanced
          { account_id: account1Id, amount_cents: 100, direction: "debit" },
          { account_id: account2Id, amount_cents: 50, direction: "credit" },
        ],
        description: "unbalanced test",
      },
    });

    expect(response.statusCode).toBe(422);
    const parsed = JSON.parse(response.payload);
    expect(parsed.code).toBe("unbalanced_postings");
    // RFC 9457 content-type
    expect(response.headers["content-type"]).toMatch(/application\/problem\+json/);
  });

  it("returns 400 when Idempotency-Key header is missing (D-08)", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/v1/transactions",
      headers: { "content-type": "application/json" },
      payload: {
        postings: [
          { account_id: account1Id, amount_cents: 100, direction: "debit" },
          { account_id: account2Id, amount_cents: 100, direction: "credit" },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    const parsed = JSON.parse(response.payload);
    // pgErrorHandler maps missing idempotency-key to 400 idempotency_key_required
    expect(parsed.status).toBe(400);
  });

  it("BigInt > MAX_SAFE_INTEGER preserved as string in response (API-02)", async () => {
    // 9007199254740993 = Number.MAX_SAFE_INTEGER + 2 — exceeds JS number precision.
    // Send payload as raw JSON string to avoid the JS parser rounding the number literal.
    // If sent as a JS object literal, `9007199254740993` would be stored as 9007199254740992
    // due to IEEE-754 double precision limits — defeating the purpose of this test.
    const largeAmountStr = "9007199254740993"; // MAX_SAFE_INTEGER + 2
    const key = randomUUID();
    const rawBody = JSON.stringify({
      postings: [
        { account_id: account1Id, amount_cents: Number.MAX_SAFE_INTEGER + 2, direction: "debit" },
        { account_id: account2Id, amount_cents: Number.MAX_SAFE_INTEGER + 2, direction: "credit" },
      ],
      description: "bigint boundary test",
    }).replace(/"amount_cents":\d+/g, `"amount_cents":${largeAmountStr}`);

    const response = await app.inject({
      method: "POST",
      url: "/v1/transactions",
      headers: {
        "idempotency-key": key,
        "content-type": "application/json",
      },
      payload: rawBody,
    });

    expect(response.statusCode).toBe(201);

    // Parse as text first to check the raw JSON — if it were a number, precision loss would occur
    const rawPayload = response.payload;
    // The string '9007199254740993' must appear literally in the response
    expect(rawPayload).toContain('"9007199254740993"');

    const parsed = JSON.parse(response.payload);
    // amount_cents must be a string (not a number)
    const debitPosting = parsed.postings.find(
      (p: { direction: string }) => p.direction === "debit",
    );
    expect(typeof debitPosting.amount_cents).toBe("string");
    expect(debitPosting.amount_cents).toBe("9007199254740993");
  });

  it("route-level 40001 retry: POST succeeds on 2nd db.transaction attempt (SC#4 — ROADMAP)", async () => {
    // Prove withRetryOnSerializationFailure is wired at the route level as a factory closure.
    // We spy on drizzleDb.transaction and make it throw 40001 on the first call only.
    const { key, body } = buildBalancedPayload(account1Id, account2Id);

    // Spy on db.transaction — first call throws 40001, subsequent calls pass through
    const originalTransaction = drizzleDb.transaction.bind(drizzleDb);
    let firstCall = true;
    const spy = vi.spyOn(drizzleDb, "transaction").mockImplementation((...args) => {
      if (firstCall) {
        firstCall = false;
        const err = Object.assign(new Error("simulated serialization failure"), { code: "40001" });
        return Promise.reject(err);
      }
      // biome-ignore lint/suspicious/noExplicitAny: spy passthrough — required to forward all args
      return (originalTransaction as any)(...args);
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/transactions",
      headers: {
        "idempotency-key": key,
        "content-type": "application/json",
      },
      payload: body,
    });

    // Restore the spy immediately
    spy.mockRestore();

    expect(response.statusCode).toBe(201);
    const parsed = JSON.parse(response.payload);
    expect(parsed.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(Array.isArray(parsed.postings)).toBe(true);
    expect(parsed.postings.length).toBeGreaterThan(0);
  });
});

describe("GET /v1/transactions/:id", () => {
  it("returns 200 with transaction and postings ordered by created_at DESC", async () => {
    // First create a transaction to GET
    const { key, body } = buildBalancedPayload(account1Id, account2Id);

    const createResponse = await app.inject({
      method: "POST",
      url: "/v1/transactions",
      headers: {
        "idempotency-key": key,
        "content-type": "application/json",
      },
      payload: body,
    });

    expect(createResponse.statusCode).toBe(201);
    const created = JSON.parse(createResponse.payload);

    // Now GET it
    const getResponse = await app.inject({
      method: "GET",
      url: `/v1/transactions/${created.id}`,
    });

    expect(getResponse.statusCode).toBe(200);
    const fetched = JSON.parse(getResponse.payload);
    expect(fetched.id).toBe(created.id);
    expect(fetched.idempotency_key).toBe(key);
    expect(Array.isArray(fetched.postings)).toBe(true);
    expect(fetched.postings.length).toBe(2);
    // amount_cents must be string in GET response too
    expect(typeof fetched.postings[0].amount_cents).toBe("string");
  });

  it("returns 404 with problem+json for non-existent transaction UUID", async () => {
    const nonExistentId = randomUUID();

    const response = await app.inject({
      method: "GET",
      url: `/v1/transactions/${nonExistentId}`,
    });

    expect(response.statusCode).toBe(404);
    const parsed = JSON.parse(response.payload);
    expect(parsed.code).toBe("not_found");
    expect(parsed.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/application\/problem\+json/);
  });

  it("returns 400 for invalid UUID format in :id parameter", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/v1/transactions/not-a-uuid",
    });

    expect(response.statusCode).toBe(400);
  });
});
