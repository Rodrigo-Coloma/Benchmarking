import { and, eq, inArray } from "drizzle-orm";
import {
  evidencias,
  kpis,
  getDb,
  type Evidencia,
  type EvidenciaImport,
  type Kpi,
  type NewEvidencia,
  type Tx,
} from "@workspace/db";
import {
  ConflictError,
  DomainError,
  NotFoundError,
} from "../lib/errors.js";
import { sha256 } from "../lib/hashing.js";
import {
  buildEvidenciasDownload,
} from "../lib/excel/evidencias/download.js";
import {
  ExcelParseError,
  parseEvidenciasXlsx,
  type ParseErrorRow,
  type ParseSuccessRow,
} from "../lib/excel/evidencias/parser.js";
import { buildEvidenciasTemplate } from "../lib/excel/evidencias/template.js";
import { naturalKey } from "../lib/excel/evidencias/schema.js";
import { classifyTipoCompania } from "../utils/tipoCompania.js";
import * as importsRepo from "../repositories/evidenciaImports.repo.js";
import * as kpisRepo from "../repositories/kpis.repo.js";

export type IngestionMode = "upsert" | "replace";

export interface PreviewResult {
  run: EvidenciaImport;
  summary: PreviewSummary;
}

export interface PreviewSummary {
  filename: string;
  file_hash: string;
  mode: IngestionMode;
  totals: {
    rows_in_file: number;
    parse_errors: number;
    new: number;
    updated: number;
    unchanged: number;
    kpi_not_found: number;
    will_remove_in_replace: number;
  };
}

interface ParsedDiffRow {
  row_number: number;
  kpi_external_code: string;
  empresa_comparable: string;
  ano: number;
  kpi_id: string | null;
  kind: "new" | "updated" | "unchanged" | "kpi_not_found";
  changes?: Record<string, { old: unknown; new: unknown }>;
  payload: Record<string, unknown>;
}

interface DiffPayload {
  rows: ParsedDiffRow[];
  parse_errors: ParseErrorRow[];
  will_remove_in_replace: Array<{
    id: number;
    natural_key: string;
  }>;
}

/**
 * 1. Parse + valida el XLSX.
 * 2. Resuelve `kpi_external_code` → `kpi_id` contra el catálogo del proyecto.
 * 3. Calcula diff por clave natural.
 * 4. Persiste un `evidencia_imports` row con status="previewed" y el diff.
 *    El usuario lo confirma luego con /commit.
 */
