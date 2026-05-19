import * as XLSX from "xlsx";
import {
  COLUMNS,
  EvidenceRowSchema,
  EVIDENCIAS_SHEET_NAME,
  type EvidenceRow,
} from "./schema.js";

export interface ParseSuccessRow {
  row_number: number;        // 1-indexed (la cabecera es la fila 1)
  data: EvidenceRow;
}

export interface ParseErrorRow {
  row_number: number;
  errors: Array<{
    column: string;          // letra "A".."S"
    field: string;           // "kpi_external_code", etc.
    message: string;
  }>;
}

export interface ParseResult {
  valid: ParseSuccessRow[];
  invalid: ParseErrorRow[];
  headerErrors: string[];    // problemas con la fila 1
}

export class ExcelParseError extends Error {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = "ExcelParseError";
  }
}

/**
 * Parsea un buffer XLSX que sigue el schema fijo de V3 §3. Valida:
 *
 *   1. Existe la hoja `evidencias`.
 *   2. La fila 1 contiene exactamente las 19 cabeceras en su orden A..S.
 *   3. Cada fila ≥ 2 cumple el `EvidenceRowSchema` (Zod).
 *
 * No accede a la BBDD — sólo produce datos validados que el service consumirá
 * después para el diff/upsert.
 */
export function parseEvidenciasXlsx(buffer: Buffer): ParseResult {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  } catch (err) {
    throw new ExcelParseError("No se pudo leer el archivo XLSX", err);
  }

  const sheet = workbook.Sheets[EVIDENCIAS_SHEET_NAME];
  if (!sheet) {
    throw new ExcelParseError(
      `No se encontró la hoja obligatoria "${EVIDENCIAS_SHEET_NAME}"`,
    );
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
    raw: true,
  });

  const result: ParseResult = {
    valid: [],
    invalid: [],
    headerErrors: [],
  };

  if (rows.length === 0) {
    result.headerErrors.push("La hoja está vacía");
    return result;
  }

  const headerRow = (rows[0] ?? []) as Array<unknown>;
  for (const col of COLUMNS) {
    const got = String(headerRow[col.index] ?? "").trim();
    if (got !== col.header) {
      result.headerErrors.push(
        `Cabecera ${col.letter} esperaba "${col.header}", encontrado "${got}"`,
      );
    }
  }
  if (result.headerErrors.length > 0) return result;

  for (let r = 1; r < rows.length; r++) {
    const rawRow = (rows[r] ?? []) as Array<unknown>;
    if (rawRow.every((v) => v === null || v === undefined || v === "")) {
      continue; // fila completamente vacía → se ignora silenciosamente
    }
    const recordObject: Record<string, unknown> = {};
    for (const col of COLUMNS) {
      recordObject[col.header] = rawRow[col.index];
    }
    const parsed = EvidenceRowSchema.safeParse(recordObject);
    const rowNumber = r + 1; // XLSX es 1-indexed y la cabecera es la fila 1

    if (parsed.success) {
      result.valid.push({ row_number: rowNumber, data: parsed.data });
    } else {
      const errors: ParseErrorRow["errors"] = parsed.error.issues.map(
        (issue) => {
          const field = issue.path[0] as string | undefined;
          const col = COLUMNS.find((c) => c.header === field);
          return {
            column: col?.letter ?? "?",
            field: field ?? "?",
            message: issue.message,
          };
        },
      );
      result.invalid.push({ row_number: rowNumber, errors });
    }
  }

  return result;
}
