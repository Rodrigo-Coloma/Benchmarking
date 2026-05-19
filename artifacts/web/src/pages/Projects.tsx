import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import * as api from "../lib/api";
import { qk } from "../lib/queryKeys";
import { Button } from "../components/Button";
import { Plus } from "lucide-react";

export function ProjectsPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: qk.projects(),
    queryFn: api.listProjects,
  });

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Tus proyectos</h1>
        <Link href="/projects/new">
          <Button>
            <Plus className="h-4 w-4" /> Nuevo proyecto
          </Button>
        </Link>
      </header>

      {isLoading && (
        <p className="mt-8 text-sm text-[hsl(var(--muted-foreground))]">
          Cargando…
        </p>
      )}
      {error && (
        <p className="mt-8 text-sm text-red-600">
          Error al cargar proyectos.
        </p>
      )}

      {data && data.length === 0 && (
        <div className="mt-12 rounded-md border border-dashed border-[hsl(var(--border))] p-12 text-center">
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            Todavía no tienes proyectos. Crea el primero.
          </p>
          <Link href="/projects/new">
            <Button className="mt-4">Crear proyecto</Button>
          </Link>
        </div>
      )}

      {data && data.length > 0 && (
        <ul className="mt-8 divide-y divide-[hsl(var(--border))] rounded-md border border-[hsl(var(--border))]">
          {data.map((p) => (
            <li key={p.id}>
              <Link
                href={`/projects/${p.id}`}
                className="flex items-baseline justify-between gap-4 p-4 hover:bg-[hsl(var(--muted))]"
              >
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    {p.description.slice(0, 120)}
                    {p.description.length > 120 && "…"}
                  </p>
                </div>
                <span className="rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs uppercase tracking-wide">
                  {p.role}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
