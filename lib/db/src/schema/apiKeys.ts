import {
  pgTable,
  uuid,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { projects } from "./projects.js";
import { users } from "./users.js";

export const api_keys = pgTable(
  "api_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    project_id: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    token_hash: text("token_hash").notNull().unique(),
    scopes: text("scopes").array().notNull(),
    created_by: uuid("created_by")
      .notNull()
      .references(() => users.id),
    created_at: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    last_used_at: timestamp("last_used_at", { withTimezone: true }),
    revoked_at: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    projIdx: index("api_keys_project_idx").on(t.project_id),
  }),
);

export const insertApiKeySchema = createInsertSchema(api_keys);
export const selectApiKeySchema = createSelectSchema(api_keys);

export type ApiKey = typeof api_keys.$inferSelect;
export type NewApiKey = typeof api_keys.$inferInsert;
