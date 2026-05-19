import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireProjectMembership } from "../middlewares/requireProjectMembership.js";
import * as svc from "../services/apiKeys.service.js";

export const apiKeysRouter = Router({ mergeParams: true });

const createSchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(z.string().min(1)).min(1),
});

apiKeysRouter.use(requireAuth);

apiKeysRouter.get(
  "/",
  requireProjectMembership(["owner"]),
  async (req, res, next) => {
    try {
      const rows = await svc.list(req.params.projectId);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

apiKeysRouter.post(
  "/",
  requireProjectMembership(["owner"]),
  async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const row = await svc.create(
        req.params.projectId,
        req.session.user!.id,
        body,
      );
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

apiKeysRouter.delete(
  "/:keyId",
  requireProjectMembership(["owner"]),
  async (req, res, next) => {
    try {
      await svc.revoke(req.params.projectId, req.params.keyId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
