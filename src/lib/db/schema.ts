// Database schema of the new version: accounts, categories, transactions and
// their parts, and the tables that map rows of the old version to the records
// created from them or keep old data that has no target model yet.
//
// Loaded by the Next server, by plain `node` scripts and by drizzle-kit, so it
// imports only from packages, plus types through relative `.ts` paths. Enum
// values are English identifiers; the names shown to the user come from the
// translation file. New IDs are UUIDv7, given by PostgreSQL 18 (`uuidv7()`).
// Every ID column carries its brand from `ids.ts`, so the IDs that queries and
// `RETURNING` give back are branded where they leave the database.
//
// After a change here run `npm run db:generate` and commit the new migration.

import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import type {
  AccountId,
  CategoryId,
  LegacyAccountId,
  LegacyBankConnectionId,
  LegacyBankSyncRunId,
  LegacyCategoryId,
  LegacyClassificationResultId,
  LegacyClassificationRuleId,
  LegacyHistoricalProposalId,
  LegacyImportRunId,
  LegacyMerchantId,
  LegacySourceFileId,
  LegacyTransactionId,
  TransactionId,
  TransactionPartId,
} from "../ids.ts";

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

/** How a transaction part counts in reports. */
export const reportingClass = pgEnum("reporting_class", [
  "standard",
  "business_tax",
  "business_expense",
  "savings_investment",
]);

/** Where a transaction of the old version came from. */
export const legacySourceKind = pgEnum("legacy_source_kind", [
  "legacy_excel",
  "bank_file",
  "bank_api",
  "manual",
]);

/** What produced a classification result of the old version. */
export const legacyClassifierType = pgEnum("legacy_classifier_type", [
  "merchant_rule",
  "regex_rule",
  "historical_seed",
  "similar_history",
  "local_classifier",
  "ollama",
]);

export const legacyClassificationStatus = pgEnum("legacy_classification_status", [
  "suggested",
  "approved",
  "rejected",
  "conflict",
  "superseded",
]);

function createdAt() {
  return timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
}

function updatedAt() {
  return timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
}

