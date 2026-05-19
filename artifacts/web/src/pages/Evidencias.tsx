import { useState, useRef } from "react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@workspace/api-client-react";
import * as api from "../lib/api";
import { qk } from "../lib/queryKeys";
import { Button } from "../components/Button";
import {
  Download,
  FileDown,
  Loader2,
  Upload,
  Search,
} from "lucide-react";

export function EvidenciasPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [search, setSearch] = useState("");
  const [kpiFilter, setKpiFilter] = useState<string>("");
  const [decisionFilter, setDecisionFilter] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [uploadMode, setUploadMode] = useState<"upsert" | "replace">(
    "upsert",
  );
  const [importResult, setImportResult] = useState<
    | {
        run: api.EvidenciaImportRun;
        summary: api.EvidenciaImportRun["summary"];
      }
    | null
  >(null);
  const [confirmName, setConfirmName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const project = useQuery({
    queryKey: qk.project(id),
    queryFn: () => api.getProject(id),
  });
  const kpis = useQuery({
    queryKey: qk.kpis(id),
    queryFn: () => api.listKpis(id),
  });
  const evidencias = useQuery({
    queryKey: qk.evidencias(id, { search, kpiFilter, decisionFilter }),
    queryFn: () =>
      api.listEvidencias(id, {
        search: search || undefined,
        kpi_id: kpiFilter || undefined,
        decision_final: decisionFilter || undefined,
      }),
  });

  const commitMutation = useMutation({
    mutationFn: () => {
      if (!importResult) throw new Error("no run");
      return api.commitEvidenciaImport(id, importResult.run.id, {
        confirm_project_name:
          uploadMode === "replace" ? confirmName : undefined,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["projects", id, "evidencias"],
      });
      setImportResult(null);
      setConfirmName("");
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : "Error al aplicar");
    },
  });

  const onFile = async (f: File | null) => {
    if (!f) return;
    setError(null);
    setUploading(true);
    try {
      const result = await api.uploadEvidenciasXlsx(id, f, uploadMode);
      setImportResult(result);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.message}${err.code === "EXCEL_NO_CHANGES" ? " (archivo ya importado)" : ""}`
          : "Error al subir el archivo",
      );
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const rows = evidencias.data ?? [];

  return (
    <div className="mx-auto max-w-7xl px-6 py-8">
      <Link href={`/projects/${id}`} className="text-sm underline">
        ← Volver al proyecto
      </Link>

      <header className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Evidencias</h1>

        <div className="flex flex-wrap gap-2">
          <a href={api.evidenciasTemplateUrl(id)}>
            <Button variant="outline" size="sm">
              <FileDown className="h-4 w-4" /> Plantilla XLSX
            </Button>
          </a>
          <a href={api.evidenciasDownloadUrl(id)}>
            <Button variant="outline" size="sm">
              <Download className="h-4 w-4" /> Exportar datos
            </Button>
          </a>
          <select
            value={uploadMode}
            onChange={(e) =>
              setUploadMode(e.target.value as "upsert" | "replace")
            }
            className="h-8 rounded-md border border-[hsl(var(--border))] bg-transparent px-2 text-sm"
          >
            <option value="upsert">upsert (añadir/actualizar)</option>
            <option value="replace">replace (sobrescribir TODO)</option>
          </select>
          <Button
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Procesando…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" /> Importar XLSX
              </>
            )}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0] ?? null)}
          />
        </div>
      </header>

      {error && (
        <p className="mt-3 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      {/* Preview del último import si está pendiente */}
      {importResult && (
        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4">
          <p className="font-medium">
            Preview de “{importResult.run.filename}”
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <Stat label="Total filas" value={importResult.summary.totals.rows_in_file} />
            <Stat
              label="Nuevas"
              value={importResult.summary.totals.new}
              color="text-emerald-600"
            />
            <Stat
              label="Actualizadas"
              value={importResult.summary.totals.updated}
              color="text-amber-600"
            />
            <Stat
              label="KPI no encontrados"
              value={importResult.summary.totals.kpi_not_found}
              color="text-red-600"
            />
            <Stat
              label="Errores"
              value={importResult.summary.totals.parse_errors}
              color="text-red-600"
            />
          </div>
          {importResult.summary.totals.will_remove_in_replace > 0 && (
            <p className="mt-3 text-sm">
              ⚠️ El modo replace borrará{" "}
              <strong>
                {importResult.summary.totals.will_remove_in_replace}
              </strong>{" "}
              filas no presentes en este Excel.
            </p>
          )}
          {uploadMode === "replace" && (
            <label className="mt-3 block text-xs">
              Para confirmar replace escribe el nombre exacto del proyecto:
              <input
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
                className="ml-2 h-7 rounded border border-[hsl(var(--border))] bg-transparent px-2 text-sm"
                placeholder={project.data?.name ?? ""}
              />
            </label>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!importResult) return;
                void api.discardEvidenciaImport(id, importResult.run.id);
                setImportResult(null);
              }}
            >
              Descartar
            </Button>
            <Button
              size="sm"
              onClick={() => commitMutation.mutate()}
              disabled={commitMutation.isPending}
            >
              {commitMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Aplicando…
                </>
              ) : (
                "Aplicar"
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Filtros */}
      <div className="mt-6 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-[hsl(var(--muted-foreground))]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por empresa, fuente, texto…"
            className="h-9 w-full rounded-md border border-[hsl(var(--border))] bg-transparent pl-8 pr-3 text-sm"
          />
        </div>
        <select
          value={kpiFilter}
          onChange={(e) => setKpiFilter(e.target.value)}
          className="h-9 rounded-md border border-[hsl(var(--border))] bg-transparent px-3 text-sm"
        >
          <option value="">Todos los KPIs</option>
          {(kpis.data ?? []).map((k) => (
            <option key={k.id} value={k.id}>
              {k.external_code} — {k.name.slice(0, 40)}
            </option>
          ))}
        </select>
        <select
          value={decisionFilter}
          onChange={(e) => setDecisionFilter(e.target.value)}
          className="h-9 rounded-md border border-[hsl(var(--border))] bg-transparent px-3 text-sm"
        >
          <option value="">Cualquier decisión</option>
          <option value="NUEVA">NUEVA</option>
          <option value="OK">OK</option>
          <option value="PREVALIDADO IA">PREVALIDADO IA</option>
          <option value="DESCARTAR">DESCARTAR</option>
          <option value="REVISION MANUAL">REVISION MANUAL</option>
          <option value="Pendiente">Pendiente</option>
        </select>
      </div>

      {/* Tabla */}
      <div className="mt-4 overflow-x-auto rounded-md border border-[hsl(var(--border))]">
        <table className="w-full text-sm">
          <thead className="bg-[hsl(var(--muted))] text-left text-xs uppercase">
            <tr>
              <th className="px-3 py-2">Empresa</th>
              <th className="px-3 py-2">Año</th>
              <th className="px-3 py-2">Valor</th>
              <th className="px-3 py-2">Unidad</th>
              <th className="px-3 py-2">Fuente</th>
              <th className="px-3 py-2">Decisión</th>
              <th className="px-3 py-2">URL</th>
            </tr>
          </thead>
          <tbody>
            {evidencias.isLoading && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[hsl(var(--muted-foreground))]">
                  Cargando…
                </td>
              </tr>
            )}
            {!evidencias.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[hsl(var(--muted-foreground))]">
                  Sin evidencias. Descarga la plantilla, rellénala y súbela.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr
                key={r.id}
                className="border-t border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]"
              >
                <td className="px-3 py-2">
                  <div className="font-medium">{r.empresa_comparable}</div>
                  {r.tipo_compania && (
                    <div className="text-xs text-[hsl(var(--muted-foreground))]">
                      {r.tipo_compania}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">{r.ano ?? "—"}</td>
                <td className="px-3 py-2">{r.valor_reportado ?? "—"}</td>
                <td className="px-3 py-2">{r.unidad ?? "—"}</td>
                <td className="px-3 py-2">
                  <div>{r.fuente_tipo}</div>
                  <div className="text-xs text-[hsl(var(--muted-foreground))]">
                    {r.fuente_nivel ?? ""}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <DecisionBadge value={r.decision_final} />
                </td>
                <td className="px-3 py-2">
                  {r.url_validada ? (
                    <a
                      href={r.url_validada}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-xs underline"
                    >
                      enlace
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-[hsl(var(--muted-foreground))]">
        Mostrando {rows.length} evidencia{rows.length === 1 ? "" : "s"}.
      </p>
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
    <div className="rounded-md border border-[hsl(var(--border))] bg-white p-2 text-center">
      <div className={"text-xl font-semibold " + (color ?? "")}>{value}</div>
      <div className="text-xs text-[hsl(var(--muted-foreground))]">{label}</div>
    </div>
  );
}

function DecisionBadge({ value }: { value: string | null }) {
  if (!value) return <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>;
  const color =
    value === "OK"
      ? "bg-emerald-100 text-emerald-800"
      : value === "PREVALIDADO IA"
        ? "bg-emerald-50 text-emerald-700"
        : value === "DESCARTAR"
          ? "bg-red-100 text-red-800"
          : value === "REVISION MANUAL"
            ? "bg-amber-100 text-amber-800"
            : value === "NUEVA"
              ? "bg-blue-100 text-blue-800"
              : "bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]";
  return (
    <span className={"rounded-full px-2 py-0.5 text-xs font-medium " + color}>
      {value}
    </span>
  );
}
