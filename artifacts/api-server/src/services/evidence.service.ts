import {
  getDb,
  type Evidencia,
  type NewEvidencia,
} from "@workspace/db";
import { NotFoundError } from "../lib/errors.js";
import * as repo from "../repositories/evidencias.repo.js";
import { classifyTipoCompania } from "../utils/tipoCompania.js";

export const list = (projectId: string, filters: repo.ListFilters = {}) =>
  repo.listByProject(getDb(), projectId, filters);

export async function getOne(
  projectId: string,
  id: number,
): Promise<Evidencia> {
  const row = await repo.findById(getDb(), projectId, id);
  if (!row) {
    throw new NotFoundError("EVIDENCE_NOT_FOUND", "Evidencia no encontrada");
  }
  return row;
}

export async function create(
  projectId: string,
  input: Omit<NewEvidencia, "project_id" | "tipo_compania"> & {
    tipo_compania?: string | null;
  },
): Promise<Evidencia> {
  const db = getDb();
  const tipo_compania =
    input.tipo_compania ?? classifyTipoCompania(input.empresa_comparable);
  return repo.insert(db, {
    ...input,
    project_id: projectId,
    tipo_compania,
  });
}

export async function update(
  projectId: string,
  id: number,
  patch: Partial<NewEvidencia>,
): Promise<Evidencia> {
  await getOne(projectId, id);
  const next = { ...patch };
  if (patch.empresa_comparable) {
    next.tipo_compania = classifyTipoCompania(patch.empresa_comparable);
  }
  return repo.update(getDb(), id, next);
}

export async function remove(
  projectId: string,
  id: number,
): Promise<void> {
  await getOne(projectId, id);
  await repo.remove(getDb(), id);
}
