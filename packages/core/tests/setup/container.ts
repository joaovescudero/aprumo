// Single source of truth for the PG image used in testcontainers.
// Per D-40: pinned by digest for full reproducibility (tag alone is non-deterministic).
// Re-pin: docker pull postgres:18-alpine && docker inspect --format='{{index .RepoDigests 0}}' postgres:18-alpine
// Then update the sha256 value below.
export const PG_IMAGE =
  "postgres:18-alpine@sha256:96d56f7f57c6aacd1fcb908bc83b345ec5f83231ee486dd66a1baadce274db88";
