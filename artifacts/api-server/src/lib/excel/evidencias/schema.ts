import { z } from "zod";

/**
 * Schema fijo del Excel de evidencias — alineado con el formato que ya usa
 * el cliente (ej. evidencias_efqm_*.xlsx, 26 columnas A..Z). La hoja se
 * llama exactamente "Evidencias" (con E mayúscula) por consistencia con sus
 * archivos existentes.
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
  "REVISAR",
  "NUEVA",
  "Pendiente",
  "No aplica",
] as const;

export const FUENTE_TIPO_HINTS = [
  "EINF",
  "Informe de gestión consolidado",
  "Memoria de sostenibilidad",
  "Web corporativa",
  "Certificación",
  "Prensa",
  "Estimación",
  "Otro",
];

export interface ColumnDef {
  letter: string;
  index: number;
  header: string;
  required: boolean;
  description: string;
}

/**
 * 26 columnas exactas. El orden y los nombres de cabecera deben coincidir
 * para que el parser acepte el fichero. La columna `id` es opcional al subir
 * (si viene, se respeta para futuras correlaciones; si no, se autoincrementa).
 */
export const COLUMNS: ColumnDef[] = [
  { letter: "A", index: 0,  header: "id",                       required: false, description: "ID interno (opcional al subir; se autoincrementa si no se especifica)." },
  { letter: "B", index: 1,  header: "empresa_comparable",       required: true,  description: "Nombre de la empresa peer (máx 200 chars)." },
  { letter: "C", index: 2,  header: "entidad_fuente",           required: false, description: "Razón social completa de la entidad que publica la fuente." },
  { letter: "D", index: 3,  header: "ano",                      required: true,  description: "Año del dato (2000–2099)." },
  { letter: "E", index: 4,  header: "codigo_indicador",         required: true,  description: "Código del indicador en el catálogo (ej. AD_HOC_C7_ROTACION_PERSONAS)." },
  { letter: "F", index: 5,  header: "indicador",                required: false, description: "Nombre legible del indicador." },
  { letter: "G", index: 6,  header: "categoria_efqm",           required: false, description: "Categoría EFQM (ej. \"C7 Personas\")." },
  { letter: "H", index: 7,  header: "pilar_ilunion",            required: false, description: "Pilar ILUNION." },
  { letter: "I", index: 8,  header: "fuente_nivel",             required: false, description: "Nivel 1..Nivel 5." },
  { letter: "J", index: 9,  header: "fuente_tipo",              required: true,  description: "EINF / Informe de gestión / Web corporativa / Certificación / Prensa / Estimación / Otro." },
  { letter: "K", index: 10, header: "fuente_titulo",            required: false, description: "Título de la fuente." },
  { letter: "L", index: 11, header: "url_validada",             required: false, description: "URL absoluta (http(s)://)." },
  { letter: "M", index: 12, header: "valor_reportado",          required: false, description: "Número decimal (separador `.` o `,`)." },
  { letter: "N", index: 13, header: "unidad",                   required: false, description: "Unidad tal cual aparece en la fuente." },
  { letter: "O", index: 14, header: "comparabilidad",           required: false, description: "Alta / Media / Baja / No comparable." },
  { letter: "P", index: 15, header: "observacion_metodologica", required: false, description: "Observación metodológica." },
  { letter: "Q", index: 16, header: "decision_final",           required: false, description: "OK / PREVALIDADO IA / DESCARTAR / REVISION MANUAL / REVISAR / NUEVA / Pendiente / No aplica. Default NUEVA." },
  { letter: "R", index: 17, header: "definicion_referencia",    required: false, description: "Definición del indicador según referencia." },
  { letter: "S", index: 18, header: "unidad_base_referencia",   required: false, description: "Unidad base de referencia." },
  { letter: "T", index: 19, header: "indicador_fuente",         required: false, description: "Cómo lo llamaba la fuente original." },
  { letter: "U", index: 20, header: "encaje_indicador",         required: false, description: "Encaje con el KPI." },
  { letter: "V", index: 21, header: "estado_auditoria",         required: false, description: "Estado de auditoría (Si/No, libre)." },
  { letter: "W", index: 22, header: "id_data",                  required: false, description: "ID numérico del indicador en la BBDD origen." },
  { letter: "X", index: 23, header: "tipo_compania",            required: false, description: "Clasificación: Entidad financiera / Aseguradora / Hotelera / etc." },
  { letter: "Y", index: 24, header: "unidad_estandarizada",     required: false, description: "Unidad estándar derivada (M€, EUR, Personas, %, …)." },
  { letter: "Z", index: 25, header: "valor_estandarizado",      required: false, description: "Valor numérico convertido a la unidad estandarizada." },
];

export const EVIDENCIAS_SHEET_NAME = "Evidencias";
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

const integerFromCell = z
  .union([z.number(), z.string()])
  .nullable()
  .optional()
  .transform((v, ctx) => {
    if (v === null || v === undefined || v === "") return null;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    if (!Number.isInteger(n) || n < 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `id debe ser entero positivo o vacío: "${v}"`,
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
  id:                       integerFromCell,
  empresa_comparable:       requiredText("empresa_comparable", 200),
  entidad_fuente:           optionalText,
  ano:                      intYear,
  codigo_indicador:         requiredText("codigo_indicador", 200),
  indicador:                optionalText,
  categoria_efqm:           optionalText,
  pilar_ilunion:            optionalText,
  fuente_nivel:             optionalEnum(FUENTE_NIVEL, "fuente_nivel"),
  fuente_tipo:              requiredText("fuente_tipo", 200),
  fuente_titulo:            optionalText,
  url_validada:             optionalUrl,
  valor_reportado:          numberFromCell,
  unidad:                   optionalText,
  comparabilidad:           optionalEnum(COMPARABILIDAD, "comparabilidad"),
  observacion_metodologica: optionalText,
  decision_final:           optionalEnum(DECISION_FINAL, "decision_final"),
  definicion_referencia:    optionalText,
  unidad_base_referencia:   optionalText,
  indicador_fuente:         optionalText,
  encaje_indicador:         optionalText,
  estado_auditoria:         optionalText,
  id_data:                  optionalText,
  tipo_compania:            optionalText,
  unidad_estandarizada:     optionalText,
  valor_estandarizado:      numberFromCell,
});

export type EvidenceRow = z.infer<typeof EvidenceRowSchema>;

/**
 * Clave natural usada para upsert: codigo_indicador + empresa + año.
 * (project_id ya está implícito en el contexto del proyecto.)
 */
export function naturalKey(row: {
  codigo_indicador: string;
  empresa_comparable: string;
  ano: number;
}): string {
  return `${row.codigo_indicador}|${row.empresa_comparable.toLowerCase()}|${row.ano}`;
}
