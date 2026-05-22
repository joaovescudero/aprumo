import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "@aprumo/webhooks",
    pool: "forks",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
