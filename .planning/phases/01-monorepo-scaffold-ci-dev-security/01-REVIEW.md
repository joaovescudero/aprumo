---
phase: 01-monorepo-scaffold-ci-dev-security
reviewed: 2026-06-02T00:00:00Z
depth: deep
files_reviewed: 45
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
findings:
  critical: 4
  warning: 7
  info: 5
  total: 16
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-06-02T00:00:00Z
**Depth:** deep
**Files Reviewed:** 45
**Status:** issues_found

## Summary

This review covers the monorepo scaffold, CI/CD pipeline, secret scanning configuration, coverage gating, and developer tooling for Phase 1. The overall design is well-structured and clearly documented. Four blockers and seven warnings require attention before this code should be considered production-safe for a financial OSS project.

The highest-severity issues are: (1) GitHub Actions pinned to mutable tags rather than commit SHAs, creating a supply-chain attack surface against a workflow that carries `contents:write` and `packages:write`; (2) the gitleaks secret-scan rules blanket-exempt all `.test.ts` files, allowing a real private key or API credential committed inside any test file to bypass both pre-commit hooks and CI history scanning; (3) the release workflow declares elevated permissions at the workflow level (not job level), violating least-privilege; and (4) the `test` matrix job (CI Job 4) omits `TESTCONTAINERS_RYUK_DISABLED: "true"`, causing latent intermittent failures on GitHub-hosted runners when the PG testcontainer is started.

Additional warnings cover: gitleaks binary download without checksum verification; the release workflow having no dependency on CI passing; unnecessary `GITHUB_TOKEN` exposure to the gitleaks process; a parallel pre-commit hook race between biome's `stage_fixed` and gitleaks staging-read; and an unexplained `ignoreDeprecations: "6.0"` suppressor in `tsconfig.base.json`.

---

## Critical Issues

### CR-01: All GitHub Actions Pinned to Mutable Tags, Not Commit SHAs — Supply Chain Risk

**File:** `.github/workflows/ci.yml:19,32,41,50,64,86,97,103,117,125,140,160` and `.github/workflows/release.yml:24,29,33,43` and `.github/actions/setup/action.yml:18,24`

**Issue:** Every third-party GitHub Action is pinned to a floating tag (`@v4`, `@v6`, `@v1`, `@v2`) rather than an immutable commit SHA. Tags are mutable: a maintainer can push a new commit to the same tag, and the next CI run silently executes the new code. The release workflow grants `contents:write`, `packages:write`, and `id-token:write` — a compromised `changesets/action@v1` or `actions/setup-node@v4` could exfiltrate `GITHUB_TOKEN` or publish a malicious package version to GitHub Packages under the `@aprumo` scope. The `davelosert/vitest-coverage-report-action@v2` has `pull-requests:write` access and is a less well-known action with a smaller security audit surface.

Affected actions: `actions/checkout@v4`, `actions/setup-node@v4`, `pnpm/action-setup@v6`, `actions/upload-artifact@v4`, `changesets/action@v1`, `davelosert/vitest-coverage-report-action@v2`.

**Fix:** Pin every `uses:` to a full commit SHA with the version as a comment:

```yaml
# Before
- uses: actions/checkout@v4

# After
- uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683  # v4.2.2
```

Use `pinact`, Renovate's `pinDigests: true`, or `step-security/harden-runner` to automate SHA pinning and future updates.

---

### CR-02: Gitleaks Rules Blanket-Exempt All `.test.ts` Files — Real Secrets in Test Files Bypass Scanning

**File:** `.gitleaks.toml:13-15` and `.gitleaks.toml:22-24`

**Issue:** Both custom rules (`starkbank-private-key` and `generic-env-secret`) include `\.test\.ts$` in their per-rule allowlists. This means any file ending in `.test.ts` — including files co-located alongside production code — is completely exempt from these two rules in pre-commit scanning (`lefthook.yml` line 5) and in the full git-history scan (`gitleaks-history` job). A developer who accidentally hard-codes a real Starkbank ECDSA private key or a real `SECRET=` assignment in a test helper, test setup file, or integration test will receive no warning from gitleaks.

The rationale for this allowlist is to permit the dummy `EC_PEM_HEADER` constant used as a test fixture in `tests/ci/secret-scan.test.ts`. That file is one specific file — the allowlist exempts every test file in the repository.

**Fix:** Replace the broad pattern with an explicit path for the one known file that needs exemption:

