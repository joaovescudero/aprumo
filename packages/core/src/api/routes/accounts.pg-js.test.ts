// accounts.pg-js.test.ts — Production-driver parity tests for cursor pagination.
//
// WHY THIS FILE EXISTS:
//   The main accounts.test.ts injects a node-postgres (pg.Pool) db. Production
//   (main.ts) uses postgres-js (drizzle-orm/postgres-js). node-postgres serializes
//   a JS Date bound as a query param; postgres-js does NOT — it throws
//   ERR_INVALID_ARG_TYPE. So a keyset cursor that binds a Date passes the node-pg
//   suite but 500s in production. These tests run pagination through the SAME driver
//   production uses, so prod-only regressions in the cursor path are caught.
//
// Covers UAT-03 gap (test 8):
//   1. page 2 (valid next_cursor) returns 200 under postgres-js — not 500
//   2. (created_at, id) keyset tiebreaker survives microsecond-identical timestamps

import { randomUUID } from "node:crypto";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { createTestDb, type TestDb } from "../../../tests/helpers/createTestDb.js";
import { createServer } from "../server.js";
import { accountRoutes } from "./accounts.js";
import { transactionRoutes } from "./transactions.js";

let testDb: TestDb;
let pgClient: ReturnType<typeof postgres>;
// biome-ignore lint/suspicious/noExplicitAny: FastifyInstance type from createServer
let app: any;

beforeAll(async () => {
  testDb = await createTestDb(import.meta.url);

  // Build the PRODUCTION driver (postgres-js) connected as aprumo_app on the
  // isolated test schema — mirrors main.ts exactly.
  const url = new URL(inject("pgUri"));
  pgClient = postgres({
    host: url.hostname,
    port: Number(url.port),
    database: url.pathname.slice(1),
    username: "aprumo_app",
    password: "test-only",
    connection: { search_path: `${testDb.schema},public` },
    max: 4,
  });
  const db = drizzle(pgClient);

  app = await createServer(db);
  await app.register(transactionRoutes, { prefix: "/v1", db });
  await app.register(accountRoutes, { prefix: "/v1", db });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await pgClient.end();
  await testDb.cleanup();
});

async function createAccount(type: string, owner_ref: string): Promise<string> {
  const r = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    headers: { "content-type": "application/json" },
    payload: { type, owner_ref },
  });
  if (r.statusCode !== 201) throw new Error(`createAccount ${r.statusCode}: ${r.payload}`);
  return (JSON.parse(r.payload) as { id: string }).id;
}

async function createTransaction(debitId: string, creditId: string, amount: number): Promise<void> {
  const r = await app.inject({
    method: "POST",
    url: "/v1/transactions",
    headers: { "idempotency-key": randomUUID(), "content-type": "application/json" },
    payload: {
      postings: [
        { account_id: debitId, amount_cents: amount, direction: "debit" },
        { account_id: creditId, amount_cents: amount, direction: "credit" },
      ],
      description: "pg-js pagination seed",
    },
  });
  if (r.statusCode !== 201) throw new Error(`createTransaction ${r.statusCode}: ${r.payload}`);
}

describe("GET /v1/accounts/:id/postings — postgres-js production driver", () => {
  it("page 2 with a valid next_cursor returns 200, not 500 (UAT-03 gap)", async () => {
    const acct = await createAccount("asset", "pgjs-paginate");
    const counter = await createAccount("revenue", "pgjs-counter");
    await createTransaction(acct, counter, 101);
    await createTransaction(acct, counter, 102);
    await createTransaction(acct, counter, 103);

    const page1 = await app.inject({ method: "GET", url: `/v1/accounts/${acct}/postings?limit=2` });
    expect(page1.statusCode).toBe(200);
    const p1 = JSON.parse(page1.payload);
    expect(p1.data).toHaveLength(2);
    expect(typeof p1.next_cursor).toBe("string");

    // The bug: this request 500s under postgres-js because the keyset binds a Date.
    const page2 = await app.inject({
      method: "GET",
      url: `/v1/accounts/${acct}/postings?limit=2&cursor=${p1.next_cursor}`,
    });
    expect(page2.statusCode).toBe(200);
    const p2 = JSON.parse(page2.payload);
    expect(p2.data).toHaveLength(1);
    expect(p2.next_cursor).toBeNull();

    const p1ids = p1.data.map((p: { id: string }) => p.id);
    const p2ids = p2.data.map((p: { id: string }) => p.id);
    expect(p1ids.filter((id: string) => p2ids.includes(id))).toHaveLength(0);
  });

  it("keyset tiebreaker survives microsecond-identical created_at (no skip/dup)", async () => {
    const acct = await createAccount("asset", "pgjs-tiebreak");
    const counter = await createAccount("revenue", "pgjs-tiebreak-counter");

    // Seed 3 postings on `acct` that all share the EXACT same created_at
    // (microsecond-identical). The double_entry trigger requires each transaction to
    // balance, so we create 3 balanced transactions and stamp BOTH legs with the same
    // created_at. Distinct posting ids then make the (created_at, id) tiebreaker the
    // only thing separating the acct-side rows — a ms-truncated cursor skips them.
    const ts = "2026-03-04 05:06:07.123456+00"; // identical microsecond stamp
    for (let n = 0; n < 3; n++) {
      const txRes = await testDb.migration.query<{ id: string }>(
        `INSERT INTO transactions (id, idempotency_key, ts, description, source)
         VALUES (gen_random_uuid(), $1, now(), 'tiebreak', 'test') RETURNING id`,
        [`tiebreak-${randomUUID()}`],
      );
      const txId = txRes.rows[0]!.id;
      await testDb.migration.query(
        `INSERT INTO postings (id, transaction_id, account_id, amount_cents, direction, created_at)
         VALUES
           (gen_random_uuid(), $1, $2, 100, 'debit',  $3),
           (gen_random_uuid(), $1, $4, 100, 'credit', $3)`,
        [txId, acct, ts, counter],
      );
    }

    // Walk the full list one page at a time (limit=1). Every posting must appear
    // exactly once across all pages — no skip, no duplicate.
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let guard = 0; guard < 10; guard++) {
      const url: string = `/v1/accounts/${acct}/postings?limit=1${cursor ? `&cursor=${cursor}` : ""}`;
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload);
      for (const p of body.data) seen.push(p.id);
      cursor = body.next_cursor;
      if (cursor === null) break;
    }

    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3); // no duplicates
  });
});
