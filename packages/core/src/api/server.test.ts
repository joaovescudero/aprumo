// server.test.ts — Integration tests for the Fastify server factory.
//
// TDD RED: This file imports from './server.js' which does not yet exist.
// Tests cover:
//   1. BigInt 100n in response is serialized as JSON string '100' (not number 100)
//   2. BigInt > MAX_SAFE_INTEGER (9007199254740993n) is preserved as string with full precision
//   3. GET /docs returns 200 (swagger UI registered before any routes)
//
// Must FAIL until Task 3 creates server.ts and bigint-serializer.ts.

import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "../../tests/helpers/createTestDb.js";
import { type AnyDrizzleDb, createServer } from "./server.js";

let testDb: TestDb;
let drizzleDb: AnyDrizzleDb;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let app: Awaited<ReturnType<typeof createServer>>;

beforeAll(async () => {
  testDb = await createTestDb(import.meta.url);
  // drizzle-orm/node-postgres: accepts pg.Pool directly (testDb.app is a pg.Pool)
  drizzleDb = drizzle(testDb.app);
  app = await createServer(drizzleDb);

  // Register a one-off test route that returns a BigInt value directly.
  // This simulates what Drizzle returns for amount_cents (bigint mode).
  app.get("/test-bigint", {}, async () => ({ amount_cents: 100n }));

  // Separate route for >MAX_SAFE_INTEGER boundary test.
  // 9007199254740993 === Number.MAX_SAFE_INTEGER + 2 — would lose precision as JS number.
  app.get("/test-bigint-large", {}, async () => ({ amount_cents: 9007199254740993n }));

  await app.ready();
});

afterAll(async () => {
  await app.close();
  await testDb.cleanup();
});

describe("BigInt serialization", () => {
  it("serializes BigInt 100n as JSON string '100' (not number 100)", async () => {
    const response = await app.inject({ method: "GET", url: "/test-bigint" });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    // Critical invariant (API-02, CLAUDE.md #8): amount_cents must be a string, not a number.
    // native JSON.stringify(100n) throws TypeError; setSerializerCompiler converts to '100'.
    expect(typeof body.amount_cents).toBe("string");
    expect(body.amount_cents).toBe("100");
  });

  it("preserves BigInt > MAX_SAFE_INTEGER as string without precision loss", async () => {
    const response = await app.inject({ method: "GET", url: "/test-bigint-large" });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as Record<string, unknown>;
    // 9007199254740993 cannot be represented exactly as a JS number.
    // If serialized as a number it would become 9007199254740992 (silent precision loss).
    expect(typeof body.amount_cents).toBe("string");
    expect(body.amount_cents).toBe("9007199254740993");
  });
});

describe("Swagger UI", () => {
  it("GET /docs returns 200 (swagger registered before routes)", async () => {
    const response = await app.inject({ method: "GET", url: "/docs" });
    // @fastify/swagger-ui serves the interactive UI at the routePrefix.
    // Returns 200 (or 302 redirect to /docs/) — accept both.
    expect(response.statusCode).toBeLessThan(400);
  });
});
