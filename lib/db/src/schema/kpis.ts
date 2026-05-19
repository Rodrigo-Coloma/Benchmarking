import {
  pgTable,
  uuid,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { projects } from "./projects.js";

export const DIRECTIONS = ["ASCENDENTE", "DESCENDENTE", "NEUTRO"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const kpis = pgTable(
  "kpis",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    external_code: text("external_code").notNull(),
    name: text("name").notNull(),
    scope: text("scope"),
    responsible_area: text("responsible_area"),
    direction: text("direction"),
    comparable_companies: text("comparable_companies").array(),
    standard_unit: text("standard_unit"),
    category: text("category"),
    description: text("description"),
    extra: jsonb("extra"),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    archived_at: timestamp("archived_at", { withTimezone: true }),
  },
  (t) => ({
    uniqExternal: uniqueIndex("kpis_project_external_idx").on(
      t.project_id,
      t.external_code,
    ),
    projIdx: index("kpis_project_idx").on(t.project_id),
  }),
);

export const insertKpiSchema = createInsertSchema(kpis);
export const selectKpiSchema = createSelectSchema(kpis);

export type Kpi = typeof kpis.$inferSelect;
export type NewKpi = typeof kpis.$inferInsert;
