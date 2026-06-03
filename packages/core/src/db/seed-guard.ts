/**
 * WR-06 structural guard for dev seed SQL.
 *
 * Extracted from seed.ts so the pure, unit-testable validation logic lives in a
 * module that is imported by tests (and therefore covered), while seed.ts remains
 * a thin CLI entrypoint (like migrate.ts / reset.ts) that is exercised via the
 * `db:seed` script rather than unit tests.
 *
 * See: CLAUDE.md Invariant #1, FND-14 (dev seed script requirement).
 */

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
