// Reads the transaction list and the details of one transaction in the shape
// the pages show them.
//
// Takes the database handle as a parameter and knows nothing about Next, so
// the database tests can load it. Enum values stay the English identifiers and
// amounts stay bigint in minor units; the pages translate and format them. The
// classification state is derived from the parts by the one rule in
// `classification-state.ts`, never read from a column. Imports only packages
// and relative `.ts` paths.

import { asc, count, desc, eq, inArray, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { alias } from "drizzle-orm/pg-core";

import {
  accounts,
  categories,
  legacyTransactionSources,
  possibleDuplicates,
  transactionParts,
  transactions,
} from "../db/schema.ts";
import type { TransactionId } from "../ids.ts";
import { type ClassificationState, classificationState } from "./classification-state.ts";

type Account = typeof accounts.$inferSelect;
type Transaction = typeof transactions.$inferSelect;
type TransactionPart = typeof transactionParts.$inferSelect;
type LegacySourceKind = (typeof legacyTransactionSources.$inferSelect)["sourceKind"];

export const TRANSACTIONS_PAGE_SIZE = 50;

/** The category of a part; `parentCategoryName` is null when it is a root category. */
export type PartCategory = { categoryName: string; parentCategoryName: string | null };

export type TransactionListItem = Pick<
  Transaction,
  "id" | "bookingDate" | "description" | "amountMinor"
> & {
  accountName: string;
  /** The currency of the account, which is the currency of the transaction. */
  currency: string;
  state: ClassificationState;
  /** In the order of the part IDs. */
  parts: PartCategory[];
  hasPossibleDuplicate: boolean;
};

export type TransactionList = {
  items: TransactionListItem[];
  total: number;
  /** The page shown, from 1 to `pageCount`. */
  page: number;
  /** At least 1, even without transactions. */
  pageCount: number;
};

export type TransactionPartDetails = PartCategory &
  Pick<TransactionPart, "id" | "amountMinor" | "label" | "reportingClass" | "approved">;

/** The other transaction of a possible duplicate pair. */
export type PossibleDuplicate = Pick<
  Transaction,
  "id" | "bookingDate" | "amountMinor" | "description"
> & {
  currency: string;
  sourceKind: LegacySourceKind | null;
};

export type TransactionDetails = Omit<TransactionListItem, "parts"> &
  Pick<Transaction, "operationDate" | "reportingScopeOverride"> & {
    accountReportingScope: Account["reportingScope"];
    /** Null for a transaction without a trace of the old version. */
    sourceKind: LegacySourceKind | null;
    /** In the order of the part IDs. */
    parts: TransactionPartDetails[];
    /** By booking date, then by ID. */
    possibleDuplicates: PossibleDuplicate[];
  };

const parentCategories = alias(categories, "parent_categories");

/** The parts of the given transactions with their categories, by part ID. */
async function readParts(db: NodePgDatabase, ids: readonly TransactionId[]) {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select({
      id: transactionParts.id,
      transactionId: transactionParts.transactionId,
      categoryName: categories.name,
      parentCategoryName: parentCategories.name,
      amountMinor: transactionParts.amountMinor,
      label: transactionParts.label,
      reportingClass: transactionParts.reportingClass,
      approved: transactionParts.approved,
    })
    .from(transactionParts)
    .innerJoin(categories, eq(categories.id, transactionParts.categoryId))
    .leftJoin(parentCategories, eq(parentCategories.id, categories.parentId))
    .where(inArray(transactionParts.transactionId, [...ids]))
    .orderBy(asc(transactionParts.id));
}

/** The pairs that contain any of the given transactions, on either side. */
async function readPairs(db: NodePgDatabase, ids: readonly TransactionId[]) {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select({
      firstTransactionId: possibleDuplicates.firstTransactionId,
      secondTransactionId: possibleDuplicates.secondTransactionId,
    })
    .from(possibleDuplicates)
    .where(
      or(
        inArray(possibleDuplicates.firstTransactionId, [...ids]),
        inArray(possibleDuplicates.secondTransactionId, [...ids]),
      ),
    );
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * One page of transactions, newest booking date first and, within a date, the
 * later in the source first (IDs are UUIDv7 given in source order). A page
 * outside `1…pageCount` gives the nearest one.
 */
export async function listTransactions(
  db: NodePgDatabase,
  page: number,
): Promise<TransactionList> {
  const [{ total }] = await db.select({ total: count() }).from(transactions);
  const pageCount = Math.max(1, Math.ceil(total / TRANSACTIONS_PAGE_SIZE));
  const shown = clamp(Number.isInteger(page) ? page : 1, 1, pageCount);

  const rows = await db
    .select({
      id: transactions.id,
      bookingDate: transactions.bookingDate,
      description: transactions.description,
      accountName: accounts.name,
      currency: accounts.currency,
      amountMinor: transactions.amountMinor,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .orderBy(desc(transactions.bookingDate), desc(transactions.id))
    .limit(TRANSACTIONS_PAGE_SIZE)
    .offset((shown - 1) * TRANSACTIONS_PAGE_SIZE);

  const ids = rows.map((row) => row.id);
  const [parts, pairs] = await Promise.all([readParts(db, ids), readPairs(db, ids)]);

  const partsByTransaction = new Map<TransactionId, typeof parts>();
  for (const part of parts) {
    const list = partsByTransaction.get(part.transactionId) ?? [];
    list.push(part);
    partsByTransaction.set(part.transactionId, list);
  }
  const paired = new Set<TransactionId>();
  for (const pair of pairs) {
    paired.add(pair.firstTransactionId);
    paired.add(pair.secondTransactionId);
  }

  const items = rows.map((row): TransactionListItem => {
    const own = partsByTransaction.get(row.id) ?? [];
    return {
      ...row,
      state: classificationState(row.amountMinor, own),
      parts: own.map(({ categoryName, parentCategoryName }) => ({
        categoryName,
        parentCategoryName,
      })),
      hasPossibleDuplicate: paired.has(row.id),
    };
  });

  return { items, total, page: shown, pageCount };
}

/** The details of one transaction, or null when there is none with this ID. */
export async function getTransaction(
  db: NodePgDatabase,
  id: TransactionId,
): Promise<TransactionDetails | null> {
  const [row] = await db
    .select({
      id: transactions.id,
      bookingDate: transactions.bookingDate,
      operationDate: transactions.operationDate,
      description: transactions.description,
      amountMinor: transactions.amountMinor,
      reportingScopeOverride: transactions.reportingScopeOverride,
      accountName: accounts.name,
      currency: accounts.currency,
      accountReportingScope: accounts.reportingScope,
      sourceKind: legacyTransactionSources.sourceKind,
    })
    .from(transactions)
    .innerJoin(accounts, eq(accounts.id, transactions.accountId))
    .leftJoin(legacyTransactionSources, eq(legacyTransactionSources.transactionId, transactions.id))
    .where(eq(transactions.id, id));
  if (row === undefined) {
    return null;
  }

  const [parts, pairs] = await Promise.all([readParts(db, [id]), readPairs(db, [id])]);
  const otherIds = pairs.map((pair) =>
    pair.firstTransactionId === id ? pair.secondTransactionId : pair.firstTransactionId,
  );
  const others =
    otherIds.length === 0
      ? []
      : await db
          .select({
            id: transactions.id,
            bookingDate: transactions.bookingDate,
            amountMinor: transactions.amountMinor,
            description: transactions.description,
            currency: accounts.currency,
            sourceKind: legacyTransactionSources.sourceKind,
          })
          .from(transactions)
          .innerJoin(accounts, eq(accounts.id, transactions.accountId))
          .leftJoin(
            legacyTransactionSources,
            eq(legacyTransactionSources.transactionId, transactions.id),
          )
          .where(inArray(transactions.id, otherIds))
          .orderBy(asc(transactions.bookingDate), asc(transactions.id));

  return {
    ...row,
    state: classificationState(row.amountMinor, parts),
    parts: parts.map(
      (part): TransactionPartDetails => ({
        id: part.id,
        categoryName: part.categoryName,
        parentCategoryName: part.parentCategoryName,
        amountMinor: part.amountMinor,
        label: part.label,
        reportingClass: part.reportingClass,
        approved: part.approved,
      }),
    ),
    hasPossibleDuplicate: others.length > 0,
    possibleDuplicates: others,
  };
}
