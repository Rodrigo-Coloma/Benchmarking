import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { users } from "./users.js";
import { projects } from "./projects.js";

export const ROLES = ["owner", "editor", "viewer"] as const;
export type Role = (typeof ROLES)[number];

export const project_members = pgTable(
  "project_members",
  {
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    user_id: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    added_by: uuid("added_by").references(() => users.id),
    added_at: timestamp("added_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.project_id, t.user_id] }),
    roleCheck: check(
      "role_check",
      sql`${t.role} in ('owner','editor','viewer')`,
    ),
  }),
);

export const insertProjectMemberSchema = createInsertSchema(project_members);
export const selectProjectMemberSchema = createSelectSchema(project_members);

export type ProjectMember = typeof project_members.$inferSelect;
export type NewProjectMember = typeof project_members.$inferInsert;