export async function previewIngestion(opts: {
  projectId: string;
  userId: string;
  filename: string;
  fileBuffer: Buffer;
  mode: IngestionMode;
}): Promise<PreviewResult> {
  const db = getDb();

  let parsed;
  try {
    parsed = parseEvidenciasXlsx(opts.fileBuffer);
  } catch (err) {
    if (err instanceof ExcelParseError) {
      throw new DomainError("EXCEL_PARSE_FAILED", err.message, 422, {
        details: err.details ?? null,
      });
    }
    throw err;
  }

  if (parsed.headerErrors.length > 0) {
    throw new DomainError(
      "EXCEL_PARSE_FAILED",
      "Las cabeceras del XLSX no coinciden con el schema",
      422,
      { headerErrors: parsed.headerErrors },
    );
  }

  const file_hash = sha256(opts.fileBuffer.toString("base64"));

  // Detectar re-uploads idénticos ya committeados → 409
  const previous = await importsRepo.listByProject(db, opts.projectId);
  const sameHashCommitted = previous.find(
    (p) => p.file_hash === file_hash && p.status === "committed",
  );
  if (sameHashCommitted) {
    throw new ConflictError(
      "EXCEL_NO_CHANGES",
      "Este archivo ya fue importado con éxito anteriormente",
      { previousRunId: sameHashCommitted.id },
    );
  }

  // Resolver KPIs del proyecto por external_code
  const projectKpis = await kpisRepo.listByProject(db, opts.projectId, {
    includeArchived: true,
  });
  const kpiByCode = new Map<string, Kpi>();
  for (const k of projectKpis) kpiByCode.set(k.external_code, k);

  // Cargar evidencias existentes del proyecto para diff (clave natural)
  const currentRows = await db
    .select({
      id: evidencias.id,
      project_id: evidencias.project_id,
      kpi_id: evidencias.kpi_id,
      empresa_comparable: evidencias.empresa_comparable,
      ano: evidencias.ano,
      entidad_fuente: evidencias.entidad_fuente,
      fuente_nivel: evidencias.fuente_nivel,
      fuente_tipo: evidencias.fuente_tipo,
      fuente_titulo: evidencias.fuente_titulo,
      url_validada: evidencias.url_validada,
      ubicacion_fuente: evidencias.ubicacion_fuente,
      texto_evidencia: evidencias.texto_evidencia,
      valor_reportado: evidencias.valor_reportado,
      unidad: evidencias.unidad,
      comparabilidad: evidencias.comparabilidad,
      observacion_metodologica: evidencias.observacion_metodologica,
      decision_final: evidencias.decision_final,
      definicion_referencia: evidencias.definicion_referencia,
      unidad_base_referencia: evidencias.unidad_base_referencia,
      indicador_fuente: evidencias.indicador_fuente,
      encaje_indicador: evidencias.encaje_indicador,
    })
    .from(evidencias)
    .where(eq(evidencias.project_id, opts.projectId));

  const currentByKey = new Map<
    string,
    (typeof currentRows)[number] & { kpi_external_code: string | undefined }
  >();
  for (const r of currentRows) {
    const code = r.kpi_id
      ? projectKpis.find((k) => k.id === r.kpi_id)?.external_code
      : undefined;
    if (!code || r.ano === null) continue;
    const key = naturalKey({
      kpi_external_code: code,
      empresa_comparable: r.empresa_comparable,
      ano: r.ano,
    });
    currentByKey.set(key, { ...r, kpi_external_code: code });
  }

  const diffRows: ParsedDiffRow[] = [];
  const touchedKeys = new Set<string>();
  let counts = {
    new: 0,
    updated: 0,
    unchanged: 0,
    kpi_not_found: 0,
  };

  for (const v of parsed.valid) {
    const kpi = kpiByCode.get(v.data.kpi_external_code);
    const key = naturalKey(v.data);
    touchedKeys.add(key);

    const payload = buildEvidencePayload(v, kpi);
    if (!kpi) {
      diffRows.push({
        row_number: v.row_number,
        kpi_external_code: v.data.kpi_external_code,
        empresa_comparable: v.data.empresa_comparable,
        ano: v.data.ano,
        kpi_id: null,
        kind: "kpi_not_found",
        payload,
      });
      counts.kpi_not_found += 1;
      continue;
    }

    const existing = currentByKey.get(key);
    if (!existing) {
      diffRows.push({
        row_number: v.row_number,
        kpi_external_code: v.data.kpi_external_code,
        empresa_comparable: v.data.empresa_comparable,
        ano: v.data.ano,
        kpi_id: kpi.id,
        kind: "new",
        payload,
      });
      counts.new += 1;
    } else {
      const changes = diffPayload(existing, payload);
      if (Object.keys(changes).length === 0) {
        diffRows.push({
          row_number: v.row_number,
          kpi_external_code: v.data.kpi_external_code,
          empresa_comparable: v.data.empresa_comparable,
          ano: v.data.ano,
          kpi_id: kpi.id,
          kind: "unchanged",
          payload,
        });
        counts.unchanged += 1;
      } else {
        diffRows.push({
          row_number: v.row_number,
          kpi_external_code: v.data.kpi_external_code,
          empresa_comparable: v.data.empresa_comparable,
          ano: v.data.ano,
          kpi_id: kpi.id,
          kind: "updated",
          changes,
          payload,
        });
        counts.updated += 1;
      }
    }
  }

  // Replace: filas actuales que NO aparecen en el upload
  const willRemove: DiffPayload["will_remove_in_replace"] = [];
  if (opts.mode === "replace") {
    for (const [key, row] of currentByKey.entries()) {
      if (!touchedKeys.has(key)) {
        willRemove.push({ id: row.id, natural_key: key });
      }
    }
  }

  const summary: PreviewSummary = {
    filename: opts.filename,
    file_hash,
    mode: opts.mode,
    totals: {
      rows_in_file: parsed.valid.length + parsed.invalid.length,
      parse_errors: parsed.invalid.length,
      new: counts.new,
      updated: counts.updated,
      unchanged: counts.unchanged,
      kpi_not_found: counts.kpi_not_found,
      will_remove_in_replace: willRemove.length,
    },
  };

  const diff: DiffPayload = {
    rows: diffRows,
    parse_errors: parsed.invalid,
    will_remove_in_replace: willRemove,
  };

  const run = await importsRepo.insert(db, {
    project_id: opts.projectId,
    user_id: opts.userId,
    filename: opts.filename,
    file_hash,
    mode: opts.mode,
    status: "previewed",
    summary: summary as never,
    diff: diff as never,
    errors: parsed.invalid.length > 0 ? (parsed.invalid as never) : null,
  });

  return { run, summary };
}

export async function discard(projectId: string, runId: string): Promise<void> {
  const db = getDb();
  const run = await importsRepo.findById(db, projectId, runId);
  if (!run) {
    throw new NotFoundError(
      "INGESTION_NOT_FOUND",
      "No se encontró esa ingesta",
    );
  }
  if (run.status === "committed") {
    throw new ConflictError(
      "EXCEL_NO_CHANGES",
      "Esta ingesta ya está committeada y no se puede descartar",
    );
  }
  await importsRepo.markDiscarded(db, runId);
}

