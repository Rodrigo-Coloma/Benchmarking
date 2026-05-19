import { and, eq, ilike, desc, or, type SQL } from "drizzle-orm";
import {
  evidencias,
  type Db,
  type Evidencia,
  type NewEvidencia,
  type Tx,
} from "@workspace/db";

type Executor = Db | Tx;

export interface ListFilters {
  kpi_id?: string;
  empresa_comparable?: string;
  decision_final?: string;
  fuente_tipo?: string;
  comparabilidad?: string;
  search?: string;
}

export async function listByProject(
  exec: Executor,
  projectId: string,
  filters: ListFilters = {},
): Promise<Evidencia[]> {
  const conds: SQL[] = [eq(evidencias.project_id, projectId)];
  if (filters.kpi_id) conds.push(eq(evidencias.kpi_id, filters.kpi_id));
  if (filters.empresa_comparable) {
    conds.push(
      ilike(evidencias.empresa_comparable, `%${filters.empresa_comparable}%`),
    );
  }
  if (filters.decision_final) {
    conds.push(eq(evidencias.decision_final, filters.decision_final));
  }
  if (filters.fuente_tipo) {
    conds.push(eq(evidencias.fuente_tipo, filters.fuente_tipo));
  }
  if (filters.comparabilidad) {
    conds.push(eq(evidencias.comparabilidad, filters.comparabilidad));
  }
  if (filters.search) {
    const q = `%${filters.search}%`;
    const searchCond = or(
      ilike(evidencias.empresa_comparable, q),
      ilike(evidencias.indicador, q),
      ilike(evidencias.entidad_fuente, q),
      ilike(evidencias.fuente_titulo, q),
      ilike(evidencias.texto_evidencia, q),
      ilike(evidencias.unidad, q),
    );
    if (searchCond) conds.push(searchCond);
  }

  return exec
    .select()
    .from(evidencias)
    .where(and(...conds))
    .orderBy(desc(evidencias.created_at));
}

export async function findById(
  exec: Executor,
  projectId: string,
  id: number,
): Promise<Evidencia | undefined> {
  const [row] = await exec
    .select()
    .from(evidencias)
    .where(and(eq(evidencias.id, id), eq(evidencias.project_id, projectId)))
    .limit(1);
  return row;
}

export async function insert(
  exec: Executor,
  input: NewEvidencia,
): Promise<Evidencia> {
  const [row] = await exec.insert(evidencias).values(input).returning();
  return row;
}

export async function update(
  exec: Executor,
  id: number,
  patch: Partial<Evidencia>,
): Promise<Evidencia> {
  const [row] = await exec
    .update(evidencias)
    .set(patch)
    .where(eq(evidencias.id, id))
    .returning();
  return row;
}

export async function remove(exec: Executor, id: number): Promise<void> {
  await exec.delete(evidencias).where(eq(evidencias.id, id));
}
