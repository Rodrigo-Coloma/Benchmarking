import PgBoss from "pg-boss";
import { loadEnv } from "../env.js";
import { logger } from "../logger.js";

let _boss: PgBoss | undefined;

export async function startJobs(opts: {
  registerWorkers: boolean;
}): Promise<PgBoss> {
  if (_boss) return _boss;
  const env = loadEnv();
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    archiveCompletedAfterSeconds: 7 * 24 * 60 * 60,
    deleteAfterDays: 30,
  });

  boss.on("error", (err) =>
    logger.error({ err }, "pg-boss error"),
  );

  await boss.start();
  logger.info("pg-boss iniciado");

  if (opts.registerWorkers) {
    // PR1: scaffolding. Las workers de agent.gather / agent.validate /
    // excel.ingest se conectarán en PR3.
    await boss.work("noop", async (jobs) => {
      logger.info({ count: jobs.length }, "noop jobs procesados");
    });
  }

  _boss = boss;
  return boss;
}

export function getJobs(): PgBoss | undefined {
  return _boss;
}

export async function stopJobs(): Promise<void> {
  if (_boss) {
    await _boss.stop({ graceful: true });
    _boss = undefined;
  }
}
