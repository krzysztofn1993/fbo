// A made-up old database for the migration tests: a hand-written minimal DDL
// with only the columns the migration reads, made-up rows and a made-up
// category layout. Nothing here comes from a real instance.
//
// Imported by tests only; relative `.ts` imports like the modules the
// migration script loads.

import {
  type LegacyAccountId,
  LegacyAccountIdSchema,
  type LegacyBankConnectionId,
  LegacyBankConnectionIdSchema,
  type LegacyBankSyncRunId,
  LegacyBankSyncRunIdSchema,
  type LegacyCategoryId,
  LegacyCategoryIdSchema,
  type LegacyClassificationResultId,
  LegacyClassificationResultIdSchema,
  type LegacyClassificationRuleId,
  LegacyClassificationRuleIdSchema,
  type LegacyHistoricalProposalId,
  LegacyHistoricalProposalIdSchema,
  type LegacyImportRunId,
  LegacyImportRunIdSchema,
  type LegacyMerchantId,
  LegacyMerchantIdSchema,
  type LegacySourceFileId,
  LegacySourceFileIdSchema,
  type LegacyTransactionId,
  LegacyTransactionIdSchema,
} from "../ids.ts";
import type { LegacyAccountRow, LegacyCategoryRow } from "./accounts-categories.ts";
import { ACCOUNT_REFERENCE_TABLES } from "./read.ts";

/** A pool, a client or a pool client. */
type Queryable = {
  query(text: string, values?: unknown[]): Promise<unknown>;
};

/** Tables that only need to exist with an `account_id` column. */
const ACCOUNT_STUB_TABLES = ACCOUNT_REFERENCE_TABLES.filter((table) => table !== "transactions");

