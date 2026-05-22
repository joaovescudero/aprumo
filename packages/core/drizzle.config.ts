import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./migrations",
  migrations: {
    table: "__drizzle_migrations",
    schema: "drizzle",
  },
});
