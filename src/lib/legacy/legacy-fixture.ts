// A made-up old database for the migration tests: a hand-written minimal DDL
// with only the columns the migration reads, made-up rows and a made-up
// category layout. Nothing here comes from a real instance.
//
// Imported by database tests only; relative `.ts` imports like the modules the
// migration script loads.

import {
  LegacyAccountIdSchema,
  type LegacyCategoryId,
  LegacyCategoryIdSchema,
} from "../ids.ts";
import type { LegacyAccountRow, LegacyCategoryRow } from "./accounts-categories.ts";
import { ACCOUNT_REFERENCE_TABLES } from "./read.ts";

/** A pool, a client or a pool client. */
type Queryable = {
  query(text: string, values?: unknown[]): Promise<unknown>;
};

/** Drops and recreates the old tables; the old enums are PostgreSQL enums too. */
export async function createLegacySchema(client: Queryable): Promise<void> {
  const referenceTables = ACCOUNT_REFERENCE_TABLES.map(
    (table) => `CREATE TABLE ${table} (account_id uuid REFERENCES accounts (id));`,
  ).join("\n");
  await client.query(`
    DROP TABLE IF EXISTS ${ACCOUNT_REFERENCE_TABLES.join(", ")}, categories, accounts CASCADE;
    DROP TYPE IF EXISTS account_type, reporting_scope, category_kind;
    CREATE TYPE account_type AS ENUM ('bank', 'cash', 'investment', 'liability', 'other');
    CREATE TYPE reporting_scope AS ENUM ('personal', 'business', 'excluded');
    CREATE TYPE category_kind AS ENUM ('income', 'expense', 'transfer', 'mixed');
    CREATE TABLE accounts (
      id uuid PRIMARY KEY,
      name text NOT NULL,
      type account_type NOT NULL,
      currency varchar(3) NOT NULL,
      reporting_scope reporting_scope NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );
    CREATE TABLE categories (
      id uuid PRIMARY KEY,
      parent_id uuid REFERENCES categories (id),
      name text NOT NULL,
      kind category_kind NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL,
      UNIQUE NULLS NOT DISTINCT (parent_id, name)
    );
    ${referenceTables}
  `);
}

function at(day: number): Date {
  return new Date(Date.UTC(2024, 0, day, 12));
}

export const ACCOUNT_BANK_1 = LegacyAccountIdSchema.parse("a0000000-0000-4000-8000-000000000001");
export const ACCOUNT_CASH_1 = LegacyAccountIdSchema.parse("a0000000-0000-4000-8000-000000000002");
export const ACCOUNT_INACTIVE = LegacyAccountIdSchema.parse("a0000000-0000-4000-8000-000000000003");

export const LEGACY_ACCOUNTS: LegacyAccountRow[] = [
  {
    id: ACCOUNT_BANK_1,
    name: "bank 1",
    type: "bank",
    currency: "PLN",
    reportingScope: "personal",
    isActive: true,
    createdAt: at(1),
    updatedAt: at(5),
  },
  {
    id: ACCOUNT_CASH_1,
    name: "cash 1",
    type: "cash",
    currency: "EUR",
    reportingScope: "business",
    isActive: true,
    createdAt: at(2),
    updatedAt: at(2),
  },
  {
    id: ACCOUNT_INACTIVE,
    name: "cash 2",
    type: "cash",
    currency: "PLN",
    reportingScope: "personal",
    isActive: false,
    createdAt: at(3),
    updatedAt: at(4),
  },
];

export const ROOT_A = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000001");
export const ROOT_B = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000002");
export const ROOT_C = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000003");
export const SUB_A1 = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000011");
export const SUB_A2 = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000012");
export const SUB_A3 = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000013");
export const SUB_B_BONUS_OLD = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000021");
export const SUB_B_BONUS_NEW = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000022");
export const SUB_B_SALARY = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000023");

function category(
  id: LegacyCategoryId,
  parentId: LegacyCategoryId | null,
  name: string,
  kind: string,
  createdDay: number,
  updatedDay = createdDay,
): LegacyCategoryRow {
  return {
    id,
    parentId,
    name,
    kind,
    isActive: true,
    createdAt: at(createdDay),
    updatedAt: at(updatedDay),
  };
}

/**
 * Three roots: "Kategoria A" with three subcategories (the last one missing
 * from the layout), "Kategoria B" of income with a pair of names that differ
 * only in case, and "Kategoria C", labeled in the layout.
 */
export const LEGACY_CATEGORIES: LegacyCategoryRow[] = [
  category(ROOT_A, null, "Kategoria A", "expense", 1),
  category(ROOT_B, null, "Kategoria B", "income", 1),
  category(ROOT_C, null, "Kategoria C", "expense", 2),
  category(SUB_A1, ROOT_A, "Podkategoria 1", "expense", 3),
  category(SUB_A2, ROOT_A, "Podkategoria 2", "expense", 3),
  category(SUB_A3, ROOT_A, "Podkategoria 3", "expense", 9),
  category(SUB_B_BONUS_OLD, ROOT_B, "premia", "income", 4, 6),
  category(SUB_B_BONUS_NEW, ROOT_B, "Premia", "income", 5, 8),
  category(SUB_B_SALARY, ROOT_B, "Wynagrodzenie", "income", 4),
];

/**
 * The layout orders the roots and subcategories differently from both their
 * creation and the alphabet, and names one subcategory missing from the data.
 */
export const LEGACY_LAYOUT = {
  roots: [
    { name: "Kategoria C", type: "labeled" },
    { name: "Kategoria A", children: ["Podkategoria 2", "Podkategoria 1", "Podkategoria 9"] },
    { name: "Kategoria B", children: ["Wynagrodzenie", "Premia"] },
  ],
};

export async function insertLegacyAccounts(
  client: Queryable,
  rows: readonly LegacyAccountRow[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      "INSERT INTO accounts (id, name, type, currency, reporting_scope, is_active, created_at," +
        " updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        row.id,
        row.name,
        row.type,
        row.currency,
        row.reportingScope,
        row.isActive,
        row.createdAt,
        row.updatedAt,
      ],
    );
  }
}

/** Inserts the rows in the given order, so parents must come before children. */
export async function insertLegacyCategories(
  client: Queryable,
  rows: readonly LegacyCategoryRow[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      "INSERT INTO categories (id, parent_id, name, kind, is_active, created_at, updated_at)" +
        " VALUES ($1, $2, $3, $4, $5, $6, $7)",
      [row.id, row.parentId, row.name, row.kind, row.isActive, row.createdAt, row.updatedAt],
    );
  }
}

/** Fills the empty old tables with the made-up rows; only active accounts are referenced. */
export async function seedLegacyDatabase(client: Queryable): Promise<void> {
  await insertLegacyAccounts(client, LEGACY_ACCOUNTS);
  await insertLegacyCategories(client, LEGACY_CATEGORIES);
  await client.query("INSERT INTO transactions (account_id) VALUES ($1), ($2), (NULL)", [
    ACCOUNT_BANK_1,
    ACCOUNT_CASH_1,
  ]);
  await client.query("INSERT INTO account_live_balances (account_id) VALUES ($1)", [
    ACCOUNT_BANK_1,
  ]);
}
