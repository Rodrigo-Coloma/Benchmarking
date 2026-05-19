import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const EVIDENCIA_IMPORT_STATUSES = [
  "previewed",
  "committed",
  "discarded",
  "failed",
] as const;
export type EvidenciaImportStatus =
  (typeof EVIDENCIA_IMPORT_STATUSES)[number];

export const EVIDENCIA_IMPORT_MODES = ["upsert", "replace"] as const;
export type EvidenciaImportMode = (typeof EVIDENCIA_IMPORT_MODES)[number];

/**
 * Auditoría de cada subida de XLSX de evidencias. Persiste el diff y el modo
 * elegido entre `upsert` y `replace` (V3 §3.6).
 */
export const evidencia_imports = pgTable(
  "evidencia_imports",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id),
    filename: text("filename").notNull(),
    file_hash: text("file_hash").notNull(),
    mode: text("mode").notNull(),
    status: text("status").notNull(),
    summary: jsonb("summary").notNull(),
    diff: jsonb("diff").notNull(),
    errors: jsonb("errors"),
    error: text("error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    committed_at: timestamp("committed_at", { withTimezone: true }),
  },
  (t) => ({
    projIdx: index("evidencia_imports_project_idx").on(t.project_id),
    statusIdx: index("evidencia_imports_status_idx").on(t.status),
  }),
);

export const insertEvidenciaImportSchema =
  createInsertSchema(evidencia_imports);
export const selectEvidenciaImportSchema =
  createSelectSchema(evidencia_imports);

export type EvidenciaImport = typeof evidencia_imports.$inferSelect;
export type NewEvidenciaImport = typeof evidencia_imports.$inferInsert;
