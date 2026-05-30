// health.test.ts — Integration tests for GET /health and Swagger UI endpoints.
//
// Covers:
//   API-12: GET /health returns 200 { status: 'ok', postgres: 'up' } when PG is reachable
//   API-12: GET /health returns 503 { status: 'error', postgres: string } when db.execute throws
//   API-13: GET /docs returns 200 (swagger UI registered)
//   API-13: GET /docs/json OpenAPI spec has amount_cents documented as type:string
//
// Test lifecycle:
//   beforeAll: createTestDb → drizzle → createServer → register all 3 route plugins → app.ready()
//   afterAll:  app.close() → testDb.cleanup()
//
// Stub pattern for PG-down test:
//   vi.spyOn(drizzleDb, 'execute').mockRejectedValueOnce(new Error('conn refused'))
//   This avoids stopping the container and is reset immediately after inject via vi.restoreAllMocks()

import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { createTestDb, type TestDb } from "../../../tests/helpers/createTestDb.js";
import { createServer } from "../server.js";
import { accountRoutes } from "./accounts.js";
import { healthRoutes } from "./health.js"; // non-existent → RED
import { transactionRoutes } from "./transactions.js";

let testDb: TestDb;
let drizzleDb: ReturnType<typeof drizzle>;
// biome-ignore lint/suspicious/noExplicitAny: FastifyInstance type from createServer
let app: any;

// ─────────────────────────────────────────────────────────────────────────────
// Test lifecycle
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  testDb = await createTestDb(import.meta.url);
  drizzleDb = drizzle(testDb.app);
  app = await createServer(drizzleDb);

  // Register route plugins in the same order as main.ts will use.
  // transactionRoutes and accountRoutes must be registered BEFORE healthRoutes
  // so the full OpenAPI spec (including amount_cents schemas) is captured.
  await app.register(transactionRoutes, { prefix: "/v1", db: drizzleDb });
  await app.register(accountRoutes, { prefix: "/v1", db: drizzleDb });
  // healthRoutes is registered WITHOUT /v1 prefix (D-07: single /health endpoint at root)
  await app.register(healthRoutes, { db: drizzleDb });

  await app.ready();
});

afterAll(async () => {
  await app.close();
  await testDb.cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

it("GET /health returns 200 when PG is up", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/health",
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.parse(response.payload) as { status: string; postgres: string };
  expect(body.status).toBe("ok");
  expect(body.postgres).toBe("up");
});

it("GET /health returns 503 when db.execute throws", async () => {
  // Stub a single db.execute call to simulate PG connectivity failure.
  // vi.restoreAllMocks() is called immediately after inject to un-stub.
  vi.spyOn(drizzleDb, "execute").mockRejectedValueOnce(new Error("conn refused"));

  const response = await app.inject({
    method: "GET",
    url: "/health",
  });

  vi.restoreAllMocks();

  expect(response.statusCode).toBe(503);
  const body = JSON.parse(response.payload) as { status: string; postgres: string };
  expect(body.status).toBe("error");
  expect(typeof body.postgres).toBe("string");
});

it("GET /docs returns 200", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/docs",
  });

  expect(response.statusCode).toBe(200);
});

it("GET /docs/json has amount_cents as type string", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/docs/json",
  });

  expect(response.statusCode).toBe(200);
  const body = JSON.stringify(JSON.parse(response.payload) as unknown);
  // amount_cents must be documented as type:string in the OpenAPI spec (API-13)
  expect(body).toContain('"amount_cents"');
  expect(body).toContain('"type":"string"');
});
