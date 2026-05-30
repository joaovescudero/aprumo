// @aprumo/core — Public API surface.
//
// This module is the entry point for consumers of @aprumo/core.
// main.ts is NOT exported — it is an entrypoint, not a library export.
//
// Exports:
//   createServer  — factory function: createServer(db) → FastifyInstance
//   AnyDrizzleDb  — union type accepted by createServer and all route plugins
//   db/schema     — Drizzle table definitions for downstream consumers (connectors, etc.)

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------
export type { AnyDrizzleDb, ServerOptions } from "./api/server.js";
export { createServer } from "./api/server.js";

// ---------------------------------------------------------------------------
// Database schema (Drizzle table/type exports for downstream packages)
// ---------------------------------------------------------------------------
export * from "./db/schema.js";
