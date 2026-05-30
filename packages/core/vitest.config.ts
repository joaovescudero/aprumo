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
  },
});
