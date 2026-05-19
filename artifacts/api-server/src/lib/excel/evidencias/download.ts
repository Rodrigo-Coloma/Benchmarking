import ExcelJS from "exceljs";
import { COLUMNS, EVIDENCIAS_SHEET_NAME, KPIS_SHEET_NAME } from "./schema.js";
import type { Evidencia, Kpi } from "@workspace/db";

/**
 * Export simétrico: mismas 26 columnas que el template para que el usuario
 * pueda descargar, editar en local y resubir sin fricciones.
 */
export async function buildEvidenciasDownload(opts: {
  projectName: string;
  evidencias: Evidencia[];
  kpisById: Map<string, Kpi>;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Asset Manager";
  wb.created = new Date();

  const ev = wb.addWorksheet(EVIDENCIAS_SHEET_NAME, {
    views: [{ state: "frozen", ySplit: 1 }],
  });
  ev.columns = COLUMNS.map((c) => ({
    header: c.header,
    key: c.header,
    width: Math.min(Math.max(c.header.length + 4, 14), 36),
  }));
  ev.getRow(1).font = { bold: true };

  for (const e of opts.evidencias) {
    const kpi = e.kpi_id ? opts.kpisById.get(e.kpi_id) : undefined;
    ev.addRow({
      id: e.id,
      empresa_comparable: e.empresa_comparable,
      entidad_fuente: e.entidad_fuente ?? "",
      ano: e.ano ?? null,
      codigo_indicador: e.codigo_indicador ?? kpi?.external_code ?? "",
      indicador: e.indicador ?? kpi?.name ?? "",
      categoria_efqm: e.categoria_efqm ?? "",
      pilar_ilunion: e.pilar_ilunion ?? "",
      fuente_nivel: e.fuente_nivel ?? "",
      fuente_tipo: e.fuente_tipo,
      fuente_titulo: e.fuente_titulo ?? "",
      url_validada: e.url_validada ?? "",
      valor_reportado: e.valor_reportado ?? null,
      unidad: e.unidad ?? "",
      comparabilidad: e.comparabilidad ?? "",
      observacion_metodologica: e.observacion_metodologica ?? "",
      decision_final: e.decision_final ?? "",
      definicion_referencia: e.definicion_referencia ?? "",
      unidad_base_referencia: e.unidad_base_referencia ?? "",
      indicador_fuente: e.indicador_fuente ?? "",
      encaje_indicador: e.encaje_indicador ?? "",
      estado_auditoria: e.estado_auditoria ?? "",
      id_data: e.id_data ?? "",
      tipo_compania: e.tipo_compania ?? "",
      unidad_estandarizada: e.unidad_estandarizada ?? "",
      valor_estandarizado: e.valor_estandarizado ?? null,
    });
  }

  const kpis = wb.addWorksheet(KPIS_SHEET_NAME);
  kpis.columns = [
    { header: "external_code", key: "external_code", width: 32 },
    { header: "name", key: "name", width: 60 },
    { header: "standard_unit", key: "standard_unit", width: 18 },
  ];
  kpis.getRow(1).font = { bold: true };
  for (const k of opts.kpisById.values()) {
    kpis.addRow({
      external_code: k.external_code,
      name: k.name,
      standard_unit: k.standard_unit ?? "",
    });
  }

  const meta = wb.addWorksheet("metadata");
  meta.addRow(["project", opts.projectName]);
  meta.addRow(["generated_at", new Date().toISOString()]);
  meta.addRow(["row_count", opts.evidencias.length]);

  const ab = await wb.xlsx.writeBuffer();
  return Buffer.from(ab as ArrayBuffer);
}
