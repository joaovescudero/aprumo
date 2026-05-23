/**
 * Custom per-schema SQL migration runner for test isolation.
 *
 * Reads migration files from the journal, rewrites "public". qualifiers to
 * the target schema, and executes statements via postgres-js.
 *
 * This is the test-only counterpart to src/db/migrate.ts. The production
 * runner applies unmodified SQL to the public schema where FK targets are
 * correct. This runner rewrites FK qualifiers so migrations work inside
 * isolated per-test schemas (test_xxx) used by testcontainers.
 *
 * IMPORTANT: Migration files on disk are NEVER modified. The rewrite is
 * in-memory only — drift gate (migration-hashes.json) remains intact.
 *
 * Per D-37: schema-per-test-file isolation using createTestDb helper.
 * Per CLAUDE.md Invariant 1: append-only tables; this helper only creates
 * schema structure, never mutates production data.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

/** Tag patterns that identify dev-only seed migrations — skipped by this runner. */
const SEED_TAG_PATTERN = /seed/i;

/**
 * Split a SQL file content into individual executable statements.
 *
 * Handles two cases:
 * 1. Files with `--> statement-breakpoint` markers (drizzle-generated DDL like 0000_init_tables.sql)
 *    — split on statement-breakpoint; each chunk is one statement.
 * 2. Files without markers (hand-written migrations: roles, grants, post_transaction, etc.)
 *    — split on `;` but skip semicolons inside `$$...$$` dollar-quoted blocks.
 *    This is required because PostgreSQL's simple query protocol parses ALL statements
 *    before executing any — type resolution in ALTER FUNCTION fails if CREATE TYPE
 *    is in the same batch but hasn't been executed yet.
 *
 * Dollar-quote tracking: we track whether we are inside a `$$` block and skip
 * any `;` found within it. This handles PL/pgSQL function bodies safely.
 */
