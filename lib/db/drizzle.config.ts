import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL;
if (!url) {
  // No abortamos en codegen offline, pero avisamos.
  // drizzle-kit push fallará igualmente sin la URL.
  console.warn("[drizzle.config] DATABASE_URL no está definida");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: url ?? "postgres://localhost:5432/assetmanager",
  },
  strict: true,
  verbose: true,
});
