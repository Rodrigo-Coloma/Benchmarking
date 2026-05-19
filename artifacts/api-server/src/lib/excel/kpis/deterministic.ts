import * as XLSX from "xlsx";
import { z } from "zod";
import {
  letterToIndex,
  type WorkbookStructure,
} from "./structural.js";
import type { DiscoveredSchema } from "./discoverer.js";

const DIRECTION_ENUM = ["ASCENDENTE", "DESCENDENTE", "NEUTRO"] as const;

export const ParsedKpiSchema = z.object({
  external_code: z.string().min(1).max(80),
  name: z.string().min(1).max(300),
  scope: z.string().nullable(),
  responsible_area: z.string().nullable(),
  direction: z.enum(DIRECTION_ENUM).nullable(),
  standard_unit: z.string().nullable(),
  category: z.string().nullable(),
  description: z.string().nullable(),
  comparable_companies: z.array(z.string()).nullable(),
  extra: z.record(z.string(), z.unknown()).nullable(),
});
export type ParsedKpi = z.infer<typeof ParsedKpiSchema>;

export interface DeterministicRow {
  row_number: number;
  data: ParsedKpi;
}

export interface DeterministicError {
  row_number: number;
  message: string;
}

export interface DeterministicResult {
  rows: DeterministicRow[];
  errors: DeterministicError[];
}

/**
 * Aplica un `DiscoveredSchema` aprobado al buffer XLSX para producir las filas
 * de KPI listas para upsertar. No llama al LLM. Si una fila no cumple el
 * `ParsedKpiSchema` (sin external_code o sin name), se reporta como error
 * pero no aborta el batch.
 */
export function applyDeterministicMapping(
  buffer: Buffer,
  schema: DiscoveredSchema,
): DeterministicResult {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = wb.Sheets[schema.sheet];
  if (!sheet) {
    return {
      rows: [],
      errors: [
        {
          row_number: 0,
          message: `La hoja "${schema.sheet}" no existe en el workbook`,
        },
      ],
    };
  }
  const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: false,
  }) as Array<Array<unknown>>;

  const startIndex = schema.header_row; // raw[0] = fila 1, raw[header_row] = primera de datos
  const skip = new Set(schema.skip_rows);

  const rows: DeterministicRow[] = [];
  const errors: DeterministicError[] = [];

  for (let i = startIndex; i < raw.length; i++) {
    const rowNumber = i + 1;
    if (skip.has(rowNumber)) continue;
    const r = raw[i] ?? [];
    if (r.every((c) => c === null || c === undefined || String(c).trim() === ""))
      continue;

    const baseRecord: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};

    for (const [field, mapping] of Object.entries(schema.column_mapping)) {
      const colIdx = letterToIndex(mapping.source_col);
      const rawCell = r[colIdx];
      const value = normalizeCell(field, rawCell);
      if (field.startsWith("extra.")) {
        extra[field.slice("extra.".length)] = value;
      } else {
        baseRecord[field] = value;
      }
    }
    baseRecord.extra = Object.keys(extra).length > 0 ? extra : null;

    // Defaults para campos opcionales no mapeados.
    for (const k of [
      "scope",
      "responsible_area",
      "direction",
      "standard_unit",
      "category",
      "description",
      "comparable_companies",
    ]) {
      if (!(k in baseRecord)) baseRecord[k] = null;
    }

    const parsed = ParsedKpiSchema.safeParse(baseRecord);
    if (parsed.success) {
      rows.push({ row_number: rowNumber, data: parsed.data });
    } else {
      errors.push({
        row_number: rowNumber,
        message: parsed.error.issues
          .map((iss) => `${iss.path.join(".") || "?"}: ${iss.message}`)
          .join("; "),
      });
    }
  }

  return { rows, errors };
}

function normalizeCell(field: string, raw: unknown): unknown {
  if (raw === null || raw === undefined) return field === "comparable_companies" ? null : null;
  const s = String(raw).trim();
  if (s === "") return field === "comparable_companies" ? null : null;

  if (field === "comparable_companies") {
    return s
      .split(/[;,]/)
      .map((x) => x.trim())
      .filter((x) => x.length > 0);
  }
  if (field === "direction") {
    const u = s.toUpperCase();
    return (DIRECTION_ENUM as readonly string[]).includes(u) ? u : null;
  }
  return s;
}

/**
 * Verifica determinísticamente las cabeceras de la hoja contra el mapping
 * antes de aplicarlo. Se usa para auto-aplicar templates cacheados sólo si
 * siguen siendo válidos.
 */
export function mappingMatchesWorkbook(
  workbook: WorkbookStructure,
  schema: DiscoveredSchema,
): boolean {
  const sheet = workbook.sheets.find((s) => s.name === schema.sheet);
  if (!sheet) return false;
  const headerRow = sheet.sample[schema.header_row - 1] ?? [];
  for (const entry of Object.values(schema.column_mapping)) {
    const idx = letterToIndex(entry.source_col);
    const actual = (headerRow[idx] ?? "").toLowerCase().trim();
    if (actual !== entry.header.toLowerCase().trim()) return false;
  }
  return true;
}
