import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  buildStructure,
  columnLetter,
  letterToIndex,
} from "../lib/excel/kpis/structural.js";

function makeWorkbook(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    const ws = XLSX.utils.aoa_to_sheet(rows as unknown[][]);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("structural parser", () => {
  it("expone todas las hojas con su dimensión", () => {
    const buf = makeWorkbook({
      KPIs: [
        ["id", "name", "unit"],
        ["KPI_1", "Plantilla", "Personas"],
      ],
      Notas: [["nota"], ["…"]],
    });
    const s = buildStructure(buf);
    expect(s.sheets.map((x) => x.name).sort()).toEqual(["KPIs", "Notas"]);
    const kpis = s.sheets.find((x) => x.name === "KPIs")!;
    expect(kpis.rows).toBe(2);
    expect(kpis.cols).toBe(3);
  });

  it("produce header_signature determinístico", () => {
    const buf1 = makeWorkbook({
      KPIs: [
        ["id", "name", "unit"],
        ["KPI_1", "a", "b"],
      ],
    });
    const buf2 = makeWorkbook({
      KPIs: [
        ["id", "name", "unit"],
        ["KPI_2", "c", "d"],
      ],
    });
    const s1 = buildStructure(buf1);
    const s2 = buildStructure(buf2);
    expect(s1.sheets[0].header_signature).toBe(s2.sheets[0].header_signature);
  });

  it("cambia la firma cuando las cabeceras cambian", () => {
    const buf1 = makeWorkbook({
      KPIs: [["id", "name"]],
    });
    const buf2 = makeWorkbook({
      KPIs: [["código", "nombre"]],
    });
    const s1 = buildStructure(buf1);
    const s2 = buildStructure(buf2);
    expect(s1.sheets[0].header_signature).not.toBe(
      s2.sheets[0].header_signature,
    );
  });

  it("columnLetter ↔ letterToIndex son inversas", () => {
    for (let i = 0; i < 60; i++) {
      expect(letterToIndex(columnLetter(i))).toBe(i);
    }
  });
});
