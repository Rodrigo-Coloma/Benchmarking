import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import * as api from "../lib/api";
import { qk } from "../lib/queryKeys";

export function ProjectOverviewPage() {
  const { id } = useParams<{ id: string }>();

  const projectQuery = useQuery({
    queryKey: qk.project(id),
    queryFn: () => api.getProject(id),
  });

  const kpisQuery = useQuery({
    queryKey: qk.kpis(id),
    queryFn: () => api.listKpis(id),
    enabled: !!projectQuery.data,
  });

  const project = projectQuery.data;

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <Link href="/projects" className="text-sm underline">
        ← Volver
      </Link>

      {projectQuery.isLoading && <p className="mt-6">Cargando…</p>}
      {projectQuery.error && (
        <p className="mt-6 text-red-600">No se pudo cargar el proyecto.</p>
      )}

      {project && (
        <>
          <header className="mt-6">
            <h1 className="text-2xl font-semibold">{project.name}</h1>
            <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
              {project.framework ?? "Sin framework"} · Rol:{" "}
              <strong>{project.role}</strong>
            </p>
            <p className="mt-4 whitespace-pre-line text-sm">
              {project.description}
            </p>
          </header>

          <section className="mt-10">
            <h2 className="text-lg font-medium">Catálogo de KPIs</h2>
            {kpisQuery.isLoading && (
              <p className="mt-2 text-sm">Cargando KPIs…</p>
            )}
            {kpisQuery.data && kpisQuery.data.length === 0 && (
              <p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">
                Todavía no hay KPIs. En PR3 podrás importarlos desde un Excel.
              </p>
            )}
            {kpisQuery.data && kpisQuery.data.length > 0 && (
              <ul className="mt-2 divide-y divide-[hsl(var(--border))] rounded-md border border-[hsl(var(--border))]">
                {kpisQuery.data.map((k) => (
                  <li key={k.id} className="flex justify-between gap-4 p-3">
                    <div>
                      <p className="font-medium">{k.name}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {k.external_code} ·{" "}
                        {k.standard_unit ?? "sin unidad estándar"}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
