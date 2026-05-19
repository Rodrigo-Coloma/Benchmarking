import { getDb, type Kpi, type NewKpi } from "@workspace/db";
import { ConflictError, NotFoundError } from "../lib/errors.js";
import * as kpisRepo from "../repositories/kpis.repo.js";

export async function list(projectId: string): Promise<Kpi[]> {
  const db = getDb();
  return kpisRepo.listByProject(db, projectId);
}

export async function getOne(
  projectId: string,
  kpiId: string,
): Promise<Kpi> {
  const db = getDb();
  const row = await kpisRepo.findById(db, projectId, kpiId);
  if (!row) throw new NotFoundError("KPI_NOT_FOUND", "KPI no encontrado");
  return row;
}

export async function create(
  projectId: string,
  input: Omit<NewKpi, "project_id">,
): Promise<Kpi> {
  const db = getDb();
  const existing = await kpisRepo.findByExternalCode(
    db,
    projectId,
    input.external_code,
  );
  if (existing) {
    throw new ConflictError(
      "KPI_DUPLICATE",
      `Ya existe un KPI con external_code "${input.external_code}" en este proyecto`,
    );
  }
  return kpisRepo.insert(db, { ...input, project_id: projectId });
}

export async function update(
  projectId: string,
  kpiId: string,
  patch: Partial<Kpi>,
): Promise<Kpi> {
  const db = getDb();
  await getOne(projectId, kpiId);
  return kpisRepo.update(db, kpiId, patch);
}

export async function archive(
  projectId: string,
  kpiId: string,
): Promise<Kpi> {
  const db = getDb();
  await getOne(projectId, kpiId);
  return kpisRepo.archive(db, kpiId);
}
