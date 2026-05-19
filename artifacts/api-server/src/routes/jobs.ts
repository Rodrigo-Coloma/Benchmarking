import { Router } from "express";
import { requireAuth } from "../middlewares/requireAuth.js";
import { getJobs } from "../jobs/index.js";

export const jobsRouter = Router();

jobsRouter.use(requireAuth);

/**
 * Devuelve el estado y, si está completo, el resultado de un job de pg-boss.
 * En PR1 esto es scaffolding: aún no encolamos ningún job real.
 */
jobsRouter.get("/:jobId", async (req, res, next) => {
  try {
    const jobs = getJobs();
    if (!jobs) {
      return res.json({
        id: req.params.jobId,
        name: "unknown",
        state: "created",
      });
    }
    const job = await jobs.getJobById(req.params.jobId);
    if (!job) {
      return res.status(404).json({
        error: "Job no encontrado",
        code: "EVIDENCE_NOT_FOUND",
      });
    }
    res.json({
      id: job.id,
      name: job.name,
      state: job.state,
      data: job.data,
      result: (job as { output?: unknown }).output ?? null,
      started_on: (job as { startedOn?: Date }).startedOn ?? null,
      completed_on: (job as { completedOn?: Date }).completedOn ?? null,
    });
  } catch (err) {
    next(err);
  }
});
