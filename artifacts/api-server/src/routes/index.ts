import { Router } from "express";
import { healthRouter } from "./health.js";
import { authRouter } from "./auth.js";
import { projectsRouter } from "./projects.js";
import { membersRouter } from "./members.js";
import {
  projectInvitationsRouter,
  publicInvitationsRouter,
} from "./invitations.js";
import { kpisRouter } from "./kpis.js";
import {
  kpiIngestionsRouter,
  kpiSchemaTemplatesRouter,
} from "./kpiIngestions.js";
import { evidenciasRouter } from "./evidencias.js";
import { evidenciaImportsRouter } from "./evidenciaImports.js";
import { apiKeysRouter } from "./apiKeys.js";
import { jobsRouter } from "./jobs.js";

export function buildRouter(): Router {
  const router = Router();

  router.use(healthRouter);
  router.use("/auth", authRouter);
  router.use("/projects", projectsRouter);
  router.use("/projects/:projectId/members", membersRouter);
  router.use("/projects/:projectId/invitations", projectInvitationsRouter);
  router.use("/projects/:projectId/kpis", kpisRouter);
  router.use("/projects/:projectId/kpi-ingestions", kpiIngestionsRouter);
  router.use(
    "/projects/:projectId/kpi-schema-templates",
    kpiSchemaTemplatesRouter,
  );
  // El router de imports/template/download va ANTES del CRUD básico para que
  // sus rutas no colisionen con `/:evId` (sólo numérico).
  router.use("/projects/:projectId/evidencias", evidenciaImportsRouter);
  router.use("/projects/:projectId/evidencias", evidenciasRouter);
  router.use("/projects/:projectId/api-keys", apiKeysRouter);
  router.use("/invitations", publicInvitationsRouter);
  router.use("/jobs", jobsRouter);

  return router;
}
