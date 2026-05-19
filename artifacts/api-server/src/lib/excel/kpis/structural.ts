import * as XLSX from "xlsx";
import { createHash } from "node:crypto";

export interface SheetSample {
  name: string;
  rows: number;
  cols: number;
  /**
   * Primeras N filas × M columnas como strings (sin formatear). Sirve para
   * mandar como contexto al LLM o para que el deterministicParser localice
   * la fila de cabecera.
   */
  sample: string[][];
  /**
   * Sha256 calculado sobre las cabeceras "más probables" — todas las celdas
   * de la primera fila no vacía. Si el usuario re-sube un Excel con el mismo
   * formato, este hash será idéntico y podremos reutilizar el template.
   */
  header_signature: string;
  header_guess_row: number; // 1-indexed
}

export interface WorkbookStructure {
  sheets: SheetSample[];
}

const MAX_SAMPLE_ROWS = 30;
const MAX_SAMPLE_COLS = 30;

/**
 * Carga el workbook completo y produce una "muestra estructural" por hoja:
 * dimensiones, primeras 30 filas × 30 columnas como strings y una firma
 * estable de cabeceras. No realiza ningún juicio semántico — sólo extrae datos
 * crudos que el descubridor IA o el parser determinístico consumirán.
 */
export function buildStructure(buffer: Buffer): WorkbookStructure {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });

  const sheets: SheetSample[] = [];
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet) continue;
    const ref = sheet["!ref"];
    if (!ref) {
      sheets.push({
        name,
        rows: 0,
        cols: 0,
        sample: [],
        header_signature: emptyHash(name),
        header_guess_row: 1,
      });
      continue;
    }

    const range = XLSX.utils.decode_range(ref);
    const rows = range.e.r - range.s.r + 1;
    const cols = range.e.c - range.s.c + 1;

    const raw = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: null,
      blankrows: false,
      raw: false,
    }) as Array<Array<unknown>>;

    const limitedRows = raw.slice(0, MAX_SAMPLE_ROWS);
    const sample = limitedRows.map((r) =>
      Array.from({ length: Math.min(cols, MAX_SAMPLE_COLS) }, (_, i) =>
        normalizeCell(r[i]),
      ),
    );

    const { signature, headerRow } = computeHeaderSignature(sample);
    sheets.push({
      name,
      rows,
      cols,
      sample,
      header_signature: signature,
      header_guess_row: headerRow,
    });
  }

  return { sheets };
}

function normalizeCell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * Busca la primera fila con ≥ 3 celdas no vacías como candidato natural de
 * cabecera y firma sus contenidos normalizados.
 */
function computeHeaderSignature(sample: string[][]): {
  signature: string;
  headerRow: number;
} {
  for (let i = 0; i < sample.length; i++) {
    const row = sample[i] ?? [];
    const filled = row.filter((c) => c !== "").length;
    if (filled >= 3) {
      const sig = createHash("sha256")
        .update(row.map((c) => c.toLowerCase()).join("|"))
        .digest("hex");
      return { signature: sig, headerRow: i + 1 };
    }
  }
  return { signature: emptyHash("empty"), headerRow: 1 };
}

function emptyHash(label: string): string {
  return createHash("sha256")
    .update("empty:" + label)
    .digest("hex");
}

/** Convierte la muestra a una tabla CSV-like prefijada con A/B/C/... + nº de fila. */
export function sampleToContextString(sample: string[][]): string {
  if (sample.length === 0) return "(hoja vacía)";
  const colCount = Math.max(...sample.map((r) => r.length));
  const headerLine =
    "    | " +
    Array.from({ length: colCount }, (_, i) => columnLetter(i)).join(" | ");
  const lines = [headerLine];
  for (let i = 0; i < sample.length; i++) {
    const row = sample[i] ?? [];
    const cells = Array.from(
      { length: colCount },
      (_, j) => row[j] ?? "",
    );
    lines.push(
      String(i + 1).padStart(3, " ") + " | " + cells.join(" | "),
    );
  }
  return lines.join("\n");
}

export function columnLetter(idx0: number): string {
  let s = "";
  let n = idx0;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

export function letterToIndex(letter: string): number {
  let n = 0;
  for (const ch of letter.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n - 1;
}