```toml
# Before (too broad):
  [[rules.allowlists]]
  paths = ['''__fixtures__/''', '''\.example$''', '''\.test\.ts$''']

# After (narrow):
  [[rules.allowlists]]
  description = "Allow dummy PEM header only in the secret-scan fixture test"
  paths = ['''__fixtures__/''', '''\.example$''', '''tests/ci/secret-scan\.test\.ts$''']
```

Apply the same fix to both the `starkbank-private-key` and `generic-env-secret` rules.

---

### CR-03: Release Workflow Declares Elevated Permissions at Workflow Level, Not Job Level

**File:** `.github/workflows/release.yml:13-17`

**Issue:** The `permissions` block in `release.yml` is declared at the workflow (top) level:

```yaml
permissions:
  id-token: write
  contents: write
  pull-requests: write
  packages: write
```

Although there is currently only one job (`release`), declaring permissions at workflow level means any future job added to this workflow (e.g., a smoke test, a deployment notification, or a post-release check) automatically inherits `contents:write` and `packages:write`. This is a footgun that violates least-privilege and is a standard GitHub Actions hardening requirement.

**Fix:** Set permissions to nothing at the workflow level and grant them explicitly per job:

```yaml
permissions: {}  # default: no permissions for any job unless explicitly granted

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

### CR-04: `test` Matrix Job (CI Job 4) Missing `TESTCONTAINERS_RYUK_DISABLED: "true"` — Latent Flakiness on GitHub Runners

**File:** `.github/workflows/ci.yml:54-71`

**Issue:** The `test` job runs `pnpm test`, which triggers the root `vitest.config.ts` `globalSetup` that starts a PostgreSQL testcontainer. Testcontainers uses a Ryuk cleanup daemon by default. On GitHub-hosted runners, Ryuk intermittently fails to start, causing test runs to fail non-deterministically with `"RYUK container failed to start"`. This is why both the `coverage-gate` job (line 93-94) and the `integration-test` job (line 147-150) explicitly set `TESTCONTAINERS_RYUK_DISABLED: "true"`.

The `test` matrix job omits this variable entirely and has no `env:` block at all, creating a two-class CI environment: the jobs that have the fix and the one that does not.

**Fix:**

```yaml
      - run: pnpm test
        env:
          DATABASE_URL: ""
          TESTCONTAINERS_RYUK_DISABLED: "true"
```

---

## Warnings

### WR-01: Gitleaks Binary Downloaded Without Checksum Verification

**File:** `.github/workflows/ci.yml:70,90,167`

**Issue:** All three gitleaks install steps use:

```bash
curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz | sudo tar -xz -C /usr/local/bin gitleaks
```

There is no SHA-256 checksum verification. Although the URL is version-pinned (`v8.30.1`), a compromised GitHub release asset or CDN MITM would install a malicious binary that is then executed with `sudo` against the repository codebase. Gitleaks publishes a `checksums.txt` file alongside each release.

**Fix:**

```bash
curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/gitleaks_8.30.1_linux_x64.tar.gz -o /tmp/gitleaks.tar.gz
echo "<SHA256_FROM_CHECKSUMS_TXT>  /tmp/gitleaks.tar.gz" | sha256sum --check
sudo tar -xz -C /usr/local/bin gitleaks < /tmp/gitleaks.tar.gz
rm /tmp/gitleaks.tar.gz
```

Obtain the expected SHA256 from `https://github.com/gitleaks/gitleaks/releases/download/v8.30.1/checksums.txt`.

---

### WR-02: Release Workflow Runs Concurrently With CI — Packages Can Be Published Before Tests Pass

**File:** `.github/workflows/release.yml:3-6`

**Issue:** The release workflow triggers on `push: branches: [main]` with no dependency on any CI job. GitHub Actions workflows are entirely independent: a push to `main` triggers both `ci.yml` and `release.yml` simultaneously. If `release.yml` completes before `ci.yml`, packages can be published from code that has not yet passed lint, typecheck, build, or tests. For a financial ledger library whose consumers depend on type-correct, tested code, this is a correctness risk.

**Fix:** The most reliable mitigation is branch protection: require all CI status checks to pass before any merge to `main` (so any code on `main` has already passed CI before the release workflow sees it). Add a comment in the workflow documenting that this branch protection must be configured, or add an explicit CI-status check step as a first gate in the release job.

---

