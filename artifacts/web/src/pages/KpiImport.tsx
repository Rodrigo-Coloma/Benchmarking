import { useState, useRef, useCallback, type DragEvent } from "react";
import { Link, useLocation, useParams } from "wouter";
import { ApiError } from "@workspace/api-client-react";
import * as api from "../lib/api";
import { Button } from "../components/Button";
import { Upload, FileSpreadsheet, Loader2 } from "lucide-react";

export function KpiImportPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const onPick = (f: File | null) => {
    setError(null);
    if (!f) return setFile(null);
    if (!/\.(xlsx|xlsm)$/i.test(f.name)) {
      setError("Sólo se aceptan archivos .xlsx o .xlsm");
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError("Archivo demasiado grande (máx 10 MB)");
      return;
    }
    setFile(f);
  };

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragging(false);
      onPick(e.dataTransfer.files?.[0] ?? null);
    },
    [],
  );

  const onSubmit = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const result = await api.uploadKpiXlsx(id, file);
      navigate(`/projects/${id}/kpis/import/${result.run.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.message}${err.code === "EXCEL_NO_CHANGES" ? " (este archivo ya estaba committeado)" : ""}`
          : "Error desconocido al subir el archivo",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <Link href={`/projects/${id}`} className="text-sm underline">
        ← Volver al proyecto
      </Link>
      <h1 className="mt-4 text-2xl font-semibold">Importar catálogo de KPIs</h1>
      <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">
        Sube un Excel con el catálogo de KPIs. Si el formato es nuevo, Claude
        Haiku detectará la estructura y propondrá un mapeo que podrás revisar
        antes de aplicar.
      </p>

      <div
        className={
          "mt-8 cursor-pointer rounded-lg border-2 border-dashed p-12 text-center transition-colors " +
          (dragging
            ? "border-[hsl(var(--primary))] bg-[hsl(var(--muted))]"
            : "border-[hsl(var(--border))] hover:bg-[hsl(var(--muted))]")
        }
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
      >
        {file ? (
          <>
            <FileSpreadsheet className="mx-auto h-10 w-10 text-[hsl(var(--primary))]" />
            <p className="mt-3 font-medium">{file.name}</p>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {(file.size / 1024).toFixed(1)} KB
            </p>
            <button
              type="button"
              className="mt-3 text-xs underline"
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
              }}
            >
              Cambiar archivo
            </button>
          </>
        ) : (
          <>
            <Upload className="mx-auto h-10 w-10 text-[hsl(var(--muted-foreground))]" />
            <p className="mt-3">Arrastra el .xlsx aquí o haz click para elegir</p>
            <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">
              Máximo 10 MB
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
      </div>

      {error && (
        <p className="mt-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Link href={`/projects/${id}`}>
          <Button variant="outline" type="button">
            Cancelar
          </Button>
        </Link>
        <Button onClick={onSubmit} disabled={!file || uploading}>
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Procesando con IA…
            </>
          ) : (
            "Subir y descubrir mapeo"
          )}
        </Button>
      </div>

      <div className="mt-10 rounded-md bg-[hsl(var(--muted))] p-4 text-xs">
        <p className="font-medium">¿Qué pasa al subir?</p>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>Se calcula la firma de las cabeceras de tu Excel.</li>
          <li>
            Si el formato ya se vio antes en este proyecto, se aplica el
            mapeo cacheado (gratis, sin IA).
          </li>
          <li>
            Si no, Claude Haiku analiza la estructura y propone un mapeo de
            columnas → campos canónicos (KPI code, name, scope, unit…).
          </li>
          <li>
            Verás la propuesta + el diff respecto al catálogo actual y
            podrás aceptarla o ajustarla antes del commit.
          </li>
        </ol>
      </div>
    </div>
  );
}
