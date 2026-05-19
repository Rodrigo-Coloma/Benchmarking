import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { projects } from "./projects.js";
import { users } from "./users.js";

/**
 * Mappings aprobados del descubridor IA (V3 §2). Cuando un usuario sube un
 * Excel con header_signature ya conocido para el proyecto, saltamos la
 * llamada al LLM y aplicamos este template directamente.
 */
export const kpi_schema_templates = pgTable(
  "kpi_schema_templates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    header_signature: text("header_signature").notNull(),
    sheet_name: text("sheet_name").notNull(),
    header_row: integer("header_row").notNull(),
    column_mapping: jsonb("column_mapping").notNull(),
    skip_rows: integer("skip_rows")
      .array()
      .notNull()
      .default(sql`'{}'::int[]`),
    notes: text("notes"),
    created_by: uuid("created_by")
      .notNull()
      .references(() => users.id),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    uses_count: integer("uses_count").notNull().default(0),
  },
  (t) => ({
    uniqSig: uniqueIndex("kpi_schema_templates_proj_sig_idx").on(
      t.project_id,
      t.header_signature,
    ),
  }),
);

export const insertKpiSchemaTemplateSchema =
  createInsertSchema(kpi_schema_templates);
export const selectKpiSchemaTemplateSchema =
  createSelectSchema(kpi_schema_templates);

export type KpiSchemaTemplate = typeof kpi_schema_templates.$inferSelect;
export type NewKpiSchemaTemplate = typeof kpi_schema_templates.$inferInsert;
