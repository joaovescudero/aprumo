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

      // Execute migration DDL and tracking INSERT in a single outer transaction.
      //
      // Using one transaction for all statements of a migration + the tracking INSERT
      // eliminates the partial-failure window: if the process is interrupted after DDL
      // commits but before the tracking INSERT commits, the migration is applied but
      // never recorded, and the next run fails on non-idempotent DDL (e.g. CREATE TABLE
      // without IF NOT EXISTS). Wrapping both in one transaction makes them atomic.
      //
      // SET LOCAL search_path at the top of the transaction applies to all statements
      // within it — same type-resolution behaviour as the previous per-statement approach.
      //
      // Role/type duplicates (23505 / 42710): handled via savepoints so the outer
      // transaction stays alive when a concurrent fork has already created a global role.
      await sql.begin(async (tx) => {
        // Set search_path once for the whole migration transaction so DDL type lookups
        // (e.g. `posting_input` composite type in ALTER FUNCTION signatures) find the
        // correct test schema types. SET LOCAL reverts at transaction end.
        await tx.unsafe(`SET LOCAL search_path = ${schema},public`);

        for (const statement of migration.sql) {
          const trimmed = statement.trim();
          if (trimmed.length === 0) continue;

          // Use a savepoint so that a 23505/42710 on role/DO statements can be
          // absorbed without aborting the outer transaction. Without the savepoint,
          // any error would put the transaction in an aborted state and prevent the
          // tracking INSERT from running.
          await tx.savepoint(async (sp) => {
            try {
              await sp.unsafe(trimmed);
            } catch (err) {
              // 23505 = unique_violation / 42710 = duplicate_object: tolerated for
              // cluster-level role creation when multiple test forks run concurrently.
              // Roles are in pg_authid (global) — a concurrent fork may have already
              // created them. Check the first real SQL token (not comment text) so
              // that a CREATE TABLE whose comment mentions CREATE ROLE is not silently
              // swallowed.
              const pgCode =
                err instanceof Error && "code" in err ? (err as { code: string }).code : undefined;
              const firstToken = trimmed
                .replace(/--[^\n]*/g, "")
                .trim()
                .toUpperCase()
                .slice(0, 20);
              const isRoleStatement =
                firstToken.startsWith("CREATE ROLE") || firstToken.startsWith("DO ");
              if ((pgCode === "23505" || pgCode === "42710") && isRoleStatement) {
                // Role already created by a concurrent fork — safely idempotent.
                // Savepoint is automatically rolled back on error; outer tx continues.
                return;
              }
              throw err;
            }
          });
        }

        // Insert tracking record in the same transaction — atomic with the DDL above.
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
