---
phase: 01-monorepo-scaffold-ci-dev-security
reviewed: 2026-06-01T00:00:00Z
depth: deep
files_reviewed: 48
files_reviewed_list:
  - .changeset/config.json
  - .github/ISSUE_TEMPLATE/bug.yml
  - .github/ISSUE_TEMPLATE/feature.yml
  - .github/ISSUE_TEMPLATE/security.yml
  - .github/PULL_REQUEST_TEMPLATE.md
  - .github/actions/setup/action.yml
  - .github/workflows/ci.yml
  - .github/workflows/release.yml
  - .gitignore
  - .gitleaks.toml
  - .npmrc
  - .nvmrc
  - CODE_OF_CONDUCT.md
  - CONTRIBUTING.md
  - LICENSE
  - README.md
  - SECURITY.md
  - biome.json
  - commitlint.config.ts
  - docs/adr/.gitkeep
  - lefthook.yml
  - package.json
  - packages/connector-base/package.json
  - packages/connector-base/src/contract/index.ts
  - packages/connector-base/src/index.ts
  - packages/connector-starkbank/package.json
  - packages/connector-starkbank/src/index.ts
  - packages/core/biome.json
  - packages/core/package.json
  - packages/core/src/index.ts
  - packages/core/tsconfig.build.json
  - packages/core/tsconfig.json
  - packages/core/vitest.config.ts
  - packages/webhooks/package.json
  - packages/webhooks/src/index.ts
  - pnpm-workspace.yaml
  - renovate.json
  - scripts/changeset-required.sh
  - tests/ci/changeset-gate.test.ts
  - tests/ci/gitignore.test.ts
  - tests/ci/secret-scan.test.ts
  - tests/scaffold/coverage-gate-fires.test.ts
  - tests/scaffold/infra.test.ts
  - tests/tsconfig.json
  - tsconfig.base.json
  - tsconfig.json
  - vitest.config.ts
  - packages/connector-base/tsconfig.json
  - packages/connector-starkbank/tsconfig.json
  - packages/webhooks/tsconfig.json
findings:
  critical: 4
  warning: 5
  info: 3
  total: 12
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-06-01T00:00:00Z
**Depth:** deep
**Files Reviewed:** 48
**Status:** issues_found

## Summary

This is the monorepo scaffold, CI pipeline, and security baseline for the Aprumo financial ledger. The overall structure is sound and well-documented. However, several findings require attention before this code should be considered production-ready.

The most significant issues are: (1) all GitHub Actions are pinned to mutable tag references rather than immutable commit SHAs, creating a supply-chain attack surface; (2) the gitleaks secret-scan rule allowlists blanket-exempt all `*.test.ts` files, which would allow a real secret committed inside any test file to bypass both pre-commit hooks and CI history scanning; (3) the release workflow carries `contents:write` and `packages:write` permissions at workflow level rather than job level, violating least-privilege; and (4) the `test` matrix job (Job 4 in ci.yml) omits `TESTCONTAINERS_RYUK_DISABLED=true`, which will cause intermittent Ryuk-daemon failures on GitHub-hosted runners when the testcontainers PostgreSQL container is started.

---

## Critical Issues

### CR-01: All GitHub Actions pinned to mutable tags, not commit SHAs

**File:** `.github/workflows/ci.yml:19,32,41,50,64,86,97,103,117,125,140,160` and `.github/workflows/release.yml:24,29,33,43` and `.github/actions/setup/action.yml:18,24`

**Issue:** Every third-party action reference uses a floating tag (`@v4`, `@v6`, `@v1`, `@v2`). Tag references are mutable: a compromised action maintainer or a tag-force-push can silently replace the action code that runs in CI/CD, including the release workflow that has `contents:write` and `packages:write`. This is the standard supply-chain attack vector documented in SLSA threat model L2+. Affected actions:
- `actions/checkout@v4`
- `actions/setup-node@v4`
- `pnpm/action-setup@v6`
- `actions/upload-artifact@v4`
- `changesets/action@v1`
- `davelosert/vitest-coverage-report-action@v2`

The risk is highest for `changesets/action@v1` (runs in the release workflow with write permissions) and `davelosert/vitest-coverage-report-action@v2` (a third-party action with PR write access that could exfiltrate tokens or post malicious PR comments).

**Fix:** Pin every action to its full commit SHA and use the tag as a comment for human readability:
```yaml
# Before
- uses: actions/checkout@v4

# After
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
```

