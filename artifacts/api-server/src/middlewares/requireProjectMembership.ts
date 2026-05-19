import type { RequestHandler } from "express";
import { eq, and } from "drizzle-orm";
import {
  project_members,
  projects,
  type Role,
} from "@workspace/db";
import { getDb } from "@workspace/db";
import { ForbiddenError, NotFoundError } from "../lib/errors.js";

declare module "express-serve-static-core" {
  interface Request {
    projectId?: string;
    projectRole?: Role;
  }
}

/**
 * Comprueba que el usuario autenticado es miembro del proyecto identificado por
 * `req.params.projectId`. Si se pasan `allowedRoles`, además exige que su rol
 * esté en la lista. En caso contrario devuelve `INSUFFICIENT_ROLE`.
 */
export function requireProjectMembership(
  allowedRoles?: Role[],
): RequestHandler {
  return async (req, _res, next) => {
    try {
      const userId = req.session?.user?.id;
      const projectId = req.params.projectId;
      if (!userId) return next(new ForbiddenError("FORBIDDEN", "No session"));
      if (!projectId) {
        return next(
          new NotFoundError("PROJECT_NOT_FOUND", "Project ID missing"),
        );
      }

      const db = getDb();
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, projectId),
      });
      if (!project) {
        return next(
          new NotFoundError("PROJECT_NOT_FOUND", "Proyecto no encontrado"),
        );
      }

      const member = await db.query.project_members.findFirst({
        where: and(
          eq(project_members.project_id, projectId),
          eq(project_members.user_id, userId),
        ),
      });

      if (!member) {
        return next(
          new ForbiddenError("FORBIDDEN", "No eres miembro del proyecto"),
        );
      }

      const role = member.role as Role;
      if (allowedRoles && !allowedRoles.includes(role)) {
        return next(
          new ForbiddenError(
            "INSUFFICIENT_ROLE",
            `Rol insuficiente: requiere ${allowedRoles.join("|")}`,
          ),
        );
      }

      req.projectId = projectId;
      req.projectRole = role;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}
