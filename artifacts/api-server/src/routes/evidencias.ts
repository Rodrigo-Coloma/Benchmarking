import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth.js";
import { requireProjectMembership } from "../middlewares/requireProjectMembership.js";
import * as svc from "../services/evidence.service.js";

export const evidenciasRouter = Router({ mergeParams: true });

const evidenciaBaseSchema = z.object({
  kpi_id: z.string().uuid().nullable().optional(),
  empresa_comparable: z.string().min(1).max(200),
  entidad_fuente: z.string().nullable().optional(),
  ano: z.number().int().min(2000).max(2099).nullable().optional(),
  fuente_nivel: z.string().nullable().optional(),
  fuente_tipo: z.string().min(1).max(120),
  fuente_titulo: z.string().nullable().optional(),
  url_validada: z.string().url().nullable().optional(),
  ubicacion_fuente: z.string().nullable().optional(),
  texto_evidencia: z.string().nullable().optional(),
  valor_reportado: z.number().nullable().optional(),
  unidad: z.string().nullable().optional(),
  comparabilidad: z
    .enum(["Alta", "Media", "Baja", "No comparable"])
    .nullable()
    .optional(),
  observacion_metodologica: z.string().nullable().optional(),
  decision_final: z.string().nullable().optional(),
});

const updateSchema = evidenciaBaseSchema.partial();

evidenciasRouter.use(requireAuth);

evidenciasRouter.get(
  "/",
  requireProjectMembership(),
  async (req, res, next) => {
    try {
      const filters = {
        kpi_id: req.query.kpi_id as string | undefined,
        empresa_comparable: req.query.empresa_comparable as string | undefined,
        decision_final: req.query.decision_final as string | undefined,
        fuente_tipo: req.query.fuente_tipo as string | undefined,
        comparabilidad: req.query.comparabilidad as string | undefined,
        search: req.query.search as string | undefined,
      };
      const rows = await svc.list(req.params.projectId, filters);
      res.json(rows);
    } catch (err) {
      next(err);
    }
  },
);

evidenciasRouter.post(
  "/",
  requireProjectMembership(["owner", "editor"]),
  async (req, res, next) => {
    try {
      const body = evidenciaBaseSchema.parse(req.body);
      const row = await svc.create(req.params.projectId, body);
      res.status(201).json(row);
    } catch (err) {
      next(err);
    }
  },
);

evidenciasRouter.get(
  "/:evId",
  requireProjectMembership(),
  async (req, res, next) => {
    try {
      const id = Number(req.params.evId);
      const row = await svc.getOne(req.params.projectId, id);
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

evidenciasRouter.patch(
  "/:evId",
  requireProjectMembership(["owner", "editor"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.evId);
      const body = updateSchema.parse(req.body);
      const row = await svc.update(req.params.projectId, id, body);
      res.json(row);
    } catch (err) {
      next(err);
    }
  },
);

evidenciasRouter.delete(
  "/:evId",
  requireProjectMembership(["owner", "editor"]),
  async (req, res, next) => {
    try {
      const id = Number(req.params.evId);
      await svc.remove(req.params.projectId, id);
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  },
);
