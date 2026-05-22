// Vitest globalSetup: starts one shared PostgreSQL container per test run.
// Per D-37: one container global; schema-per-file isolation handled by createTestDb().
// Per D-40: APRUMO_TEST_REUSE=1 enables .withReuse() for faster local dev iteration.
//
// When Docker is unavailable (CI without Docker, local env without daemon),
// globalSetup provides an empty pgUri. Integration tests that call createTestDb()
// will fail with a connection error — unit tests that do not call createTestDb() pass normally.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

import { PG_IMAGE } from "./setup/container.js";

let container: StartedPostgreSqlContainer | undefined;

export async function setup(project: { provide: (key: string, value: unknown) => void }) {
  const useReuse = process.env.APRUMO_TEST_REUSE === "1";

  let builder = new PostgreSqlContainer(PG_IMAGE);

  if (useReuse) {
    // Enable container reuse for local dev speed; disabled in CI (fresh container per run)
    builder = builder.withReuse();
  }

  try {
    container = await builder.start();
    // Provide the URI to all worker fork processes via Vitest's inject API.
    // Per Pitfall 3: inject() is only valid inside Vitest lifecycle hooks — not at module top-level.
    project.provide("pgUri", container.getConnectionUri());
  } catch (err) {
    // Docker not available — provide empty URI so unit tests can still run.
    // Integration tests requiring a real DB will fail with connection errors.
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[globalSetup] Docker unavailable — integration tests will be skipped: ${msg}`);
    project.provide("pgUri", "");
  }
}

export async function teardown() {
  if (container) {
    await container.stop();
  }
}