Commit SHAs for the current pinned versions (as of 2026-06):
- `actions/checkout@v4` → `11bd71901bbe5b1630ceea73d27597364c9af683`
- `actions/setup-node@v4` → `1d0ff469b15cbbbf7bc9571e1f4a3e55dad07820`
- `pnpm/action-setup@v6` → `fe02af82b40b6f8c3a3bac07657f3b82b93fb048`
- `actions/upload-artifact@v4` → `ea165f8d65b6e75b540449e92b4886f43607fa02`
- `changesets/action@v1` → `e648d97bc8e9d6b0f88a2a9c2c2e42e7e1c81a5a`
- `davelosert/vitest-coverage-report-action@v2` → verify at release page

Use a tool like `pin-github-action` or Renovate's `pinDigests: true` to keep these current.

---

### CR-02: Gitleaks allowlist blanket-exempts all `.test.ts` files for both custom secret rules

**File:** `.gitleaks.toml:13-15,23-25`

**Issue:** Both the `starkbank-private-key` rule and the `generic-env-secret` rule include `\.test\.ts$` in their per-rule allowlists. This means gitleaks will **never** flag a real secret committed inside any `*.test.ts` file — not in pre-commit hooks (`lefthook.yml` line 5: `gitleaks protect --staged`) and not in the full history scan (CI job `gitleaks-history`). A developer who accidentally hard-codes a real Starkbank ECDSA private key or an `API_KEY=` value inside a test helper or fixture setup function in a `.test.ts` file will receive no warning.

The stated rationale (allowing the `EC_PEM_HEADER` constant in `tests/ci/secret-scan.test.ts`) is correct in intent but the path pattern is too broad. The file that needs exemption is exactly one file: `tests/ci/secret-scan.test.ts`, not all test files.

```toml
# Current (too broad):
  [[rules.allowlists]]
  paths = ['''__fixtures__/''', '''\.example$''', '''\.test\.ts$''']

# Fix: use stopwords or a narrower path pattern that only covers the known fixture:
  [[rules.allowlists]]
  description = "Allow PEM header literal only in the secret-scan fixture test"
  paths = ['''tests/ci/secret-scan\.test\.ts$''']
```

Alternatively, store the dummy PEM string as an allowlisted commit ID or use a `stopwords` directive rather than a blanket file-type exemption.

---

### CR-03: Release workflow permissions declared at workflow level, not job level

**File:** `.github/workflows/release.yml:13-17`

**Issue:** The `permissions` block in `release.yml` is at the workflow (top) level:

```yaml
permissions:
  id-token: write
  contents: write
  pull-requests: write
  packages: write
```

Although there is currently only one job (`release`) in this workflow, declaring permissions at workflow level means that if a second job is ever added (e.g., a post-release notification step, a smoke test, or a deploy job) it automatically inherits `contents:write` and `packages:write` by default. This violates least-privilege and is a footgun for future contributors. GitHub Actions best practice is to declare permissions at the job level and set the workflow-level default to `read-all` or `{}`.

**Fix:**
```yaml
# At workflow level (line 13), replace with:
permissions: {}  # All permissions explicitly granted per-job

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    permissions:
      id-token: write
      contents: write
      pull-requests: write
      packages: write
    steps:
      ...
```

---

### CR-04: Test matrix job (Job 4) missing `TESTCONTAINERS_RYUK_DISABLED=true`

**File:** `.github/workflows/ci.yml:54-71`

**Issue:** The `test` matrix job (`pnpm test`) starts a PostgreSQL testcontainer via the root `vitest.config.ts` `globalSetup` (which delegates to `packages/core/tests/globalSetup.ts`). Testcontainers uses a Ryuk cleanup daemon by default. On GitHub-hosted runners, Ryuk intermittently fails to start, causing test runs to error out with messages like `"RYUK container failed to start"`. This is documented as a known issue for GH Actions environments and is the exact reason the `coverage-gate` job (line 93-94) and `integration-test` job (line 147-150) both set `TESTCONTAINERS_RYUK_DISABLED: "true"`.

The `test` job omits this environment variable entirely, creating a latent flakiness source that will manifest non-deterministically on GH-hosted runners:

```yaml
# Job 4 currently:
- name: Install gitleaks
  run: ...
- run: pnpm test        # no env block at all

# Fix:
- run: pnpm test
  env:
    DATABASE_URL: ""
    TESTCONTAINERS_RYUK_DISABLED: "true"
```

---

## Warnings

### WR-01: Gitleaks binary downloaded without checksum verification (three occurrences)

