/**
 * Dev seed runner for @aprumo/core.
 *
 * Reads packages/core/migrations/0006_seed_dev.sql and executes it against DATABASE_URL.
 * This script is intentionally SEPARATE from the migrate runner — seed data must never
 * be applied automatically by pnpm db:migrate.
 *
 * Usage:
 *   tsx src/db/seed.ts     (or via: pnpm --filter @aprumo/core db:seed)
 *
 * Requires DATABASE_URL env var pointing to a Postgres instance with aprumo_migration role
 * (seed calls post_transaction which requires the function to exist, and INSERT on accounts).
 *
 * See: CLAUDE.md Invariant #1 — 0006_seed_dev.sql uses post_transaction, never direct INSERT
 *      into postings. This script only executes the SQL; the invariant is enforced in the SQL.
 * See: FND-14 (dev seed script requirement)
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_SQL_PATH = path.resolve(__dirname, "../../migrations/0006_seed_dev.sql");

async function runSeed(databaseUrl?: string): Promise<void> {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required — set it in the environment or pass it explicitly to runSeed()",
    );
  }

  const seedContent = readFileSync(SEED_SQL_PATH, "utf8");

  // { max: 1 } — single connection, no pool overhead for a one-shot seed script.
  const sql = postgres(url, { max: 1 });

  try {
    // unsafe() allows multi-statement SQL (the DO $$ block in 0006_seed_dev.sql).
    await sql.unsafe(seedContent);
    console.log("Seed applied.");
  } finally {
    await sql.end();
  }
}

export { runSeed };

// CLI entry point — only runs when executed directly, not when imported as a module.
const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  runSeed()
    .then(() => {
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("Seed failed:", err);
      process.exit(1);
    });
}
