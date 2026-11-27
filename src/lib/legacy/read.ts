// Reads what the migration of accounts and categories needs from the old
// database: one read-only REPEATABLE READ transaction, so every query sees the
// same snapshot, and nothing but SELECT statements.
//
// The rows come from another system, so each one is parsed by a Zod schema
// before the translation sees it: the old IDs get their brands here, and a row
// of an unexpected shape is reported with every other one instead of being
// trusted. Enum values stay text; the translation checks them against the new
// schema.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// packages and relative `.ts` paths and uses only erasable syntax.

import type pg from "pg";
import { z } from "zod";

import { LegacyAccountIdSchema, LegacyCategoryIdSchema, type LegacyAccountId } from "../ids.ts";
import type { LegacyAccountRow, LegacyCategoryRow } from "./accounts-categories.ts";

export type LegacySnapshot = {
  accounts: LegacyAccountRow[];
  referencedInactiveAccountIds: Set<LegacyAccountId>;
  categories: LegacyCategoryRow[];
};

export type LegacySnapshotResult =
  | { ok: true; snapshot: LegacySnapshot }
  | { ok: false; problems: string[] };

/** Rows exactly as the queries below return them. */
export type LegacyRecords = {
  accounts: readonly unknown[];
  referencedInactive: readonly unknown[];
  categories: readonly unknown[];
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

const AccountRecordSchema = z
  .object({
    id: LegacyAccountIdSchema,
    name: z.string(),
    type: z.string(),
    currency: z.string(),
    reporting_scope: z.string(),
    is_active: z.boolean(),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .transform(
    (row): LegacyAccountRow => ({
      id: row.id,
      name: row.name,
      type: row.type,
      currency: row.currency,
      reportingScope: row.reporting_scope,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );

const ReferencedRecordSchema = z.object({ id: LegacyAccountIdSchema }).transform((row) => row.id);

const CategoryRecordSchema = z
  .object({
    id: LegacyCategoryIdSchema,
    parent_id: LegacyCategoryIdSchema.nullable(),
    name: z.string(),
    kind: z.string(),
    is_active: z.boolean(),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .transform(
    (row): LegacyCategoryRow => ({
      id: row.id,
      parentId: row.parent_id,
      name: row.name,
      kind: row.kind,
      isActive: row.is_active,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );

/** One problem per issue: the query, the row number in its order and the column. */
function describeIssues(query: string, error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const [index, column] = issue.path;
    const row = typeof index === "number" ? ` row ${index + 1}` : "";
    const field = column === undefined ? "" : `, column "${String(column)}"`;
    return `The old database returned an unexpected value in ${query}${row}${field}: ${issue.message}.`;
  });
}

/** Parses the rows of the three queries; reports every row that does not fit. */
export function parseLegacyRecords(records: LegacyRecords): LegacySnapshotResult {
  const accounts = z.array(AccountRecordSchema).safeParse(records.accounts);
  const referenced = z.array(ReferencedRecordSchema).safeParse(records.referencedInactive);
  const categories = z.array(CategoryRecordSchema).safeParse(records.categories);

  if (!accounts.success || !referenced.success || !categories.success) {
    return {
      ok: false,
      problems: [
        ...(accounts.success ? [] : describeIssues("accounts", accounts.error)),
        ...(referenced.success ? [] : describeIssues("referenced accounts", referenced.error)),
        ...(categories.success ? [] : describeIssues("categories", categories.error)),
      ],
    };
  }
  return {
    ok: true,
    snapshot: {
      accounts: accounts.data,
      referencedInactiveAccountIds: new Set(referenced.data),
      categories: categories.data,
    },
  };
}

/** Reads the snapshot through `client`, which must not be inside a transaction. */
export async function readLegacySnapshot(client: pg.ClientBase): Promise<LegacySnapshotResult> {
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  let records: LegacyRecords;
  try {
    const accounts = await client.query(ACCOUNTS_SQL);
    const referencedInactive = await client.query(REFERENCED_INACTIVE_SQL);
    const categories = await client.query(CATEGORIES_SQL);
    await client.query("COMMIT");
    records = {
      accounts: accounts.rows,
      referencedInactive: referencedInactive.rows,
      categories: categories.rows,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  return parseLegacyRecords(records);
}
