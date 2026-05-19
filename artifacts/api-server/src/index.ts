import { buildApp } from "./app.js";
import { loadEnv } from "./env.js";
import { logger } from "./logger.js";
import { runMigrations } from "./migrate.js";
import { startJobs, stopJobs } from "./jobs/index.js";
import { closeDb } from "@workspace/db";

async function main(): Promise<void> {
  const env = loadEnv();

  await runMigrations();

  if (env.ROLE === "worker" || env.ROLE === "both") {
    await startJobs({ registerWorkers: true });
  } else {
    await startJobs({ registerWorkers: false });
  }

  if (env.ROLE === "worker") {
    logger.info("Modo worker — no se levanta el servidor HTTP");
    return;
  }

  const app = buildApp();

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, basePath: env.BASE_PATH },
      "API listening",
    );
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down...");
    server.close(() => logger.info("HTTP server closed"));
    await stopJobs();
    await closeDb();
    process.exit(0);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal:", err);
  process.exit(1);
});
