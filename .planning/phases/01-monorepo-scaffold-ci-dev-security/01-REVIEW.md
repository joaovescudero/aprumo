---
phase: 01-monorepo-scaffold-ci-dev-security
reviewed: 2026-05-22T00:00:00Z
depth: standard
files_reviewed: 48
files_reviewed_list:
  - vitest.config.ts
  - tests/scaffold/infra.test.ts
  - tests/scaffold/coverage-gate-fires.test.ts
  - tests/ci/secret-scan.test.ts
  - tests/ci/gitignore.test.ts
  - tests/ci/changeset-gate.test.ts
  - tests/tsconfig.json
  - package.json
  - tsconfig.base.json
  - tsconfig.json
  - biome.json
  - .gitignore
  - .npmrc
  - .nvmrc
  - renovate.json
  - pnpm-workspace.yaml
  - packages/core/package.json
  - packages/core/tsconfig.json
  - packages/core/tsconfig.build.json
  - packages/core/biome.json
  - packages/core/vitest.config.ts
  - packages/core/src/index.ts
  - packages/connector-base/package.json
  - packages/connector-base/tsconfig.json
  - packages/connector-base/tsconfig.build.json
  - packages/connector-base/biome.json
  - packages/connector-base/vitest.config.ts
  - packages/connector-base/src/index.ts
  - packages/connector-starkbank/package.json
  - packages/connector-starkbank/tsconfig.json
  - packages/connector-starkbank/tsconfig.build.json
  - packages/connector-starkbank/biome.json
  - packages/connector-starkbank/vitest.config.ts
  - packages/connector-starkbank/src/index.ts
  - packages/webhooks/package.json
  - packages/webhooks/tsconfig.json
  - packages/webhooks/tsconfig.build.json
  - packages/webhooks/biome.json
  - packages/webhooks/vitest.config.ts
  - packages/webhooks/src/index.ts
  - lefthook.yml
  - .gitleaks.toml
  - commitlint.config.ts
  - .changeset/config.json
  - scripts/changeset-required.sh
  - .github/actions/setup/action.yml
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
findings:
  critical: 3
  warning: 4
  info: 2
  total: 9
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-05-22T00:00:00Z
**Depth:** standard
**Files Reviewed:** 48
**Status:** issues_found

## Summary

Phase 1 delivers the monorepo scaffold, CI pipeline, and dev-security tooling (INF-01..10). The
overall shape is sound: TypeScript strict config is correctly wired, Biome v2 and Vitest 4 are
properly configured, the `pnpm-workspace.yaml` / `publishConfig` / `changeset` chain is correct,
and lefthook gates (biome, commitlint, gitleaks protect) look complete.

Three blockers stand out. The most immediately breaking: the `starkbank-private-key` gitleaks
rule has no allowlist for test files, so `tests/ci/secret-scan.test.ts` — which deliberately
embeds the PEM header string to verify detection — will fire on every CI gitleaks history scan.
The second: all GitHub Actions are pinned to mutable version tags (`@v4`, `@v1`, etc.) rather
than immutable commit SHAs, violating the SHA-pinning requirement noted in D-23. Third: the
gitleaks binary is downloaded via a curl-pipe-tar in CI without any checksum verification,
creating a supply-chain integrity gap.

Four warnings follow, covering default over-broad GITHUB_TOKEN permissions in CI, a missing
`try/catch` in a test cleanup path, a weaker-than-intended `.env.*` gitignore pattern, and an
imprecise Biome `files.includes` exclusion.

---

## Critical Issues

### CR-01: `starkbank-private-key` gitleaks rule fires on `tests/ci/secret-scan.test.ts` — CI self-breaks

**File:** `tests/ci/secret-scan.test.ts:21`

