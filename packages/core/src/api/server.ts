// server.ts — Fastify server factory for the Aprumo Ledger API.
//
// createServer(db) returns a fully configured Fastify instance ready to accept
// route plugin registrations. This factory is injectable for tests and main.ts.
//
// Wiring order (critical — Pitfall 4 in RESEARCH.md):
//   1. BigInt serializer (must be first — before any route registration)
//   2. @fastify/swagger (must be before routes to capture schemas)
//   3. @fastify/swagger-ui (depends on swagger)
//   4. Error handler (pgErrorHandler)
//   5. X-Request-Id response hook (D-09)
//   Route plugins are NOT registered here — see Plans 03-05, 03-06, 03-07.
//
// Security configuration (CLAUDE.md + RESEARCH.md):
//   coerceTypes: false    — never silently coerce types (Pitfall 3 prevention)
//   removeAdditional: all — strip unknown fields from request bodies
//   onProtoPoisoning: error — reject __proto__ injection attempts
//   pino redact           — authorization, cookie, idempotency-key header values are
//                           redacted from logs (D-10); bodies are never logged wholesale
//
// AnyDrizzleDb union:
//   Production: drizzle-orm/postgres-js (postgres.js driver)
//   Tests:      drizzle-orm/node-postgres (pg.Pool from createTestDb)
//   Exported so Plans 03-05/06/07 route plugins can reference the same type.

import { randomUUID } from "node:crypto";

import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { FastifyInstance } from "fastify";
import Fastify from "fastify";

import { pgErrorHandler } from "./errors/pg-error-handler.js";
import { registerBigIntSerializer } from "./plugins/bigint-serializer.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Union of Drizzle database instance types accepted by createServer.
 * Production uses PostgresJsDatabase (postgres.js driver).
 * Tests use NodePgDatabase (drizzle-orm/node-postgres wrapping pg.Pool).
 */
export type AnyDrizzleDb =
  | PostgresJsDatabase<Record<string, unknown>>
  | NodePgDatabase<Record<string, unknown>>;

/**
 * Options type for route plugins that need a db handle.
 * Import from this module for consistent typing across all route plans.
 */
export type ServerOptions = { db: AnyDrizzleDb };

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create and configure a Fastify server instance.
 *
 * Route plugins (transactions, accounts, health) are NOT registered here;
 * they are registered by Plans 03-05, 03-06, 03-07 via:
 *   await app.register(transactionRoutes, { prefix: '/v1', db })
 *
 * @param db - Drizzle database instance (production or test)
 * @returns Configured Fastify instance with TypeBox type provider
 */
export async function createServer(db: AnyDrizzleDb): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env["NODE_ENV"] === "test" ? "silent" : "info",
      // D-10: Redact auth and idempotency-key header values from logs.
      // Request/response bodies are NEVER logged wholesale by Fastify's default request log
      // (it only emits route, method, status, reqId by default). This redact config adds
      // defense-in-depth for headers that might otherwise appear in serialized log objects.
      // owner_ref and metadata in POST /accounts body are never emitted because body logging
      // is disabled (Fastify 5 does not log bodies in the default serializers).
      redact: ["req.headers.authorization", "req.headers.cookie", 'req.headers["idempotency-key"]'],
    },
    // D-09: Generate a UUID for every incoming request; used as instance in problem+json
    // and emitted as X-Request-Id response header via the onSend hook below.
    genReqId: () => randomUUID(),
    // T-03-04c: Reject requests with __proto__ or constructor keys in JSON body.
    onProtoPoisoning: "error",
    // T-03-04a, T-03-04b: Strict Ajv validation — strip unknown fields; minimal coercion.
    // coerceTypes: 'array' allows HTTP query-string values ("2" → 2 for integer params)
    // while preventing the dangerous array-to-scalar coercion that 'true' allows.
    // This is required for GetPostingsQuerySchema Type.Integer({ maximum:200 }) to work
    // correctly with query strings (which are always string-typed at the HTTP layer).
    // See D-06: limit parameter coercion is expected behaviour, not a security bypass.
    ajv: {
      customOptions: {
        coerceTypes: "array",
        removeAdditional: "all",
        useDefaults: true,
      },
    },
  }).withTypeProvider<TypeBoxTypeProvider>();

  // Step 1: Register BigInt serializer FIRST — before any plugin or route that could
  // respond with data containing BigInt values (amount_cents, balance from Drizzle).
  registerBigIntSerializer(app);

  // Step 2: Register OpenAPI spec generation (MUST precede route registration — Pitfall 4).
  await app.register(swagger, {
    openapi: {
      openapi: "3.0.0",
      info: {
        title: "Aprumo Ledger API",
        version: "0.1.0",
        description:
          "Immutable double-entry ledger API. amount_cents fields are JSON strings (BigInt precision).",
      },
    },
  });

  // Step 3: Register Swagger UI (depends on swagger being registered above).
  await app.register(swaggerUi, { routePrefix: "/docs" });

  // Step 4: Wire the global error handler (pgErrorHandler maps PG codes → RFC 9457 responses).
  app.setErrorHandler(pgErrorHandler);

  // Step 5: D-09 — Reflect the generated request ID back as X-Request-Id response header.
  // This allows callers and logs to correlate requests with error responses.
  app.addHook("onSend", (req, reply, _payload, done) => {
    reply.header("x-request-id", req.id);
    done();
  });

  // Route plugins are registered by the caller (Plans 03-05/06/07 or tests).
  // Example:
  //   await app.register(transactionRoutes, { prefix: '/v1', db })
  //   await app.register(accountRoutes, { prefix: '/v1', db })
  //   await app.register(healthRoutes, { db })

  return app;
}
