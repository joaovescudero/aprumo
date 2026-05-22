import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@aprumo/connector-starkbank",
    pool: "forks",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