**Issue:** The `starkbank-private-key` rule in `.gitleaks.toml` matches the regex
`-----BEGIN EC PRIVATE KEY-----` with no per-rule or global allowlist for test files. The test
file `tests/ci/secret-scan.test.ts` assigns that exact string to `EC_PEM_HEADER` (line 21) and
embeds it in a template literal (line 73), both of which match the regex. The global `[allowlist]`
only covers `\.gitleaks\.toml` and `docs/adr/`. When the `gitleaks-history` CI job runs
`./gitleaks detect --config .gitleaks.toml --redact --no-banner` against the full git history,
it will find these matches and exit non-zero, breaking every CI run on every commit that includes
this test file.

The `generic-env-secret` rule does have a per-rule allowlist for `\.test\.ts$`, but the
`starkbank-private-key` rule does not. The omission is inconsistent and causes a hard CI failure.

**Fix:** Add a per-rule allowlist to `starkbank-private-key` that mirrors the pattern used in
`generic-env-secret`:

```toml
[[rules]]
id = "starkbank-private-key"
description = "Starkbank ECDSA private key (PEM)"
regex = '''-----BEGIN EC PRIVATE KEY-----'''
tags = ["starkbank", "key", "EC"]

  [[rules.allowlists]]
  description = "Allow in test fixtures, example files, and test files"
  paths = ['''__fixtures__/''', '''\.example$''', '''\.test\.ts$''']
```

---

### CR-02: All GitHub Actions pinned to mutable version tags — no SHA pinning (D-23)

**File:** `.github/workflows/ci.yml:19`, `.github/workflows/release.yml:24`, `.github/actions/setup/action.yml:18`

**Issue:** Every action reference in the repository uses a mutable version tag:

- `actions/checkout@v4` (7 occurrences across ci.yml, release.yml, action.yml)
- `actions/setup-node@v4` (release.yml:33, action.yml:24)
- `actions/upload-artifact@v4` (ci.yml:79)
- `davelosert/vitest-coverage-report-action@v2` (ci.yml:73)
- `changesets/action@v1` (release.yml:43)
- `pnpm/action-setup@v6` (action.yml:18)

A mutable tag can be force-pushed to point to arbitrary new commits. If any of these action
repositories is compromised, an attacker can inject malicious code that runs with the workflow's
`GITHUB_TOKEN` permissions — which in `release.yml` includes `packages:write`, `contents:write`,
and `pull-requests:write`. This is a supply-chain attack vector that bypasses all other security
controls in this phase.

**Fix:** Pin every action to an immutable full-length commit SHA. Use the version tag as a
comment for human readability. Example for `actions/checkout`:

```yaml
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
```

Obtain the current SHA for each action from its GitHub releases page or via:
```bash
gh api repos/actions/checkout/git/ref/tags/v4 --jq '.object.sha'
```

The full list of actions to pin: `actions/checkout`, `actions/setup-node`,
`actions/upload-artifact`, `pnpm/action-setup`, `davelosert/vitest-coverage-report-action`,
`changesets/action`.

---

### CR-03: Gitleaks binary downloaded via unverified `curl | tar` in CI — no checksum

**File:** `.github/workflows/ci.yml:114`

**Issue:** The `gitleaks-history` CI job downloads the gitleaks binary with:

```bash
curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz | tar -xz gitleaks
```

There is no SHA-256 checksum verification, no sigstore/cosign attestation check, and no
comparison against a pinned hash. A compromised GitHub release asset or a MITM attack on
the CDN could serve a malicious binary that runs with full access to the checked-out repository
(which contains the full git history, including any secrets that gitleaks is supposed to detect).

This is particularly ironic: the tool meant to prevent secret leakage is itself fetched without
integrity verification.

**Fix:** Verify the downloaded binary's checksum against the release's published
`checksums.txt` before extracting:

```bash
GITLEAKS_VERSION=8.30.1
curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" -o gitleaks.tar.gz
curl -sSfL "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/checksums.txt" -o checksums.txt
grep "gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" checksums.txt | sha256sum --check --strict
tar -xzf gitleaks.tar.gz gitleaks
rm gitleaks.tar.gz checksums.txt
```

