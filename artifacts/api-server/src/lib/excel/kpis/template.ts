import ExcelJS from "exceljs";

/**
 * Plantilla descargable de KPIs. Columnas exactamente alineadas con el schema
 * canónico, así el descubridor IA las mapea con 100 % confianza (o el parser
 * determinístico las acepta tal cual con un template cacheado).
 */
const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F2937" },
};
const HEADER_FONT: Partial<ExcelJS.Font> = {
  bold: true,
  color: { argb: "FFFFFFFF" },
};

export const KPI_TEMPLATE_COLUMNS = [
  {
    key: "external_code",
    header: "external_code",
    required: true,
    description: "Código único del KPI dentro del proyecto. Ej: L.1.1, EFQM.7.1.",
    example: "KPI_001",
  },
  {
    key: "name",
    header: "name",
    required: true,
    description: "Nombre legible del indicador.",
    example: "Plantilla total Personas",
  },
  {
    key: "description",
    header: "description",
    required: false,
    description: "Descripción extendida del indicador (se usa como contexto del LLM).",
    example: "Número total de personas en plantilla a 31 de diciembre.",
  },
  {
    key: "standard_unit",
    header: "standard_unit",
    required: false,
    description: "Unidad estandarizada: M€, EUR, Personas, %, tCO2e, horas/persona, etc.",
    example: "Personas",
  },
  {
    key: "comparable_companies",
    header: "comparable_companies",
    required: false,
    description: "Empresas peer separadas por `;` o `,`.",
    example: "Eulen; Clece; Sodexo España",
  },
  {
    key: "direction",
    header: "direction",
    required: false,
    description: "ASCENDENTE / DESCENDENTE / NEUTRO.",
    example: "ASCENDENTE",
  },
  {
    key: "scope",
    header: "scope",
    required: false,
    description: "Alcance: ILUNION, Corporativo, Global, España, etc.",
    example: "ILUNION",
  },
  {
    key: "responsible_area",
    header: "responsible_area",
    required: false,
    description: "Área responsable del KPI.",
    example: "Area Personas",
  },
  {
    key: "category",
    header: "category",
    required: false,
    description: "Categoría del framework (EFQM 1.1, GRI 2-7, …).",
    example: "EFQM 5.1",
  },
] as const;

export async function buildKpisTemplate(opts: {
  projectName: string;
  projectFramework?: string | null;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Asset Manager";
  wb.created = new Date();

  // --- kpis (la hoja principal a rellenar) ---
  const ws = wb.addWorksheet("kpis", {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ws.columns = KPI_TEMPLATE_COLUMNS.map((c) => ({
    header: c.header,
    key: c.key,
    width: Math.min(Math.max(c.header.length + 8, 18), 40),
  }));
  ws.getRow(1).font = HEADER_FONT;
  ws.getRow(1).fill = HEADER_FILL;
  ws.getRow(1).alignment = { vertical: "middle", horizontal: "center" };

  // Una fila de ejemplo para que el usuario vea el formato
  const exampleRow: Record<string, string> = {};
  for (const c of KPI_TEMPLATE_COLUMNS) exampleRow[c.key] = c.example;
  ws.addRow(exampleRow);

  // Estilo de la fila de ejemplo: italic gris para que se vea que es placeholder
  ws.getRow(2).font = { italic: true, color: { argb: "FF9CA3AF" } };

  // Data validation para `direction`
  const dirCol = String.fromCharCode(
    "A".charCodeAt(0) + KPI_TEMPLATE_COLUMNS.findIndex((c) => c.key === "direction"),
  );
  for (let r = 2; r <= 1000; r++) {
    ws.getCell(`${dirCol}${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"ASCENDENTE,DESCENDENTE,NEUTRO"'],
      showErrorMessage: true,
      errorTitle: "Valor no permitido",
      error: "Usa ASCENDENTE, DESCENDENTE o NEUTRO",
    };
  }

  // --- instrucciones ---
  const inst = wb.addWorksheet("instrucciones");
  inst.columns = [
    { header: "Columna", key: "header", width: 24 },
    { header: "Obligatorio", key: "required", width: 14 },
    { header: "Descripción", key: "description", width: 60 },
    { header: "Ejemplo", key: "example", width: 40 },
  ];
  inst.getRow(1).font = HEADER_FONT;
  inst.getRow(1).fill = HEADER_FILL;

  inst.addRow({
    header: `Proyecto: ${opts.projectName}`,
    required: opts.projectFramework ?? "",
    description:
      "Rellena la hoja `kpis` (puedes borrar la fila de ejemplo). " +
      "Después subes este Excel desde 'Importar desde Excel'.",
    example: "",
  });
  inst.addRow({});
  for (const c of KPI_TEMPLATE_COLUMNS) {
    inst.addRow({
      header: c.header,
      required: c.required ? "SÍ" : "no",
      description: c.description,
      example: c.example,
    });
  }

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}
