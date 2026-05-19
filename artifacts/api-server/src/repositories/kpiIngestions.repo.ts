import { and, desc, eq } from "drizzle-orm";
import {
  kpi_ingestion_runs,
  type Db,
  type IngestionRun,
  type NewIngestionRun,
  type Tx,
} from "@workspace/db";

type Executor = Db | Tx;

export async function insert(
  exec: Executor,
  input: NewIngestionRun,
): Promise<IngestionRun> {
  const [row] = await exec
    .insert(kpi_ingestion_runs)
    .values(input)
    .returning();
  return row;
}

export async function findById(
  exec: Executor,
  projectId: string,
  id: string,
): Promise<IngestionRun | undefined> {
  const [row] = await exec
    .select()
    .from(kpi_ingestion_runs)
    .where(
      and(
        eq(kpi_ingestion_runs.id, id),
        eq(kpi_ingestion_runs.project_id, projectId),
      ),
    )
    .limit(1);
  return row;
}

export async function listByProject(
  exec: Executor,
  projectId: string,
): Promise<IngestionRun[]> {
  return exec
    .select()
    .from(kpi_ingestion_runs)
    .where(eq(kpi_ingestion_runs.project_id, projectId))
    .orderBy(desc(kpi_ingestion_runs.created_at));
}

export async function markCommitted(
  exec: Executor,
  id: string,
  summary: unknown,
): Promise<IngestionRun> {
  const [row] = await exec
    .update(kpi_ingestion_runs)
    .set({
      status: "committed",
      committed_at: new Date(),
      summary: summary as never,
    })
    .where(eq(kpi_ingestion_runs.id, id))
    .returning();
  return row;
}

export async function markDiscarded(
  exec: Executor,
  id: string,
): Promise<void> {
  await exec
    .update(kpi_ingestion_runs)
    .set({ status: "discarded" })
    .where(eq(kpi_ingestion_runs.id, id));
}