/**
 * Aplica el diff a la BBDD en una sola transacción. `replace` borra las filas
 * que no estaban en el upload (V3 §3.5). En modo `dry_run` no toca BBDD y
 * devuelve sólo el conteo.
 */
export async function commit(opts: {
  projectId: string;
  runId: string;
  confirmProjectName?: string;
  dryRun?: boolean;
}): Promise<{ summary: PreviewSummary; applied: boolean }> {
  const db = getDb();
  const run = await importsRepo.findById(db, opts.projectId, opts.runId);
  if (!run) {
    throw new NotFoundError(
      "INGESTION_NOT_FOUND",
      "No se encontró esa ingesta",
    );
  }
  if (run.status === "committed") {
    throw new ConflictError(
      "EXCEL_NO_CHANGES",
      "Esta ingesta ya está committeada",
    );
  }
  if (run.status === "discarded") {
    throw new ConflictError(
      "INGESTION_NOT_FOUND",
      "Esta ingesta fue descartada",
    );
  }

  const diff = run.diff as unknown as DiffPayload;
  const summary = run.summary as unknown as PreviewSummary;

  if (run.mode === "replace") {
    if (!opts.confirmProjectName) {
      throw new ConflictError(
        "EXCEL_PARSE_FAILED",
        "El modo replace requiere confirmar el nombre del proyecto",
      );
    }
  }

  if (opts.dryRun) {
    return { summary, applied: false };
  }

  await db.transaction(async (tx) => {
    if (run.mode === "replace" && diff.will_remove_in_replace.length > 0) {
      const ids = diff.will_remove_in_replace.map((r) => r.id);
      await tx
        .delete(evidencias)
        .where(
          and(
            eq(evidencias.project_id, opts.projectId),
            inArray(evidencias.id, ids),
          ),
        );
    }

    for (const row of diff.rows) {
      if (row.kind === "kpi_not_found" || row.kind === "unchanged") continue;

      if (row.kind === "new") {
        const newRow = buildInsert(opts.projectId, row);
        await tx.insert(evidencias).values(newRow);
      } else if (row.kind === "updated") {
        await applyUpdate(tx, opts.projectId, row);
      }
    }
    await importsRepo.markCommitted(tx, opts.runId, summary);
  });

  return { summary, applied: true };
}

// --- helpers ---

const UPSERTABLE_FIELDS = [
  "entidad_fuente",
  "fuente_nivel",
  "fuente_tipo",
  "fuente_titulo",
  "url_validada",
  "ubicacion_fuente",
  "texto_evidencia",
  "valor_reportado",
  "unidad",
  "comparabilidad",
  "observacion_metodologica",
  "decision_final",
  "definicion_referencia",
  "unidad_base_referencia",
  "indicador_fuente",
  "encaje_indicador",
] as const;

function buildEvidencePayload(
  v: ParseSuccessRow,
  kpi: Kpi | undefined,
): Record<string, unknown> {
  return {
    kpi_id: kpi?.id ?? null,
    empresa_comparable: v.data.empresa_comparable,
    ano: v.data.ano,
    entidad_fuente: v.data.entidad_fuente,
    fuente_nivel: v.data.fuente_nivel,
    fuente_tipo: v.data.fuente_tipo,
    fuente_titulo: v.data.fuente_titulo,
    url_validada: v.data.url_validada,
    ubicacion_fuente: v.data.ubicacion_fuente,
    texto_evidencia: v.data.texto_evidencia,
    valor_reportado: v.data.valor_reportado,
    unidad: v.data.unidad,
    comparabilidad: v.data.comparabilidad,
    observacion_metodologica: v.data.observacion_metodologica,
    decision_final: v.data.decision_final ?? "NUEVA",
    definicion_referencia: v.data.definicion_referencia,
    unidad_base_referencia: v.data.unidad_base_referencia,
    indicador_fuente: v.data.indicador_fuente,
    encaje_indicador: v.data.encaje_indicador,
  };
}

function diffPayload(
  existing: Record<string, unknown>,
  payload: Record<string, unknown>,
): Record<string, { old: unknown; new: unknown }> {
  const out: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of UPSERTABLE_FIELDS) {
    const a = existing[field] ?? null;
    const b = payload[field] ?? null;
    if (!eqLoose(a, b)) {
      out[field] = { old: a, new: b };
    }
  }
  return out;
}

function eqLoose(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined) return b === null || b === undefined;
  if (b === null || b === undefined) return false;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) < 1e-9;
  }
  return String(a).trim() === String(b).trim();
}

