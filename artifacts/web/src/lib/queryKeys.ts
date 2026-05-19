/**
 * Factory de query keys jerárquicos para react-query. Permite invalidar
 * granularmente: `qk.project(id)` invalida todo lo del proyecto, `qk.kpis(id)`
 * sólo el catálogo, etc.
 */
export const qk = {
  me: () => ["me"] as const,
  projects: () => ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  kpis: (projectId: string) => ["projects", projectId, "kpis"] as const,
  kpi: (projectId: string, kpiId: string) =>
    ["projects", projectId, "kpis", kpiId] as const,
  evidencias: (projectId: string, filters?: Record<string, unknown>) =>
    ["projects", projectId, "evidencias", filters ?? {}] as const,
  evidencia: (projectId: string, evId: number) =>
    ["projects", projectId, "evidencias", evId] as const,
  members: (projectId: string) =>
    ["projects", projectId, "members"] as const,
  apiKeys: (projectId: string) =>
    ["projects", projectId, "api-keys"] as const,
  job: (jobId: string) => ["jobs", jobId] as const,
};
