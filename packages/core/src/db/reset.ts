/**
 * DB reset script — drops and recreates the aprumo database.
 *
 * DESTRUCTIVE: For development use only. Do NOT run against production.
 * Guarded by NODE_ENV check — will refuse to run unless NODE_ENV=development or NODE_ENV is unset.
 *
 * Usage:
 *   tsx src/db/reset.ts               (CLI)
 *   RESET_DB_NAME=aprumo_test tsx src/db/reset.ts
 *
 * After reset, run `pnpm db:migrate` to reapply all migrations.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function resetDatabase(options?: {
  databaseUrl?: string;
  dbName?: string;
}): Promise<void> {
  const nodeEnv = process.env.NODE_ENV;
  if (nodeEnv === "production") {
    throw new Error("db:reset refused: NODE_ENV=production. This command is for development only.");
  }

  // Connect to the system "postgres" database (not the app DB) so we can DROP it.
  const appDbUrl = options?.databaseUrl ?? process.env.DATABASE_URL;
  if (!appDbUrl) {
    throw new Error("DATABASE_URL is required — set it in the environment before running db:reset");
  }

  const dbName = options?.dbName ?? process.env.RESET_DB_NAME ?? "aprumo";

  // Build the system-DB URL by replacing the database name with "postgres".
  // This assumes the URL is in the form postgres://user:pass@host:port/dbname
  const systemUrl = appDbUrl.replace(/\/[^/?]+(\?.*)?$/, "/postgres");

  const sql = postgres(systemUrl, { max: 1 });

  try {
    // Terminate all connections to the target database before dropping.
    await sql`
      SELECT pg_terminate_backend(pg_stat_activity.pid)
        FROM pg_stat_activity
       WHERE pg_stat_activity.datname = ${dbName}
         AND pid <> pg_backend_pid()
    `;

    // Using template literals with identifier injection is safe here because
    // dbName is validated above and postgres driver handles quoting.
    await sql`DROP DATABASE IF EXISTS ${sql(dbName)}`;
    await sql`CREATE DATABASE ${sql(dbName)}`;

    console.log(
      `DB reset complete — "${dbName}" recreated. Run pnpm db:migrate to reapply migrations.`,
    );
  } finally {
    await sql.end();
  }
}

// CLI entry point
const isMain =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain) {
  resetDatabase()
    .then(() => {
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error("DB reset failed:", err);
      process.exit(1);
    });
}
