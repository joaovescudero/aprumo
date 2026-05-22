// Single source of truth for the PG image used in testcontainers.
// Per D-40: pinned to postgres:18-alpine for reproducibility.
// To pin by digest: 'postgres:18-alpine@sha256:<hash>'
// Get digest: docker pull postgres:18-alpine && docker inspect postgres:18-alpine | jq '.[0].RepoDigests'
export const PG_IMAGE = "postgres:18-alpine";
