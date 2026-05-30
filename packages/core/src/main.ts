// main.ts — Aprumo Ledger API entrypoint.
//
// Wires createServer + all route plugins and starts listening.
//
// Environment variables:
//   DATABASE_URL (required) — Postgres connection string for aprumo_app role.
//   PORT          (optional, default 3000) — TCP port to listen on.
//
// Startup order (matches server.ts wiring order comments):
//   1. Parse DATABASE_URL — throw early on missing config (T-03-07b: never log value)
//   2. Create postgres.js client + drizzle instance
//   3. createServer(db) — registers BigInt serializer, swagger, swagger-ui, error handler
//   4. Register route plugins (transactionRoutes, accountRoutes, healthRoutes)
//   5. Listen on 0.0.0.0:PORT
//   6. Attach SIGTERM handler for graceful shutdown (T-03-07c)
//
// Note: DATABASE_URL value is NEVER logged (T-03-07b, CLAUDE.md §Invariants #8 no-PII).
// Only the port number is logged at startup.

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { accountRoutes } from "./api/routes/accounts.js";
import { healthRoutes } from "./api/routes/health.js";
import { transactionRoutes } from "./api/routes/transactions.js";
import { createServer } from "./api/server.js";

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

(async () => {
  // Validate required environment variables upfront — fail fast with a clear message.
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  // Create postgres.js connection (production driver — drizzle-orm/postgres-js).
  // SIGTERM handler closes this connection before process.exit.
  const pgClient = postgres(databaseUrl);

  // Create Drizzle instance wrapping the postgres.js client.
  const db = drizzle(pgClient);

  // Create and configure the Fastify server (BigInt serializer, swagger, error handler).
  const app = await createServer(db);

  // Register route plugins in order:
  //   transactionRoutes first (POST/GET /v1/transactions)
  //   accountRoutes second  (POST/GET /v1/accounts + GET /v1/accounts/:id/postings)
  //   healthRoutes last     (GET /health — no /v1 prefix per D-07)
  await app.register(transactionRoutes, { prefix: "/v1", db });
  await app.register(accountRoutes, { prefix: "/v1", db });
  await app.register(healthRoutes, { db });

  // SIGTERM graceful shutdown (T-03-07c):
  //   Close HTTP server (drains in-flight requests), then close PG connections.
  //   Without this, containerized deployments leak DB connections on pod termination.
  process.on("SIGTERM", () => {
    app.log.info("SIGTERM received, shutting down gracefully");
    void app
      .close()
      .then(() => pgClient.end())
      .then(() => {
        process.exit(0);
      })
      .catch((err: unknown) => {
        app.log.error({ err }, "Error during graceful shutdown");
        process.exit(1);
      });
  });

  // Start listening.
  const port = Number(process.env.PORT ?? "3000");
  await app.listen({ port, host: "0.0.0.0" });
  app.log.info({ port }, "Aprumo Ledger API started");
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
