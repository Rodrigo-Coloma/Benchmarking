import { z } from "zod";

/**
 * Schema fijo del Excel de evidencias (V3 §3). 19 columnas A..S, sin
 * tolerancia a variaciones de orden o nombre. Toda la validación de tipos vive
 * aquí; los mensajes de error se traducen a la celda exacta al ejecutar el
 * parser (ver parser.ts).
 */

export const FUENTE_NIVEL = [
  "Nivel 1",
  "Nivel 2",
  "Nivel 3",
  "Nivel 4",
  "Nivel 5",
] as const;

export const COMPARABILIDAD = [
  "Alta",
  "Media",
  "Baja",
  "No comparable",
] as const;

export const DECISION_FINAL = [
  "OK",
  "PREVALIDADO IA",
  "DESCARTAR",
  "REVISION MANUAL",
  "NUEVA",
  "Pendiente",
  "No aplica",
] as const;

export const FUENTE_TIPO_HINTS = [
  "EINF",
  "Web corporativa",
  "Certificación",
  "Prensa",
  "Estimación",
  "Otro",
];

export interface ColumnDef {
  letter: string;       // "A", "B", …
  index: number;        // 0-indexed (A=0)
  header: string;       // string esperado en fila 1
  required: boolean;
  description: string;
}

export const COLUMNS: ColumnDef[] = [
  { letter: "A", index: 0,  header: "kpi_external_code",      required: true,  description: "Código del KPI en el catálogo del proyecto." },
  { letter: "B", index: 1,  header: "empresa_comparable",     required: true,  description: "Nombre de la empresa peer (máx 200 chars)." },
  { letter: "C", index: 2,  header: "ano",                    required: true,  description: "Año del dato (2000–2099)." },
  { letter: "D", index: 3,  header: "entidad_fuente",         required: false, description: "Organismo/empresa fuente." },
  { letter: "E", index: 4,  header: "fuente_nivel",           required: false, description: "Nivel 1..Nivel 5." },
  { letter: "F", index: 5,  header: "fuente_tipo",            required: true,  description: "EINF / Web corporativa / Certificación / Prensa / Estimación / Otro." },
  { letter: "G", index: 6,  header: "fuente_titulo",          required: false, description: "Título de la fuente." },
  { letter: "H", index: 7,  header: "url_validada",           required: false, description: "URL absoluta (http(s)://)." },
  { letter: "I", index: 8,  header: "ubicacion_fuente",       required: false, description: "p. 34, tabla 12, sección 3.2…" },
  { letter: "J", index: 9,  header: "texto_evidencia",        required: false, description: "Cita textual breve, máx 1000 chars." },
  { letter: "K", index: 10, header: "valor_reportado",        required: false, description: "Número decimal (separador `.` o `,`)." },
  { letter: "L", index: 11, header: "unidad",                 required: false, description: "Unidad tal cual aparece en la fuente." },
  { letter: "M", index: 12, header: "comparabilidad",         required: false, description: "Alta / Media / Baja / No comparable." },
  { letter: "N", index: 13, header: "observacion_metodologica", required: false, description: "Observación metodológica." },
  { letter: "O", index: 14, header: "decision_final",         required: false, description: "OK / PREVALIDADO IA / DESCARTAR / REVISION MANUAL / NUEVA / Pendiente / No aplica. Default NUEVA." },
  { letter: "P", index: 15, header: "definicion_referencia",  required: false, description: "Definición del KPI según referencia." },
  { letter: "Q", index: 16, header: "unidad_base_referencia", required: false, description: "Unidad estandarizada del KPI." },
  { letter: "R", index: 17, header: "indicador_fuente",       required: false, description: "Cómo lo llamaba la fuente original." },
  { letter: "S", index: 18, header: "encaje_indicador",       required: false, description: "Encaje con el KPI." },
];

export const EVIDENCIAS_SHEET_NAME = "evidencias";
export const INSTRUCCIONES_SHEET_NAME = "instrucciones";
export const KPIS_SHEET_NAME = "kpis";
export const ENUMS_SHEET_NAME = "enums";

const numberFromCell = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    const cleaned = v.replace(/\s/g, "").replace(",", ".");
    const n = Number(cleaned);
    if (Number.isNaN(n)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Valor no numérico: "${v}"`,
      });
      return z.NEVER;
    }
    return n;
  });

const optionalText = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((v) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  });

const requiredText = (label: string, max = 200) =>
  z
    .union([z.string(), z.number()])
    .transform((v, ctx) => {
      const s = String(v ?? "").trim();
      if (s === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} es obligatorio`,
        });
        return z.NEVER;
      }
      if (s.length > max) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} supera ${max} caracteres`,
        });
        return z.NEVER;
      }
      return s;
    });

const intYear = z
  .union([z.number(), z.string()])
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ano es obligatorio",
      });
      return z.NEVER;
    }
    const n = typeof v === "number" ? v : Number(String(v).trim());
    if (!Number.isInteger(n) || n < 2000 || n > 2099) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `ano fuera de rango (2000–2099): ${v}`,
      });
      return z.NEVER;
    }
    return n;
  });

const optionalUrl = z
  .union([z.string(), z.number()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (s === "") return null;
    try {
      const u = new URL(s);
      if (!/^https?:$/.test(u.protocol)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `URL no http/https: "${s}"`,
        });
        return z.NEVER;
      }
      return s;
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `URL inválida: "${s}"`,
      });
      return z.NEVER;
    }
  });

const optionalEnum = <T extends readonly string[]>(values: T, label: string) =>
  z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      if (s === "") return null;
      if (!(values as readonly string[]).includes(s)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${label} debe ser uno de: ${values.join(", ")}`,
        });
        return z.NEVER;
      }
      return s as T[number];
    });

export const EvidenceRowSchema = z.object({
  kpi_external_code:        requiredText("kpi_external_code", 120),
  empresa_comparable:       requiredText("empresa_comparable", 200),
  ano:                      intYear,
  entidad_fuente:           optionalText,
  fuente_nivel:             optionalEnum(FUENTE_NIVEL, "fuente_nivel"),
  fuente_tipo:              requiredText("fuente_tipo", 120),
  fuente_titulo:            optionalText,
  url_validada:             optionalUrl,
  ubicacion_fuente:         optionalText,
  texto_evidencia:          z
    .union([z.string(), z.number()])
    .nullable()
    .optional()
    .transform((v, ctx) => {
      if (v === null || v === undefined) return null;
      const s = String(v).trim();
      if (s === "") return null;
      if (s.length > 1000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `texto_evidencia supera 1000 caracteres`,
        });
        return z.NEVER;
      }
      return s;
    }),
  valor_reportado:          numberFromCell,
  unidad:                   optionalText,
  comparabilidad:           optionalEnum(COMPARABILIDAD, "comparabilidad"),
  observacion_metodologica: optionalText,
  decision_final:           optionalEnum(DECISION_FINAL, "decision_final"),
  definicion_referencia:    optionalText,
  unidad_base_referencia:   optionalText,
  indicador_fuente:         optionalText,
  encaje_indicador:         optionalText,
});

export type EvidenceRow = z.infer<typeof EvidenceRowSchema>;

/** Clave natural usada para el upsert (V3 §3.4). */
export function naturalKey(row: {
  kpi_external_code: string;
  empresa_comparable: string;
  ano: number;
}): string {
  return `${row.kpi_external_code}|${row.empresa_comparable.toLowerCase()}|${row.ano}`;
}
