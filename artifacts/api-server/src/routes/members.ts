import { Router } from "express";
import { z } from "zod";
import { ROLES } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireProjectMembership } from "../middlewares/requireProjectMembership.js";
import * as svc from "../services/members.service.js";

export const membersRouter = Router({ mergeParams: true });

const updateRoleSchema = z.object({
  role: z.enum(ROLES),
});

membersRouter.use(requireAuth);

membersRouter.get(
  "/",
  requireProjectMembership(),
  async (req, res, next) => {
    try {
      const rows = await svc.list(req.params.projectId);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

membersRouter.patch(
  "/:userId",
  requireProjectMembership(["owner"]),
  async (req, res, next) => {
    try {
      const body = updateRoleSchema.parse(req.body);
      const row = await svc.updateRole(
        req.params.projectId,
        req.params.userId,
        body.role,
      );
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

membersRouter.delete(
  "/:userId",
  requireProjectMembership(["owner"]),
  async (req, res, next) => {
    try {
      await svc.remove(req.params.projectId, req.params.userId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
