import { z } from "zod";
import {
  getAnthropic,
  HAIKU_MODEL,
  estimateCost,
  type UsageMetrics,
} from "../../agents/anthropic.client.js";
import {
  letterToIndex,
  sampleToContextString,
  type WorkbookStructure,
} from "./structural.js";

/**
 * Descubridor IA (V3 §2.3 y §2.4). Recibe la estructura completa del workbook
 * y la descripción del proyecto, llama a Claude Haiku, valida el output con
 * Zod, y verifica que los campos referenciados existen en la hoja propuesta.
 *
 * En caso de validación post-respuesta fallida, reintenta UNA vez con
 * feedback. Si vuelve a fallar, devuelve el mejor mapping disponible con
 * `low_confidence=true` para que la UI fuerce revisión humana.
 */

const CANONICAL_FIELDS = [
  "external_code",
  "name",
  "scope",
  "responsible_area",
  "direction",
  "standard_unit",
  "comparable_companies",
  "category",
  "description",
] as const;
export type CanonicalField = (typeof CANONICAL_FIELDS)[number];

const ColumnMappingEntry = z.object({
  source_col: z
    .string()
    .regex(/^[A-Z]{1,3}$/, "source_col debe ser una letra de columna"),
  header: z.string(),
  confidence: z.number().min(0).max(1),
});

export type ColumnMappingEntry = z.infer<typeof ColumnMappingEntry>;

export const DiscoveredSchema = z.object({
  sheet: z.string().min(1),
  header_row: z.number().int().min(1).max(200),
  skip_rows: z.array(z.number().int().min(1)).default([]),
  column_mapping: z
    .record(z.string(), ColumnMappingEntry)
    .refine((m) => Boolean(m["external_code"]) && Boolean(m["name"]), {
      message: "external_code y name son obligatorios en el mapping",
    }),
  notes: z.string().default(""),
});

export type DiscoveredSchema = z.infer<typeof DiscoveredSchema>;

export interface DiscoverInput {
  project: {
    name: string;
    description: string;
    framework?: string | null;
  };
  workbook: WorkbookStructure;
}

export interface DiscoverResult {
  schema: DiscoveredSchema;
  low_confidence: boolean;
  usage: UsageMetrics;
  attempts: number;
  raw: string;
}

const SYSTEM_PROMPT = `Eres analista de datos especializado en frameworks de indicadores (EFQM, GRI, ESG, KPI corporativos).
Recibes una muestra de las primeras filas de cada hoja de un Excel y la descripción del proyecto.
Debes:
  1. Identificar qué hoja contiene el catálogo de KPIs (no datos puntuales ni resúmenes).
  2. Detectar la fila de cabeceras y filas a saltar (totales, secciones vacías).
  3. Mapear las columnas a este schema canónico:
       external_code       (obligatorio — código único del KPI)
       name                (obligatorio — nombre del indicador)
       scope               (opcional — alcance: "ILUNION", "Global", "España"…)
       responsible_area    (opcional — área responsable)
       direction           (opcional — "ASCENDENTE" / "DESCENDENTE" / "NEUTRO")
       standard_unit       (opcional — unidad estándar: "M€", "%", "Personas", "tCO2e"…)
       comparable_companies (opcional — lista de empresas peer; soporta separadores ";" o ",")
       category            (opcional — categoría EFQM/GRI/etc.)
       description         (opcional — descripción larga)
  4. Cualquier otra columna útil → mapearla a "extra.<nombre_normalizado>".
  5. Asignar confidence (0-1) a cada mapping.

Respondes SÓLO con un JSON válido conforme al schema indicado. Sin texto adicional. Sin comentarios. Si no estás seguro de un mapeo, omítelo (no inventes columnas inexistentes).`;

function buildUserPrompt(input: DiscoverInput, retryFeedback?: string): string {
  const sheetsBlock = input.workbook.sheets
    .map(
      (s) =>
        `Hoja "${s.name}" (${s.rows} filas × ${s.cols} columnas):\n` +
        sampleToContextString(s.sample),
    )
    .join("\n\n");

  const fb = retryFeedback
    ? `\n\nREINTENTO: la respuesta anterior contenía errores. Corrígelos:\n${retryFeedback}`
    : "";

  return `PROYECTO: "${input.project.name}"
FRAMEWORK: ${input.project.framework ?? "(no especificado)"}
DESCRIPCIÓN: ${input.project.description}

HOJAS DEL EXCEL:
${sheetsBlock}

Devuelve un JSON con:
{
  "sheet": "<nombre exacto de la hoja elegida>",
  "header_row": <número 1-indexed>,
  "skip_rows": [<números de filas a ignorar>],
  "column_mapping": {
    "<campo canónico>": {
      "source_col": "<letra de columna>",
      "header": "<texto exacto de la cabecera>",
      "confidence": <0..1>
    }
  },
  "notes": "<observaciones cortas>"
}${fb}`;
}

