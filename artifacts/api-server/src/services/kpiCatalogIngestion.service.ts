import { and, count, eq, inArray } from "drizzle-orm";
import {
  evidencias,
  getDb,
  kpis as kpisTable,
  type IngestionRun,
  type Kpi,
  type KpiSchemaTemplate,
  type Tx,
} from "@workspace/db";
import {
  ConflictError,
  DomainError,
  NotFoundError,
} from "../lib/errors.js";
import { sha256 } from "../lib/hashing.js";
import { buildStructure, type WorkbookStructure } from "../lib/excel/kpis/structural.js";
import {
  discoverKpiSchema,
  DiscoveredSchema,
  type DiscoverResult,
} from "../lib/excel/kpis/discoverer.js";
import {
  applyDeterministicMapping,
  mappingMatchesWorkbook,
  type ParsedKpi,
} from "../lib/excel/kpis/deterministic.js";
import { buildKpiDiff } from "../lib/excel/kpis/differ.js";
import * as kpisRepo from "../repositories/kpis.repo.js";
import * as templatesRepo from "../repositories/kpiSchemaTemplates.repo.js";
import * as runsRepo from "../repositories/kpiIngestions.repo.js";

export interface UploadInput {
  projectId: string;
  userId: string;
  filename: string;
  fileBuffer: Buffer;
  project: {
    id: string;
    name: string;
    description: string;
    framework?: string | null;
  };
}

export interface PreviewResult {
  run: IngestionRun;
  needs_review: boolean;
  template_used: KpiSchemaTemplate | null;
  discovery?: {
    low_confidence: boolean;
    attempts: number;
    usage: DiscoverResult["usage"];
  };
}

interface DiffPayload {
  workbook_structure: {
    sheet_names: string[];
  };
  schema: DiscoveredSchema;
  parser_errors: Array<{ row_number: number; message: string }>;
  diff: ReturnType<typeof buildKpiDiff>;
  source: "template_cache" | "discoverer";
}

/**
 * Sube un XLSX. Si hay un template aprobado para el `header_signature` de la
 * primera hoja → lo aplicamos. Si no, llamamos al descubridor IA.
 *
 * Crea un `kpi_ingestion_runs` row con status="previewed" y persiste el diff
 * + el mapping propuesto en `diff` (jsonb). El usuario lo confirma luego con
 * /commit, momento en el que también se persiste el template en
 * `kpi_schema_templates` (si vino del descubridor) o se incrementa su
 * `uses_count` (si vino del cache).
 */
