---
phase: 02-schema-foundation-db-tooling
plan: 13
subsystem: testcontainers-setup
tags: [digest-pin, reproducibility, d-40, tdd]
dependency_graph:
  requires: []
  provides: [pinned-pg-image-constant]
  affects: [packages/core/tests/setup/container.ts]
tech_stack:
  added: []
  patterns: [digest-pinning, tdd-grep-gate]
key_files:
  created: []
  modified:
    - packages/core/tests/setup/container.ts
decisions:
  - "PG_IMAGE pinned to postgres:18-alpine@sha256:96d56f7f57c6aacd1fcb908bc83b345ec5f83231ee486dd66a1baadce274db88 — digest fetched live via docker pull + docker inspect"
  - "Digest method: docker pull postgres:18-alpine && docker inspect --format='{{index .RepoDigests 0}}' postgres:18-alpine"
metrics:
  duration: 97s
  completed: 2026-05-23
  tasks_completed: 2
  files_modified: 1
---

# Phase 02 Plan 13: PG Image Digest Pin (D-40) Summary

**One-liner:** Pinned postgres:18-alpine to SHA256 digest `96d56f7f...` via docker inspect, satisfying D-40 reproducibility requirement so CI and local machines run identical image bytes.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 (RED) | Confirm grep gate fails on floating tag | — | No file change (confirmatory only) |
| 2 (GREEN) | Fetch digest + pin PG_IMAGE | 97cbfe7 | packages/core/tests/setup/container.ts |

## What Was Done

**Task 1 (RED):** Confirmed the grep gate `grep -E '@sha256:[a-f0-9]{64}' packages/core/tests/setup/container.ts` exits 1 against the current file — no digest present. RED state verified. No file changes.

**Task 2 (GREEN):** 
1. Fetched the live digest via `docker pull postgres:18-alpine` — output included `Digest: sha256:96d56f7f57c6aacd1fcb908bc83b345ec5f83231ee486dd66a1baadce274db88`
2. Confirmed via `docker inspect --format='{{index .RepoDigests 0}}' postgres:18-alpine` → `postgres@sha256:96d56f7f57c6aacd1fcb908bc83b345ec5f83231ee486dd66a1baadce274db88`
3. Updated `PG_IMAGE` constant in `container.ts` from `"postgres:18-alpine"` to `"postgres:18-alpine@sha256:96d56f7f57c6aacd1fcb908bc83b345ec5f83231ee486dd66a1baadce274db88"`
4. Updated comments: removed "To pin by digest" instruction (now done), updated "Per D-40" comment, retained re-pin recipe for maintainers
5. Grep gate exits 0 (GREEN), typecheck exits 0, biome exits 0 on modified file
6. All 54 core tests pass with pinned image (testcontainers pulls and boots successfully)

## Verification Results

| Check | Result |
|-------|--------|
| `grep -E '@sha256:[a-f0-9]{64}' container.ts` | exit 0 — PASS |
| No floating tag in non-comment lines | 0 matches — PASS |
| Digest length (64 hex chars) | Confirmed |
| `pnpm typecheck` | exit 0 — PASS |
| `biome check container.ts` | exit 0 — PASS |
| `pnpm --filter @aprumo/core test` | 54/54 passed — PASS |

## Deviations from Plan

None — plan executed exactly as written. `pnpm lint` for the full monorepo hit an OOM condition (pre-existing environment issue, not caused by this change). Biome on the specific modified file exits 0.

## Digest Provenance

- **Method:** `docker pull postgres:18-alpine` + `docker inspect --format='{{index .RepoDigests 0}}' postgres:18-alpine`
- **Pull date:** 2026-05-23
- **Digest:** `sha256:96d56f7f57c6aacd1fcb908bc83b345ec5f83231ee486dd66a1baadce274db88`
- **Full pinned ref:** `postgres:18-alpine@sha256:96d56f7f57c6aacd1fcb908bc83b345ec5f83231ee486dd66a1baadce274db88`

## Known Stubs

None.

## Threat Flags

None — single-constant TypeScript file. No new network endpoints, auth paths, or trust boundaries introduced. SHA-256 digest pinning is itself a supply-chain security mitigation (T-02-13-01 in plan's STRIDE register).

## Self-Check: PASSED

- FOUND: packages/core/tests/setup/container.ts
- FOUND: commit 97cbfe7
- PASS: digest present in file
