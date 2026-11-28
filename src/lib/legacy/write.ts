// Writes a translated migration plan to the new database in one transaction.
//
// The transaction first locks every table the migration writes in EXCLUSIVE
// mode, so nothing else can write to them until it ends, and only then checks
// that they are all empty: the migration runs once, into empty tables. IDs
// come from the database, so roots are inserted before their subcategories,
// the legacy maps after the records they point at, and the transactions one by
// one in the order of the plan, so their UUIDv7 IDs follow it. The rows that
// hang off the transactions, the pairs of possible duplicates last, go in
// batches, since PostgreSQL takes at most 65 535 parameters per statement.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// packages and relative `.ts` paths and uses only erasable syntax.

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  accounts,
  categories,
  legacyAccountMap,
  legacyCategoryMap,
  legacyClassificationResults,
  legacyTransactionMap,
  legacyTransactionSources,
  possibleDuplicates,
  transactionParts,
  transactions,
} from "../db/schema.ts";
import type {
  AccountId,
  CategoryId,
  LegacyAccountId,
  LegacyCategoryId,
  LegacyTransactionId,
  TransactionId,
} from "../ids.ts";
import type { MigrationPlan, NewCategory } from "./accounts-categories.ts";
import type { NewDuplicatePair } from "./duplicates.ts";
import type { NewTransaction } from "./transactions.ts";

/**
 * The accounts and categories of the old version with the transactions on
 * them and the pairs of possible duplicates among those transactions.
 */
export type MigrationWritePlan = MigrationPlan & {
  transactions: readonly NewTransaction[];
  duplicates: readonly NewDuplicatePair[];
};

/** Rows per multi-row insert; the widest table has about 25 columns. */
const BATCH_SIZE = 500;

/** Thrown when any of the migration tables already has rows. */
export class AlreadyMigratedError extends Error {
  constructor() {
    super(
      "Accounts, categories and transactions have already been migrated: the target tables " +
        "are not empty. To try again, start from a fresh database and run `npm run db:migrate` first.",
    );
    this.name = "AlreadyMigratedError";
  }
}

function batches<T>(rows: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    result.push(rows.slice(start, start + BATCH_SIZE));
  }
  return result;
}

function lookup<K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V {
  const value = map.get(key);
  if (value === undefined) {
    throw new Error(`The plan refers to an unknown ${what} ${String(key)}.`);
  }
  return value;
}