export async function previewIngestion(
  input: UploadInput,
): Promise<PreviewResult> {
  const db = getDb();
  const file_hash = sha256(input.fileBuffer.toString("base64"));

  const previousRuns = await runsRepo.listByProject(db, input.projectId);
  const sameHashCommitted = previousRuns.find(
    (p) => p.file_hash === file_hash && p.status === "committed",
  );
  if (sameHashCommitted) {
    throw new ConflictError(
      "EXCEL_NO_CHANGES",
      "Este archivo ya fue committeado anteriormente",
      { previousRunId: sameHashCommitted.id },
    );
  }

  let workbook: WorkbookStructure;
  try {
    workbook = buildStructure(input.fileBuffer);
  } catch (err) {
    throw new DomainError(
      "EXCEL_PARSE_FAILED",
      `No se pudo leer el archivo: ${(err as Error).message}`,
      422,
    );
  }
  if (workbook.sheets.length === 0) {
    throw new DomainError(
      "EXCEL_PARSE_FAILED",
      "El archivo no contiene hojas",
      422,
    );
  }

  // 1. Buscar template cacheado por header_signature de CUALQUIERA de las hojas.
  let templateUsed: KpiSchemaTemplate | null = null;
  let schema: DiscoveredSchema | null = null;
  let discovery: PreviewResult["discovery"];
  let source: DiffPayload["source"] = "discoverer";

  for (const s of workbook.sheets) {
    const cached = await templatesRepo.findByProjectAndSignature(
      db,
      input.projectId,
      s.header_signature,
    );
    if (cached) {
      const cachedSchema = DiscoveredSchema.safeParse(buildSchemaFromTemplate(cached));
      if (cachedSchema.success && mappingMatchesWorkbook(workbook, cachedSchema.data)) {
        templateUsed = cached;
        schema = cachedSchema.data;
        source = "template_cache";
        break;
      }
    }
  }

  // 2. Si no había template aplicable, llamar al descubridor IA.
  if (!schema) {
    const result = await discoverKpiSchema({
      project: {
        name: input.project.name,
        description: input.project.description,
        framework: input.project.framework,
      },
      workbook,
    });
    schema = result.schema;
    discovery = {
      low_confidence: result.low_confidence,
      attempts: result.attempts,
      usage: result.usage,
    };
  }

  // 3. Aplicar mapping determinístico y diff.
  const parsed = applyDeterministicMapping(input.fileBuffer, schema);
  const evidenceCountByKpi = await countEvidencesPerKpi(
    db,
    input.projectId,
  );
  const currentCatalog = await kpisRepo.listByProject(db, input.projectId, {
    includeArchived: false,
  });
  const diff = buildKpiDiff({
    current: currentCatalog,
    parsed: parsed.rows.map((r) => r.data),
    evidenceCountByKpiId: evidenceCountByKpi,
  });

  const diffPayload: DiffPayload = {
    workbook_structure: {
      sheet_names: workbook.sheets.map((s) => s.name),
    },
    schema,
    parser_errors: parsed.errors,
    diff,
    source,
  };

  const summary = {
    filename: input.filename,
    file_hash,
    source,
    template_id: templateUsed?.id ?? null,
    discovery,
    diff: diff.summary,
    parser_errors: parsed.errors.length,
    needs_review: Boolean(discovery?.low_confidence),
  };

  const run = await runsRepo.insert(db, {
    project_id: input.projectId,
    user_id: input.userId,
    filename: input.filename,
    file_hash,
    status: "previewed",
    summary: summary as never,
    diff: diffPayload as never,
  });

  return {
    run,
    needs_review: Boolean(discovery?.low_confidence),
    template_used: templateUsed,
    discovery,
  };
}

/**
 * Aplica el diff a la BBDD + persiste / actualiza el `kpi_schema_templates`
 * correspondiente. Todo en una sola transacción.
 *
 * `removed` se materializa como soft-delete (`archived_at = now()`) — nunca
 * se hace DELETE físico para preservar evidencias asociadas (V3 §5).
 */
export async function commitIngestion(opts: {
  projectId: string;
  runId: string;
  userId: string;
  /**
   * Permite al usuario sobrescribir partes del schema antes de aplicarlo
   * (p.ej. tras revisar el mapeo en la UI). Si no se pasa, se usa el schema
   * persistido en el run.
   */
  overrideSchema?: DiscoveredSchema;
  acceptedChanges?: {
    add?: string[];
    update?: string[];
    remove?: string[];
  };
}): Promise<{ summary: unknown; applied: boolean }> {
  const db = getDb();
  const run = await runsRepo.findById(db, opts.projectId, opts.runId);
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

  const payload = run.diff as unknown as DiffPayload;
  const schema = opts.overrideSchema ?? payload.schema;
  const diff = payload.diff;

  const acceptedAdd = opts.acceptedChanges?.add;
  const acceptedUpdate = opts.acceptedChanges?.update;
  const acceptedRemove = opts.acceptedChanges?.remove;
  const isAcceptedAdd = (code: string) =>
    !acceptedAdd || acceptedAdd.includes(code);
  const isAcceptedUpdate = (code: string) =>
    !acceptedUpdate || acceptedUpdate.includes(code);
  const isAcceptedRemove = (code: string) =>
    !acceptedRemove || acceptedRemove.includes(code);

  const applied = await db.transaction(async (tx) => {
    for (const row of diff.rows) {
      if (row.kind === "new" && row.parsed && isAcceptedAdd(row.external_code)) {
        await kpisRepo.insert(tx, {
          project_id: opts.projectId,
          external_code: row.external_code,
          name: row.parsed.name,
          scope: row.parsed.scope,
          responsible_area: row.parsed.responsible_area,
          direction: row.parsed.direction,
          standard_unit: row.parsed.standard_unit,
          category: row.parsed.category,
          description: row.parsed.description,
          comparable_companies: row.parsed.comparable_companies ?? null,
          extra: row.parsed.extra,
        });
      } else if (
        row.kind === "updated" &&
        row.current &&
        row.parsed &&
        isAcceptedUpdate(row.external_code)
      ) {
        await kpisRepo.update(tx, row.current.id, {
          name: row.parsed.name,
          scope: row.parsed.scope,
          responsible_area: row.parsed.responsible_area,
          direction: row.parsed.direction,
          standard_unit: row.parsed.standard_unit,
          category: row.parsed.category,
          description: row.parsed.description,
          comparable_companies: row.parsed.comparable_companies ?? null,
          extra: row.parsed.extra,
        });
      } else if (
        row.kind === "removed" &&
        row.current &&
        isAcceptedRemove(row.external_code)
      ) {
        await kpisRepo.archive(tx, row.current.id);
      }
    }

    // Persistir / refrescar template cacheado
    await templatesRepo.upsert(tx, {
      project_id: opts.projectId,
      header_signature: computeSignatureForSchema(schema, payload),
      sheet_name: schema.sheet,
      header_row: schema.header_row,
      column_mapping: schema.column_mapping,
      skip_rows: schema.skip_rows ?? [],
      notes: schema.notes,
      created_by: opts.userId,
    });

    const committedRun = await runsRepo.markCommitted(tx, opts.runId, {
      ...(run.summary as Record<string, unknown>),
      committed_at: new Date().toISOString(),
    });
    return committedRun;
  });

  return { summary: applied.summary, applied: true };
}

