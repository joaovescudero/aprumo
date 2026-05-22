/**
 * Programmatic migration runner for @aprumo/core.
 *
 * Usage:
 *   tsx src/db/migrate.ts         (CLI)
 *   import { runMigrations } from './migrate.js'  (programmatic, e.g. test helpers)
 *
 * Requires DATABASE_URL env var pointing to a Postgres instance with aprumo_migration role.
 * Connects with { max: 1 } as required by drizzle-orm/postgres-js/migrator.
 *
 * IMPORTANT: this runner SKIPS entries whose tag contains 'seed' — seed migrations are
 * dev-only and must be applied manually via `pnpm db:seed`, never automatically.
 * The seed entry is still registered in _journal.json for Plan 09 drift-check tracking.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = path.resolve(__dirname, "../../migrations");

/** Tag patterns that identify dev-only seed migrations — skipped by this runner. */
const SEED_TAG_PATTERN = /seed/i;

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/**
 * Reads migration files from the migrations folder, skipping any tagged as seed.
 * Mirrors the logic of drizzle-orm/migrator's readMigrationFiles but with the seed filter.
 */
function readNonSeedMigrations(migrationsFolder: string): {
  sql: string[];
  bps: boolean;
  folderMillis: number;
  hash: string;
  tag: string;
}[] {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  if (!fs.existsSync(journalPath)) {
    throw new Error(`Can't find meta/_journal.json file at ${journalPath}`);
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8")) as Journal;

  const result: {
    sql: string[];
    bps: boolean;
    folderMillis: number;
    hash: string;
    tag: string;
  }[] = [];

  for (const entry of journal.entries) {
    // Skip dev-only seed entries — these must be applied via `pnpm db:seed`.
    if (SEED_TAG_PATTERN.test(entry.tag)) {
      continue;
    }

    const migrationPath = path.join(migrationsFolder, `${entry.tag}.sql`);
    if (!fs.existsSync(migrationPath)) {
      throw new Error(`No file ${migrationPath} found in ${migrationsFolder} folder`);
    }

    const query = fs.readFileSync(migrationPath, "utf8");
    result.push({
      sql: query.split("--> statement-breakpoint"),
      bps: entry.breakpoints,
      folderMillis: entry.when,
      hash: crypto.createHash("sha256").update(query).digest("hex"),
      tag: entry.tag,
    });
  }

  return result;
}

export async function runMigrations(databaseUrl?: string): Promise<void> {
  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required — set it in the environment or pass it explicitly to runMigrations()",
    );
  }

  const migrations = readNonSeedMigrations(MIGRATIONS_FOLDER);

  // { max: 1 } is required: the migrator uses a single connection and does not
  // work correctly with a pool.
  const sql = postgres(url, { max: 1 });

  try {
    // Apply each migration in order, tracking applied migrations in __drizzle_migrations.
    await sql.begin(async (tx) => {
      // Ensure the migrations tracking table exists.
      await tx`
        CREATE SCHEMA IF NOT EXISTS drizzle
      `;
      await tx`
        CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
          id        serial PRIMARY KEY,
          hash      text    NOT NULL,
          created_at bigint
        )
      `;

      // Collect hashes already applied.
      const applied = await tx<{ hash: string }[]>`
        SELECT hash FROM drizzle.__drizzle_migrations ORDER BY id ASC
      `;
      const appliedHashes = new Set(applied.map((r) => r.hash));

      for (const migration of migrations) {
        if (appliedHashes.has(migration.hash)) {
          // Already applied — idempotent skip.
          continue;
        }

        // Execute each statement in the migration file.
        for (const statement of migration.sql) {
          const trimmed = statement.trim();
          if (trimmed.length === 0) continue;
          await tx.unsafe(trimmed);
        }

        // Record the migration as applied.
        await tx`
          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
          VALUES (${migration.hash}, ${migration.folderMillis})
        `;
      }
    });
  } finally {
    await sql.end();
  }
}

// CLI entry point — only runs when executed directly, not when imported as a module.
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
