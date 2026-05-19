import { and, eq, inArray } from "drizzle-orm";
import {
  evidencias,
  kpis,
  getDb,
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
    /**
     * Filas sin match en el catálogo de KPIs. NO bloquean — se insertan con
     * `kpi_id = NULL`. Sólo informativo, para que el frontend pueda animar al
     * usuario a registrar los KPIs faltantes.
     */
    kpi_not_in_catalog: number;
    will_remove_in_replace: number;
  };
}

interface ParsedDiffRow {
  row_number: number;
  codigo_indicador: string;
  empresa_comparable: string;
  ano: number;
  kpi_id: string | null;
  kind: "new" | "updated" | "unchanged";
  kpi_not_in_catalog: boolean;
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
 * Sube y procesa el XLSX. Estructura el diff por clave natural
 * (codigo_indicador, empresa_comparable, ano). Si el codigo_indicador coincide
 * con un external_code del catálogo, asocia kpi_id; si no, queda NULL pero la
 * evidencia sí se inserta (no bloquea).
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

  // Catálogo del proyecto, indexado por external_code (== codigo_indicador
  // del Excel cuando coincide).
  const projectKpis = await kpisRepo.listByProject(db, opts.projectId, {
    includeArchived: true,
  });
  const kpiByCode = new Map<string, Kpi>();
  for (const k of projectKpis) kpiByCode.set(k.external_code, k);

  // Evidencias actuales del proyecto para diff por clave natural.
  const currentRows = await db
    .select()
    .from(evidencias)
    .where(eq(evidencias.project_id, opts.projectId));

  const currentByKey = new Map<string, (typeof currentRows)[number]>();
  for (const r of currentRows) {
    if (!r.codigo_indicador || r.ano === null) continue;
    const key = naturalKey({
      codigo_indicador: r.codigo_indicador,
      empresa_comparable: r.empresa_comparable,
      ano: r.ano,
    });
    currentByKey.set(key, r);
  }

  const diffRows: ParsedDiffRow[] = [];
  const touchedKeys = new Set<string>();
  let counts = {
    new: 0,
    updated: 0,
    unchanged: 0,
    kpi_not_in_catalog: 0,
  };

  for (const v of parsed.valid) {
    const kpi = kpiByCode.get(v.data.codigo_indicador);
    const key = naturalKey(v.data);
    touchedKeys.add(key);

    const payload = buildEvidencePayload(v, kpi);
    const kpiMissing = !kpi;
    if (kpiMissing) counts.kpi_not_in_catalog += 1;

    const existing = currentByKey.get(key);
    if (!existing) {
      diffRows.push({
        row_number: v.row_number,
        codigo_indicador: v.data.codigo_indicador,
        empresa_comparable: v.data.empresa_comparable,
        ano: v.data.ano,
        kpi_id: kpi?.id ?? null,
        kind: "new",
        kpi_not_in_catalog: kpiMissing,
        payload,
      });
      counts.new += 1;
    } else {
      const changes = diffPayload(existing, payload);
      if (Object.keys(changes).length === 0) {
        diffRows.push({
          row_number: v.row_number,
          codigo_indicador: v.data.codigo_indicador,
          empresa_comparable: v.data.empresa_comparable,
          ano: v.data.ano,
          kpi_id: kpi?.id ?? existing.kpi_id,
          kind: "unchanged",
          kpi_not_in_catalog: kpiMissing,
          payload,
        });
        counts.unchanged += 1;
      } else {
        diffRows.push({
          row_number: v.row_number,
          codigo_indicador: v.data.codigo_indicador,
          empresa_comparable: v.data.empresa_comparable,
          ano: v.data.ano,
          kpi_id: kpi?.id ?? existing.kpi_id,
          kind: "updated",
          kpi_not_in_catalog: kpiMissing,
          changes,
          payload,
        });
        counts.updated += 1;
      }
    }
  }

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
      kpi_not_in_catalog: counts.kpi_not_in_catalog,
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
 * Aplica el diff en transacción. `replace` borra filas no presentes en el
 * upload (V3 §3.5). En `dry_run` no toca BBDD.
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