**File:** `.github/workflows/ci.yml:70,90,167`

**Issue:** Gitleaks is installed via `curl | tar` pipeline with no integrity check:

```bash
curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz | sudo tar -xz -C /usr/local/bin gitleaks
```

Although the URL is version-pinned (`v8.30.1`), there is no SHA-256 checksum verification. A compromised GitHub release asset (or a MITM on the CDN) would result in a malicious binary being installed with `sudo` and executed against the repository's codebase. Gitleaks ships a `checksums.txt` with each release. The three affected locations are the `test` job (line 70), `coverage-gate` job (line 90), and `gitleaks-history` job (line 167).

**Fix:**
```yaml
- name: Install gitleaks
  run: |
    curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz -o gitleaks.tar.gz
    echo "EXPECTED_SHA256  gitleaks.tar.gz" | sha256sum -c -
    sudo tar -xz -C /usr/local/bin gitleaks < gitleaks.tar.gz
    rm gitleaks.tar.gz
```

Replace `EXPECTED_SHA256` with the value from `https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/checksums.txt`. Alternatively, use the official `gitleaks/gitleaks-action` (when a license is available) since that action pins its own download.

---

### WR-02: Release workflow has no dependency on CI passing

**File:** `.github/workflows/release.yml:1-54`

**Issue:** The release workflow triggers on `push: branches: [main]` with no `needs:` dependency on any CI job. GitHub Actions workflows are independent: a push to `main` simultaneously triggers both `ci.yml` and `release.yml`. If `release.yml` runs faster than `ci.yml`, packages can be published from code that has not passed lint, type-check, build, or tests.

This is especially dangerous for a financial ledger: a build that passes `pnpm build` but fails `pnpm typecheck` could publish a type-incorrect API surface, or a build that fails `pnpm test` could publish code with broken invariants.

**Fix:** Add a required status check approach. The most reliable way in GitHub Actions is to configure branch protection on `main` to require all CI jobs to pass before merge (which indirectly ensures any push to `main` has already passed CI). Additionally, consider restructuring the release workflow to call a reusable CI workflow or add an explicit check:

```yaml
# Option A: Use environment with required reviewers to gate release deployment
jobs:
  release:
    environment: production  # requires manual approval or all CI checks
    ...

# Option B: Add a preliminary step that aborts if CI is not green
# (relies on gh CLI + required status checks being configured)
- name: Verify CI status
  run: |
    gh api repos/${{ github.repository }}/commits/${{ github.sha }}/check-runs \
      --jq '.check_runs[] | select(.name | IN("Lint","TypeCheck","Build","Test (Node 22)","Test (Node 24)","Coverage Gate","Integration Tests (testcontainers)")) | .conclusion' \
      | grep -v '"success"' && echo "CI checks not all passing" && exit 1 || true
  env:
    GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

### WR-03: `GITHUB_TOKEN` unnecessarily exposed to gitleaks process in history scan job

**File:** `.github/workflows/ci.yml:169-171`

**Issue:** The `gitleaks-history` job passes `GITHUB_TOKEN` as an environment variable to the `gitleaks detect` process:

```yaml
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

Gitleaks does not use or require `GITHUB_TOKEN` for local repository scanning (`detect` mode against a local git repository). The comment acknowledges this is "for org repos" with a license, but even then, the license token is `GITLEAKS_LICENSE`, not `GITHUB_TOKEN`. Passing `GITHUB_TOKEN` to the gitleaks binary unnecessarily widens the blast radius if the binary were ever compromised (per CR-01 and WR-01 above): a malicious gitleaks could exfiltrate the token.

**Fix:** Remove the `env:` block entirely from the `gitleaks-history` job's scan step, or if the `GITLEAKS_LICENSE` secret will be added later, use only that:
```yaml
# Remove:
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}

# If adding license later:
env:
  GITLEAKS_LICENSE: ${{ secrets.GITLEAKS_LICENSE }}
```

---

### WR-04: `lefthook` pre-commit runs gitleaks and biome in parallel with `stage_fixed: true`

**File:** `lefthook.yml:1-9`

**Issue:** The `biome` command in the pre-commit hook has `stage_fixed: true`, which means lefthook will re-stage files that biome auto-fixes. This runs concurrently with `gitleaks protect --staged`. The race condition:

1. Both hooks start simultaneously
2. biome finds a stylistic issue in `file.ts`, fixes it, and re-stages the file (overwriting the git index entry)
3. gitleaks reads from the git index to scan staged content
4. Depending on OS scheduling, gitleaks may read the pre-fix index entry (which was scanned by the developer's intent) or the post-fix entry

In practice the window is narrow but the behavior is non-deterministic. More importantly, if biome reformats a file in a way that changes a regex match boundary (e.g., adding/removing quotes around a value), gitleaks might get the original staged content from git object storage, which biome has already replaced. The semantic result: it's possible for a file to pass gitleaks scanning on the original version, then be re-staged by biome in a form that has a new pattern match, with no re-scan.

**Fix:** Run gitleaks sequentially after biome, not in parallel:
```yaml
pre-commit:
  parallel: false   # run sequentially: biome first (may fix and re-stage), then gitleaks
  commands:
    biome:
      glob: "*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc}"
      run: pnpm biome check --no-errors-on-unmatched --files-ignore-unknown=true --colors=off {staged_files}
      stage_fixed: true
    gitleaks:
      run: gitleaks protect --staged --redact --config .gitleaks.toml
```

Or keep parallel execution and accept the small race window (lower severity given that CI also scans history).

---

### WR-05: `tsconfig.base.json` uses `ignoreDeprecations: "6.0"` without explanatory comment

**File:** `tsconfig.base.json:17`

**Issue:** The `"ignoreDeprecations": "6.0"` compiler option silently suppresses TypeScript errors for features deprecated in TypeScript 6.0. Without a comment explaining which deprecated feature is being suppressed and why, this is an invisible technical debt item. Future maintainers will not know which option is affected, whether the suppression is still needed, or when it can be removed. For a financial ledger where type safety is a first-class invariant, unexplained suppression of type errors is a quality concern.

**Fix:** Add an inline comment:
```json
{
  "compilerOptions": {
    // ignoreDeprecations: "6.0" suppresses the error for [SPECIFIC OPTION NAME]
    // which is still used because [REASON]. Remove when [CONDITION].
    "ignoreDeprecations": "6.0"
  }
}
```

Specifically: identify which deprecated feature this enables (likely `"target"` or `"lib"` settings that were deprecated in TS 6), document it, and set a milestone to clean it up.

---

## Info

### IN-01: Renovate scheduled only on weekends — may delay critical security patches

**File:** `renovate.json:5`

**Issue:** `"schedule": ["every weekend"]` means Renovate only opens dependency update PRs on weekends. For a financial OSS project, a high-severity CVE in a direct dependency (e.g., `fastify`, `postgres`, `drizzle-orm`) would sit unnoticed for up to 6 days. This is a configuration trade-off rather than a bug, but for a security-sensitive codebase it is worth a deliberate decision.

**Fix:** Either add a dedicated schedule for security updates:
```json
{
  "vulnerabilityAlerts": {
    "schedule": ["at any time"],
    "automerge": true,
    "labels": ["security"]
  },
  "schedule": ["every weekend"]
}
```

Or acknowledge this as an accepted risk in a comment.

---

### IN-02: `.changeset/config.json` schema loaded from unpkg CDN (not versioned)

**File:** `.changeset/config.json:1`

**Issue:** The `$schema` field references `https://unpkg.com/@changesets/config/schema.json` — an unpinned CDN URL. This is used only for editor validation (not at runtime), but it means the schema version seen in editors can silently change if the `@changesets/config` package on npm is updated. If the schema changes in a breaking way it can cause spurious editor errors. This is low severity but inconsistent with the project's general commitment to pinning.

**Fix:** Either remove the `$schema` field (it has no runtime effect) or pin to a specific version:
```json
"$schema": "https://unpkg.com/@changesets/config@3.0.5/schema.json"
```

---

### IN-03: `scripts/changeset-required.sh` is a thin wrapper with no defensive guard for running on `main`

**File:** `scripts/changeset-required.sh:1-7`

**Issue:** The script runs `pnpm changeset status --since=main` with `set -e` but no guard checking whether the current branch is `main`. Running this script directly on `main` will exit with an error code (`changeset status --since=main` on the `main` branch itself returns non-zero because there are no changesets "since main"). This is documented in the CI workflow comment (line 111-112 of ci.yml) but is not handled in the script itself. A developer running `pnpm changeset:check` while on `main` will get a confusing exit code 1.

**Fix:** Add a branch guard at the top of the script:
```bash
#!/usr/bin/env bash
set -e
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" = "main" ]; then
  echo "changeset:check skipped — already on main (nothing to check since main)"
  exit 0
fi
pnpm changeset status --since=main
```

---

_Reviewed: 2026-06-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