Alternatively, use the official `gitleaks/gitleaks-action` (SHA-pinned) instead of a manual
download. Note: switching to the action also eliminates the download step entirely.

---

## Warnings

### WR-01: `ci.yml` has no workflow-level `permissions:` block — over-broad GITHUB_TOKEN defaults

**File:** `.github/workflows/ci.yml:1`

**Issue:** `ci.yml` defines no top-level `permissions:` block. Only the `coverage-gate` job has
explicit permissions (`contents: read`, `pull-requests: write`). The remaining six jobs (`lint`,
`typecheck`, `build`, `test`, `changeset-check`, `gitleaks-history`) inherit the workflow
default, which is determined by the repository's "Default permissions for GITHUB_TOKEN" setting.
On private repositories this defaults to read/write for most scopes. Even on public repositories,
not declaring a minimal `permissions:` block is a deviation from least-privilege and makes the
effective permissions invisible to reviewers.

The `gitleaks-history` job in particular sets `GITHUB_TOKEN` in its `env:` block but only needs
`contents: read` to scan the checked-out history.

**Fix:** Add a workflow-level `permissions:` block that denies all scopes by default, then
grant only what each job needs:

```yaml
# After the concurrency block
permissions: {}  # deny-by-default; per-job overrides below
```

Then add per-job overrides. The `lint`, `typecheck`, `build`, `test`, `changeset-check`, and
`gitleaks-history` jobs all need only `contents: read`. The `coverage-gate` job already has its
explicit block. This ensures even if a job is compromised, the blast radius is minimized.

---

### WR-02: `afterAll` in `coverage-gate-fires.test.ts` — `unlinkSync` without try/catch causes cleanup failure

**File:** `tests/scaffold/coverage-gate-fires.test.ts:42`

**Issue:** The `afterAll` cleanup block calls `fs.unlinkSync(UNCOVERED_FILE)` directly (line 42)
without error handling. The `rmdirSync` call on the following line is wrapped in `try/catch` (line
45), but `unlinkSync` is not. If the file does not exist — which can happen when `beforeAll`
partially fails (e.g., `mkdirSync` succeeds but `writeFileSync` throws), or when the test is
interrupted — `unlinkSync` throws `ENOENT` and the `afterAll` hook itself fails. This leaves
`FIXTURES_DIR` on disk and causes vitest to report a spurious afterAll error, which can mask the
real test result.

**Fix:** Wrap the `unlinkSync` call in the same `try/catch` or use `existsSync` guard:

```typescript
afterAll(() => {
  // Remove fixture file if it was created
  try {
    if (fs.existsSync(UNCOVERED_FILE)) {
      fs.unlinkSync(UNCOVERED_FILE);
    }
    fs.rmdirSync(FIXTURES_DIR);
  } catch {
    // Directory not empty, doesn't exist, or partial cleanup — ignore
  }
});
```

---

### WR-03: `.gitignore` uses `.env.*` (dot-separator required) instead of `.env*` — misses `.envRC`, `.envlocal`

**File:** `.gitignore:12`

**Issue:** The `.gitignore` file contains `.env.*` (line 12) as the pattern for environment files.
This pattern requires a literal dot between `.env` and the extension, so it matches `.env.local`,
`.env.production`, `.env.test` — but it does NOT match `.envRC`, `.envlocal`, `.env_local`, or
any other common non-dotted environment file name variants used by tools like `direnv`, `dotenv`,
or `nvm`. The `tests/ci/gitignore.test.ts` test (line 37) accepts this because it only checks
`p.startsWith(".env")`, giving a false green.

The project CLAUDE.md invariant "never store secrets" depends on .gitignore being comprehensive.

**Fix:** Replace `.env.*` with the broader `.env*` pattern, and keep the exception:

```gitignore
# Environment files
.env*
!.env.example
```

