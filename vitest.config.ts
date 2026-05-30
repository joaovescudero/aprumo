// Root Vitest configuration
// D-20 AMENDED: uses projects: array (NOT vitest.workspace.ts — deprecated since Vitest 3.2)
// D-21: pool: 'forks' is set per-package in each packages/*/vitest.config.ts
// Coverage thresholds MUST be root-level (per-project coverage is silently ignored in workspace mode)
// Glob order: specific-before-wildcard (packages/core/src/** BEFORE packages/*/src/**)
//
// Wave 0 note: An inline project for tests/ is included so scaffold + CI gate tests
// can run before any package/ directory exists. When packages are scaffolded (Wave 1+),
// the "packages/*/vitest.config.ts" glob resolves additional per-package projects.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // Inline project for root-level scaffold and CI gate tests (Wave 0)
      {
        test: {
          name: "root-tests",
          include: ["tests/**/*.test.ts"],
          environment: "node",
        },
      },
      // Per-package projects — resolved once packages/ dirs exist (Wave 1+)
      "packages/*/vitest.config.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json", "json-summary"],
      reportsDirectory: "./coverage",
      thresholds: {
        // INF-04: 90% LoC gate for @aprumo/core (specific pattern FIRST)
        "packages/core/src/**": {
          lines: 90,
          functions: 90,
          branches: 80,
          statements: 90,
        },
        // 80% for all other packages (wildcard SECOND)
        "packages/*/src/**": {
          lines: 80,
          functions: 80,
          branches: 75,
          statements: 80,
        },
      },
    },
  },
});