export async function discardIngestion(
  projectId: string,
  runId: string,
): Promise<void> {
  const db = getDb();
  const run = await runsRepo.findById(db, projectId, runId);
  if (!run) {
    throw new NotFoundError(
      "INGESTION_NOT_FOUND",
      "No se encontró esa ingesta",
    );
  }
  if (run.status === "committed") {
    throw new ConflictError(
      "EXCEL_NO_CHANGES",
      "No se puede descartar una ingesta ya committeada",
    );
  }
  await runsRepo.markDiscarded(db, runId);
}

export async function listRuns(projectId: string) {
  const db = getDb();
  return runsRepo.listByProject(db, projectId);
}

export async function getRun(projectId: string, runId: string) {
  const db = getDb();
  const run = await runsRepo.findById(db, projectId, runId);
  if (!run) {
    throw new NotFoundError(
      "INGESTION_NOT_FOUND",
      "No se encontró esa ingesta",
    );
  }
  return run;
}

export async function listTemplates(projectId: string) {
  const db = getDb();
  return templatesRepo.listByProject(db, projectId);
}

// --- helpers ---

async function countEvidencesPerKpi(
  exec: Tx | ReturnType<typeof getDb>,
  projectId: string,
): Promise<Map<string, number>> {
  const rows = await exec
    .select({
      kpi_id: evidencias.kpi_id,
      n: count(evidencias.id),
    })
    .from(evidencias)
    .where(eq(evidencias.project_id, projectId))
    .groupBy(evidencias.kpi_id);
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.kpi_id) m.set(r.kpi_id, Number(r.n));
  }
  return m;
}

function buildSchemaFromTemplate(t: KpiSchemaTemplate): unknown {
  return {
    sheet: t.sheet_name,
    header_row: t.header_row,
    skip_rows: t.skip_rows ?? [],
    column_mapping: t.column_mapping,
    notes: t.notes ?? "",
  };
}

/**
 * Si el schema vino del descubridor, recomputamos la firma a partir de las
 * cabeceras detectadas en su `column_mapping`. Si vino de un template,
 * conservamos la firma del template original.
 */
function computeSignatureForSchema(
  schema: DiscoveredSchema,
  _payload: DiffPayload,
): string {
  // Concatenamos source_col→header en orden alfabético de source_col.
  const entries = Object.values(schema.column_mapping)
    .map((m) => `${m.source_col}=${m.header.toLowerCase()}`)
    .sort();
  return sha256(entries.join("|"));
}

// re-export tipos útiles para los handlers
export { applyDeterministicMapping } from "../lib/excel/kpis/deterministic.js";
export type { ParsedKpi };
