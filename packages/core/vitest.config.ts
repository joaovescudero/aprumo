import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@aprumo/core",
    pool: "forks",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
