import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireProjectMembership } from "../middlewares/requireProjectMembership.js";
import * as projectsService from "../services/projects.service.js";

export const projectsRouter = Router();

const createSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().min(10).max(5000),
  framework: z.string().optional().nullable(),
  framework_context: z.record(z.unknown()).optional().nullable(),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    .optional()
    .nullable(),
});

const updateSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().min(10).max(5000).optional(),
  framework: z.string().optional().nullable(),
  framework_context: z.record(z.unknown()).optional().nullable(),
});

projectsRouter.use(requireAuth);

projectsRouter.get("/", async (req, res, next) => {
  try {
    const userId = req.session.user!.id;
    const rows = await projectsService.listMine(userId);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

projectsRouter.post("/", async (req, res, next) => {
  try {
    const userId = req.session.user!.id;
    const body = createSchema.parse(req.body);
    const project = await projectsService.createProject(userId, body);
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
});

projectsRouter.get(
  "/:projectId",
  requireProjectMembership(),
  async (req, res, next) => {
    try {
      const userId = req.session.user!.id;
      const project = await projectsService.getProjectForUser(
        userId,
        req.params.projectId,
      );
      res.json(project);
    } catch (err) {
      next(err);
    }
  },
);

projectsRouter.patch(
  "/:projectId",
  requireProjectMembership(["owner"]),
  async (req, res, next) => {
    try {
      const body = updateSchema.parse(req.body);
      const project = await projectsService.updateProject(
        req.params.projectId,
        body,
      );
      res.json(project);
    } catch (err) {
      next(err);
    }
  },
);

projectsRouter.post(
  "/:projectId/archive",
  requireProjectMembership(["owner"]),
  async (req, res, next) => {
    try {
      const project = await projectsService.archiveProject(
        req.params.projectId,
      );
      res.json(project);
    } catch (err) {
      next(err);
    }
  },
);

projectsRouter.delete(
  "/:projectId",
  requireProjectMembership(["owner"]),
  async (req, res, next) => {
    try {
      await projectsService.deleteProject(req.params.projectId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
