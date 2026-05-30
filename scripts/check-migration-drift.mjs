#!/usr/bin/env node
/**
 * check-migration-drift.mjs
 *
 * FND-15 hard gate: verifies that no committed migration SQL file has been edited
 * since migration-hashes.json was last generated.
 *
 * Algorithm:
 *   1. Read packages/core/migrations/meta/_journal.json — parse entries array
 *   2. Read packages/core/migrations/migration-hashes.json — stored SHA-256 hashes
 *   3. For each entry in the journal:
 *      a. Compute SHA-256 of the .sql file
 *      b. Compare against stored hash
 *      c. Log DRIFT: error if hash differs or file is missing
 *   4. Exit 1 if any drift detected; exit 0 otherwise
 *
 * Usage:
 *   node scripts/check-migration-drift.mjs          # check for drift (CI gate)
 *
 * To regenerate the hash file after adding a new migration, run:
 *   node scripts/generate-migration-hashes.mjs
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
  // 1. Load journal
  if (!existsSync(JOURNAL_PATH)) {
    process.stderr.write(`DRIFT: _journal.json not found at ${JOURNAL_PATH}\n`);
    process.exit(1);
  }

  const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"));
  const entries = journal.entries ?? [];

  // 2. Load stored hashes
  if (!existsSync(HASHES_PATH)) {
    process.stderr.write(`DRIFT: migration-hashes.json not found at ${HASHES_PATH}\n`);
    process.stderr.write("Run: node scripts/generate-migration-hashes.mjs to generate it.\n");
    process.exit(1);
  }

  const storedHashes = JSON.parse(readFileSync(HASHES_PATH, "utf8"));

  // 3. Check each journal entry
  let driftDetected = false;
  const driftedFiles = [];

  for (const entry of entries) {
    const tag = entry.tag;
    const filePath = resolve(MIGRATIONS_DIR, `${tag}.sql`);

    if (!existsSync(filePath)) {
      process.stderr.write(`DRIFT: missing migration file: ${filePath}\n`);
      driftedFiles.push(tag);
      driftDetected = true;
      continue;
    }

    if (!(tag in storedHashes)) {
      process.stderr.write(
        `DRIFT: no stored hash for ${tag} — run generate-migration-hashes.mjs to update migration-hashes.json\n`,
      );
      driftedFiles.push(tag);
      driftDetected = true;
      continue;
    }

    const currentHash = sha256(filePath);
    const expectedHash = storedHashes[tag];

    if (currentHash !== expectedHash) {
      process.stderr.write(
        `DRIFT: ${tag}.sql has been modified since last hash commit\n` +
          `  expected: ${expectedHash}\n` +
          `  current:  ${currentHash}\n`,
      );
      driftedFiles.push(tag);
      driftDetected = true;
    }
  }

  // 4. Report result
  if (driftDetected) {
    process.stderr.write(
      `\nMigration integrity check FAILED. Drifted files: ${driftedFiles.join(", ")}\n`,
    );
    process.stderr.write(
      "Committed migration files must never be edited. If you intentionally updated hashes,\n" +
        "run: node scripts/generate-migration-hashes.mjs && git add packages/core/migrations/migration-hashes.json\n",
    );
    process.exit(1);
  }

  process.stdout.write(
    `Migration integrity check passed — no drift detected (${entries.length} migrations verified).\n`,
  );
  process.exit(0);
}

main();
