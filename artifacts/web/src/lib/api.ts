/**
 * Wrappers manuales de los endpoints PR1 mientras esperamos a que el codegen
 * de Orval se ejecute. Una vez ejecutado `pnpm codegen`, los hooks generados
 * (useListProjects, useCreateProject, …) pueden sustituir a estas funciones.
 */
import {
  customFetch,
  getBaseUrl,
  ApiError,
  type ApiErrorBody,
} from "@workspace/api-client-react";

export interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
  last_login_at: string | null;
}

export interface Project {
  id: string;
  slug: string;
  name: string;
  description: string;
  framework: string | null;
  framework_context: Record<string, unknown> | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

export interface ProjectWithRole extends Project {
  role: "owner" | "editor" | "viewer";
}

export interface Kpi {
  id: string;
  project_id: string;
  external_code: string;
  name: string;
  scope: string | null;
  responsible_area: string | null;
  direction: "ASCENDENTE" | "DESCENDENTE" | "NEUTRO" | null;
  standard_unit: string | null;
  category: string | null;
  description: string | null;
  comparable_companies: string[] | null;
  extra: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

// ---------- Auth ----------
export const signup = (data: {
  email: string;
  password: string;
  name: string;
}) =>
  customFetch<User>({
    url: "/auth/signup",
    method: "POST",
    data,
  });

export const login = (data: { email: string; password: string }) =>
  customFetch<User>({ url: "/auth/login", method: "POST", data });

export const logout = () =>
  customFetch<void>({ url: "/auth/logout", method: "POST" });

export const getMe = () => customFetch<User>({ url: "/auth/me" });

// ---------- Projects ----------
export const listProjects = () =>
  customFetch<ProjectWithRole[]>({ url: "/projects" });

export const getProject = (id: string) =>
  customFetch<ProjectWithRole>({ url: `/projects/${id}` });

export const createProject = (data: {
  name: string;
  description: string;
  framework?: string | null;
  slug?: string | null;
}) =>
  customFetch<Project>({ url: "/projects", method: "POST", data });

// ---------- KPIs ----------
export const listKpis = (projectId: string) =>
  customFetch<Kpi[]>({ url: `/projects/${projectId}/kpis` });

// ---------- KPI Ingestions (PR3) ----------

export interface ColumnMappingEntry {
  source_col: string;
  header: string;
  confidence: number;
}

export interface DiscoveredSchema {
  sheet: string;
  header_row: number;
  skip_rows: number[];
  column_mapping: Record<string, ColumnMappingEntry>;
  notes: string;
}

export interface KpiDiffRow {
  kind: "new" | "updated" | "removed" | "unchanged";
  external_code: string;
  parsed?: Kpi;
  current?: Kpi;
  changes?: Record<string, { old: unknown; new: unknown }>;
}

export interface KpiDiff {
  rows: KpiDiffRow[];
  summary: {
    new: number;
    updated: number;
    removed: number;
    unchanged: number;
    removed_with_evidence: number;
  };
}

export interface KpiIngestionRun {
  id: string;
  project_id: string;
  user_id: string;
  filename: string;
  file_hash: string;
  status: "previewed" | "committed" | "discarded" | "failed";
  summary: Record<string, unknown>;
  diff: {
    workbook_structure: { sheet_names: string[] };
    schema: DiscoveredSchema;
    parser_errors: Array<{ row_number: number; message: string }>;
    diff: KpiDiff;
    source: "template_cache" | "discoverer";
  };
  error: string | null;
  created_at: string;
  committed_at: string | null;
}

export interface KpiIngestionPreview {
  run: KpiIngestionRun;
  needs_review: boolean;
  template_used: { id: string; uses_count: number } | null;
  discovery?: {
    low_confidence: boolean;
    attempts: number;
    usage: {
      input_tokens: number;
      output_tokens: number;
      estimated_cost_usd: number;
    };
  };
}

/**
 * Sube el XLSX. customFetch no soporta multipart bien, así que aquí usamos
 * fetch nativo con FormData. Mantiene credentials include para la cookie.
 */
export async function uploadKpiXlsx(
  projectId: string,
  file: File,
): Promise<KpiIngestionPreview> {
  const form = new FormData();
  form.append("file", file);

  const res = await fetch(
    `${getBaseUrl()}/projects/${projectId}/kpi-ingestions`,
    {
      method: "POST",
      credentials: "include",
      body: form,
    },
  );

  if (!res.ok) {
    let body: ApiErrorBody = {
      error: res.statusText || "HTTP error",
      code: "INTERNAL_ERROR",
    };
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      /* keep default */
    }
    throw new ApiError(res.status, body);
  }

  return (await res.json()) as KpiIngestionPreview;
}

export const getKpiIngestionRun = (projectId: string, runId: string) =>
  customFetch<KpiIngestionRun>({
    url: `/projects/${projectId}/kpi-ingestions/${runId}`,
  });

export const commitKpiIngestion = (
  projectId: string,
  runId: string,
  body?: {
    override_schema?: DiscoveredSchema;
    accepted_changes?: {
      add?: string[];
      update?: string[];
      remove?: string[];
    };
  },
) =>
  customFetch<{ summary: unknown; applied: boolean }>({
    url: `/projects/${projectId}/kpi-ingestions/${runId}/commit`,
    method: "POST",
    data: body ?? {},
  });

export const discardKpiIngestion = (projectId: string, runId: string) =>
  customFetch<void>({
    url: `/projects/${projectId}/kpi-ingestions/${runId}`,
    method: "DELETE",
  });