### WR-03: `GITHUB_TOKEN` Unnecessarily Passed to Gitleaks Process

**File:** `.github/workflows/ci.yml:169-171`

**Issue:** The `gitleaks-history` scan step passes `GITHUB_TOKEN` as an environment variable to the gitleaks binary. Gitleaks `detect` mode (scanning a local git repository) does not use or require `GITHUB_TOKEN`. The comment acknowledges this is for a future `GITLEAKS_LICENSE` secret, but `GITHUB_TOKEN` is a completely different credential. Passing it to the gitleaks process widens the blast radius: a compromised gitleaks binary (per CR-01 and WR-01) could exfiltrate this token.

**Fix:** Remove the `env:` block from the gitleaks-history scan step entirely. If a license is needed later, use only `GITLEAKS_LICENSE`:

```yaml
# Remove:
env:
  GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

---

### WR-04: Parallel Pre-Commit: Biome `stage_fixed` and Gitleaks Scan on Staged Content Are a Race Condition

**File:** `lefthook.yml:1-9`

**Issue:** The pre-commit hook runs `biome` and `gitleaks` in `parallel: true`. The `biome` command has `stage_fixed: true`, meaning lefthook re-stages files that biome auto-fixes. Gitleaks reads staged file content from the git index (`protect --staged`). If biome re-stages a file concurrently with gitleaks reading the staged content, gitleaks may scan a version of the file that no longer matches what will be committed. In practice the race window is narrow, but the behavior is undefined and non-deterministic.

**Fix:** Set `parallel: false` so biome runs (and potentially re-stages files) before gitleaks scans staged content:

```yaml
pre-commit:
  parallel: false
  commands:
    biome:
      glob: "*.{js,ts,cjs,mjs,d.cts,d.mts,jsx,tsx,json,jsonc}"
      run: pnpm biome check --no-errors-on-unmatched --files-ignore-unknown=true --colors=off {staged_files}
      stage_fixed: true
    gitleaks:
      run: gitleaks protect --staged --redact --config .gitleaks.toml
```

---

### WR-05: `tsconfig.base.json` Uses `ignoreDeprecations: "6.0"` Without Explanation

**File:** `tsconfig.base.json:17`

**Issue:** `"ignoreDeprecations": "6.0"` silently suppresses TypeScript errors for features deprecated in TypeScript 6.0 without any comment explaining which deprecated feature is being suppressed or why. For a financial ledger project where type correctness is a first-class invariant and where `CLAUDE.md` explicitly prohibits unexplained `@ts-ignore` usage, an unexplained deprecation suppressor is a notable inconsistency. Future maintainers cannot know which option is affected, whether it's still needed, or when it can be removed.

**Fix:** Add an inline comment identifying the specific deprecated option being used and the reason it cannot be changed yet:

```json
{
  "compilerOptions": {
    // ignoreDeprecations: "6.0" — suppresses the TS6 error for ["target": "ES2024" | specific deprecated setting].
    // Remove when [the upstream dependency / library type / pattern] is updated to TS6-compatible syntax.
    "ignoreDeprecations": "6.0"
  }
}
```

---

### WR-06: `test` CI Job Has No `needs:` Chain — Tests Run Against Potentially Non-Building Code

**File:** `.github/workflows/ci.yml:54`

**Issue:** The `test` matrix job has no `needs:` clause and runs in parallel with `lint`, `typecheck`, and `build`. For a strictly-typed financial codebase, allowing tests to run against code that has not been type-verified means type errors at ledger boundaries (e.g., a mismatch in `amount_cents` type) could be present in the code under test without the CI signal making the relationship clear. The `coverage-gate` and `integration-test` jobs correctly declare `needs: [lint, typecheck, build]`.

**Fix:**

```yaml
test:
  name: Test (Node ${{ matrix.node-version }})
  needs: [lint, typecheck, build]
  runs-on: ubuntu-latest
  ...
