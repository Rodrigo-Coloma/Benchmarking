import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Sparkles } from "lucide-react";
import * as api from "../lib/api";
import { qk } from "../lib/queryKeys";
import { Button } from "../components/Button";

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
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-medium">Catálogo de KPIs</h2>
              <Link href={`/projects/${id}/kpis/import`}>
                <Button size="sm">
                  <Sparkles className="h-4 w-4" /> Importar desde Excel
                </Button>
              </Link>
            </div>

            {kpisQuery.isLoading && (
              <p className="mt-2 text-sm">Cargando KPIs…</p>
            )}

            {kpisQuery.data && kpisQuery.data.length === 0 && (
              <div className="mt-4 rounded-md border border-dashed border-[hsl(var(--border))] p-8 text-center">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  Todavía no hay KPIs en este proyecto. Sube un Excel y
                  Claude Haiku detectará la estructura automáticamente.
                </p>
                <Link href={`/projects/${id}/kpis/import`}>
                  <Button className="mt-4">
                    <Sparkles className="h-4 w-4" /> Importar primer Excel
                  </Button>
                </Link>
              </div>
            )}

            {kpisQuery.data && kpisQuery.data.length > 0 && (
              <ul className="mt-4 divide-y divide-[hsl(var(--border))] rounded-md border border-[hsl(var(--border))]">
                {kpisQuery.data.map((k) => (
                  <li key={k.id} className="flex justify-between gap-4 p-3">
                    <div>
                      <p className="font-medium">{k.name}</p>
                      <p className="text-xs text-[hsl(var(--muted-foreground))]">
                        {k.external_code} ·{" "}
                        {k.standard_unit ?? "sin unidad estándar"}
                        {k.scope && <> · {k.scope}</>}
                      </p>
                    </div>
                    {k.direction && (
                      <span className="text-xs text-[hsl(var(--muted-foreground))]">
                        {k.direction}
                      </span>
                    )}
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
