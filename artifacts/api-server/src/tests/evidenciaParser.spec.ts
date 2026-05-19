import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseEvidenciasXlsx } from "../lib/excel/evidencias/parser.js";
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

function row(overrides: Record<string, unknown> = {}): unknown[] {
  const base: Record<string, unknown> = {
    id: null,
    empresa_comparable: "Ibercaja",
    entidad_fuente: "Ibercaja Banco, S.A.",
    ano: 2024,
    codigo_indicador: "AD_HOC_C7_ROTACION_PERSONAS",
    indicador: "Tasa de rotación de personas",
    categoria_efqm: "C7 Personas",
    pilar_ilunion: null,
    fuente_nivel: "Nivel 1",
    fuente_tipo: "Informe de gestión consolidado",
    fuente_titulo: "Informe 2024",
    url_validada: null,
    valor_reportado: 6.87,
    unidad: "%",
    comparabilidad: "Media",
    observacion_metodologica: null,
    decision_final: "REVISAR",
    definicion_referencia: null,
    unidad_base_referencia: null,
    indicador_fuente: null,
    encaje_indicador: null,
    estado_auditoria: "Si",
    id_data: "22",
    tipo_compania: "Entidad financiera",
    unidad_estandarizada: "%",
    valor_estandarizado: 6.87,
    ...overrides,
  };
  return COLUMNS.map((c) => base[c.header] ?? null);
}

describe("parseEvidenciasXlsx (26 columnas)", () => {
  it("falla si la hoja 'Evidencias' no existe", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["a", "b"]]);
    XLSX.utils.book_append_sheet(wb, ws, "otra");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    expect(() => parseEvidenciasXlsx(buf)).toThrow(/Evidencias/);
  });

  it("reporta cabeceras incorrectas en la fila 1", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["wrong_header", ...COLUMNS.slice(1).map((c) => c.header)],
      row(),
    ]);
    XLSX.utils.book_append_sheet(wb, ws, EVIDENCIAS_SHEET_NAME);
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    const result = parseEvidenciasXlsx(buf);
    expect(result.headerErrors.length).toBeGreaterThan(0);
  });

  it("parsea una fila válida con los 26 campos", () => {
    const buf = buildWorkbook([row()]);
    const result = parseEvidenciasXlsx(buf);
    expect(result.headerErrors).toEqual([]);
    expect(result.invalid).toEqual([]);
    expect(result.valid).toHaveLength(1);
    const r = result.valid[0].data;
    expect(r.codigo_indicador).toBe("AD_HOC_C7_ROTACION_PERSONAS");
    expect(r.empresa_comparable).toBe("Ibercaja");
    expect(r.ano).toBe(2024);
    expect(r.valor_reportado).toBe(6.87);
    expect(r.decision_final).toBe("REVISAR");
    expect(r.unidad_estandarizada).toBe("%");
    expect(r.valor_estandarizado).toBe(6.87);
    expect(r.id_data).toBe("22");
  });

  it("acepta el enum REVISAR de tu Excel real", () => {
    const buf = buildWorkbook([row({ decision_final: "REVISAR" })]);
    const result = parseEvidenciasXlsx(buf);
    expect(result.valid[0].data.decision_final).toBe("REVISAR");
  });

  it("rechaza decision_final fuera del enum", () => {
    const buf = buildWorkbook([row({ decision_final: "XYZ" })]);
    const result = parseEvidenciasXlsx(buf);
    expect(result.invalid).toHaveLength(1);
  });

  it("ignora la columna id si está vacía", () => {
    const buf = buildWorkbook([row({ id: null })]);
    const result = parseEvidenciasXlsx(buf);
    expect(result.valid).toHaveLength(1);
    expect(result.valid[0].data.id).toBeNull();
  });

  it("respeta la columna id cuando viene rellena", () => {
    const buf = buildWorkbook([row({ id: 136 })]);
    const result = parseEvidenciasXlsx(buf);
    expect(result.valid[0].data.id).toBe(136);
  });

  it("rechaza codigo_indicador vacío (obligatorio)", () => {
    const buf = buildWorkbook([row({ codigo_indicador: "" })]);
    const result = parseEvidenciasXlsx(buf);
    expect(result.invalid).toHaveLength(1);
  });
});
