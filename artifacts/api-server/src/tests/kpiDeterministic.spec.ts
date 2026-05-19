import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  applyDeterministicMapping,
  mappingMatchesWorkbook,
} from "../lib/excel/kpis/deterministic.js";
import { buildStructure } from "../lib/excel/kpis/structural.js";
import { buildKpiDiff } from "../lib/excel/kpis/differ.js";
import type { Kpi } from "@workspace/db";

function makeWb(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, "KPIs");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

const sampleMapping = {
  sheet: "KPIs",
  header_row: 1,
  skip_rows: [],
  notes: "",
  column_mapping: {
    external_code: { source_col: "A", header: "id", confidence: 0.99 },
    name: { source_col: "B", header: "indicator", confidence: 0.99 },
    standard_unit: { source_col: "C", header: "unit", confidence: 0.9 },
    comparable_companies: { source_col: "D", header: "peers", confidence: 0.8 },
    direction: { source_col: "E", header: "direction", confidence: 0.8 },
  },
};

describe("deterministic parser", () => {
  it("aplica un mapping aprobado y parsea filas válidas", () => {
    const buf = makeWb([
      ["id", "indicator", "unit", "peers", "direction"],
      ["KPI_1", "Plantilla", "Personas", "Eulen; Clece", "ASCENDENTE"],
      ["KPI_2", "EBITDA", "M€", "Iberdrola, Endesa", "ASCENDENTE"],
    ]);
    const result = applyDeterministicMapping(buf, sampleMapping);
    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].data.external_code).toBe("KPI_1");
    expect(result.rows[0].data.comparable_companies).toEqual(["Eulen", "Clece"]);
    expect(result.rows[1].data.comparable_companies).toEqual([
      "Iberdrola",
      "Endesa",
    ]);
    expect(result.rows[0].data.direction).toBe("ASCENDENTE");
  });

  it("acumula errores cuando falta external_code", () => {
    const buf = makeWb([
      ["id", "indicator", "unit", "peers", "direction"],
      ["", "Sin código", "Personas", "Eulen", "ASCENDENTE"],
    ]);
    const result = applyDeterministicMapping(buf, sampleMapping);
    expect(result.rows).toEqual([]);
    expect(result.errors).toHaveLength(1);
  });

  it("respeta skip_rows", () => {
    const buf = makeWb([
      ["id", "indicator", "unit", "peers", "direction"],
      ["totales", "—", "—", "", ""],
      ["KPI_1", "Plantilla", "Personas", "Eulen", "ASCENDENTE"],
    ]);
    const result = applyDeterministicMapping(buf, {
      ...sampleMapping,
      skip_rows: [2],
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].data.external_code).toBe("KPI_1");
  });

  it("normaliza direction inválida a null", () => {
    const buf = makeWb([
      ["id", "indicator", "unit", "peers", "direction"],
      ["KPI_1", "x", null, null, "????"],
    ]);
    const result = applyDeterministicMapping(buf, sampleMapping);
    expect(result.rows[0].data.direction).toBeNull();
  });

  it("mappingMatchesWorkbook devuelve true cuando cabeceras coinciden", () => {
    const buf = makeWb([
      ["id", "indicator", "unit", "peers", "direction"],
      ["KPI_1", "x", "u", null, null],
    ]);
    const struct = buildStructure(buf);
    expect(mappingMatchesWorkbook(struct, sampleMapping)).toBe(true);
  });

  it("mappingMatchesWorkbook devuelve false si cabeceras cambian", () => {
    const buf = makeWb([
      ["codigo", "indicator", "unit", "peers", "direction"],
      ["KPI_1", "x", "u", null, null],
    ]);
    const struct = buildStructure(buf);
    expect(mappingMatchesWorkbook(struct, sampleMapping)).toBe(false);
  });
});

describe("kpi differ", () => {
  function k(overrides: Partial<Kpi> = {}): Kpi {
    return {
      id: overrides.id ?? crypto.randomUUID(),
      project_id: "p1",
      external_code: overrides.external_code ?? "KPI_X",
      name: overrides.name ?? "x",
      scope: overrides.scope ?? null,
      responsible_area: overrides.responsible_area ?? null,
      direction: overrides.direction ?? null,
      standard_unit: overrides.standard_unit ?? null,
      category: overrides.category ?? null,
      description: overrides.description ?? null,
      comparable_companies: overrides.comparable_companies ?? null,
      extra: overrides.extra ?? null,
      created_at: new Date(),
      updated_at: new Date(),
      archived_at: null,
    };
  }

  it("clasifica new / updated / unchanged / removed", () => {
    const current: Kpi[] = [
      k({ external_code: "KEEP", name: "igual" }),
      k({ external_code: "CHANGE", name: "antes" }),
      k({ external_code: "GONE", name: "se quita" }),
    ];
    const diff = buildKpiDiff({
      current,
      parsed: [
        {
          external_code: "KEEP",
          name: "igual",
          scope: null,
          responsible_area: null,
          direction: null,
          standard_unit: null,
          category: null,
          description: null,
          comparable_companies: null,
          extra: null,
        },
        {
          external_code: "CHANGE",
          name: "ahora",
          scope: null,
          responsible_area: null,
          direction: null,
          standard_unit: null,
          category: null,
          description: null,
          comparable_companies: null,
          extra: null,
        },
        {
          external_code: "NEW",
          name: "soy nuevo",
          scope: null,
          responsible_area: null,
          direction: null,
          standard_unit: null,
          category: null,
          description: null,
          comparable_companies: null,
          extra: null,
        },
      ],
    });
    expect(diff.summary).toMatchObject({
      new: 1,
      updated: 1,
      unchanged: 1,
      removed: 1,
    });
  });
});
