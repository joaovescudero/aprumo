import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@aprumo/connector-base",
    pool: "forks",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
