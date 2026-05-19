import { getDb, type Role } from "@workspace/db";
import { ForbiddenError, NotFoundError } from "../lib/errors.js";
import * as membersRepo from "../repositories/members.repo.js";

export async function list(projectId: string) {
  const db = getDb();
  return membersRepo.listByProject(db, projectId);
}

export async function updateRole(
  projectId: string,
  userId: string,
  role: Role,
) {
  const db = getDb();
  const existing = await membersRepo.findOne(db, projectId, userId);
  if (!existing) {
    throw new NotFoundError(
      "PROJECT_NOT_FOUND",
      "El usuario no es miembro del proyecto",
    );
  }
  return membersRepo.updateRole(db, projectId, userId, role);
}

export async function remove(projectId: string, userId: string) {
  const db = getDb();
  const existing = await membersRepo.findOne(db, projectId, userId);
  if (!existing) return;
  if (existing.role === "owner") {
    // Si fuese el último owner, no permitir; simplificación: no eliminamos owners.
    throw new ForbiddenError(
      "FORBIDDEN",
      "No puedes eliminar al owner del proyecto",
    );
  }
  await membersRepo.remove(db, projectId, userId);
}
