import ExcelJS from "exceljs";
import {
  COLUMNS,
  COMPARABILIDAD,
  DECISION_FINAL,
  ENUMS_SHEET_NAME,
  EVIDENCIAS_SHEET_NAME,
  FUENTE_NIVEL,
  FUENTE_TIPO_HINTS,
  INSTRUCCIONES_SHEET_NAME,
  KPIS_SHEET_NAME,
} from "./schema.js";
import type { Kpi } from "@workspace/db";

const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};

/**
 * Genera la plantilla XLSX descargable (V3 §3.2). Contiene cuatro hojas:
 *
 *   - "evidencias"     : cabeceras en fila 1 con freeze + data validation
 *   - "instrucciones"  : descripción de cada columna y valores permitidos
 *   - "kpis"           : catálogo del proyecto, read-only (para consulta del usuario)
 *   - "enums"          : listas que alimentan las data validations
 */
export async function buildEvidenciasTemplate(opts: {
  projectName: string;
  projectFramework?: string | null;
  kpis: Kpi[];
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Asset Manager";
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  // --- evidencias ---
  const ev = wb.addWorksheet(EVIDENCIAS_SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ev.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.header,
    width: Math.min(Math.max(c.header.length + 4, 14), 36),
  }));
  ev.getRow(1).font = HEADER_FONT;
  ev.getRow(1).fill = HEADER_FILL;
  ev.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  // --- enums (oculta, alimenta validaciones) ---
  const enums = wb.addWorksheet(ENUMS_SHEET_NAME);
  enums.state = "hidden";
  enums.columns = [
    { header: "fuente_nivel", key: "fuente_nivel", width: 20 },
    { header: "comparabilidad", key: "comparabilidad", width: 20 },
    { header: "decision_final", key: "decision_final", width: 24 },
    { header: "fuente_tipo_hints", key: "fuente_tipo_hints", width: 24 },
  ];
  enums.getRow(1).font = { bold: true };
  const maxRows = Math.max(
    FUENTE_NIVEL.length,
    COMPARABILIDAD.length,
    DECISION_FINAL.length,
    FUENTE_TIPO_HINTS.length,
  );
  for (let i = 0; i < maxRows; i++) {
    enums.addRow({
      fuente_nivel: FUENTE_NIVEL[i] ?? null,
      comparabilidad: COMPARABILIDAD[i] ?? null,
      decision_final: DECISION_FINAL[i] ?? null,
      fuente_tipo_hints: FUENTE_TIPO_HINTS[i] ?? null,
    });
  }

  const enumRange = (col: string, len: number) =>
    `${ENUMS_SHEET_NAME}!$${col}$2:$${col}$${len + 1}`;

  // Aplicamos data validation a las primeras 5000 filas (suficiente para casos
  // reales; exceljs aplica la validación celda a celda).
  const DATA_ROWS = 5000;

  for (let r = 2; r <= DATA_ROWS + 1; r++) {
    ev.getCell(`E${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [enumRange("A", FUENTE_NIVEL.length)],
      showErrorMessage: true,
      errorTitle: "Valor no permitido",
      error: `Usa uno de: ${FUENTE_NIVEL.join(", ")}`,
    };
    ev.getCell(`M${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [enumRange("B", COMPARABILIDAD.length)],
      showErrorMessage: true,
      errorTitle: "Valor no permitido",
      error: `Usa uno de: ${COMPARABILIDAD.join(", ")}`,
    };
    ev.getCell(`O${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [enumRange("C", DECISION_FINAL.length)],
      showErrorMessage: true,
      errorTitle: "Valor no permitido",
      error: `Usa uno de: ${DECISION_FINAL.join(", ")}`,
    };
    // fuente_tipo es libre (string) pero damos pistas con un dropdown
    ev.getCell(`F${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: [enumRange("D", FUENTE_TIPO_HINTS.length)],
      showErrorMessage: false,
    };
    // ano: entero 2000-2099
    ev.getCell(`C${r}`).dataValidation = {
      type: "whole",
      operator: "between",
      allowBlank: true,
      formulae: [2000, 2099],
      showErrorMessage: true,
      errorTitle: "Año fuera de rango",
      error: "El año debe ser entero entre 2000 y 2099",
    };
  }

  // --- instrucciones ---
  const inst = wb.addWorksheet(INSTRUCCIONES_SHEET_NAME);
  inst.columns = [
    { header: "Columna", key: "letter", width: 10 },
    { header: "Nombre", key: "header", width: 28 },
    { header: "Obligatorio", key: "required", width: 14 },
    { header: "Descripción", key: "description", width: 80 },
  ];
  inst.getRow(1).font = HEADER_FONT;
  inst.getRow(1).fill = HEADER_FILL;

  inst.addRow({
    letter: "",
    header: `Proyecto: ${opts.projectName}`,
    required: opts.projectFramework ?? "",
    description: "Rellena la hoja 'evidencias'. NO modifiques cabeceras ni columnas.",
  });
  inst.addRow({});

  for (const col of COLUMNS) {
    inst.addRow({
      letter: col.letter,
      header: col.header,
      required: col.required ? "SÍ" : "no",
      description: col.description,
    });
  }

  // --- kpis (catálogo, read-only) ---
  const kpis = wb.addWorksheet(KPIS_SHEET_NAME);
  kpis.columns = [
    { header: "external_code", key: "external_code", width: 24 },
    { header: "name", key: "name", width: 60 },
    { header: "scope", key: "scope", width: 24 },
    { header: "standard_unit", key: "standard_unit", width: 18 },
    { header: "category", key: "category", width: 24 },
  ];
  kpis.getRow(1).font = HEADER_FONT;
  kpis.getRow(1).fill = HEADER_FILL;
  for (const k of opts.kpis) {
    kpis.addRow({
      external_code: k.external_code,
      name: k.name,
      scope: k.scope ?? "",
      standard_unit: k.standard_unit ?? "",
      category: k.category ?? "",
    });
  }
  kpis.protect("readonly", { selectLockedCells: true });

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}