function buildInsert(
  projectId: string,
  row: ParsedDiffRow,
): NewEvidencia {
  const p = row.payload as Record<string, unknown>;
  return {
    project_id: projectId,
    kpi_id: row.kpi_id,
    empresa_comparable: p.empresa_comparable as string,
    entidad_fuente: (p.entidad_fuente as string | null) ?? null,
    ano: row.ano,
    fuente_nivel: (p.fuente_nivel as string | null) ?? null,
    fuente_tipo: p.fuente_tipo as string,
    fuente_titulo: (p.fuente_titulo as string | null) ?? null,
    url_validada: (p.url_validada as string | null) ?? null,
    ubicacion_fuente: (p.ubicacion_fuente as string | null) ?? null,
    texto_evidencia: (p.texto_evidencia as string | null) ?? null,
    valor_reportado: (p.valor_reportado as number | null) ?? null,
    unidad: (p.unidad as string | null) ?? null,
    comparabilidad: (p.comparabilidad as string | null) ?? null,
    observacion_metodologica:
      (p.observacion_metodologica as string | null) ?? null,
    decision_final: (p.decision_final as string | null) ?? "NUEVA",
    definicion_referencia: (p.definicion_referencia as string | null) ?? null,
    unidad_base_referencia:
      (p.unidad_base_referencia as string | null) ?? null,
    indicador_fuente: (p.indicador_fuente as string | null) ?? null,
    encaje_indicador: (p.encaje_indicador as string | null) ?? null,
    tipo_compania: classifyTipoCompania(p.empresa_comparable as string),
  };
}

async function applyUpdate(
  tx: Tx,
  projectId: string,
  row: ParsedDiffRow,
): Promise<void> {
  const p = row.payload as Record<string, unknown>;
  if (!row.kpi_id) return;
  await tx
    .update(evidencias)
    .set({
      entidad_fuente: (p.entidad_fuente as string | null) ?? null,
      fuente_nivel: (p.fuente_nivel as string | null) ?? null,
      fuente_tipo: p.fuente_tipo as string,
      fuente_titulo: (p.fuente_titulo as string | null) ?? null,
      url_validada: (p.url_validada as string | null) ?? null,
      ubicacion_fuente: (p.ubicacion_fuente as string | null) ?? null,
      texto_evidencia: (p.texto_evidencia as string | null) ?? null,
      valor_reportado: (p.valor_reportado as number | null) ?? null,
      unidad: (p.unidad as string | null) ?? null,
      comparabilidad: (p.comparabilidad as string | null) ?? null,
      observacion_metodologica:
        (p.observacion_metodologica as string | null) ?? null,
      decision_final: (p.decision_final as string | null) ?? null,
      definicion_referencia: (p.definicion_referencia as string | null) ?? null,
      unidad_base_referencia:
        (p.unidad_base_referencia as string | null) ?? null,
      indicador_fuente: (p.indicador_fuente as string | null) ?? null,
      encaje_indicador: (p.encaje_indicador as string | null) ?? null,
    })
    .where(
      and(
        eq(evidencias.project_id, projectId),
        eq(evidencias.kpi_id, row.kpi_id),
        eq(evidencias.empresa_comparable, row.empresa_comparable),
        eq(evidencias.ano, row.ano),
      ),
    );
}

// --- template / download exports ---

export async function generateTemplate(
  projectId: string,
  projectName: string,
  projectFramework: string | null,
): Promise<Buffer> {
  const db = getDb();
  const list = await kpisRepo.listByProject(db, projectId, {
    includeArchived: false,
  });
  return buildEvidenciasTemplate({
    projectName,
    projectFramework,
    kpis: list,
  });
}

export async function generateDownload(
  projectId: string,
  projectName: string,
): Promise<Buffer> {
  const db = getDb();
  const [rows, kpisList] = await Promise.all([
    db
      .select()
      .from(evidencias)
      .where(eq(evidencias.project_id, projectId)),
    db.select().from(kpis).where(eq(kpis.project_id, projectId)),
  ]);
  const map = new Map<string, Kpi>();
  for (const k of kpisList) map.set(k.id, k);
  return buildEvidenciasDownload({
    projectName,
    evidencias: rows,
    kpisById: map,
  });
}

export async function getRun(
  projectId: string,
  runId: string,
): Promise<EvidenciaImport> {
  const db = getDb();
  const run = await importsRepo.findById(db, projectId, runId);
  if (!run) {
    throw new NotFoundError(
      "INGESTION_NOT_FOUND",
      "No se encontró esa ingesta",
    );
  }
  return run;
}

export async function listRuns(
  projectId: string,
): Promise<EvidenciaImport[]> {
  const db = getDb();
  return importsRepo.listByProject(db, projectId);
}
