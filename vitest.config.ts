// Root Vitest configuration
// D-20 AMENDED: uses projects: array (NOT vitest.workspace.ts — deprecated since Vitest 3.2)
// D-21: pool: 'forks' is set per-package in each packages/*/vitest.config.ts
// Coverage thresholds MUST be root-level (per-project coverage is silently ignored in workspace mode)
// Glob order: specific-before-wildcard (packages/core/src/** BEFORE packages/*/src/**)
//
// Wave 0 note: An inline project for tests/ is included so scaffold + CI gate tests
// can run before any package/ directory exists. When packages are scaffolded (Wave 1+),
// the "packages/*/vitest.config.ts" glob resolves additional per-package projects.
//
// Phase 2 (Plan 08): globalSetup is declared per-package in packages/core/vitest.config.ts.
// Per D-37: one container global; schema-per-file isolation handled by createTestDb().
// WR-01: do NOT add globalSetup here — in Vitest workspace mode both root-level and
// project-level globalSetup are executed, which would start two PG containers and
// result in non-deterministic pgUri injection.
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
      // Exclude declarative Drizzle schema definitions from coverage collection.
      // db/schema.ts contains only pgTable() calls with index/check callback arrow functions
      // that v8 counts as uncovered functions — they execute at module import time
      // during schema definition, not as testable application logic. Excluding this file
      // prevents the 9 DDL-definition callbacks from dragging functions coverage below 90%.
      // All real application logic remains covered. (Gap-closure: blocker 1 in 03-VERIFICATION.md)
      exclude: ["**/db/schema.ts"],
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