export function splitMigrationStatements(sql: string): string[] {
  if (sql.includes("--> statement-breakpoint")) {
    return sql.split("--> statement-breakpoint");
  }

  // Split on `;` outside of `$$...$$` dollar-quoted blocks and `--` comment lines.
  // This is required because PostgreSQL simple query protocol parses ALL statements
  // before executing any — so each statement must be sent individually.
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;
  let inLineComment = false;
  let i = 0;

  while (i < sql.length) {
    const ch = sql[i] ?? "";
    const next = sql[i + 1] ?? "";

    // Handle end of line — resets single-line comment state
    if (ch === "\n") {
      inLineComment = false;
      current += ch;
      i++;
      continue;
    }

    // Detect start of single-line comment (`--`)
    if (!inDollarQuote && !inLineComment && ch === "-" && next === "-") {
      inLineComment = true;
      current += ch;
      i++;
      continue;
    }

    // Inside a line comment — just accumulate characters (no splitting)
    if (inLineComment) {
      current += ch;
      i++;
      continue;
    }

    // Check for start/end of dollar-quote block (`$$`).
    // Guard with !inLineComment to prevent a $$ sequence inside a `--` comment
    // from flipping inDollarQuote. Without the guard, `-- uses $$ quoting` would
    // incorrectly enter dollar-quote mode and suppress all subsequent semicolons.
    if (!inLineComment && ch === "$" && next === "$") {
      inDollarQuote = !inDollarQuote;
      current += "$$";
      i += 2;
      continue;
    }

    // Split on `;` only when NOT inside a dollar-quoted block or comment
    if (ch === ";" && !inDollarQuote) {
      const trimmed = `${current};`.trim();
      // Filter out lone semicolons and comment-only chunks
      const withoutComments = trimmed.replace(/--[^\n]*/g, "").trim();
      if (withoutComments.length > 1) {
        statements.push(trimmed);
      }
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  // Push any remaining content after the last semicolon
  const remaining = current.trim();
  if (remaining.length > 0) {
    const withoutComments = remaining.replace(/--[^\n]*/g, "").trim();
    if (withoutComments.length > 0) {
      statements.push(remaining);
    }
  }

  return statements;
}

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
 * Rewrite all occurrences of the literal `"public".` qualifier in a SQL string
 * to `"${schema}".` so FK REFERENCES targets the correct test schema instead of
 * the literal public schema.
 *
 * Only replaces the exact four-character sequence `"public".` — safe to apply
 * to any migration SQL statement. Non-public-qualified statements are returned
 * unchanged.
 *
 * Example:
 *   REFERENCES "public"."accounts"("id")
 *   → REFERENCES "myschema"."accounts"("id")
 */
export function rewritePublicQualifier(sql: string, schema: string): string {
  return sql.replaceAll('"public".', `"${schema}".`);
}

/**
 * Apply additional schema-specific rewrites for test isolation beyond the basic
 * `"public".` FK qualifier rewrite.
 *
 * These rewrites are required to make hand-written migrations work in per-schema
 * test isolation contexts:
 *
 * 1. `SET search_path = public` → `SET search_path = ${schema},public`
 *    Required in function definitions (post_transaction, audit_row_change, etc.).
 *    PL/pgSQL validates DECLARE-section types using the function's own SET search_path
 *    at CREATE FUNCTION time. Without this rewrite, `v_rec posting_input` in the
 *    DECLARE block fails because `posting_input` is in `test_xxx`, not `public`.
 *
 * 2. `IN SCHEMA public` → `IN SCHEMA ${schema}`
 *    Required for GRANT/REVOKE/ALTER DEFAULT PRIVILEGES statements so that
 *    privileges are applied to the test schema's objects, not the empty public schema.
 *
 * Note: This is a test-only helper — production migrate.ts is unmodified.
 */
export function rewriteForTestSchema(sql: string, schema: string): string {
  return sql
    .replaceAll("SET search_path = public", `SET search_path = ${schema},public`)
    .replaceAll("IN SCHEMA public", `IN SCHEMA ${schema}`);
}

/**
 * Apply all non-seed migrations from migrationsFolder into the given Postgres schema.
 *
 * For each migration:
 *   1. Reads SQL from disk (never modifies the file).
 *   2. Computes sha256 hash of raw content (matches migration-hashes.json).
 *   3. Rewrites "public". qualifiers to "${schema}". in memory.
 *   4. Splits on "--> statement-breakpoint".
 *   5. Executes non-empty statements via postgres-js tx.unsafe().
 *   6. Tracks applied hash in ${schema}.__drizzle_migrations for idempotency.
 *
 * @param pgUri - Postgres connection URI (from testcontainers inject('pgUri')).
 * @param migrationsFolder - Absolute path to the migrations directory.
 * @param schema - Target test schema name (e.g. 'test_abc123def456').
 */
/**
 * Read a file with up to 3 retries on ENOENT.
 * macOS APFS can transiently return ENOENT under heavy concurrent I/O
 * (10+ forks all reading the same static files simultaneously). The file
 * is never deleted during a test run so ENOENT is always transient.
 */
async function readWithRetry(filePath: string, folderForError: string): Promise<string> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return fs.readFileSync(filePath, "utf8");
    } catch (err: unknown) {
      lastErr = err;
      const code =
        typeof err === "object" && err !== null && "code" in err
          ? (err as { code: string }).code
          : undefined;
      if (code !== "ENOENT") throw err;
      // Exponential backoff with jitter: 20ms, 40ms, 80ms, ...
      const wait = Math.min(20 * 2 ** attempt + Math.random() * 20, 500);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  const code =
    typeof lastErr === "object" && lastErr !== null && "code" in lastErr
      ? (lastErr as { code: string }).code
      : undefined;
  if (code === "ENOENT") {
    throw new Error(`No file ${filePath} found in ${folderForError}`);
  }
  throw lastErr;
}

export async function applyMigrationsToSchema(
  pgUri: string,
  migrationsFolder: string,
  schema: string,
): Promise<void> {
  const journalPath = path.join(migrationsFolder, "meta", "_journal.json");
  const journalContent = await readWithRetry(journalPath, migrationsFolder);
  const journal = JSON.parse(journalContent) as Journal;

  // Collect migrations to apply, skipping seed entries.
  const migrations: {
    sql: string[];
    folderMillis: number;
    hash: string;
    tag: string;
  }[] = [];

  for (const entry of journal.entries) {
    if (SEED_TAG_PATTERN.test(entry.tag)) {
      continue;
    }

    const migrationPath = path.join(migrationsFolder, `${entry.tag}.sql`);

    // Read raw content — hash is computed BEFORE any rewrite to match migration-hashes.json.
    // Retry up to 3 times on ENOENT: macOS APFS can transiently return ENOENT under heavy
    // concurrent I/O (10+ forks all reading the same static files simultaneously).
    // The file is never deleted during a test run, so ENOENT is always transient here.
    const rawSql = await readWithRetry(migrationPath, migrationsFolder);
    const hash = crypto.createHash("sha256").update(rawSql).digest("hex");

    // Apply rewrites in memory only — disk file unchanged (drift gate stays intact).
    // 1. rewritePublicQualifier: fixes FK REFERENCES "public"."tablename" qualifiers.
    // 2. rewriteForTestSchema: fixes SET search_path = public in function definitions
    //    and IN SCHEMA public in grant/revoke statements.
    const rewrittenSql = rewriteForTestSchema(rewritePublicQualifier(rawSql, schema), schema);

    migrations.push({
      sql: splitMigrationStatements(rewrittenSql),
      folderMillis: entry.when,
      hash,
      tag: entry.tag,
    });
  }

  // Open a single-connection postgres-js client.
  // max:1 ensures sequential execution on a single connection (same as production migrate.ts).
  // We do NOT use the `connection` option for search_path — instead we SET it explicitly
  // in SQL so it's visible at DDL type-resolution time within each statement.
  const sql = postgres(pgUri, { max: 1 });

  try {
    // Step 1: Ensure the per-schema migration tracking table exists.
    // schema name is SHA1-derived (test_[a-f0-9]{12}) — alphanumeric only, safe to interpolate.
    // Using unquoted identifier since test schema names never contain special characters.
    //
    // IMPORTANT: SET search_path here affects subsequent `sql.unsafe()` calls on this connection
    // because they all share the same session state (max:1 pool = single connection).
    await sql.unsafe(`SET search_path = ${schema},public`);
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS ${JSON.stringify(schema)}.__drizzle_migrations (
        id         serial PRIMARY KEY,
        hash       text   NOT NULL,
        created_at bigint
      )
    `);

    // Step 2: Collect hashes already applied (idempotency check).
    const applied = await sql.unsafe<{ hash: string }[]>(
      `SELECT hash FROM ${JSON.stringify(schema)}.__drizzle_migrations ORDER BY id ASC`,
    );
    const appliedHashes = new Set(applied.map((r) => r.hash));

    // Step 3: Apply each migration that hasn't been applied yet.
    for (const migration of migrations) {
      if (appliedHashes.has(migration.hash)) {
        // Already applied — idempotent skip.
        continue;
      }

      // Execute migration DDL. Each statement is wrapped in an explicit transaction
      // that begins with `SET LOCAL search_path = schema,public` so type resolution
      // (e.g. `posting_input` in ALTER FUNCTION signatures) uses the correct schema.
      // SET LOCAL persists for the duration of the transaction only.
      //
      // Note: DDL in PostgreSQL is transactional (CREATE TYPE, CREATE FUNCTION, etc.)
      // so each statement is safe to commit individually.
      for (const statement of migration.sql) {
        const trimmed = statement.trim();
        if (trimmed.length === 0) continue;
        try {
          await sql.begin(async (tx) => {
            // Set search_path for this transaction so DDL type lookups find test_xxx types.
            // SET LOCAL reverts after the transaction; the session search_path (set above)
            // remains as the default between transactions.
            await tx.unsafe(`SET LOCAL search_path = ${schema},public`);
            await tx.unsafe(trimmed);
          });
        } catch (err) {
          // 23505 = unique_violation: tolerated for cluster-level role creation when
          // multiple test files run concurrently in forks mode. The roles are global
          // (pg_authid) — if another fork already created them, we're idempotent.
          // 42710 = duplicate_object: similarly tolerated for roles and types.
          const pgCode =
            err instanceof Error && "code" in err ? (err as { code: string }).code : undefined;
          const isRoleStatement = /CREATE ROLE|DO \$\$/i.test(trimmed);
          if ((pgCode === "23505" || pgCode === "42710") && isRoleStatement) {
            // Role already created by a concurrent fork — safely idempotent.
            continue;
          }
          throw err;
        }
      }

      // Record the migration as applied — use a transaction to ensure atomicity.
      await sql.begin(async (tx) => {
        await tx.unsafe(`SET LOCAL search_path = ${schema},public`);
        await tx`
          INSERT INTO ${tx(schema)}.__drizzle_migrations (hash, created_at)
          VALUES (${migration.hash}, ${migration.folderMillis})
        `;
      });
    }
  } finally {
    await sql.end();
  }
}