```

---

### WR-07: Secret-Scan Tests Pass Silently (Not Skipped) When `gitleaks` Is Absent

**File:** `tests/ci/secret-scan.test.ts:63-66` and `99-102`

**Issue:** The two tests that verify gitleaks detects EC private keys and `SECRET=` assignments use this pattern when gitleaks is not installed:

```typescript
if (!gitleaksAvailable) {
  console.warn("Skipping: gitleaks not installed — run: brew install gitleaks");
  return;
}
```

`return` causes the test function to exit early, and Vitest marks the test as **passed** — not skipped. A CI run or local environment without gitleaks installed will show these security-verification tests as green, providing false confidence that secret scanning is operational.

(Note: the first test in the suite, `"gitleaks binary is available on PATH"`, will fail when gitleaks is absent. But because the suite continues, the two detection tests still report as `PASS`.)

**Fix:** Use Vitest's proper skip mechanism so the tests report as `SKIPPED`, not `PASSED`:

```typescript
it("gitleaks detects EC private key header in a fixture file", (ctx) => {
  if (!gitleaksAvailable) {
    ctx.skip();
    return;
  }
  // ... rest of test
});
```

Or use `it.skipIf(!gitleaksAvailable)(...)` at declaration time.

---

## Info

### IN-01: `gitleaks` Binary Extracted to CWD in History Scan Not in `.gitignore`

**File:** `.github/workflows/ci.yml:167`, `.gitignore`

**Issue:** The `gitleaks-history` job extracts `gitleaks` to the current working directory (`tar -xz gitleaks` without `-C`). On ephemeral CI runners this is harmless. However, the `gitleaks` binary name is not present in `.gitignore`. If a developer replicates this command locally for debugging, the binary lands at repo root and `git add .` would stage it. A 40+ MB binary accidentally committed would bloat the repository permanently (git history is hard to clean).

**Fix:** Add `gitleaks` to `.gitignore`:

```gitignore
# Local gitleaks binary (may be extracted for debugging)
gitleaks
```

---

### IN-02: Renovate Scheduled Only on Weekends — High-Severity CVEs Sit Unpatched for Up to 6 Days

**File:** `renovate.json:5`

**Issue:** `"schedule": ["every weekend"]` means Renovate only opens dependency PRs on weekends. For a financial OSS library with direct dependencies on `fastify`, `postgres`, `drizzle-orm`, and related packages, a critical CVE could go unnoticed for up to 6 days. This is a deliberate trade-off but worth explicit acknowledgment for a security-sensitive project.

**Fix:** Add a separate `vulnerabilityAlerts` schedule:

```json
{
  "extends": ["config:recommended"],
  "schedule": ["every weekend"],
  "automerge": false,
  "dependencyDashboard": true,
  "vulnerabilityAlerts": {
    "schedule": ["at any time"],
    "labels": ["security", "priority"]
  }
}
```

---

### IN-03: `CONTRIBUTING.md` and `CLAUDE.md` Reference Scripts That Do Not Exist

**File:** `CONTRIBUTING.md:96`, `CLAUDE.md` (Common commands section)

**Issue:** Two documented commands do not exist in `package.json`:

1. `pnpm test:contract` (referenced in `CONTRIBUTING.md`) — no such script defined.
2. `pnpm db:rollback` (referenced in `CLAUDE.md`) — no such script defined.

Both are Phase-5+ features, but running them currently yields `ERR_PNPM_NO_SCRIPT`, which is confusing to contributors following the setup guide.

**Fix:** Either stub the scripts now (even with a `"not yet implemented"` echo) or annotate the documentation sections with explicit `(Phase 5+)` or `(not yet available)` markers so contributors know not to run them.

---

### IN-04: README and CONTRIBUTING Contain Unresolved `<owner>` Placeholder in Clone URL

**File:** `README.md:59`, `CONTRIBUTING.md:67-68`

**Issue:** Both files contain `https://github.com/<owner>/apruma.git`. This is a placeholder that must be replaced when the repository is published under a real GitHub organization or user account. Contributors following the quickstart will copy an invalid URL.

**Fix:** Replace `<owner>` with the real GitHub organization/username before the repository is made public.

---

### IN-05: `biome.json` Coverage Directory Exclusion May Not Match Subdirectory Contents

**File:** `biome.json:30`

**Issue:** The `files.includes` exclusion uses `"!coverage"` (no trailing wildcard or slash). In Biome's glob implementation, `"!coverage"` matches a file or directory entry named exactly `coverage` at any depth, which should effectively exclude the `coverage/` directory. However, the canonical pattern `"!coverage/**"` is more explicit and matches the style of other exclusions in the same list (`"!**/dist"`, `"!**/node_modules"`).

**Fix:**

```json
"includes": ["**", "!**/dist", "!**/node_modules", "!**/*.d.ts", "!coverage/**"]
```

---

_Reviewed: 2026-06-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
