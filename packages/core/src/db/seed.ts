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

/**
 * WR-06: Structural validation for seed SQL content.
 *
 * Strips leading SQL line-comments (lines starting with "--") and blank lines,
 * then verifies the first non-skipped line begins with the DO $$ pattern.
 *
 * This guard prevents dependency confusion attacks where a malicious file
 * substitutes arbitrary SQL that would run as the migration role via sql.unsafe().
 *
 * @param content - Raw SQL content to validate
 * @param label   - Optional label (e.g. file path) for the error message
 * @throws Error if the first non-comment, non-blank line does not match DO $$
 */
export function assertSeedStructure(content: string, label?: string): void {
  const lines = content.split("\n");
  const firstRealLine = lines.find((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && !trimmed.startsWith("--");
  });

  if (firstRealLine === undefined || !/^\s*DO\s+\$\$/.test(firstRealLine)) {
    const location = label !== undefined ? ` at ${label}` : "";
    throw new Error(
      `Seed file${location} does not begin with the expected DO $$ block. ` +
        "Refusing to execute unrecognised content.",
    );
  }
}

async function runSeed(databaseUrl?: string): Promise<void> {
  // CR-01: Environment allowlist guard — mirrors reset.ts.
  // Seed inserts accounts accumulate without a unique constraint on owner_ref, and
  // executes sql.unsafe() as the migration role. Running against production is a
  // data-corruption risk even though post_transaction is idempotent on idempotency_key.
  const SAFE_ENVS = new Set(["development", "test"]);
  const nodeEnv = process.env.NODE_ENV ?? "";
  if (!SAFE_ENVS.has(nodeEnv)) {
    throw new Error(
      `db:seed refused: NODE_ENV="${nodeEnv}" is not a permitted environment. ` +
        `Allowed values: development, test.`,
    );
  }

  const url = databaseUrl ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is required — set it in the environment or pass it explicitly to runSeed()",
    );
  }

  const seedContent = readFileSync(SEED_SQL_PATH, "utf8");

  // WR-06: Structural validation before executing sql.unsafe().
  // Verify the seed file begins with the expected `DO $$` pattern to guard against
  // dependency confusion attacks where a malicious package substitutes the file with
  // arbitrary SQL that would run as the migration role.
  // Log the resolved path for audit purposes.
  process.stdout.write(`Loading seed from: ${SEED_SQL_PATH}\n`);
  assertSeedStructure(seedContent, SEED_SQL_PATH);

  // { max: 1 } — single connection, no pool overhead for a one-shot seed script.
  const sql = postgres(url, { max: 1 });

  try {
    // unsafe() allows multi-statement SQL (the DO $$ block in 0006_seed_dev.sql).
    await sql.unsafe(seedContent);
    process.stdout.write("Seed applied.\n");
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
      process.stderr.write(`Seed failed: ${String(err)}\n`);
      process.exit(1);
    });
}
