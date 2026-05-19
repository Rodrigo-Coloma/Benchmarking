/**
 * Entry point para `node dist/migrate.mjs`. Se importa ÚNICAMENTE desde este
 * archivo (ver build.mjs), nunca desde index.ts, para que el `process.exit`
 * no se inlinee en el bundle del servidor.
 */
import { runMigrations } from "../migrate.js";
import { logger } from "../logger.js";
import { closeDb } from "@workspace/db";

async function main(): Promise<void> {
  try {
    await runMigrations();
    await closeDb();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, "Migrations failed");
    process.exit(1);
  }
}

void main();
