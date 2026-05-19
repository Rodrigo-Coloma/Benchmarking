import {
  pgTable,
  uuid,
  text,
  integer,
  doublePrecision,
  timestamp,
  serial,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { projects } from "./projects.js";
import { kpis } from "./kpis.js";

/**
 * Evidencias: registros numéricos asociados a un KPI y a una empresa peer
 * en un año concreto. Schema heredado de V1, evolucionado a multi-proyecto.
 */
export const evidencias = pgTable(
  "evidencias",
  {
    id: serial("id").primaryKey(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kpi_id: uuid("kpi_id").references(() => kpis.id, {
      onDelete: "set null",
    }),

    empresa_comparable: text("empresa_comparable").notNull(),
    entidad_fuente: text("entidad_fuente"),
    ano: integer("ano"),

    codigo_indicador: text("codigo_indicador"),
    indicador: text("indicador"),
    categoria_efqm: text("categoria_efqm"),
    pilar_ilunion: text("pilar_ilunion"),
    id_data: text("id_data"),
    fuente_nivel: text("fuente_nivel"),
    fuente_tipo: text("fuente_tipo").notNull(),
    fuente_titulo: text("fuente_titulo"),
    url_validada: text("url_validada"),
    ubicacion_fuente: text("ubicacion_fuente"),
    texto_evidencia: text("texto_evidencia"),
    valor_reportado: doublePrecision("valor_reportado"),
    unidad: text("unidad"),
    comparabilidad: text("comparabilidad"),
    observacion_metodologica: text("observacion_metodologica"),
    decision_final: text("decision_final"),

    definicion_referencia: text("definicion_referencia"),
    unidad_base_referencia: text("unidad_base_referencia"),
    indicador_fuente: text("indicador_fuente"),
    encaje_indicador: text("encaje_indicador"),

    estado_auditoria: text("estado_auditoria"),
    tipo_compania: text("tipo_compania"),
    unidad_estandarizada: text("unidad_estandarizada"),
    valor_estandarizado: doublePrecision("valor_estandarizado"),

    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    projIdx: index("evidencias_project_idx").on(t.project_id),
    projKpiIdx: index("evidencias_project_kpi_idx").on(t.project_id, t.kpi_id),
    projDecisionIdx: index("evidencias_project_decision_idx").on(
      t.project_id,
      t.decision_final,
    ),
    projCreatedIdx: index("evidencias_project_created_idx").on(
      t.project_id,
      t.created_at,
    ),
  }),
);

export const insertEvidenciaSchema = createInsertSchema(evidencias);
export const selectEvidenciaSchema = createSelectSchema(evidencias);

export type Evidencia = typeof evidencias.$inferSelect;
export type NewEvidencia = typeof evidencias.$inferInsert;
