// Single source of truth for the PG image used in testcontainers.
// Per D-40: pinned by digest for full reproducibility (tag alone is non-deterministic).
// Per CLAUDE.md: "DB: Postgres 16+" — tests run on the minimum supported version.
// Re-pin: docker pull postgres:16-alpine && docker inspect --format='{{index .RepoDigests 0}}' postgres:16-alpine
// Then update the sha256 value below.
export const PG_IMAGE =
  "postgres:16-alpine@sha256:16bc17c64a573ef34162af9298258d1aec548232985b33ed7b1eac33ba35c229";
