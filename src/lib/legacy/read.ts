// Reads what the migration of accounts and categories needs from the old
// database: one read-only REPEATABLE READ transaction, so every query sees the
// same snapshot, and nothing but SELECT statements.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// packages and relative `.ts` paths and uses only erasable syntax.

import type pg from "pg";

import type { LegacyAccountRow, LegacyCategoryRow } from "./accounts-categories.ts";

export type LegacySnapshot = {
  accounts: LegacyAccountRow[];
  referencedInactiveAccountIds: Set<string>;
  categories: LegacyCategoryRow[];
};

/** Old tables with an `account_id` column. */
export const ACCOUNT_REFERENCE_TABLES = [
  "transactions",
  "planned_transactions",
  "recurring_expenses",
  "account_balance_snapshots",
  "account_live_balances",
  "classification_rules",
] as const;

const ACCOUNTS_SQL = `
  SELECT id::text AS id, name, type::text AS type, currency,
         reporting_scope::text AS reporting_scope, is_active, created_at, updated_at
  FROM accounts
  ORDER BY created_at, id`;

const CATEGORIES_SQL = `
  SELECT id::text AS id, parent_id::text AS parent_id, name, kind::text AS kind,
         is_active, created_at, updated_at
  FROM categories
  ORDER BY created_at, id`;

const REFERENCED_INACTIVE_SQL = `
  SELECT a.id::text AS id
  FROM accounts a
  WHERE NOT a.is_active
    AND a.id IN (${ACCOUNT_REFERENCE_TABLES.map((table) => `SELECT account_id FROM ${table}`).join(
      " UNION ",
    )})`;

type AccountRecord = {
  id: string;
  name: string;
  type: string;
  currency: string;
  reporting_scope: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

type CategoryRecord = {
  id: string;
  parent_id: string | null;
  name: string;
  kind: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

/** Reads the snapshot through `client`, which must not be inside a transaction. */
export async function readLegacySnapshot(client: pg.ClientBase): Promise<LegacySnapshot> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  try {
    const accounts = await client.query<AccountRecord>(ACCOUNTS_SQL);
    const referenced = await client.query<{ id: string }>(REFERENCED_INACTIVE_SQL);
    const categories = await client.query<CategoryRecord>(CATEGORIES_SQL);
    await client.query("COMMIT");

    return {
      accounts: accounts.rows.map((row) => ({
        id: row.id,
        name: row.name,
        type: row.type,
        currency: row.currency,
        reportingScope: row.reporting_scope,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      referencedInactiveAccountIds: new Set(referenced.rows.map((row) => row.id)),
      categories: categories.rows.map((row) => ({
        id: row.id,
        parentId: row.parent_id,
        name: row.name,
        kind: row.kind,
        isActive: row.is_active,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}
