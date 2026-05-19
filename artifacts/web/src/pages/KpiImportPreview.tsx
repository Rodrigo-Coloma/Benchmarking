import { useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import * as api from "../lib/api";
import { qk } from "../lib/queryKeys";
import { Button } from "../components/Button";
import { AlertTriangle, Check, Loader2, Sparkles, Trash2 } from "lucide-react";

type Tab = "mapping" | "new" | "updated" | "removed" | "errors";

export function KpiImportPreviewPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("mapping");
  const [error, setError] = useState<string | null>(null);

  const runQuery = useQuery({
    queryKey: ["kpi-ingestion", id, runId],
    queryFn: () => api.getKpiIngestionRun(id, runId),
  });

  const commitMutation = useMutation({
    mutationFn: () => api.commitKpiIngestion(id, runId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.kpis(id) });
      void queryClient.invalidateQueries({ queryKey: qk.project(id) });
      navigate(`/projects/${id}`);
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Error al aplicar");
    },
  });

  const discardMutation = useMutation({
    mutationFn: () => api.discardKpiIngestion(id, runId),
    onSuccess: () => navigate(`/projects/${id}/kpis/import`),
  });

  if (runQuery.isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm">Cargando preview…</p>
      </div>
    );
  }
  if (runQuery.error || !runQuery.data) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="text-sm text-red-600">No se pudo cargar la ingesta.</p>
        <Link href={`/projects/${id}`} className="mt-4 inline-block underline">
          ← Volver
        </Link>
      </div>
    );
  }

  const run = runQuery.data;
  const { schema, parser_errors, diff, source } = run.diff;
  const summary = diff.summary;
  const status = run.status;
  const isApplied = status === "committed" || status === "discarded";

  const rowsByKind = {
    new: diff.rows.filter((r) => r.kind === "new"),
    updated: diff.rows.filter((r) => r.kind === "updated"),
    removed: diff.rows.filter((r) => r.kind === "removed"),
    unchanged: diff.rows.filter((r) => r.kind === "unchanged"),
  };

  const TabBtn = ({
    value,
    label,
    count,
    accent,
  }: {
    value: Tab;
    label: string;
    count: number;
    accent?: string;
  }) => (
    <button
      type="button"
      onClick={() => setTab(value)}
      className={
        "border-b-2 px-3 py-2 text-sm transition-colors " +
        (tab === value
          ? `border-[hsl(var(--primary))] font-medium ${accent ?? ""}`
          : "border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]")
      }
    >
      {label}{" "}
      <span className="ml-1 rounded-full bg-[hsl(var(--muted))] px-2 py-0.5 text-xs">
        {count}
      </span>
    </button>
  );

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <Link href={`/projects/${id}`} className="text-sm underline">
        ← Volver al proyecto
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">{run.filename}</h1>
      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
        {source === "discoverer" ? (
          <>
            <Sparkles className="mr-1 inline h-4 w-4" />
            Mapeo descubierto por Claude Haiku
          </>
        ) : (
          <>
            <Check className="mr-1 inline h-4 w-4" />
            Mapeo reutilizado de un template cacheado (sin coste IA)
          </>
        )}
        {" · "}
        Status: <strong>{status}</strong>
      </p>

      {/* Resumen */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Nuevos" value={summary.new} color="text-emerald-600" />
        <Stat label="Modificados" value={summary.updated} color="text-amber-600" />
        <Stat label="Eliminados" value={summary.removed} color="text-red-600" />
        <Stat label="Sin cambios" value={summary.unchanged} />
        <Stat label="Errores" value={parser_errors.length} color="text-red-600" />
      </div>

      {summary.removed_with_evidence > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-600" />
          <span>
            {summary.removed_with_evidence} KPI(s) marcados como eliminados
            tienen evidencias asociadas. <strong>No se borrarán</strong> —
            se archivarán (soft-delete) para preservar el histórico.
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="mt-8 flex gap-2 border-b border-[hsl(var(--border))]">
        <TabBtn value="mapping" label="Mapeo IA" count={Object.keys(schema.column_mapping).length} />
        <TabBtn value="new" label="Nuevos" count={summary.new} accent="text-emerald-600" />
        <TabBtn value="updated" label="Modificados" count={summary.updated} accent="text-amber-600" />
        <TabBtn value="removed" label="Eliminados" count={summary.removed} accent="text-red-600" />
        <TabBtn value="errors" label="Errores" count={parser_errors.length} accent="text-red-600" />
      </div>

      <div className="mt-6">
        {tab === "mapping" && <MappingView schema={schema} />}
        {tab === "new" && <NewRowsView rows={rowsByKind.new} />}
        {tab === "updated" && <UpdatedRowsView rows={rowsByKind.updated} />}
        {tab === "removed" && <RemovedRowsView rows={rowsByKind.removed} />}
        {tab === "errors" && <ErrorsView errors={parser_errors} />}
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {!isApplied && (
        <div className="mt-10 flex justify-end gap-2 border-t border-[hsl(var(--border))] pt-4">
          <Button
            variant="outline"
            onClick={() => discardMutation.mutate()}
            disabled={discardMutation.isPending}
          >
            <Trash2 className="h-4 w-4" /> Descartar
          </Button>
          <Button
            onClick={() => commitMutation.mutate()}
            disabled={commitMutation.isPending}
          >
            {commitMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Aplicando…
              </>
            ) : (
              <>
                Aplicar {summary.new + summary.updated + summary.removed} cambios
              </>
            )}
          </Button>
        </div>
      )}

      {isApplied && (
        <div className="mt-10 rounded-md bg-emerald-50 p-3 text-sm text-emerald-800">
          Esta ingesta ya está {status === "committed" ? "aplicada" : "descartada"}.
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-md border border-[hsl(var(--border))] p-3 text-center">
      <div className={"text-2xl font-semibold " + (color ?? "")}>{value}</div>
      <div className="text-xs text-[hsl(var(--muted-foreground))]">{label}</div>
    </div>
  );
}

function MappingView({ schema }: { schema: api.DiscoveredSchema }) {
  const entries = Object.entries(schema.column_mapping);
  return (
    <div>
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Hoja: <strong>{schema.sheet}</strong> · Fila de cabeceras:{" "}
        <strong>{schema.header_row}</strong>
        {schema.skip_rows.length > 0 && (
          <> · Filas saltadas: {schema.skip_rows.join(", ")}</>
        )}
      </p>
      {schema.notes && (
        <p className="mt-2 rounded-md bg-[hsl(var(--muted))] p-3 text-xs">
          {schema.notes}
        </p>
      )}
      <table className="mt-4 w-full text-sm">
        <thead className="border-b border-[hsl(var(--border))] text-left text-xs uppercase text-[hsl(var(--muted-foreground))]">
          <tr>
            <th className="py-2">Campo canónico</th>
            <th className="py-2">Columna Excel</th>
            <th className="py-2">Cabecera detectada</th>
            <th className="py-2 text-right">Confianza</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([field, m]) => (
            <tr key={field} className="border-b border-[hsl(var(--border))]">
              <td className="py-2 font-mono text-xs">{field}</td>
              <td className="py-2 font-mono text-xs">{m.source_col}</td>
              <td className="py-2">{m.header}</td>
              <td className="py-2 text-right">
                <ConfidenceBadge value={m.confidence} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ConfidenceBadge({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color =
    value > 0.85
      ? "bg-emerald-100 text-emerald-800"
      : value > 0.6
        ? "bg-amber-100 text-amber-800"
        : "bg-red-100 text-red-800";
  return (
    <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + color}>
      {pct}%
    </span>
  );
}

function NewRowsView({ rows }: { rows: api.KpiDiffRow[] }) {
  if (rows.length === 0)
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">Nada nuevo.</p>;
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-[hsl(var(--border))] text-left text-xs uppercase text-[hsl(var(--muted-foreground))]">
        <tr>
          <th className="py-2">Code</th>
          <th className="py-2">Nombre</th>
          <th className="py-2">Unidad</th>
          <th className="py-2">Alcance</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.external_code} className="border-b border-[hsl(var(--border))]">
            <td className="py-2 font-mono text-xs">{r.external_code}</td>
            <td className="py-2">{r.parsed?.name ?? "—"}</td>
            <td className="py-2">{r.parsed?.standard_unit ?? "—"}</td>
            <td className="py-2">{r.parsed?.scope ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function UpdatedRowsView({ rows }: { rows: api.KpiDiffRow[] }) {
  if (rows.length === 0)
    return <p className="text-sm text-[hsl(var(--muted-foreground))]">Sin cambios.</p>;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div
          key={r.external_code}
          className="rounded-md border border-[hsl(var(--border))] p-3"
        >
          <p className="font-mono text-xs text-[hsl(var(--muted-foreground))]">
            {r.external_code}
          </p>
          <p className="mt-1 font-medium">{r.parsed?.name ?? r.current?.name}</p>
          <ul className="mt-2 space-y-1 text-xs">
            {Object.entries(r.changes ?? {}).map(([field, ch]) => (
              <li key={field}>
                <span className="font-mono">{field}</span>:{" "}
                <span className="line-through text-red-600">
                  {JSON.stringify(ch.old)}
                </span>{" "}
                →{" "}
                <span className="text-emerald-700">
                  {JSON.stringify(ch.new)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RemovedRowsView({ rows }: { rows: api.KpiDiffRow[] }) {
  if (rows.length === 0)
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        Nada a eliminar.
      </p>
    );
  return (
    <table className="w-full text-sm">
      <thead className="border-b border-[hsl(var(--border))] text-left text-xs uppercase text-[hsl(var(--muted-foreground))]">
        <tr>
          <th className="py-2">Code</th>
          <th className="py-2">Nombre</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.external_code} className="border-b border-[hsl(var(--border))]">
            <td className="py-2 font-mono text-xs">{r.external_code}</td>
            <td className="py-2">{r.current?.name ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ErrorsView({
  errors,
}: {
  errors: Array<{ row_number: number; message: string }>;
}) {
  if (errors.length === 0)
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">Sin errores.</p>
    );
  return (
    <ul className="space-y-1 text-sm">
      {errors.map((e, i) => (
        <li key={i} className="font-mono text-xs text-red-600">
          Fila {e.row_number}: {e.message}
        </li>
      ))}
    </ul>
  );
}
