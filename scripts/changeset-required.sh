#!/usr/bin/env bash
# Simulate the CI changeset-check gate locally.
# Usage: bash scripts/changeset-required.sh
# Exits 1 if no changeset file exists for a publishable package change since main.
# Note: In CI, this runs only on pull_request events (see .github/workflows/ci.yml).
set -e
pnpm changeset status --since=main
