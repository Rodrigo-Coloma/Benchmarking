import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
  check,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { users } from "./users.js";
import { projects } from "./projects.js";

export const project_invitations = pgTable(
  "project_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role").notNull(),
    token: text("token").notNull().unique(),
    invited_by: uuid("invited_by")
      .notNull()
      .references(() => users.id),
    invited_at: timestamp("invited_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expires_at: timestamp("expires_at", { withTimezone: true }).notNull(),
    accepted_at: timestamp("accepted_at", { withTimezone: true }),
  },
  (t) => ({
    projectIdx: index("invitations_project_idx").on(t.project_id),
    emailIdx: index("invitations_email_idx").on(t.email),
    roleCheck: check(
      "invitation_role_check",
      sql`${t.role} in ('editor','viewer')`,
    ),
  }),
);

export const insertInvitationSchema = createInsertSchema(project_invitations);
export const selectInvitationSchema = createSelectSchema(project_invitations);

export type Invitation = typeof project_invitations.$inferSelect;
export type NewInvitation = typeof project_invitations.$inferInsert;