  if (run.mode === "replace" && !opts.confirmProjectName) {
    throw new ConflictError(
      "EXCEL_PARSE_FAILED",
      "El modo replace requiere confirmar el nombre del proyecto",
    );
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
      if (row.kind === "unchanged") continue;
      if (row.kind === "new") {
        await tx.insert(evidencias).values(buildInsert(opts.projectId, row));
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
  "kpi_id",
  "indicador",
  "categoria_efqm",
  "pilar_ilunion",
  "entidad_fuente",
  "fuente_nivel",
  "fuente_tipo",
  "fuente_titulo",
  "url_validada",
  "valor_reportado",
  "unidad",
  "comparabilidad",
  "observacion_metodologica",
  "decision_final",
  "definicion_referencia",
  "unidad_base_referencia",
  "indicador_fuente",
  "encaje_indicador",
  "estado_auditoria",
  "id_data",
  "tipo_compania",
  "unidad_estandarizada",
  "valor_estandarizado",
] as const;

function buildEvidencePayload(
  v: ParseSuccessRow,
  kpi: Kpi | undefined,
): Record<string, unknown> {
  return {
    kpi_id: kpi?.id ?? null,
    codigo_indicador: v.data.codigo_indicador,
    empresa_comparable: v.data.empresa_comparable,
    entidad_fuente: v.data.entidad_fuente,
    ano: v.data.ano,
    indicador: v.data.indicador ?? kpi?.name ?? null,
    categoria_efqm: v.data.categoria_efqm,
    pilar_ilunion: v.data.pilar_ilunion,
    fuente_nivel: v.data.fuente_nivel,
    fuente_tipo: v.data.fuente_tipo,
    fuente_titulo: v.data.fuente_titulo,
    url_validada: v.data.url_validada,
    valor_reportado: v.data.valor_reportado,
    unidad: v.data.unidad,
    comparabilidad: v.data.comparabilidad,
    observacion_metodologica: v.data.observacion_metodologica,
    decision_final: v.data.decision_final ?? "NUEVA",
    definicion_referencia: v.data.definicion_referencia,
    unidad_base_referencia: v.data.unidad_base_referencia,
    indicador_fuente: v.data.indicador_fuente,
    encaje_indicador: v.data.encaje_indicador,
    estado_auditoria: v.data.estado_auditoria,
    id_data: v.data.id_data,
    tipo_compania:
      v.data.tipo_compania ??
      classifyTipoCompania(v.data.empresa_comparable),
    unidad_estandarizada:
      v.data.unidad_estandarizada ?? kpi?.standard_unit ?? null,
    valor_estandarizado: v.data.valor_estandarizado,
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
    codigo_indicador: p.codigo_indicador as string,
    empresa_comparable: p.empresa_comparable as string,
    entidad_fuente: (p.entidad_fuente as string | null) ?? null,
    ano: row.ano,
    indicador: (p.indicador as string | null) ?? null,
    categoria_efqm: (p.categoria_efqm as string | null) ?? null,
    pilar_ilunion: (p.pilar_ilunion as string | null) ?? null,
    fuente_nivel: (p.fuente_nivel as string | null) ?? null,
    fuente_tipo: p.fuente_tipo as string,
    fuente_titulo: (p.fuente_titulo as string | null) ?? null,
    url_validada: (p.url_validada as string | null) ?? null,
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
    estado_auditoria: (p.estado_auditoria as string | null) ?? null,
    id_data: (p.id_data as string | null) ?? null,
    tipo_compania: (p.tipo_compania as string | null) ?? null,
    unidad_estandarizada: (p.unidad_estandarizada as string | null) ?? null,
    valor_estandarizado: (p.valor_estandarizado as number | null) ?? null,
  };
}

async function applyUpdate(
  tx: Tx,
  projectId: string,
  row: ParsedDiffRow,
): Promise<void> {
  const p = row.payload as Record<string, unknown>;
  await tx
    .update(evidencias)
    .set({
      kpi_id: row.kpi_id,
      indicador: (p.indicador as string | null) ?? null,
      categoria_efqm: (p.categoria_efqm as string | null) ?? null,
      pilar_ilunion: (p.pilar_ilunion as string | null) ?? null,
      entidad_fuente: (p.entidad_fuente as string | null) ?? null,
      fuente_nivel: (p.fuente_nivel as string | null) ?? null,
      fuente_tipo: p.fuente_tipo as string,
      fuente_titulo: (p.fuente_titulo as string | null) ?? null,
      url_validada: (p.url_validada as string | null) ?? null,
      valor_reportado: (p.valor_reportado as number | null) ?? null,
      unidad: (p.unidad as string | null) ?? null,
      comparabilidad: (p.comparabilidad as string | null) ?? null,
      observacion_metodologica:
        (p.observacion_metodologica as string | null) ?? null,
      decision_final: (p.decision_final as string | null) ?? null,
      definicion_referencia:
        (p.definicion_referencia as string | null) ?? null,
      unidad_base_referencia:
        (p.unidad_base_referencia as string | null) ?? null,
      indicador_fuente: (p.indicador_fuente as string | null) ?? null,
      encaje_indicador: (p.encaje_indicador as string | null) ?? null,
      estado_auditoria: (p.estado_auditoria as string | null) ?? null,
      id_data: (p.id_data as string | null) ?? null,
      tipo_compania: (p.tipo_compania as string | null) ?? null,
      unidad_estandarizada:
        (p.unidad_estandarizada as string | null) ?? null,
      valor_estandarizado:
        (p.valor_estandarizado as number | null) ?? null,
    })
    .where(
      and(
        eq(evidencias.project_id, projectId),
        eq(evidencias.codigo_indicador, row.codigo_indicador),
        eq(evidencias.empresa_comparable, row.empresa_comparable),
        eq(evidencias.ano, row.ano),
      ),
    );
}

// --- template / download / fetchers ---

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
    db.select().from(evidencias).where(eq(evidencias.project_id, projectId)),
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
