import { getDb, type Role } from "@workspace/db";
import {
  DomainError,
  NotFoundError,
} from "../lib/errors.js";
import { randomToken } from "../lib/hashing.js";
import * as inviRepo from "../repositories/invitations.repo.js";
import * as projectsRepo from "../repositories/projects.repo.js";
import * as usersRepo from "../repositories/users.repo.js";
import * as membersRepo from "../repositories/members.repo.js";

const INVITE_TTL_DAYS = 7;

export async function create(
  projectId: string,
  invitedBy: string,
  input: { email: string; role: Exclude<Role, "owner"> },
) {
  const db = getDb();
  const token = randomToken(32);
  const expires_at = new Date(
    Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000,
  );
  return inviRepo.insert(db, {
    project_id: projectId,
    email: input.email.toLowerCase(),
    role: input.role,
    token,
    invited_by: invitedBy,
    expires_at,
  });
}

export async function listPending(projectId: string) {
  const db = getDb();
  return inviRepo.listPending(db, projectId);
}

export async function preview(token: string) {
  const db = getDb();
  const invitation = await inviRepo.findByToken(db, token);
  if (!invitation) {
    throw new NotFoundError("INVITATION_INVALID", "Invitación no encontrada");
  }
  if (invitation.accepted_at) {
    throw new DomainError(
      "INVITATION_INVALID",
      "La invitación ya fue aceptada",
      410,
    );
  }
  if (invitation.expires_at < new Date()) {
    throw new DomainError(
      "INVITATION_EXPIRED",
      "La invitación ha expirado",
      410,
    );
  }
  const project = await projectsRepo.findById(db, invitation.project_id);
  if (!project) {
    throw new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado");
  }
  return {
    email: invitation.email,
    role: invitation.role as Exclude<Role, "owner">,
    project_name: project.name,
    project_slug: project.slug,
    expires_at: invitation.expires_at,
  };
}

export async function accept(token: string, userId: string) {
  const db = getDb();
  const invitation = await inviRepo.findByToken(db, token);
  if (!invitation || invitation.accepted_at || invitation.expires_at < new Date()) {
    throw new DomainError(
      "INVITATION_INVALID",
      "Invitación inválida o expirada",
      410,
    );
  }

  const user = await usersRepo.findById(db, userId);
  if (!user) throw new NotFoundError("PROJECT_NOT_FOUND", "Usuario no encontrado");
  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    throw new DomainError(
      "INVITATION_INVALID",
      "El email de la invitación no coincide con tu cuenta",
      403,
    );
  }

  return db.transaction(async (tx) => {
    const existing = await membersRepo.findOne(
      tx,
      invitation.project_id,
      userId,
    );
    let member = existing;
    if (!existing) {
      member = await membersRepo.add(tx, {
        project_id: invitation.project_id,
        user_id: userId,
        role: invitation.role as Role,
        added_by: invitation.invited_by,
      });
    }
    await inviRepo.markAccepted(tx, invitation.id);
    return member!;
  });
}

export async function revoke(invitationId: string) {
  const db = getDb();
  await inviRepo.remove(db, invitationId);
}