The `!.env.example` negation still works correctly with `.env*`. This covers `.envRC`,
`.env_local`, `.envlocal`, `.env.local`, `.env.production`, and all other variants.

---

### WR-04: `biome.json` `files.includes` uses `"!coverage"` — does not exclude files inside `coverage/`

**File:** `biome.json:31`

**Issue:** The `files.includes` array contains `"!coverage"` (not `"!coverage/**"`). In Biome's
glob matching, `"!coverage"` negates a file or directory entry named `coverage` at the root level,
but it does not recursively exclude contents of the `coverage/` directory. Files such as
`coverage/lcov.info`, `coverage/coverage-summary.json`, and HTML report files will still be
matched by the leading `"**"` pattern and submitted to Biome for linting. When `pnpm vitest run
--coverage` runs before `pnpm lint` (e.g., in local dev or if CI job ordering changes), Biome
will attempt to lint generated coverage artifacts and may produce spurious errors or slow down
linting significantly.

**Fix:** Use a glob that explicitly excludes directory contents:

```json
"files": {
  "includes": ["**", "!**/dist", "!**/node_modules", "!**/*.d.ts", "!coverage/**"]
}
```

---

## Info

### IN-01: `infra.test.ts` uses `describe("INF-01:")` label for two unrelated describe blocks

**File:** `tests/scaffold/infra.test.ts:21` and `tests/scaffold/infra.test.ts:91`

**Issue:** Two distinct `describe` blocks carry the same label `"INF-01:"`:
- Line 21: `describe("INF-01: pnpm workspace", ...)` covers pnpm workspace setup
- Line 91: `describe("INF-01: Node version pinning", ...)` covers `.nvmrc` and `.npmrc`

The second block (line 91) should be labeled `INF-01b` or renamed to reflect its distinct concern
(Node version pinning is conceptually separate from workspace configuration). The duplicate label
causes confusing test output in CI logs and makes it harder to trace failing requirements back to
specific INF IDs.

**Fix:**
```typescript
// Line 91 — rename to distinguish from the workspace block above
describe("INF-01 (Node pinning): .nvmrc and .npmrc", () => {
```

---

### IN-02: `release.yml` calls `actions/setup-node@v4` twice — redundant double setup

**File:** `.github/workflows/release.yml:29-37`

**Issue:** The release job first calls `./.github/actions/setup` (line 29), which internally
calls `actions/setup-node@v4` with `cache: pnpm` to install Node and warm the pnpm store cache.
Then release.yml immediately calls `actions/setup-node@v4` again (line 33) with
`registry-url: 'https://npm.pkg.github.com'` and `scope: '@aprumo'` to configure npm registry
auth. The second call succeeds (the `NODE_AUTH_TOKEN` injection into `~/.npmrc` is the correct
mechanism for GitHub Packages auth), but it re-runs Node setup unnecessarily and — crucially —
does not include `cache: pnpm`, meaning the second `setup-node` call partially overwrites the
cache configuration from the composite action.

This is functionally correct today (the build still works because `pnpm install` already ran in
the composite action), but it is fragile: if the order or content of the composite action changes,
the double-setup interaction could silently break caching behavior.

**Fix:** Move the GitHub Packages auth configuration into the composite action as an optional
step, or restructure the release workflow to make the auth purpose explicit and document that
the second `setup-node` is solely for writing `NODE_AUTH_TOKEN` to `~/.npmrc`:

```yaml
# release.yml — document clearly that this second setup-node is ONLY for npm auth
- name: Configure GitHub Packages auth (writes NODE_AUTH_TOKEN to ~/.npmrc)
  uses: actions/setup-node@<SHA>  # v4.x.x
  with:
    # node-version intentionally omitted — already set by ./.github/actions/setup
    registry-url: 'https://npm.pkg.github.com'
    scope: '@aprumo'
```

---

_Reviewed: 2026-05-22T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
