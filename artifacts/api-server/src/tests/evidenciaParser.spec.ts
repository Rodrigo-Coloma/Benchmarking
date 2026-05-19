import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseEvidenciasXlsx,
} from "../lib/excel/evidencias/parser.js";
import {
  COLUMNS,
  EVIDENCIAS_SHEET_NAME,
} from "../lib/excel/evidencias/schema.js";

function buildWorkbook(rows: Array<Array<unknown>>): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([
    COLUMNS.map((c) => c.header),
    ...rows,
  ]);
  XLSX.utils.book_append_sheet(wb, ws, EVIDENCIAS_SHEET_NAME);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("parseEvidenciasXlsx", () => {
  it("falla si la hoja 'evidencias' no existe", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["a", "b"]]);
    XLSX.utils.book_append_sheet(wb, ws, "otra");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    expect(() => parseEvidenciasXlsx(buf)).toThrow(/evidencias/);
  });

  it("reporta cabeceras incorrectas en la fila 1", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["wrong_header", ...COLUMNS.slice(1).map((c) => c.header)],
      ["k1", "Eulen", 2024, null, null, "EINF"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, EVIDENCIAS_SHEET_NAME);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const result = parseEvidenciasXlsx(buf);
    expect(result.headerErrors.length).toBeGreaterThan(0);
    expect(result.valid).toEqual([]);
  });

  it("parsea una fila válida mínima", () => {
    const row: unknown[] = new Array(COLUMNS.length).fill(null);
    row[0] = "KPI_1";
    row[1] = "Eulen";
    row[2] = 2024;
    row[5] = "EINF";

    const buf = buildWorkbook([row]);
    const result = parseEvidenciasXlsx(buf);

    expect(result.headerErrors).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].data.kpi_external_code).toBe("KPI_1");
    expect(result.valid[0].data.empresa_comparable).toBe("Eulen");
    expect(result.valid[0].data.ano).toBe(2024);
    expect(result.valid[0].data.fuente_tipo).toBe("EINF");
  });

  it("acepta números con coma decimal en valor_reportado", () => {
    const row: unknown[] = new Array(COLUMNS.length).fill(null);
    row[0] = "KPI_1";
    row[1] = "Eulen";
    row[2] = 2024;
    row[5] = "EINF";
    row[10] = "1.234,56";

    const result = parseEvidenciasXlsx(buildWorkbook([row]));
    expect(result.valid[0]?.data.valor_reportado).toBeCloseTo(1234.56, 2);
  });

  it("rechaza fuente_nivel fuera del enum", () => {
    const row: unknown[] = new Array(COLUMNS.length).fill(null);
    row[0] = "KPI_1";
    row[1] = "Eulen";
    row[2] = 2024;
    row[4] = "Nivel 9";   // fuera del enum
    row[5] = "EINF";

    const result = parseEvidenciasXlsx(buildWorkbook([row]));
    expect(result.valid).toEqual([]);
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors[0].column).toBe("E");
  });

  it("rechaza año fuera de rango", () => {
    const row: unknown[] = new Array(COLUMNS.length).fill(null);
    row[0] = "KPI_1";
    row[1] = "Eulen";
    row[2] = 1990;
    row[5] = "EINF";

    const result = parseEvidenciasXlsx(buildWorkbook([row]));
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors.some((e) => e.column === "C")).toBe(true);
  });

  it("rechaza URL no http(s)", () => {
    const row: unknown[] = new Array(COLUMNS.length).fill(null);
    row[0] = "KPI_1";
    row[1] = "Eulen";
    row[2] = 2024;
    row[5] = "EINF";
    row[7] = "ftp://example.com/file.pdf";

    const result = parseEvidenciasXlsx(buildWorkbook([row]));
    expect(result.invalid).toHaveLength(1);
    expect(result.invalid[0].errors.some((e) => e.column === "H")).toBe(true);
  });

  it("ignora filas completamente vacías", () => {
    const row1: unknown[] = new Array(COLUMNS.length).fill(null);
    row1[0] = "KPI_1";
    row1[1] = "Eulen";
    row1[2] = 2024;
    row1[5] = "EINF";
    const empty: unknown[] = new Array(COLUMNS.length).fill(null);
    const row3 = [...row1];
    row3[1] = "Clece";

    const result = parseEvidenciasXlsx(buildWorkbook([row1, empty, row3]));
    expect(result.valid).toHaveLength(2);
  });

  it("acumula errores por fila sin abortar el batch", () => {
    const ok: unknown[] = new Array(COLUMNS.length).fill(null);
    ok[0] = "KPI_1";
    ok[1] = "Eulen";
    ok[2] = 2024;
    ok[5] = "EINF";

    const bad = [...ok];
    bad[2] = "no-es-año";

    const result = parseEvidenciasXlsx(buildWorkbook([ok, bad]));
    expect(result.valid).toHaveLength(1);
    expect(result.invalid).toHaveLength(1);
  });
});
