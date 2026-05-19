import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { projects, getDb } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireProjectMembership } from "../middlewares/requireProjectMembership.js";
import * as svc from "../services/evidenciaIngestion.service.js";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "../lib/errors.js";

const UPLOAD_MAX_BYTES = 10 * 1024 * 1024; // 10 MB (V3 §3)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_MAX_BYTES },
});

export const evidenciaImportsRouter = Router({ mergeParams: true });

evidenciaImportsRouter.use(requireAuth);

const importBodySchema = z.object({
  mode: z.enum(["upsert", "replace"]).default("upsert"),
});

const commitBodySchema = z.object({
  dry_run: z.coerce.boolean().default(false),
  confirm_project_name: z.string().optional(),
});

/**
 * POST /api/projects/:projectId/evidencias/import
 *   multipart/form-data: file=<xlsx>, mode=upsert|replace
 *   Parsea, calcula diff y persiste un run con status="previewed".
 */
evidenciaImportsRouter.post(
  "/import",
  requireProjectMembership(["owner", "editor"]),
  upload.single("file"),
  async (req, res, next) => {
    try {
      if (!req.file) throw new ValidationError({ file: ["required"] });
      const body = importBodySchema.parse({
        mode: req.body?.mode ?? "upsert",
      });
      const result = await svc.previewIngestion({
        projectId: req.params.projectId,
        userId: req.session.user!.id,
        filename: req.file.originalname,
        fileBuffer: req.file.buffer,
        mode: body.mode,
      });
      res.status(201).json({
        run: result.run,
        summary: result.summary,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/projects/:projectId/evidencias/imports
 *   Lista runs ordenados por fecha desc.
 */
evidenciaImportsRouter.get(
  "/imports",
  requireProjectMembership(),
  async (req, res, next) => {
    try {
      const runs = await svc.listRuns(req.params.projectId);
      res.json(runs);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/projects/:projectId/evidencias/imports/:runId
 *   Devuelve el run completo (incluye el diff). Útil para volver a renderizar
 *   el preview en el frontend sin re-subir el archivo.
 */
evidenciaImportsRouter.get(
  "/imports/:runId",
  requireProjectMembership(),
  async (req, res, next) => {
    try {
      const run = await svc.getRun(
        req.params.projectId,
        req.params.runId,
      );
      res.json(run);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/projects/:projectId/evidencias/imports/:runId/commit
 *   Aplica el diff. `replace` requiere `confirm_project_name`.
 */
evidenciaImportsRouter.post(
  "/imports/:runId/commit",
  requireProjectMembership(["owner", "editor"]),
  async (req, res, next) => {
    try {
      const body = commitBodySchema.parse(req.body ?? {});
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
      // En modo replace exigimos que el confirm coincida con el nombre
      // del proyecto, similar a "Type the repo name to delete" de GitHub.
      const run = await svc.getRun(req.params.projectId, req.params.runId);
      if (run.mode === "replace") {
        if (
          !body.confirm_project_name ||
          body.confirm_project_name.trim() !== project.name
        ) {
          throw new ConflictError(
            "EXCEL_PARSE_FAILED",
            "Para confirmar replace escribe exactamente el nombre del proyecto",
          );
        }
      }

      const result = await svc.commit({
        projectId: req.params.projectId,
        runId: req.params.runId,
        confirmProjectName: body.confirm_project_name,
        dryRun: body.dry_run,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * DELETE /api/projects/:projectId/evidencias/imports/:runId
 *   Marca el run como descartado.
 */
evidenciaImportsRouter.delete(
  "/imports/:runId",
  requireProjectMembership(["owner", "editor"]),
  async (req, res, next) => {
    try {
      await svc.discard(req.params.projectId, req.params.runId);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/projects/:projectId/evidencias/template.xlsx
 *   Plantilla descargable, generada al vuelo.
 */
evidenciaImportsRouter.get(
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
      const buffer = await svc.generateTemplate(
        project.id,
        project.name,
        project.framework,
      );
      res
        .status(200)
        .setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .setHeader(
          "Content-Disposition",
          `attachment; filename="evidencias-${project.slug}-template.xlsx"`,
        )
        .send(buffer);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/projects/:projectId/evidencias/download.xlsx
 *   Export simétrico con los datos actuales del proyecto.
 */
evidenciaImportsRouter.get(
  "/download.xlsx",
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
      const buffer = await svc.generateDownload(project.id, project.name);
      const stamp = new Date().toISOString().slice(0, 10);
      res
        .status(200)
        .setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
        .setHeader(
          "Content-Disposition",
          `attachment; filename="evidencias-${project.slug}-${stamp}.xlsx"`,
        )
        .send(buffer);
    } catch (err) {
      next(err);
    }
  },
);
