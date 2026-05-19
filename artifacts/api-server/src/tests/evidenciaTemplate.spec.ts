import { describe, it, expect } from "vitest";
import { buildEvidenciasTemplate } from "../lib/excel/evidencias/template.js";
import { parseEvidenciasXlsx } from "../lib/excel/evidencias/parser.js";

describe("buildEvidenciasTemplate round-trip", () => {
  it("genera un XLSX que el parser lee con 0 cabeceras inválidas", async () => {
    const buffer = await buildEvidenciasTemplate({
      projectName: "Proyecto Demo",
      projectFramework: "EFQM 2025",
      kpis: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          project_id: "22222222-2222-2222-2222-222222222222",
          external_code: "KPI_1",
          name: "Plantilla total Personas",
          scope: "ILUNION",
          responsible_area: null,
          direction: null,
          comparable_companies: ["Eulen", "Clece"],
          standard_unit: "Personas",
          category: null,
          description: null,
          extra: null,
          created_at: new Date(),
          updated_at: new Date(),
          archived_at: null,
        },
      ],
    });

    expect(buffer.byteLength).toBeGreaterThan(1000);

    const parsed = parseEvidenciasXlsx(buffer);
    expect(parsed.headerErrors).toEqual([]);
    expect(parsed.valid).toEqual([]); // plantilla vacía
    expect(parsed.invalid).toEqual([]);
  });
});
