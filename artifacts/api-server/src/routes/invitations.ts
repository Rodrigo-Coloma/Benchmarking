import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireProjectMembership } from "../middlewares/requireProjectMembership.js";
import * as svc from "../services/invitations.service.js";

export const projectInvitationsRouter = Router({ mergeParams: true });
export const publicInvitationsRouter = Router();

const createSchema = z.object({
  email: z.string().email(),
  role: z.enum(["editor", "viewer"]),
});

projectInvitationsRouter.use(requireAuth);

projectInvitationsRouter.get(
  "/",
  requireProjectMembership(["owner"]),
  async (req, res, next) => {
    try {
      const rows = await svc.listPending(req.params.projectId);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

projectInvitationsRouter.post(
  "/",
  requireProjectMembership(["owner"]),
  async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const userId = req.session.user!.id;
      const invitation = await svc.create(req.params.projectId, userId, body);
      const basePath = req.app.get("basePath") ?? "";
      const inviteLink = `${basePath}/invitations/${invitation.token}`;
      res.status(201).json({ ...invitation, inviteLink });
    } catch (err) {
      next(err);
    }
  },
);

projectInvitationsRouter.delete(
  "/:invitationId",
  requireProjectMembership(["owner"]),
  async (req, res, next) => {
    try {
      await svc.revoke(req.params.invitationId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

// Pública (sin sesión): preview de invitación
publicInvitationsRouter.get("/:token", async (req, res, next) => {
  try {
    const preview = await svc.preview(req.params.token);
    res.json(preview);
  } catch (err) {
    next(err);
  }
});

publicInvitationsRouter.post(
  "/:token/accept",
  requireAuth,
  async (req, res, next) => {
    try {
      const userId = req.session.user!.id;
      const member = await svc.accept(req.params.token, userId);
      res.json(member);
    } catch (err) {
      next(err);
    }
  },
);