function extractJson(text: string): string {
  // Tolera fences ```json … ``` y respuestas con texto antes/después.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) return fenceMatch[1].trim();
  const objMatch = text.match(/\{[\s\S]*\}/);
  return (objMatch ? objMatch[0] : text).trim();
}

interface VerifyResult {
  ok: boolean;
  feedback: string;
  lowConfidence: boolean;
}

/**
 * Verifica que el mapping referencia columnas y headers reales de la hoja
 * elegida. Usa distancia Levenshtein ≤ 2 para tolerar typos en el header.
 */
function verifyAgainstWorkbook(
  schema: DiscoveredSchema,
  workbook: WorkbookStructure,
): VerifyResult {
  const sheet = workbook.sheets.find((s) => s.name === schema.sheet);
  if (!sheet) {
    return {
      ok: false,
      feedback: `La hoja "${schema.sheet}" no existe en el workbook. Hojas disponibles: ${workbook.sheets.map((s) => s.name).join(", ")}`,
      lowConfidence: true,
    };
  }

  const headerRow = sheet.sample[schema.header_row - 1] ?? [];
  const issues: string[] = [];
  let anyLow = false;

  for (const [field, entry] of Object.entries(schema.column_mapping)) {
    const colIdx = letterToIndex(entry.source_col);
    const actual = (headerRow[colIdx] ?? "").trim();
    if (!actual && entry.confidence > 0.6) {
      issues.push(
        `Columna ${entry.source_col} (mapeada a "${field}") está vacía en la fila ${schema.header_row}`,
      );
    } else if (
      actual &&
      levenshtein(actual.toLowerCase(), entry.header.toLowerCase()) > 2 &&
      entry.confidence > 0.6
    ) {
      issues.push(
        `Columna ${entry.source_col} declaró header "${entry.header}" pero la hoja tiene "${actual}"`,
      );
    }
    if (entry.confidence < 0.5) anyLow = true;
  }

  return {
    ok: issues.length === 0,
    feedback: issues.join("; "),
    lowConfidence: anyLow,
  };
}

export async function discoverKpiSchema(
  input: DiscoverInput,
): Promise<DiscoverResult> {
  const client = getAnthropic();
  const messages: { role: "user"; content: string }[] = [
    { role: "user", content: buildUserPrompt(input) },
  ];

  let totalIn = 0;
  let totalOut = 0;
  let raw = "";
  let lastError: string | undefined;

  for (let attempt = 1; attempt <= 2; attempt++) {
    const resp = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 2048,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages,
    });
    totalIn += resp.usage.input_tokens;
    totalOut += resp.usage.output_tokens;

    raw = resp.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    const jsonText = extractJson(raw);
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(jsonText);
    } catch (err) {
      lastError = `JSON inválido: ${(err as Error).message}`;
      messages.push({ role: "user", content: `Tu respuesta no era JSON válido. ${lastError}. Devuelve SOLO un objeto JSON.` });
      continue;
    }

    const parsed = DiscoveredSchema.safeParse(parsedJson);
    if (!parsed.success) {
      lastError = parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ");
      messages.push({ role: "user", content: `Tu JSON no cumple el schema esperado: ${lastError}. Corrige y vuelve a responder.` });
      continue;
    }

    const verify = verifyAgainstWorkbook(parsed.data, input.workbook);
    if (verify.ok) {
      return {
        schema: parsed.data,
        low_confidence: verify.lowConfidence,
        usage: estimateCost({
          input_tokens: totalIn,
          output_tokens: totalOut,
        }),
        attempts: attempt,
        raw,
      };
    }

    if (attempt === 2) {
      // Devolvemos el mapping aunque tenga issues, marcado como low_confidence.
      return {
        schema: parsed.data,
        low_confidence: true,
        usage: estimateCost({
          input_tokens: totalIn,
          output_tokens: totalOut,
        }),
        attempts: attempt,
        raw,
      };
    }
    messages.push({
      role: "user",
      content: `Problemas con el mapping: ${verify.feedback}. Corrige y vuelve a responder.`,
    });
  }

  throw new Error(
    `Descubridor IA falló tras 2 intentos. Último error: ${lastError ?? "desconocido"}`,
  );
}

// --- Levenshtein simple ---
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  const dp = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost,
      );
    }
  }
  return dp[a.length][b.length];
}
