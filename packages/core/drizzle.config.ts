/**
 * Drizzle Kit configuration — schema introspection and migration generation ONLY.
 *
 * PROHIBITED: `drizzle-kit push` is NOT permitted in this project.
 * Rationale: push bypasses the versioned migration file system and the drift gate
 * (check-migration-drift.mjs / migration-hashes.json), making it impossible to
 * audit or reproduce schema changes. All DDL must go through versioned .sql files
 * in packages/core/migrations/ with corresponding _journal.json entries.
 *
 * No `dbCredentials` are configured here intentionally — this prevents accidental
 * `push` even if the developer adds credentials for `drizzle-kit studio`.
 * Use DATABASE_URL env var only with `pnpm db:migrate` (src/db/migrate.ts).
 *
 * Allowed commands:
 *   pnpm drizzle-kit generate   — generate migration from schema diff
 *   pnpm drizzle-kit check      — check for pending schema changes (dry-run)
 *   pnpm drizzle-kit studio     — UI browser (read-only, no push)
 */
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
});