export const accounts = pgTable(
  "accounts",
  {
    id: uuid("id").$type<AccountId>().primaryKey().default(sql`uuidv7()`),
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
    id: uuid("id").$type<CategoryId>().primaryKey().default(sql`uuidv7()`),
    /** Null for a root category; there are two levels at most. */
    parentId: uuid("parent_id")
      .$type<CategoryId>()
      .references((): AnyPgColumn => categories.id, { onDelete: "restrict" }),
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

/**
 * Old account ID → account created from it. Several old accounts may point at
 * one account: the layout file merged them.
 */
export const legacyAccountMap = pgTable("legacy_account_map", {
  legacyId: uuid("legacy_id").$type<LegacyAccountId>().primaryKey(),
  accountId: uuid("account_id")
    .$type<AccountId>()
    .notNull()
    .references(() => accounts.id, { onDelete: "restrict" }),
  migratedAt: timestamp("migrated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Old category ID → category created from it. Several old rows may point at
 * one category: old names that differ only in case were merged.
 */
export const legacyCategoryMap = pgTable("legacy_category_map", {
  legacyId: uuid("legacy_id").$type<LegacyCategoryId>().primaryKey(),
  categoryId: uuid("category_id")
    .$type<CategoryId>()
    .notNull()
    .references(() => categories.id, { onDelete: "restrict" }),
  migratedAt: timestamp("migrated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A transaction on an account. Its currency is the currency of the account.
 * Inflows are positive, outflows negative. The list orders by booking date,
 * then by ID: IDs are UUIDv7, so rows inserted in source order keep it.
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").$type<TransactionId>().primaryKey().default(sql`uuidv7()`),
    accountId: uuid("account_id")
      .$type<AccountId>()
      .notNull()
      .references(() => accounts.id, { onDelete: "restrict" }),
    /** `YYYY-MM-DD`; the date that places the transaction in a month. */
    bookingDate: date("booking_date", { mode: "string" }).notNull(),
    operationDate: date("operation_date", { mode: "string" }),
    /** In the smallest unit of the account currency. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    description: text("description"),
    /** Replaces the reporting scope of the account for this transaction. */
    reportingScopeOverride: reportingScope("reporting_scope_override"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("transactions_booking_date_id_idx").on(t.bookingDate.desc(), t.id.desc()),
    index("transactions_account_id_idx").on(t.accountId),
  ],
);

/**
 * A part of a transaction in one category. A transaction without parts is
 * unclassified; the classification state is derived from the parts, never
 * stored.
 */
export const transactionParts = pgTable(
  "transaction_parts",
  {
    id: uuid("id").$type<TransactionPartId>().primaryKey().default(sql`uuidv7()`),
    transactionId: uuid("transaction_id")
      .$type<TransactionId>()
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .$type<CategoryId>()
      .notNull()
      .references(() => categories.id, { onDelete: "restrict" }),
    /** In the smallest unit of the account currency. */
    amountMinor: bigint("amount_minor", { mode: "bigint" }).notNull(),
    /** Set on parts in a `labeled` category. */
    label: text("label"),
    reportingClass: reportingClass("reporting_class").notNull().default("standard"),
    approved: boolean("approved").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("transaction_parts_transaction_id_idx").on(t.transactionId),
    index("transaction_parts_category_id_idx").on(t.categoryId),
  ],
);

/** Old transaction ID → transaction created from it, one to one. */
export const legacyTransactionMap = pgTable("legacy_transaction_map", {
  legacyId: uuid("legacy_id").$type<LegacyTransactionId>().primaryKey(),
  transactionId: uuid("transaction_id")
    .$type<TransactionId>()
    .notNull()
    .unique("legacy_transaction_map_transaction_id_key")
    .references(() => transactions.id, { onDelete: "restrict" }),
  migratedAt: timestamp("migrated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Where a migrated transaction came from, in the shape of the old data: the
 * source columns of the old transaction with the import run, source file and
 * bank connection it pointed at. One row per migrated transaction. The old IDs
 * have no foreign key, since those records are not migrated.
 */
export const legacyTransactionSources = pgTable("legacy_transaction_sources", {
  transactionId: uuid("transaction_id")
    .$type<TransactionId>()
    .primaryKey()
    .references(() => transactions.id, { onDelete: "cascade" }),
  sourceKind: legacySourceKind("source_kind").notNull(),
  legacyMerchantId: uuid("legacy_merchant_id").$type<LegacyMerchantId>(),
  legacyImportRunId: uuid("legacy_import_run_id").$type<LegacyImportRunId>(),
  importerType: text("importer_type"),
  importerVersion: text("importer_version"),
  legacySourceFileId: uuid("legacy_source_file_id").$type<LegacySourceFileId>(),
  sourceFileName: text("source_file_name"),
  sourceFileSha256: text("source_file_sha256"),
  sourceFileMimeType: text("source_file_mime_type"),
  sourceFileSizeBytes: bigint("source_file_size_bytes", { mode: "bigint" }),
  sourceSheet: text("source_sheet"),
  sourceCell: text("source_cell"),
  sourceRecordIndex: integer("source_record_index"),
  rawSourceValue: text("raw_source_value"),
  rawRecordHash: text("raw_record_hash"),
  normalizedRecordHash: text("normalized_record_hash"),
  bankRecordIdHash: text("bank_record_id_hash"),
  legacyBankConnectionId: uuid("legacy_bank_connection_id").$type<LegacyBankConnectionId>(),
  bankProvider: text("bank_provider"),
  /** The old `aspsp_name`. */
  bankName: text("bank_name"),
  bankCountry: text("bank_country"),
  legacyBankSyncRunId: uuid("legacy_bank_sync_run_id").$type<LegacyBankSyncRunId>(),
  bankSyncStartedAt: timestamp("bank_sync_started_at", { withTimezone: true }),
  providerSourceMetadata: jsonb("provider_source_metadata").$type<Record<string, unknown>>(),
});

/**
 * Classification results of the old version (suggestions of its classifiers),
 * kept with their old values, timestamps included, for later suggestions. The
 * old rule and proposal IDs have no foreign key.
 */
export const legacyClassificationResults = pgTable("legacy_classification_results", {
  legacyId: uuid("legacy_id").$type<LegacyClassificationResultId>().primaryKey(),
  transactionId: uuid("transaction_id")
    .$type<TransactionId>()
    .notNull()
    .references(() => transactions.id, { onDelete: "cascade" }),
  categoryId: uuid("category_id")
    .$type<CategoryId>()
    .references(() => categories.id, { onDelete: "restrict" }),
  label: text("label"),
  legacyRuleId: uuid("legacy_rule_id").$type<LegacyClassificationRuleId>(),
  legacyRuleIds: jsonb("legacy_rule_ids").$type<LegacyClassificationRuleId[]>().notNull(),
  classifierType: legacyClassifierType("classifier_type").notNull(),
  classifierVersion: text("classifier_version").notNull(),
  /** Confidence in basis points, 10 000 being certain. */
  confidenceBps: integer("confidence_bps"),
  reason: text("reason"),
  legacyHistoricalProposalId: uuid(
    "legacy_historical_proposal_id",
  ).$type<LegacyHistoricalProposalId>(),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull(),
  status: legacyClassificationStatus("status").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

/**
 * Two transactions that may record the same money movement. A pair is only
 * marked: both transactions still count until someone resolves it. The
 * migration puts the row from the bank first and the row from the spreadsheet
 * second.
 */
export const possibleDuplicates = pgTable(
  "possible_duplicates",
  {
    firstTransactionId: uuid("first_transaction_id")
      .$type<TransactionId>()
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    secondTransactionId: uuid("second_transaction_id")
      .$type<TransactionId>()
      .notNull()
      .references(() => transactions.id, { onDelete: "cascade" }),
    /**
     * Days between the two transactions: for a migrated pair, the smaller of
     * the gaps from the sheet row's booking date to the bank row's booking
     * date and to its operation date.
     */
    dayDifference: integer("day_difference").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.firstTransactionId, t.secondTransactionId] }),
    check(
      "possible_duplicates_distinct_check",
      sql`${t.firstTransactionId} <> ${t.secondTransactionId}`,
    ),
    check("possible_duplicates_day_difference_check", sql`${t.dayDifference} >= 0`),
    index("possible_duplicates_second_transaction_id_idx").on(t.secondTransactionId),
  ],
);
