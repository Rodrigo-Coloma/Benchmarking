/**
 * Wrappers manuales de los endpoints PR1 mientras esperamos a que el codegen
 * de Orval se ejecute. Una vez ejecutado `pnpm codegen`, los hooks generados
 * (useListProjects, useCreateProject, …) pueden sustituir a estas funciones.
 */
import { customFetch } from "@workspace/api-client-react";

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
