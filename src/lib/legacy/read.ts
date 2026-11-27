// Reads what the migration needs from the old database: accounts, categories,
// transactions with their source trace, parts and classification results. One
// read-only REPEATABLE READ transaction, so every query sees the same
// snapshot, and nothing but SELECT statements.
//
// The rows come from another system, so each one is parsed by a Zod schema
// before the translation sees it: the old IDs get their brands here, and a row
// of an unexpected shape is reported with every other one instead of being
// trusted. Enum values stay text; the translation checks them against the new
// schema. Amounts and dates come as text, so no value passes through a
// JavaScript number or a time zone.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// packages and relative `.ts` paths and uses only erasable syntax.

import type pg from "pg";
import { z } from "zod";

import {
  type LegacyAccountId,
  LegacyAccountIdSchema,
  LegacyBankConnectionIdSchema,
  LegacyBankSyncRunIdSchema,
  LegacyCategoryIdSchema,
  LegacyClassificationResultIdSchema,
  LegacyClassificationRuleIdSchema,
  LegacyHistoricalProposalIdSchema,
  LegacyImportRunIdSchema,
  LegacyMerchantIdSchema,
  LegacySourceFileIdSchema,
  LegacyTransactionIdSchema,
} from "../ids.ts";
import type { LegacyAccountRow, LegacyCategoryRow } from "./accounts-categories.ts";
import type {
  LegacyClassificationResultRow,
  LegacyTransactionPartRow,
  LegacyTransactionRow,
} from "./transactions.ts";

export type LegacySnapshot = {
  accounts: LegacyAccountRow[];
  referencedInactiveAccountIds: Set<LegacyAccountId>;
  categories: LegacyCategoryRow[];
  transactions: LegacyTransactionRow[];
  parts: LegacyTransactionPartRow[];
  classificationResults: LegacyClassificationResultRow[];
};

export type LegacySnapshotResult =
  | { ok: true; snapshot: LegacySnapshot }
  | { ok: false; problems: string[] };

