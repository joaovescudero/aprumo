/**
 * Programmatic migration runner for @aprumo/core.
 *
 * Usage:
 *   tsx src/db/migrate.ts         (CLI)
 *   import { runMigrations } from './migrate.js'  (programmatic, e.g. test helpers)
 *
 * Requires DATABASE_URL env var pointing to a Postgres instance with aprumo_migration role.
 * Connects with { max: 1 } as required by drizzle-orm/postgres-js/migrator.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../migrations");

export async function runMigrations(databaseUrl?: string): Promise<void> {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required — set it in the environment or pass it explicitly to runMigrations()",
    );
  }

  // { max: 1 } is required: migrate() uses a single connection and does not
  // work correctly with a pool (per drizzle-orm/postgres-js/migrator internals).
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);

  try {
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await sql.end();
  }
}

// CLI entry point — only runs when executed directly, not when imported as a module.
// Detect via `import.meta.url` vs the resolved argv[1] path.
const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  runMigrations()
    .then(() => {
      console.log("Migrations applied successfully.");
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
