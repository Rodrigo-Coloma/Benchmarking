import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb, projects } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireProjectMembership } from "../middlewares/requireProjectMembership.js";
import {
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";
import * as svc from "../services/kpiCatalogIngestion.service.js";
import { DiscoveredSchema } from "../lib/excel/kpis/discoverer.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export const kpiIngestionsRouter = Router({ mergeParams: true });

kpiIngestionsRouter.use(requireAuth);

const commitBody = z.object({
  override_schema: DiscoveredSchema.optional(),
  accepted_changes: z
    .object({
      add: z.array(z.string()).optional(),
      update: z.array(z.string()).optional(),
      remove: z.array(z.string()).optional(),
    })
    .optional(),
});

/**
 * POST /api/projects/:projectId/kpi-ingestions
 *   multipart: file
 *   Sube el XLSX, llama (si hace falta) al descubridor IA, genera diff y
 *   responde con el run + el mapping propuesto.
 */
kpiIngestionsRouter.post(
  "/",
  requireProjectMembership(["owner", "editor"]),
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) throw new ValidationError({ file: ["required"] });
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

      const result = await svc.previewIngestion({
        projectId: req.params.projectId,
        userId: req.session.user!.id,
        filename: req.file.originalname,
        fileBuffer: req.file.buffer,
        project: {
          id: project.id,
          name: project.name,
          description: project.description,
          framework: project.framework,
        },
      });
      res.status(201).json(result);
    } catch (err) {
      next(err);
    }
  },
);

kpiIngestionsRouter.get(
  "/",
  requireProjectMembership(),
  async (req, res, next) => {
    try {
      const rows = await svc.listRuns(req.params.projectId);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

kpiIngestionsRouter.get(
  "/:runId",
  requireProjectMembership(),
  async (req, res, next) => {
    try {
      const row = await svc.getRun(req.params.projectId, req.params.runId);
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

kpiIngestionsRouter.post(
  "/:runId/commit",
  requireProjectMembership(["owner", "editor"]),
  async (req, res, next) => {
    try {
      const body = commitBody.parse(req.body ?? {});
      const result = await svc.commitIngestion({
        projectId: req.params.projectId,
        runId: req.params.runId,
        userId: req.session.user!.id,
        overrideSchema: body.override_schema,
        acceptedChanges: body.accepted_changes,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

kpiIngestionsRouter.delete(
  "/:runId",
  requireProjectMembership(["owner", "editor"]),
  async (req, res, next) => {
    try {
      await svc.discardIngestion(req.params.projectId, req.params.runId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/projects/:projectId/kpi-schema-templates
 *   Listado de mappings cacheados. Útil para que la UI muestre "este formato
 *   ya se conoce — n usos previos".
 */
export const kpiSchemaTemplatesRouter = Router({ mergeParams: true });
kpiSchemaTemplatesRouter.use(requireAuth);
kpiSchemaTemplatesRouter.get(
  "/",
  requireProjectMembership(),
  async (req, res, next) => {
    try {
      const rows = await svc.listTemplates(req.params.projectId);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);
