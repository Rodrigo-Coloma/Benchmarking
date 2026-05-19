import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Database, FileDown, Search, Sparkles } from "lucide-react";
import * as api from "../lib/api";
import { qk } from "../lib/queryKeys";
import { Button } from "../components/Button";

export function ProjectOverviewPage() {
  const { id } = useParams<{ id: string }>();
  const [search, setSearch] = useState("");
  const [scopeFilter, setScopeFilter] = useState<string>("");
  const [dirFilter, setDirFilter] = useState<string>("");

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
  const kpis = kpisQuery.data ?? [];

  const scopes = useMemo(() => {
    const s = new Set<string>();
    for (const k of kpis) if (k.scope) s.add(k.scope);
    return Array.from(s).sort();
  }, [kpis]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return kpis.filter((k) => {
      if (scopeFilter && (k.scope ?? "") !== scopeFilter) return false;
      if (dirFilter && (k.direction ?? "") !== dirFilter) return false;
      if (!q) return true;
      return (
        k.external_code.toLowerCase().includes(q) ||
        k.name.toLowerCase().includes(q) ||
        (k.description ?? "").toLowerCase().includes(q) ||
        (k.standard_unit ?? "").toLowerCase().includes(q)
      );
    });
  }, [kpis, search, scopeFilter, dirFilter]);

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link href="/projects" className="text-sm underline">
        ← Volver
      </Link>

      {projectQuery.isLoading && <p className="mt-6">Cargando…</p>}
      {projectQuery.error && (
        <p className="mt-6 text-red-600">No se pudo cargar el proyecto.</p>
      )}

      {project && (
        <>
          <header className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold">{project.name}</h1>
              <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
                {project.framework ?? "Sin framework"} · Rol:{" "}
                <strong>{project.role}</strong>
              </p>
              <p className="mt-3 max-w-3xl whitespace-pre-line text-sm">
                {project.description}
              </p>
            </div>
            <Link href={`/projects/${id}/evidencias`}>
              <Button>
                <Database className="h-4 w-4" /> Evidencias
              </Button>
            </Link>
          </header>

          <section className="mt-10">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-medium">
                Catálogo de KPIs
                <span className="ml-2 text-sm font-normal text-[hsl(var(--muted-foreground))]">
                  ({kpis.length})
                </span>
              </h2>
              <div className="flex flex-wrap gap-2">
                <a href={api.kpisTemplateUrl(id)}>
                  <Button variant="outline" size="sm">
                    <FileDown className="h-4 w-4" /> Plantilla XLSX
                  </Button>
                </a>
                <Link href={`/projects/${id}/kpis/import`}>
                  <Button size="sm">
                    <Sparkles className="h-4 w-4" /> Importar desde Excel
                  </Button>
                </Link>
              </div>
            </div>

            {/* Empty state */}
            {!kpisQuery.isLoading && kpis.length === 0 && (
              <div className="mt-4 rounded-md border border-dashed border-[hsl(var(--border))] p-8 text-center">
                <p className="text-sm text-[hsl(var(--muted-foreground))]">
                  Todavía no hay KPIs en este proyecto.
                </p>
                <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">
                  Descarga la plantilla, rellénala con tus indicadores y súbela.
                </p>
                <div className="mt-4 flex justify-center gap-2">
                  <a href={api.kpisTemplateUrl(id)}>
                    <Button variant="outline" size="sm">
                      <FileDown className="h-4 w-4" /> Descargar plantilla
                    </Button>
                  </a>
                  <Link href={`/projects/${id}/kpis/import`}>
                    <Button size="sm">
                      <Sparkles className="h-4 w-4" /> Importar Excel
                    </Button>
                  </Link>
                </div>
              </div>
            )}

            {/* Filtros */}
            {kpis.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar por código, nombre, unidad…"
                    className="h-9 w-full rounded-md border border-[hsl(var(--border))] bg-transparent pl-8 pr-3 text-sm"
                  />
                </div>
                {scopes.length > 0 && (
                  <select
                    value={scopeFilter}
                    onChange={(e) => setScopeFilter(e.target.value)}
                    className="h-9 rounded-md border border-[hsl(var(--border))] bg-transparent px-3 text-sm"
                  >
                    <option value="">Todos los alcances</option>
                    {scopes.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                )}
                <select
                  value={dirFilter}
                  onChange={(e) => setDirFilter(e.target.value)}
                  className="h-9 rounded-md border border-[hsl(var(--border))] bg-transparent px-3 text-sm"
                >
                  <option value="">Cualquier dirección</option>
                  <option value="ASCENDENTE">ASCENDENTE</option>
                  <option value="DESCENDENTE">DESCENDENTE</option>
                  <option value="NEUTRO">NEUTRO</option>
                </select>
              </div>
            )}

            {/* Lista */}
            {filtered.length > 0 && (
              <ul className="mt-4 divide-y divide-[hsl(var(--border))] rounded-md border border-[hsl(var(--border))]">
                {filtered.map((k) => (
                  <li
                    key={k.id}
                    className="flex flex-wrap items-baseline justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{k.name}</p>
                      <p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">
                        <span className="font-mono">{k.external_code}</span>
                        {" · "}
                        {k.standard_unit ?? "sin unidad estándar"}
                        {k.scope && <> · {k.scope}</>}
                        {k.responsible_area && <> · {k.responsible_area}</>}
                      </p>
                      {k.description && (
                        <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))] line-clamp-2">
                          {k.description}
                        </p>
                      )}
                    </div>
                    {k.direction && (
                      <DirectionBadge value={k.direction} />
                    )}
                  </li>
                ))}
              </ul>
            )}

            {kpis.length > 0 && filtered.length === 0 && (
              <p className="mt-6 text-center text-sm text-[hsl(var(--muted-foreground))]">
                Sin resultados con esos filtros.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function DirectionBadge({ value }: { value: string }) {
  const color =
    value === "ASCENDENTE"
      ? "bg-emerald-100 text-emerald-800"
      : value === "DESCENDENTE"
        ? "bg-amber-100 text-amber-800"
        : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]";
  return (
    <span
      className={
        "rounded-full px-2 py-0.5 text-xs font-medium " + color
      }
    >
      {value}
    </span>
  );
}
