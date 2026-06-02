import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@aprumo/core",
    pool: "forks",
    // D-21: forks pool required for inject() to safely bridge container URI to workers.
    // globalSetup runs once per test run; schema-per-file isolation handled by createTestDb().
    globalSetup: ["./tests/globalSetup.ts"],
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "tests/**/*.integration.test.ts"],
    environment: "node",
    // Container startup can take 30-60s on first pull; allow generous timeout.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    // IN-02: Explicitly configure v8 coverage provider per CLAUDE.md ("coverage v8").
    // Without this, `pnpm vitest run --coverage` falls back to whatever provider is
    // installed as default, which may differ from v8 instrumentation semantics.
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "json-summary", "lcov"],
      thresholds: { lines: 90 },
    },
  },
});