/** Drops and recreates the old tables; the old enums are PostgreSQL enums too. */
export async function createLegacySchema(client: Queryable): Promise<void> {
  const stubTables = ACCOUNT_STUB_TABLES.map(
    (table) => `CREATE TABLE ${table} (account_id uuid REFERENCES accounts (id));`,
  ).join("\n");
  await client.query(`
    DROP TABLE IF EXISTS classification_results, transaction_splits, transactions,
      bank_sync_runs, bank_connections, import_runs, source_files,
      ${ACCOUNT_STUB_TABLES.join(", ")}, categories, accounts CASCADE;
    DROP TYPE IF EXISTS account_type, reporting_scope, category_kind, transaction_source_kind,
      reporting_class, classification_result_classifier_type, classification_result_status;
    CREATE TYPE account_type AS ENUM ('bank', 'cash', 'investment', 'liability', 'other');
    CREATE TYPE reporting_scope AS ENUM ('personal', 'business', 'excluded');
    CREATE TYPE category_kind AS ENUM ('income', 'expense', 'transfer', 'mixed');
    CREATE TYPE transaction_source_kind AS ENUM ('legacy_excel', 'bank_file', 'bank_api', 'manual');
    CREATE TYPE reporting_class AS ENUM
      ('standard', 'business_tax', 'business_expense', 'savings_investment');
    CREATE TYPE classification_result_classifier_type AS ENUM ('merchant_rule', 'regex_rule',
      'historical_seed', 'similar_history', 'local_classifier', 'ollama');
    CREATE TYPE classification_result_status AS ENUM
      ('suggested', 'approved', 'rejected', 'conflict', 'superseded');
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
    ${stubTables}
    CREATE TABLE source_files (
      id uuid PRIMARY KEY,
      original_name text NOT NULL,
      mime_type text NOT NULL,
      size_bytes bigint NOT NULL,
      sha256 text NOT NULL UNIQUE
    );
    CREATE TABLE import_runs (
      id uuid PRIMARY KEY,
      source_file_id uuid NOT NULL REFERENCES source_files (id),
      importer_type text NOT NULL,
      importer_version text NOT NULL
    );
    CREATE TABLE bank_connections (
      id uuid PRIMARY KEY,
      provider text NOT NULL,
      aspsp_name text NOT NULL,
      aspsp_country varchar(2) NOT NULL
    );
    CREATE TABLE bank_sync_runs (
      id uuid PRIMARY KEY,
      bank_connection_id uuid NOT NULL REFERENCES bank_connections (id),
      started_at timestamptz NOT NULL
    );
    CREATE TABLE transactions (
      id uuid PRIMARY KEY,
      account_id uuid REFERENCES accounts (id),
      merchant_id uuid,
      booking_date date NOT NULL,
      operation_date date,
      amount_minor bigint NOT NULL,
      currency varchar(3) NOT NULL,
      source_kind transaction_source_kind NOT NULL,
      reporting_scope_override reporting_scope,
      description text,
      note text,
      refund_of_transaction_id uuid REFERENCES transactions (id),
      import_run_id uuid REFERENCES import_runs (id),
      source_file_id uuid REFERENCES source_files (id),
      source_sheet text,
      source_cell text,
      source_record_index integer,
      raw_source_value text,
      raw_record_hash text,
      normalized_record_hash text,
      bank_record_id_hash text,
      bank_connection_id uuid REFERENCES bank_connections (id),
      bank_sync_run_id uuid REFERENCES bank_sync_runs (id),
      provider_source_metadata jsonb,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );
    CREATE TABLE transaction_splits (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      transaction_id uuid NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
      category_id uuid NOT NULL REFERENCES categories (id),
      amount_minor bigint NOT NULL,
      label text,
      reporting_class reporting_class NOT NULL DEFAULT 'standard',
      manually_approved boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );
    CREATE TABLE classification_results (
      id uuid PRIMARY KEY,
      transaction_id uuid NOT NULL REFERENCES transactions (id) ON DELETE CASCADE,
      category_id uuid REFERENCES categories (id),
      label text,
      rule_id uuid,
      rule_ids jsonb NOT NULL DEFAULT '[]',
      classifier_type classification_result_classifier_type NOT NULL,
      classifier_version text NOT NULL DEFAULT '1',
      confidence_bps integer,
      reason text,
      historical_proposal_id uuid,
      provenance jsonb NOT NULL DEFAULT '{}',
      status classification_result_status NOT NULL,
      created_at timestamptz NOT NULL,
      updated_at timestamptz NOT NULL
    );
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

// Transactions. Booking dates fall in March and April 2024; old timestamps in
// January, shared by each import as in the old version. Amounts are made up.

export const SOURCE_FILE_1 = LegacySourceFileIdSchema.parse("f1000000-0000-4000-8000-000000000001");
export const IMPORT_RUN_1 = LegacyImportRunIdSchema.parse("f2000000-0000-4000-8000-000000000001");
export const BANK_CONNECTION_1 = LegacyBankConnectionIdSchema.parse(
  "f3000000-0000-4000-8000-000000000001",
);
export const BANK_SYNC_RUN_1 = LegacyBankSyncRunIdSchema.parse(
  "f4000000-0000-4000-8000-000000000001",
);
export const MERCHANT_1 = LegacyMerchantIdSchema.parse("f5000000-0000-4000-8000-000000000001");
export const RULE_1 = LegacyClassificationRuleIdSchema.parse(
  "f6000000-0000-4000-8000-000000000001",
);
export const RULE_2 = LegacyClassificationRuleIdSchema.parse(
  "f6000000-0000-4000-8000-000000000002",
);
export const PROPOSAL_1 = LegacyHistoricalProposalIdSchema.parse(
  "f7000000-0000-4000-8000-000000000001",
);

const transactionId = (n: number): LegacyTransactionId =>
  LegacyTransactionIdSchema.parse(`d0000000-0000-4000-8000-${String(n).padStart(12, "0")}`);

// The old IDs are numbered against the order in the source, so a migration
// that kept the order of the old IDs would fail the order test.
/** Spreadsheet, a label in the labeled category, record 2 of sheet 1. */
export const TX_SHEET_LABELED = transactionId(5);
/** Spreadsheet, income with a label that the new model drops, record 1 of sheet 1. */
export const TX_SHEET_INCOME = transactionId(7);
/** Spreadsheet, on the EUR account, with a business reporting class and a scope override. */
export const TX_SHEET_CASH = transactionId(1);
/** Spreadsheet, without parts or description. */
export const TX_SHEET_UNCLASSIFIED = transactionId(2);
/** Spreadsheet, split into two parts. */
export const TX_SHEET_SPLIT = transactionId(9);
/** Bank, approved part and an approved classification result, with a merchant. */
export const TX_BANK_APPROVED = transactionId(3);
/** Bank, a part that is not approved and a suggested result. */
export const TX_BANK_REVIEW = transactionId(8);
/** Bank, without parts, a rejected result without a category, no operation date. */
export const TX_BANK_UNCLASSIFIED = transactionId(4);
/** Bank, in April. */
export const TX_BANK_APRIL = transactionId(6);

/** The fixture transactions in their position in the source, the order the migration keeps. */
export const SOURCE_ORDER: LegacyTransactionId[] = [
  // 2024-03-05: spreadsheet by file, sheet and record, then the bank by operation date.
  TX_SHEET_INCOME,
  TX_SHEET_LABELED,
  TX_SHEET_CASH,
  TX_BANK_REVIEW,
  TX_BANK_APPROVED,
  TX_BANK_UNCLASSIFIED,
  // 2024-03-12, 2024-04-02, 2024-04-10.
  TX_SHEET_UNCLASSIFIED,
  TX_BANK_APRIL,
  TX_SHEET_SPLIT,
];

export type LegacyTransactionSeed = {
  id: LegacyTransactionId;
  accountId: LegacyAccountId | null;
  merchantId: LegacyMerchantId | null;
  bookingDate: string;
  operationDate: string | null;
  amountMinor: bigint;
  currency: string;
  sourceKind: string;
  reportingScopeOverride: string | null;
  description: string | null;
  note: string | null;
  refundOfTransactionId: LegacyTransactionId | null;
  importRunId: LegacyImportRunId | null;
  sourceFileId: LegacySourceFileId | null;
  sourceSheet: string | null;
  sourceCell: string | null;
  sourceRecordIndex: number | null;
  rawSourceValue: string | null;
  rawRecordHash: string | null;
  normalizedRecordHash: string | null;
  bankRecordIdHash: string | null;
  bankConnectionId: LegacyBankConnectionId | null;
  bankSyncRunId: LegacyBankSyncRunId | null;
  providerSourceMetadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LegacyPartSeed = {
  transactionId: LegacyTransactionId;
  categoryId: LegacyCategoryId;
  amountMinor: bigint;
  label: string | null;
  reportingClass: string;
  manuallyApproved: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type LegacyClassificationResultSeed = {
  id: LegacyClassificationResultId;
  transactionId: LegacyTransactionId;
  categoryId: LegacyCategoryId | null;
  label: string | null;
  ruleId: LegacyClassificationRuleId | null;
  ruleIds: LegacyClassificationRuleId[];
  classifierType: string;
  classifierVersion: string;
  confidenceBps: number | null;
  reason: string | null;
  historicalProposalId: LegacyHistoricalProposalId | null;
  provenance: Record<string, unknown>;
  status: string;
  createdAt: Date;
  updatedAt: Date;
};

function sheetRow(
  id: LegacyTransactionId,
  values: Pick<LegacyTransactionSeed, "bookingDate" | "amountMinor" | "description"> &
    Partial<LegacyTransactionSeed> & { sourceSheet: string; sourceRecordIndex: number },
): LegacyTransactionSeed {
  return {
    id,
    accountId: ACCOUNT_BANK_1,
    merchantId: null,
    operationDate: null,
    currency: "PLN",
    sourceKind: "legacy_excel",
    reportingScopeOverride: null,
    note: null,
    refundOfTransactionId: null,
    importRunId: IMPORT_RUN_1,
    sourceFileId: SOURCE_FILE_1,
    sourceCell: `B${values.sourceRecordIndex + 1}`,
    rawSourceValue: String(values.amountMinor),
    rawRecordHash: `raw-${id.slice(-2)}`,
    normalizedRecordHash: `normalized-${id.slice(-2)}`,
    bankRecordIdHash: null,
    bankConnectionId: null,
    bankSyncRunId: null,
    providerSourceMetadata: null,
    createdAt: at(10),
    updatedAt: at(10),
    ...values,
  };
}

function bankRow(
  id: LegacyTransactionId,
  values: Pick<LegacyTransactionSeed, "bookingDate" | "operationDate" | "amountMinor"> &
    Partial<LegacyTransactionSeed>,
): LegacyTransactionSeed {
  return {
    id,
    accountId: ACCOUNT_BANK_1,
    merchantId: null,
    currency: "PLN",
    sourceKind: "bank_api",
    reportingScopeOverride: null,
    description: `opis z banku ${id.slice(-1)}`,
    note: null,
    refundOfTransactionId: null,
    importRunId: null,
    sourceFileId: null,
    sourceSheet: null,
    sourceCell: null,
    sourceRecordIndex: null,
    rawSourceValue: null,
    rawRecordHash: `raw-${id.slice(-2)}`,
    normalizedRecordHash: `normalized-${id.slice(-2)}`,
    bankRecordIdHash: `bank-record-${id.slice(-2)}`,
    bankConnectionId: BANK_CONNECTION_1,
    bankSyncRunId: BANK_SYNC_RUN_1,
    providerSourceMetadata: { status: "BOOK" },
    createdAt: at(20),
    updatedAt: at(20),
    ...values,
  };
}

export const LEGACY_TRANSACTIONS: LegacyTransactionSeed[] = [
  sheetRow(TX_SHEET_LABELED, {
    bookingDate: "2024-03-05",
    amountMinor: -1500n,
    description: "opis 1",
    sourceSheet: "Arkusz 1",
    sourceRecordIndex: 2,
  }),
  sheetRow(TX_SHEET_INCOME, {
    bookingDate: "2024-03-05",
    amountMinor: 50000n,
    description: "Premia",
    sourceSheet: "Arkusz 1",
    sourceRecordIndex: 1,
  }),
  sheetRow(TX_SHEET_CASH, {
    accountId: ACCOUNT_CASH_1,
    currency: "EUR",
    reportingScopeOverride: "personal",
    bookingDate: "2024-03-05",
    amountMinor: -700n,
    description: "opis 2",
    sourceSheet: "Arkusz 2",
    sourceRecordIndex: 1,
  }),
  sheetRow(TX_SHEET_UNCLASSIFIED, {
    bookingDate: "2024-03-12",
    amountMinor: -2500n,
    description: null,
    sourceSheet: "Arkusz 1",
    sourceRecordIndex: 3,
  }),
  sheetRow(TX_SHEET_SPLIT, {
    bookingDate: "2024-04-10",
    amountMinor: -3000n,
    description: "opis 3",
    sourceSheet: "Arkusz 1",
    sourceRecordIndex: 4,
  }),
  bankRow(TX_BANK_APPROVED, {
    bookingDate: "2024-03-05",
    operationDate: "2024-03-04",
    amountMinor: -1500n,
    merchantId: MERCHANT_1,
  }),
  bankRow(TX_BANK_REVIEW, {
    bookingDate: "2024-03-05",
    operationDate: "2024-03-03",
    amountMinor: -900n,
  }),
  bankRow(TX_BANK_UNCLASSIFIED, {
    bookingDate: "2024-03-05",
    operationDate: null,
    amountMinor: 12000n,
    providerSourceMetadata: null,
  }),
  bankRow(TX_BANK_APRIL, {
    bookingDate: "2024-04-02",
    operationDate: "2024-04-01",
    amountMinor: -1200n,
  }),
];

function part(
  transactionId: LegacyTransactionId,
  categoryId: LegacyCategoryId,
  amountMinor: bigint,
  values: Partial<LegacyPartSeed> = {},
): LegacyPartSeed {
  return {
    transactionId,
    categoryId,
    amountMinor,
    label: null,
    reportingClass: "standard",
    manuallyApproved: true,
    createdAt: at(10),
    updatedAt: at(11),
    ...values,
  };
}

export const LEGACY_PARTS: LegacyPartSeed[] = [
  part(TX_SHEET_LABELED, ROOT_C, -1500n, { label: "etykieta 1" }),
  // The old version labeled income parts with their category name.
  part(TX_SHEET_INCOME, SUB_B_BONUS_NEW, 50000n, { label: "Premia" }),
  part(TX_SHEET_CASH, SUB_A1, -700n, { reportingClass: "business_expense" }),
  part(TX_SHEET_SPLIT, SUB_A1, -1000n),
  part(TX_SHEET_SPLIT, SUB_A2, -2000n, { reportingClass: "business_tax" }),
  part(TX_BANK_APPROVED, SUB_A2, -1500n, { createdAt: at(20), updatedAt: at(21) }),
  part(TX_BANK_REVIEW, SUB_A1, -900n, {
    manuallyApproved: false,
    createdAt: at(20),
    updatedAt: at(20),
  }),
  part(TX_BANK_APRIL, SUB_A2, -1200n, { createdAt: at(20), updatedAt: at(20) }),
];

const resultId = (n: number): LegacyClassificationResultId =>
  LegacyClassificationResultIdSchema.parse(`e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`);

export const RESULT_APPROVED = resultId(1);
export const RESULT_SUGGESTED = resultId(2);
export const RESULT_REJECTED = resultId(3);

export const LEGACY_CLASSIFICATION_RESULTS: LegacyClassificationResultSeed[] = [
  {
    id: RESULT_APPROVED,
    transactionId: TX_BANK_APPROVED,
    categoryId: SUB_A2,
    label: null,
    ruleId: RULE_1,
    ruleIds: [RULE_1, RULE_2],
    classifierType: "merchant_rule",
    classifierVersion: "1",
    confidenceBps: 10000,
    reason: "reguła 1",
    historicalProposalId: null,
    provenance: { rule: "reguła 1" },
    status: "approved",
    createdAt: at(20),
    updatedAt: at(21),
  },
  {
    id: RESULT_SUGGESTED,
    transactionId: TX_BANK_REVIEW,
    categoryId: SUB_A1,
    label: null,
    ruleId: null,
    ruleIds: [],
    classifierType: "similar_history",
    classifierVersion: "2",
    confidenceBps: 7500,
    reason: "podobna transakcja",
    historicalProposalId: PROPOSAL_1,
    provenance: {},
    status: "suggested",
    createdAt: at(20),
    updatedAt: at(20),
  },
  {
    id: RESULT_REJECTED,
    transactionId: TX_BANK_UNCLASSIFIED,
    categoryId: null,
    label: null,
    ruleId: null,
    ruleIds: [],
    classifierType: "regex_rule",
    classifierVersion: "1",
    confidenceBps: null,
    reason: null,
    historicalProposalId: null,
    provenance: { pattern: "wzorzec 1" },
    status: "rejected",
    createdAt: at(20),
    updatedAt: at(22),
  },
];

/** Inserts one source file, import run, bank connection and bank sync run. */
export async function insertLegacySources(client: Queryable): Promise<void> {
  await client.query(
    "INSERT INTO source_files (id, original_name, mime_type, size_bytes, sha256)" +
      " VALUES ($1, 'plik 1.xlsx', 'application/vnd.ms-excel', 2048, 'sha-1')",
    [SOURCE_FILE_1],
  );
  await client.query(
    "INSERT INTO import_runs (id, source_file_id, importer_type, importer_version)" +
      " VALUES ($1, $2, 'importer 1', '1.0')",
    [IMPORT_RUN_1, SOURCE_FILE_1],
  );
  await client.query(
    "INSERT INTO bank_connections (id, provider, aspsp_name, aspsp_country)" +
      " VALUES ($1, 'provider 1', 'bank 1', 'PL')",
    [BANK_CONNECTION_1],
  );
  await client.query(
    "INSERT INTO bank_sync_runs (id, bank_connection_id, started_at) VALUES ($1, $2, $3)",
    [BANK_SYNC_RUN_1, BANK_CONNECTION_1, at(20)],
  );
}

export async function insertLegacyTransactions(
  client: Queryable,
  rows: readonly LegacyTransactionSeed[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      "INSERT INTO transactions (id, account_id, merchant_id, booking_date, operation_date," +
        " amount_minor, currency, source_kind, reporting_scope_override, description, note," +
        " refund_of_transaction_id, import_run_id, source_file_id, source_sheet, source_cell," +
        " source_record_index, raw_source_value, raw_record_hash, normalized_record_hash," +
        " bank_record_id_hash, bank_connection_id, bank_sync_run_id, provider_source_metadata," +
        " created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12," +
        " $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)",
      [
        row.id,
        row.accountId,
        row.merchantId,
        row.bookingDate,
        row.operationDate,
        row.amountMinor.toString(),
        row.currency,
        row.sourceKind,
        row.reportingScopeOverride,
        row.description,
        row.note,
        row.refundOfTransactionId,
        row.importRunId,
        row.sourceFileId,
        row.sourceSheet,
        row.sourceCell,
        row.sourceRecordIndex,
        row.rawSourceValue,
        row.rawRecordHash,
        row.normalizedRecordHash,
        row.bankRecordIdHash,
        row.bankConnectionId,
        row.bankSyncRunId,
        row.providerSourceMetadata === null ? null : JSON.stringify(row.providerSourceMetadata),
        row.createdAt,
        row.updatedAt,
      ],
    );
  }
}

export async function insertLegacyParts(
  client: Queryable,
  rows: readonly LegacyPartSeed[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      "INSERT INTO transaction_splits (transaction_id, category_id, amount_minor, label," +
        " reporting_class, manually_approved, created_at, updated_at)" +
        " VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        row.transactionId,
        row.categoryId,
        row.amountMinor.toString(),
        row.label,
        row.reportingClass,
        row.manuallyApproved,
        row.createdAt,
        row.updatedAt,
      ],
    );
  }
}

export async function insertLegacyClassificationResults(
  client: Queryable,
  rows: readonly LegacyClassificationResultSeed[],
): Promise<void> {
  for (const row of rows) {
    await client.query(
      "INSERT INTO classification_results (id, transaction_id, category_id, label, rule_id," +
        " rule_ids, classifier_type, classifier_version, confidence_bps, reason," +
        " historical_proposal_id, provenance, status, created_at, updated_at)" +
        " VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
      [
        row.id,
        row.transactionId,
        row.categoryId,
        row.label,
        row.ruleId,
        JSON.stringify(row.ruleIds),
        row.classifierType,
        row.classifierVersion,
        row.confidenceBps,
        row.reason,
        row.historicalProposalId,
        JSON.stringify(row.provenance),
        row.status,
        row.createdAt,
        row.updatedAt,
      ],
    );
  }
}

/** Fills the empty old tables with the made-up rows; only active accounts are referenced. */
export async function seedLegacyDatabase(client: Queryable): Promise<void> {
  await insertLegacyAccounts(client, LEGACY_ACCOUNTS);
  await insertLegacyCategories(client, LEGACY_CATEGORIES);
  await client.query("INSERT INTO account_live_balances (account_id) VALUES ($1)", [
    ACCOUNT_BANK_1,
  ]);
  await insertLegacySources(client);
  await insertLegacyTransactions(client, LEGACY_TRANSACTIONS);
  await insertLegacyParts(client, LEGACY_PARTS);
  await insertLegacyClassificationResults(client, LEGACY_CLASSIFICATION_RESULTS);
}

// Possible duplicate pairs: a separate set, added on top of the rows above,
// with a second bank account that the layout merges with "bank 1". One case
// per rule of the pairing, in May to July 2024; each case has an amount of its
// own, so no case can pair with another one or with the rows above.

export const ACCOUNT_BANK_2 = LegacyAccountIdSchema.parse("a0000000-0000-4000-8000-000000000004");

/** Older than "bank 1", so it leads the merged account. */
export const LEGACY_ACCOUNT_BANK_2: LegacyAccountRow = {
  id: ACCOUNT_BANK_2,
  name: "bank 2",
  type: "bank",
  currency: "PLN",
  reportingScope: "personal",
  isActive: true,
  createdAt: new Date("2023-12-01T00:00:00Z"),
  updatedAt: new Date("2023-12-02T00:00:00Z"),
};

/** The category layout with "bank 1" and "bank 2" merged into one new account. */
export const DUPLICATES_LAYOUT = {
  ...LEGACY_LAYOUT,
  accounts: [{ name: "Konto wspólne", legacyNames: ["bank 1", "bank 2"] }],
};

/** Same booking date, on the two merged old accounts: a pair, 0 days. */
export const DUP_SHEET_SAME_DAY = transactionId(201);
export const DUP_BANK_SAME_DAY = transactionId(202);
/** Booking dates five days apart, the operation date one day: a pair, 1 day. */
export const DUP_SHEET_OPERATION_DATE = transactionId(203);
export const DUP_BANK_OPERATION_DATE = transactionId(204);
/** From a bank file without an operation date, exactly three days: a pair, 3 days. */
export const DUP_SHEET_THREE_DAYS = transactionId(205);
export const DUP_BANK_THREE_DAYS = transactionId(206);
/** Four days from both dates of the bank row: no pair. */
export const DUP_SHEET_FOUR_DAYS = transactionId(207);
export const DUP_BANK_FOUR_DAYS = transactionId(208);
/** One bank row, two spreadsheet rows of the same amount: the closer one pairs. */
export const DUP_BANK_CONTESTED = transactionId(209);
export const DUP_SHEET_CLOSER = transactionId(210);
export const DUP_SHEET_FARTHER = transactionId(211);
/**
 * All three candidates are two days apart. The bank row with two candidates
 * would take the earlier spreadsheet row by booking date and position, but the
 * sum of candidate counts puts its pair with the later one first, so the
 * earlier spreadsheet row stays free for the bank row whose only candidate it
 * is (through the operation date): two pairs instead of one.
 */
export const SECOND_KEY_SHEET_EARLY = transactionId(212);
export const SECOND_KEY_SHEET_LATE = transactionId(213);
export const SECOND_KEY_BANK_BOTH = transactionId(214);
export const SECOND_KEY_BANK_ONE = transactionId(215);
/** Two bank rows and two spreadsheet rows on one day, each pair within one source: no pair. */
export const DUP_BANK_SAME_SOURCE_1 = transactionId(216);
export const DUP_BANK_SAME_SOURCE_2 = transactionId(217);
export const DUP_SHEET_SAME_SOURCE_1 = transactionId(218);
export const DUP_SHEET_SAME_SOURCE_2 = transactionId(219);
/** Same day and amount, but the spreadsheet row is on another new account: no pair. */
export const DUP_SHEET_OTHER_ACCOUNT = transactionId(220);
export const DUP_BANK_OTHER_ACCOUNT = transactionId(221);

const duplicateSheetRow = (
  id: LegacyTransactionId,
  sourceRecordIndex: number,
  bookingDate: string,
  amountMinor: bigint,
  values: Partial<Pick<LegacyTransactionSeed, "accountId" | "currency">> = {},
): LegacyTransactionSeed =>
  sheetRow(id, {
    bookingDate,
    amountMinor,
    description: `opis ${id.slice(-3)}`,
    sourceSheet: "Arkusz 3",
    sourceRecordIndex,
    ...values,
  });

export const LEGACY_DUPLICATE_TRANSACTIONS: LegacyTransactionSeed[] = [
  duplicateSheetRow(DUP_SHEET_SAME_DAY, 1, "2024-05-06", -4100n, { accountId: ACCOUNT_BANK_2 }),
  bankRow(DUP_BANK_SAME_DAY, {
    bookingDate: "2024-05-06",
    operationDate: "2024-05-03",
    amountMinor: -4100n,
  }),
  duplicateSheetRow(DUP_SHEET_OPERATION_DATE, 2, "2024-05-08", -4200n),
  bankRow(DUP_BANK_OPERATION_DATE, {
    bookingDate: "2024-05-13",
    operationDate: "2024-05-09",
    amountMinor: -4200n,
  }),
  duplicateSheetRow(DUP_SHEET_THREE_DAYS, 3, "2024-05-20", -4300n, { accountId: ACCOUNT_BANK_2 }),
  bankRow(DUP_BANK_THREE_DAYS, {
    sourceKind: "bank_file",
    bookingDate: "2024-05-23",
    operationDate: null,
    amountMinor: -4300n,
  }),
  duplicateSheetRow(DUP_SHEET_FOUR_DAYS, 4, "2024-05-27", -4400n),
  bankRow(DUP_BANK_FOUR_DAYS, {
    bookingDate: "2024-05-31",
    operationDate: "2024-05-23",
    amountMinor: -4400n,
  }),
  bankRow(DUP_BANK_CONTESTED, {
    bookingDate: "2024-06-04",
    operationDate: "2024-06-04",
    amountMinor: -4500n,
  }),
  duplicateSheetRow(DUP_SHEET_CLOSER, 5, "2024-06-04", -4500n),
  duplicateSheetRow(DUP_SHEET_FARTHER, 6, "2024-06-05", -4500n, { accountId: ACCOUNT_BANK_2 }),
  duplicateSheetRow(SECOND_KEY_SHEET_EARLY, 7, "2024-06-10", -4600n),
  duplicateSheetRow(SECOND_KEY_SHEET_LATE, 8, "2024-06-14", -4600n),
  bankRow(SECOND_KEY_BANK_BOTH, {
    bookingDate: "2024-06-12",
    operationDate: "2024-06-12",
    amountMinor: -4600n,
  }),
  bankRow(SECOND_KEY_BANK_ONE, {
    bookingDate: "2024-06-20",
    operationDate: "2024-06-08",
    amountMinor: -4600n,
  }),
  bankRow(DUP_BANK_SAME_SOURCE_1, {
    bookingDate: "2024-07-01",
    operationDate: "2024-07-01",
    amountMinor: -4700n,
  }),
  bankRow(DUP_BANK_SAME_SOURCE_2, {
    bookingDate: "2024-07-01",
    operationDate: "2024-07-01",
    amountMinor: -4700n,
  }),
  duplicateSheetRow(DUP_SHEET_SAME_SOURCE_1, 9, "2024-07-01", -4800n),
  duplicateSheetRow(DUP_SHEET_SAME_SOURCE_2, 10, "2024-07-01", -4800n, {
    accountId: ACCOUNT_BANK_2,
  }),
  duplicateSheetRow(DUP_SHEET_OTHER_ACCOUNT, 11, "2024-07-08", -4900n, {
    accountId: ACCOUNT_CASH_1,
    currency: "EUR",
  }),
  bankRow(DUP_BANK_OTHER_ACCOUNT, {
    bookingDate: "2024-07-08",
    operationDate: "2024-07-08",
    amountMinor: -4900n,
  }),
];

/**
 * Adds the second bank account and the duplicate cases to a database filled
 * by `seedLegacyDatabase`; run the migration with `DUPLICATES_LAYOUT`.
 */
export async function seedLegacyDuplicates(client: Queryable): Promise<void> {
  await insertLegacyAccounts(client, [LEGACY_ACCOUNT_BANK_2]);
  await insertLegacyTransactions(client, LEGACY_DUPLICATE_TRANSACTIONS);
}
