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

export const INGESTION_STATUSES = [
  "previewed",
  "committed",
  "discarded",
  "failed",
] as const;
export type IngestionStatus = (typeof INGESTION_STATUSES)[number];

export const kpi_ingestion_runs = pgTable(
  "kpi_ingestion_runs",
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
    status: text("status").notNull(),
    summary: jsonb("summary").notNull(),
    diff: jsonb("diff").notNull(),
    error: text("error"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    committed_at: timestamp("committed_at", { withTimezone: true }),
  },
  (t) => ({
    projIdx: index("ingestions_project_idx").on(t.project_id),
    statusIdx: index("ingestions_status_idx").on(t.status),
  }),
);

export const insertIngestionSchema = createInsertSchema(kpi_ingestion_runs);
export const selectIngestionSchema = createSelectSchema(kpi_ingestion_runs);

export type IngestionRun = typeof kpi_ingestion_runs.$inferSelect;
export type NewIngestionRun = typeof kpi_ingestion_runs.$inferInsert;