/** Rows exactly as the queries below return them. */
export type LegacyRecords = {
  accounts: readonly unknown[];
  referencedInactive: readonly unknown[];
  categories: readonly unknown[];
  transactions: readonly unknown[];
  parts: readonly unknown[];
  classificationResults: readonly unknown[];
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

// The order of the transactions is set by the translation, from their
// position in the source; ordering by the old ID only makes the read stable.
const TRANSACTIONS_SQL = `
  SELECT t.id::text AS id, t.account_id::text AS account_id, t.merchant_id::text AS merchant_id,
         t.booking_date::text AS booking_date, t.operation_date::text AS operation_date,
         t.amount_minor::text AS amount_minor, t.currency, t.source_kind::text AS source_kind,
         t.reporting_scope_override::text AS reporting_scope_override, t.description, t.note,
         t.refund_of_transaction_id::text AS refund_of_transaction_id,
         t.import_run_id::text AS import_run_id, ir.importer_type, ir.importer_version,
         t.source_file_id::text AS source_file_id, sf.original_name AS source_file_name,
         sf.sha256 AS source_file_sha256, sf.mime_type AS source_file_mime_type,
         sf.size_bytes::text AS source_file_size_bytes,
         t.source_sheet, t.source_cell, t.source_record_index, t.raw_source_value,
         t.raw_record_hash, t.normalized_record_hash, t.bank_record_id_hash,
         t.bank_connection_id::text AS bank_connection_id, bc.provider AS bank_provider,
         bc.aspsp_name AS bank_name, bc.aspsp_country AS bank_country,
         t.bank_sync_run_id::text AS bank_sync_run_id, bsr.started_at AS bank_sync_started_at,
         t.provider_source_metadata, t.created_at, t.updated_at
  FROM transactions t
  LEFT JOIN import_runs ir ON ir.id = t.import_run_id
  LEFT JOIN source_files sf ON sf.id = t.source_file_id
  LEFT JOIN bank_connections bc ON bc.id = t.bank_connection_id
  LEFT JOIN bank_sync_runs bsr ON bsr.id = t.bank_sync_run_id
  ORDER BY t.id`;

const PARTS_SQL = `
  SELECT transaction_id::text AS transaction_id, category_id::text AS category_id,
         amount_minor::text AS amount_minor, label, reporting_class::text AS reporting_class,
         manually_approved, created_at, updated_at
  FROM transaction_splits
  ORDER BY id`;

const CLASSIFICATION_RESULTS_SQL = `
  SELECT id::text AS id, transaction_id::text AS transaction_id, category_id::text AS category_id,
         label, rule_id::text AS rule_id, rule_ids, classifier_type::text AS classifier_type,
         classifier_version, confidence_bps, reason,
         historical_proposal_id::text AS historical_proposal_id, provenance,
         status::text AS status, created_at, updated_at
  FROM classification_results
  ORDER BY id`;

/** A whole number of minor units, as `bigint::text` gives it. */
const AmountSchema = z
  .string()
  .regex(/^-?\d+$/)
  .transform((value) => BigInt(value));
/** A calendar date, as `date::text` gives it. */
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** A `jsonb` object. */
const JsonObjectSchema = z.record(z.string(), z.unknown());

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

const TransactionRecordSchema = z
  .object({
    id: LegacyTransactionIdSchema,
    account_id: LegacyAccountIdSchema.nullable(),
    merchant_id: LegacyMerchantIdSchema.nullable(),
    booking_date: DateSchema,
    operation_date: DateSchema.nullable(),
    amount_minor: AmountSchema,
    currency: z.string(),
    source_kind: z.string(),
    reporting_scope_override: z.string().nullable(),
    description: z.string().nullable(),
    note: z.string().nullable(),
    refund_of_transaction_id: LegacyTransactionIdSchema.nullable(),
    import_run_id: LegacyImportRunIdSchema.nullable(),
    importer_type: z.string().nullable(),
    importer_version: z.string().nullable(),
    source_file_id: LegacySourceFileIdSchema.nullable(),
    source_file_name: z.string().nullable(),
    source_file_sha256: z.string().nullable(),
    source_file_mime_type: z.string().nullable(),
    source_file_size_bytes: AmountSchema.nullable(),
    source_sheet: z.string().nullable(),
    source_cell: z.string().nullable(),
    source_record_index: z.number().int().nullable(),
    raw_source_value: z.string().nullable(),
    raw_record_hash: z.string().nullable(),
    normalized_record_hash: z.string().nullable(),
    bank_record_id_hash: z.string().nullable(),
    bank_connection_id: LegacyBankConnectionIdSchema.nullable(),
    bank_provider: z.string().nullable(),
    bank_name: z.string().nullable(),
    bank_country: z.string().nullable(),
    bank_sync_run_id: LegacyBankSyncRunIdSchema.nullable(),
    bank_sync_started_at: z.date().nullable(),
    provider_source_metadata: JsonObjectSchema.nullable(),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .transform(
    (row): LegacyTransactionRow => ({
      id: row.id,
      accountId: row.account_id,
      merchantId: row.merchant_id,
      bookingDate: row.booking_date,
      operationDate: row.operation_date,
      amountMinor: row.amount_minor,
      currency: row.currency,
      sourceKind: row.source_kind,
      reportingScopeOverride: row.reporting_scope_override,
      description: row.description,
      note: row.note,
      refundOfTransactionId: row.refund_of_transaction_id,
      importRunId: row.import_run_id,
      importerType: row.importer_type,
      importerVersion: row.importer_version,
      sourceFileId: row.source_file_id,
      sourceFileName: row.source_file_name,
      sourceFileSha256: row.source_file_sha256,
      sourceFileMimeType: row.source_file_mime_type,
      sourceFileSizeBytes: row.source_file_size_bytes,
      sourceSheet: row.source_sheet,
      sourceCell: row.source_cell,
      sourceRecordIndex: row.source_record_index,
      rawSourceValue: row.raw_source_value,
      rawRecordHash: row.raw_record_hash,
      normalizedRecordHash: row.normalized_record_hash,
      bankRecordIdHash: row.bank_record_id_hash,
      bankConnectionId: row.bank_connection_id,
      bankProvider: row.bank_provider,
      bankName: row.bank_name,
      bankCountry: row.bank_country,
      bankSyncRunId: row.bank_sync_run_id,
      bankSyncStartedAt: row.bank_sync_started_at,
      providerSourceMetadata: row.provider_source_metadata,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );

const PartRecordSchema = z
  .object({
    transaction_id: LegacyTransactionIdSchema,
    category_id: LegacyCategoryIdSchema,
    amount_minor: AmountSchema,
    label: z.string().nullable(),
    reporting_class: z.string(),
    manually_approved: z.boolean(),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .transform(
    (row): LegacyTransactionPartRow => ({
      transactionId: row.transaction_id,
      categoryId: row.category_id,
      amountMinor: row.amount_minor,
      label: row.label,
      reportingClass: row.reporting_class,
      manuallyApproved: row.manually_approved,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  );

const ClassificationResultRecordSchema = z
  .object({
    id: LegacyClassificationResultIdSchema,
    transaction_id: LegacyTransactionIdSchema,
    category_id: LegacyCategoryIdSchema.nullable(),
    label: z.string().nullable(),
    rule_id: LegacyClassificationRuleIdSchema.nullable(),
    rule_ids: z.array(LegacyClassificationRuleIdSchema),
    classifier_type: z.string(),
    classifier_version: z.string(),
    confidence_bps: z.number().int().nullable(),
    reason: z.string().nullable(),
    historical_proposal_id: LegacyHistoricalProposalIdSchema.nullable(),
    provenance: JsonObjectSchema,
    status: z.string(),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .transform(
    (row): LegacyClassificationResultRow => ({
      id: row.id,
      transactionId: row.transaction_id,
      categoryId: row.category_id,
      label: row.label,
      ruleId: row.rule_id,
      ruleIds: row.rule_ids,
      classifierType: row.classifier_type,
      classifierVersion: row.classifier_version,
      confidenceBps: row.confidence_bps,
      reason: row.reason,
      historicalProposalId: row.historical_proposal_id,
      provenance: row.provenance,
      status: row.status,
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

/** Parses the rows of the six queries; reports every row that does not fit. */
export function parseLegacyRecords(records: LegacyRecords): LegacySnapshotResult {
  const accounts = z.array(AccountRecordSchema).safeParse(records.accounts);
  const referenced = z.array(ReferencedRecordSchema).safeParse(records.referencedInactive);
  const categories = z.array(CategoryRecordSchema).safeParse(records.categories);
  const transactions = z.array(TransactionRecordSchema).safeParse(records.transactions);
  const parts = z.array(PartRecordSchema).safeParse(records.parts);
  const results = z
    .array(ClassificationResultRecordSchema)
    .safeParse(records.classificationResults);

  if (
    !accounts.success ||
    !referenced.success ||
    !categories.success ||
    !transactions.success ||
    !parts.success ||
    !results.success
  ) {
    return {
      ok: false,
      problems: [
        ...(accounts.success ? [] : describeIssues("accounts", accounts.error)),
        ...(referenced.success ? [] : describeIssues("referenced accounts", referenced.error)),
        ...(categories.success ? [] : describeIssues("categories", categories.error)),
        ...(transactions.success ? [] : describeIssues("transactions", transactions.error)),
        ...(parts.success ? [] : describeIssues("transaction parts", parts.error)),
        ...(results.success ? [] : describeIssues("classification results", results.error)),
      ],
    };
  }
  return {
    ok: true,
    snapshot: {
      accounts: accounts.data,
      referencedInactiveAccountIds: new Set(referenced.data),
      categories: categories.data,
      transactions: transactions.data,
      parts: parts.data,
      classificationResults: results.data,
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
    const transactions = await client.query(TRANSACTIONS_SQL);
    const parts = await client.query(PARTS_SQL);
    const classificationResults = await client.query(CLASSIFICATION_RESULTS_SQL);
    await client.query("COMMIT");
    records = {
      accounts: accounts.rows,
      referencedInactive: referencedInactive.rows,
      categories: categories.rows,
      transactions: transactions.rows,
      parts: parts.rows,
      classificationResults: classificationResults.rows,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
  return parseLegacyRecords(records);
}
