import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import * as api from "../lib/api";
import { qk } from "../lib/queryKeys";
import { Button } from "../components/Button";

export function NewProjectPage() {
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [framework, setFramework] = useState<string>("EFQM 2025");

  const mutation = useMutation({
    mutationFn: () =>
      api.createProject({ name, description, framework }),
    onSuccess: (project) => {
      void queryClient.invalidateQueries({ queryKey: qk.projects() });
      navigate(`/projects/${project.id}`);
    },
  });

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <h1 className="text-2xl font-semibold">Nuevo proyecto</h1>
      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
        En PR1 sólo creamos la cáscara del proyecto. El wizard de 3 pasos con
        carga de Excel inicial llegará en PR2/PR3.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
        className="mt-8 flex flex-col gap-4"
      >
        <label className="flex flex-col gap-1 text-sm">
          Nombre
          <input
            required
            minLength={2}
            maxLength={120}
            className="h-9 rounded-md border border-[hsl(var(--border))] bg-transparent px-3"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Descripción (mín. 50 caracteres recomendado — el LLM la usará como
          contexto del proyecto)
          <textarea
            required
            minLength={10}
            maxLength={5000}
            rows={6}
            className="rounded-md border border-[hsl(var(--border))] bg-transparent px-3 py-2"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Framework
          <select
            value={framework}
            onChange={(e) => setFramework(e.target.value)}
            className="h-9 rounded-md border border-[hsl(var(--border))] bg-transparent px-3"
          >
            <option value="EFQM 2025">EFQM 2025</option>
            <option value="GRI Standards">GRI Standards</option>
            <option value="ESG genérico">ESG genérico</option>
            <option value="Custom">Custom</option>
          </select>
        </label>

        {mutation.error && (
          <p className="text-sm text-red-600" role="alert">
            {mutation.error instanceof ApiError
              ? mutation.error.message
              : "Error al crear proyecto"}
          </p>
        )}

        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Creando…" : "Crear proyecto"}
        </Button>
      </form>
    </div>
  );
}
