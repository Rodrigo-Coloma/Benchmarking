import { and, eq, isNull } from "drizzle-orm";
import {
  kpis,
  type Db,
  type Kpi,
  type NewKpi,
  type Tx,
} from "@workspace/db";

type Executor = Db | Tx;

export async function insert(exec: Executor, input: NewKpi): Promise<Kpi> {
  const [row] = await exec.insert(kpis).values(input).returning();
  return row;
}

export async function listByProject(
  exec: Executor,
  projectId: string,
  opts: { includeArchived?: boolean } = {},
): Promise<Kpi[]> {
  const where = opts.includeArchived
    ? eq(kpis.project_id, projectId)
    : and(eq(kpis.project_id, projectId), isNull(kpis.archived_at));
  return exec.select().from(kpis).where(where);
}

export async function findById(
  exec: Executor,
  projectId: string,
  kpiId: string,
): Promise<Kpi | undefined> {
  const [row] = await exec
    .select()
    .from(kpis)
    .where(and(eq(kpis.id, kpiId), eq(kpis.project_id, projectId)))
    .limit(1);
  return row;
}

export async function findByExternalCode(
  exec: Executor,
  projectId: string,
  externalCode: string,
): Promise<Kpi | undefined> {
  const [row] = await exec
    .select()
    .from(kpis)
    .where(
      and(
        eq(kpis.project_id, projectId),
        eq(kpis.external_code, externalCode),
      ),
    )
    .limit(1);
  return row;
}

export async function update(
  exec: Executor,
  kpiId: string,
  patch: Partial<Kpi>,
): Promise<Kpi> {
  const [row] = await exec
    .update(kpis)
    .set({ ...patch, updated_at: new Date() })
    .where(eq(kpis.id, kpiId))
    .returning();
  return row;
}

export async function archive(exec: Executor, kpiId: string): Promise<Kpi> {
  return update(exec, kpiId, { archived_at: new Date() });
}

export async function hardDelete(
  exec: Executor,
  kpiId: string,
): Promise<void> {
  await exec.delete(kpis).where(eq(kpis.id, kpiId));
}
