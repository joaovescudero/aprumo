#!/usr/bin/env node
/**
 * generate-migration-hashes.mjs
 *
 * Generates packages/core/migrations/migration-hashes.json with SHA-256 hashes
 * of all .sql migration files listed in _journal.json.
 *
 * Run this script whenever a NEW migration is added:
 *   node scripts/generate-migration-hashes.mjs
 *   git add packages/core/migrations/migration-hashes.json
 *   git commit -m "chore: update migration hashes for <new-migration>"
 *
 * WARNING: Do NOT run this to cover up edits to existing migrations.
 * The drift check is a hard gate; migration files are immutable once committed.
 * If you need to change a migration, create a new one instead.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const REPO_ROOT = resolve(__dirname, "..");
const JOURNAL_PATH = resolve(REPO_ROOT, "packages/core/migrations/meta/_journal.json");
const HASHES_PATH = resolve(REPO_ROOT, "packages/core/migrations/migration-hashes.json");
const MIGRATIONS_DIR = resolve(REPO_ROOT, "packages/core/migrations");

function sha256(filePath) {
  const content = readFileSync(filePath);
  return createHash("sha256").update(content).digest("hex");
}

function main() {
  if (!existsSync(JOURNAL_PATH)) {
    process.stderr.write(`Error: _journal.json not found at ${JOURNAL_PATH}\n`);
    process.exit(1);
  }

  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
  const entries = journal.entries ?? [];

  const hashes = {};
  let errorCount = 0;

  for (const entry of entries) {
    const tag = entry.tag;
    const filePath = resolve(MIGRATIONS_DIR, `${tag}.sql`);

    if (!existsSync(filePath)) {
      process.stderr.write(`Error: migration file not found: ${filePath}\n`);
      errorCount++;
      continue;
    }

    hashes[tag] = sha256(filePath);
    process.stdout.write(`Hashed: ${tag} → ${hashes[tag]}\n`);
  }

  if (errorCount > 0) {
    process.stderr.write(
      `\nFailed to hash ${errorCount} migration(s). Fix missing files before committing.\n`,
    );
    process.exit(1);
  }

  writeFileSync(HASHES_PATH, `${JSON.stringify(hashes, null, 2)}\n`, "utf8");
  process.stdout.write(`\nWrote ${Object.keys(hashes).length} hashes to ${HASHES_PATH}\n`);
  process.stdout.write(
    "Next: git add packages/core/migrations/migration-hashes.json && git commit\n",
  );
}

main();
