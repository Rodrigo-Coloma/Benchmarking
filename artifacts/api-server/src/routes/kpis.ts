import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { DIRECTIONS, getDb, projects } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireProjectMembership } from "../middlewares/requireProjectMembership.js";
import * as svc from "../services/kpis.service.js";
import { buildKpisTemplate } from "../lib/excel/kpis/template.js";
import { NotFoundError } from "../lib/errors.js";

export const kpisRouter = Router({ mergeParams: true });

const createSchema = z.object({
  external_code: z.string().min(1).max(80),
  name: z.string().min(1).max(300),
  scope: z.string().nullable().optional(),
  responsible_area: z.string().nullable().optional(),
  direction: z.enum(DIRECTIONS).nullable().optional(),
  standard_unit: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  comparable_companies: z.array(z.string()).nullable().optional(),
  extra: z.record(z.unknown()).nullable().optional(),
});

const updateSchema = createSchema.partial().omit({ external_code: true });

kpisRouter.use(requireAuth);

/**
 * GET /api/projects/:projectId/kpis/template.xlsx
 *   Plantilla con columnas canónicas. Va antes que `/:kpiId` para que el
 *   router no la confunda con un kpiId.
 */
kpisRouter.get(
  "/template.xlsx",
  requireProjectMembership(),
  async (req, res, next) => {
    try {
      const db = getDb();
      const project = await db.query.projects.findFirst({
        where: eq(projects.id, req.params.projectId),
      });
      if (!project) {
        throw new NotFoundError(
          "PROJECT_NOT_FOUND",
          "Proyecto no encontrado",
        );
      }
      const buffer = await buildKpisTemplate({
        projectName: project.name,
        projectFramework: project.framework,
      });
      res
        .status(200)
        .setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .setHeader(
          "Content-Disposition",
          `attachment; filename="kpis-${project.slug}-template.xlsx"`,
        )
        .send(buffer);
    } catch (err) {
      next(err);
    }
  },
);

kpisRouter.get(
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

kpisRouter.get(
  "/:kpiId",
  requireProjectMembership(),
  async (req, res, next) => {
    try {
      const row = await svc.getOne(req.params.projectId, req.params.kpiId);
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

kpisRouter.post(
  "/",
  requireProjectMembership(["owner", "editor"]),
  async (req, res, next) => {
    try {
      const body = createSchema.parse(req.body);
      const row = await svc.create(req.params.projectId, body);
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

kpisRouter.patch(
  "/:kpiId",
  requireProjectMembership(["owner", "editor"]),
  async (req, res, next) => {
    try {
      const body = updateSchema.parse(req.body);
      const row = await svc.update(
        req.params.projectId,
        req.params.kpiId,
        body,
      );
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

kpisRouter.delete(
  "/:kpiId",
  requireProjectMembership(["owner", "editor"]),
  async (req, res, next) => {
    try {
      await svc.archive(req.params.projectId, req.params.kpiId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