export async function writeMigrationPlan(
  db: NodePgDatabase,
  plan: MigrationWritePlan,
): Promise<void> {
  await db.transaction(async (tx) => {
    const tables = [
      accounts,
      categories,
      legacyAccountMap,
      legacyCategoryMap,
      transactions,
      transactionParts,
      legacyTransactionMap,
      legacyTransactionSources,
      legacyClassificationResults,
      possibleDuplicates,
    ];
    await tx.execute(
      sql`LOCK TABLE ${sql.join(
        tables.map((table) => sql`${table}`),
        sql`, `,
      )} IN EXCLUSIVE MODE`,
    );
    const existing = await tx.execute<{ has_rows: boolean }>(
      sql`SELECT ${sql.join(
        tables.map((table) => sql`EXISTS (SELECT 1 FROM ${table})`),
        sql` OR `,
      )} AS has_rows`,
    );
    if (existing.rows[0]?.has_rows !== false) {
      throw new AlreadyMigratedError();
    }

    // The IDs given back by `RETURNING` carry their brands from the schema.
    const accountIds = new Map<LegacyAccountId, AccountId>();
    const accountMap: { legacyId: LegacyAccountId; accountId: AccountId }[] = [];
    for (const account of plan.accounts) {
      const [row] = await tx
        .insert(accounts)
        .values({
          name: account.name,
          type: account.type,
          currency: account.currency,
          reportingScope: account.reportingScope,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        })
        .returning({ id: accounts.id });
      accountIds.set(account.key, row.id);
      for (const legacyId of account.legacyIds) {
        accountMap.push({ legacyId, accountId: row.id });
      }
    }
    if (accountMap.length > 0) {
      await tx.insert(legacyAccountMap).values(accountMap);
    }

    // Key of a category in the plan → its new ID.
    const categoryIds = new Map<LegacyCategoryId, CategoryId>();
    const categoryMap: { legacyId: LegacyCategoryId; categoryId: CategoryId }[] = [];
    const insertCategory = async (
      category: NewCategory,
      parentId: CategoryId | null,
    ): Promise<CategoryId> => {
      const [row] = await tx
        .insert(categories)
        .values({
          parentId,
          name: category.name,
          kind: category.kind,
          type: category.type,
          position: category.position,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
        })
        .returning({ id: categories.id });
      categoryIds.set(category.key, row.id);
      for (const legacyId of category.legacyIds) {
        categoryMap.push({ legacyId, categoryId: row.id });
      }
      return row.id;
    };

    for (const root of plan.rootCategories) {
      await insertCategory(root, null);
    }
    for (const subcategory of plan.subcategories) {
      const parentId = categoryIds.get(subcategory.parentKey);
      if (parentId === undefined) {
        throw new Error(`Subcategory ${subcategory.key} refers to an unknown root category.`);
      }
      await insertCategory(subcategory, parentId);
    }
    if (categoryMap.length > 0) {
      await tx.insert(legacyCategoryMap).values(categoryMap);
    }

    // One at a time, so the IDs grow in the order of the plan.
    const transactionMap: { legacyId: LegacyTransactionId; transactionId: TransactionId }[] = [];
    for (const transaction of plan.transactions) {
      const [row] = await tx
        .insert(transactions)
        .values({
          accountId: lookup(accountIds, transaction.accountKey, "account"),
          bookingDate: transaction.bookingDate,
          operationDate: transaction.operationDate,
          amountMinor: transaction.amountMinor,
          description: transaction.description,
          reportingScopeOverride: transaction.reportingScopeOverride,
          createdAt: transaction.createdAt,
          updatedAt: transaction.updatedAt,
        })
        .returning({ id: transactions.id });
      transactionMap.push({ legacyId: transaction.legacyId, transactionId: row.id });
    }

    for (const batch of batches(transactionMap)) {
      await tx.insert(legacyTransactionMap).values(batch);
    }

    const sources = plan.transactions.map((transaction, index) => ({
      transactionId: transactionMap[index].transactionId,
      ...transaction.source,
    }));
    for (const batch of batches(sources)) {
      await tx.insert(legacyTransactionSources).values(batch);
    }

    const parts = plan.transactions.flatMap((transaction, index) =>
      transaction.parts.map((part) => ({
        transactionId: transactionMap[index].transactionId,
        categoryId: lookup(categoryIds, part.categoryKey, "category"),
        amountMinor: part.amountMinor,
        label: part.label,
        reportingClass: part.reportingClass,
        approved: part.approved,
        createdAt: part.createdAt,
        updatedAt: part.updatedAt,
      })),
    );
    for (const batch of batches(parts)) {
      await tx.insert(transactionParts).values(batch);
    }

    const results = plan.transactions.flatMap((transaction, index) =>
      transaction.classificationResults.map((result) => ({
        legacyId: result.legacyId,
        transactionId: transactionMap[index].transactionId,
        categoryId:
          result.categoryKey === null
            ? null
            : lookup(categoryIds, result.categoryKey, "category"),
        label: result.label,
        legacyRuleId: result.legacyRuleId,
        legacyRuleIds: result.legacyRuleIds,
        classifierType: result.classifierType,
        classifierVersion: result.classifierVersion,
        confidenceBps: result.confidenceBps,
        reason: result.reason,
        legacyHistoricalProposalId: result.legacyHistoricalProposalId,
        provenance: result.provenance,
        status: result.status,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      })),
    );
    for (const batch of batches(results)) {
      await tx.insert(legacyClassificationResults).values(batch);
    }

    // The row from the bank first, the row from the spreadsheet second.
    const transactionIds = new Map(
      transactionMap.map((row) => [row.legacyId, row.transactionId] as const),
    );
    const pairs = plan.duplicates.map((pair) => ({
      firstTransactionId: lookup(transactionIds, pair.bankLegacyId, "transaction"),
      secondTransactionId: lookup(transactionIds, pair.sheetLegacyId, "transaction"),
      dayDifference: pair.dayDifference,
    }));
    for (const batch of batches(pairs)) {
      await tx.insert(possibleDuplicates).values(batch);
    }
  });
}
