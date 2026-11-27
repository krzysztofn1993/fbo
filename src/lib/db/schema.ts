// Database schema of the new version: accounts, categories and the tables that
// map rows of the old version to the records created from them.
//
// Loaded by the Next server, by plain `node` scripts and by drizzle-kit, so it
// imports only from packages. Enum values are English identifiers; the names
// shown to the user come from the translation file. New IDs are UUIDv7, given
// by PostgreSQL 18 (`uuidv7()`).
//
// After a change here run `npm run db:generate` and commit the new migration.

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

export const accountType = pgEnum("account_type", [
  "bank",
  "cash",
  "investment",
  "liability",
  "other",
]);

export const reportingScope = pgEnum("reporting_scope", ["personal", "business", "excluded"]);

export const categoryKind = pgEnum("category_kind", ["income", "expense", "transfer", "mixed"]);

/** A `labeled` category takes a label on each entry instead of having subcategories. */
export const categoryType = pgEnum("category_type", ["standard", "labeled"]);

function createdAt() {
  return timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
}

function updatedAt() {
  return timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
}

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    name: text("name").notNull(),
    type: accountType("type").notNull(),
    /** ISO 4217 code in capitals, for example "EUR". */
    currency: text("currency").notNull(),
    reportingScope: reportingScope("reporting_scope").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("accounts_currency_check", sql`${t.currency} ~ '^[A-Z]{3}$'`)],
);

// Names are unique among siblings regardless of case, root categories
// included. Drizzle cannot express an expression index with NULLS NOT
// DISTINCT, so the index `categories_parent_id_lower_name_key` on
// (parent_id, lower(name)) lives in a custom migration in drizzle/.
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    /** Null for a root category; there are two levels at most. */
    parentId: uuid("parent_id").references((): AnyPgColumn => categories.id, {
      onDelete: "restrict",
    }),
    name: text("name").notNull(),
    kind: categoryKind("kind").notNull(),
    type: categoryType("type").notNull().default("standard"),
    /** Order among the siblings, from 0. */
    position: integer("position").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("categories_position_check", sql`${t.position} >= 0`),
    check("categories_labeled_root_check", sql`${t.type} = 'standard' OR ${t.parentId} IS NULL`),
    unique("categories_parent_id_position_key").on(t.parentId, t.position).nullsNotDistinct(),
    index("categories_parent_id_idx").on(t.parentId),
  ],
);

/** Old account ID → account created from it. */
export const legacyAccountMap = pgTable("legacy_account_map", {
  legacyId: uuid("legacy_id").primaryKey(),
  accountId: uuid("account_id")
    .notNull()
    .unique("legacy_account_map_account_id_key")
    .references(() => accounts.id, { onDelete: "restrict" }),
  migratedAt: timestamp("migrated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Old category ID → category created from it. Several old rows may point at
 * one category: old names that differ only in case were merged.
 */
export const legacyCategoryMap = pgTable("legacy_category_map", {
  legacyId: uuid("legacy_id").primaryKey(),
  categoryId: uuid("category_id")
    .notNull()
    .references(() => categories.id, { onDelete: "restrict" }),
  migratedAt: timestamp("migrated_at", { withTimezone: true }).notNull().defaultNow(),
});
