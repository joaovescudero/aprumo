// health.ts — GET /health route plugin with Postgres liveness check.
//
// Decision D-07: Single /health endpoint doing both liveness + readiness.
// Registered WITHOUT /v1 prefix — at app root level (per plan 03-07 interfaces).
//
// Threat mitigations (STRIDE register T-03-07a):
//   503 response returns fixed string 'unreachable' — never includes err.message.
//   This prevents internal error details (e.g. DB hostname, connection string fragments)
//   from leaking to callers via the health endpoint.
//
// Registration pattern:
//   await app.register(healthRoutes, { db })   // NO prefix option
//   This places GET /health at the root of the Fastify instance.

import { Type } from "@sinclair/typebox";
import { sql } from "drizzle-orm";
import type { FastifyPluginAsync } from "fastify";

import type { AnyDrizzleDb } from "../server.js";

// ---------------------------------------------------------------------------
// Plugin options
// ---------------------------------------------------------------------------

export interface HealthRouteOptions {
  db: AnyDrizzleDb;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

/**
 * Fastify plugin registering GET /health.
 *
 * Returns 200 { status: 'ok', postgres: 'up' } when SELECT 1 succeeds.
 * Returns 503 { status: 'error', postgres: 'unreachable' } when db.execute throws.
 *
 * Must be registered WITHOUT a prefix:
 *   await app.register(healthRoutes, { db })
 */
export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (fastify, opts) => {
  const { db } = opts;

  fastify.get(
    "/health",
    {
      schema: {
        response: {
          200: Type.Object({
            status: Type.Literal("ok"),
            postgres: Type.Literal("up"),
          }),
          503: Type.Object({
            status: Type.Literal("error"),
            postgres: Type.String(),
          }),
        },
      },
    },
    async (_request, reply) => {
      try {
        await db.execute(sql`SELECT 1`);
        return reply.send({ status: "ok", postgres: "up" });
      } catch {
        // CRITICAL (T-03-07a): Do NOT include error details in the response.
        // Return a fixed string to avoid leaking connection info, DB hostname, etc.
        return reply.status(503).send({ status: "error", postgres: "unreachable" });
      }
    },
  );
};

export default healthRoutes;
