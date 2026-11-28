// Translates the transactions of the old version, with their parts, source
// trace and classification results, into the records of the new version. A
// pure function, like the translation of accounts and categories it follows:
// it needs that translation's plan, refers to accounts and categories by the
// same keys (the old ID of the leading row), and collects every problem
// instead of stopping at the first.
//
// The rows arrive with their shape already checked (see `read.ts`); the enum
// values are checked here against the new schema. The pairs of possible
// duplicates among the translated transactions come from `duplicates.ts`.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// packages and relative `.ts` paths and uses only erasable syntax.

import { z } from "zod";

import {
  legacyClassificationStatus,
  legacyClassifierType,
  legacySourceKind,
  reportingClass,
  reportingScope,
} from "../db/schema.ts";
import type {
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
} from "../ids.ts";
import { assertSplitDirection, assertSplitTotal, InvalidSplitError } from "../money/split-total.ts";
import {
  CLASSIFICATION_STATES,
  type ClassificationState,
  classificationState,
} from "../transactions/classification-state.ts";
import type { CategoryType, MigrationPlan, ReportingScope } from "./accounts-categories.ts";
import {
  type DuplicateReport,
  findPossibleDuplicates,
  type NewDuplicatePair,
  summarizeDuplicates,
} from "./duplicates.ts";

const LegacySourceKindSchema = z.enum(legacySourceKind.enumValues);
const ReportingClassSchema = z.enum(reportingClass.enumValues);
const ClassifierTypeSchema = z.enum(legacyClassifierType.enumValues);
const ClassificationStatusSchema = z.enum(legacyClassificationStatus.enumValues);
const ReportingScopeSchema = z.enum(reportingScope.enumValues);

export type LegacySourceKind = z.infer<typeof LegacySourceKindSchema>;
export type ReportingClass = z.infer<typeof ReportingClassSchema>;
export type LegacyClassifierType = z.infer<typeof ClassifierTypeSchema>;
export type LegacyClassificationStatus = z.infer<typeof ClassificationStatusSchema>;

/**
 * A row of the old `transactions` table with the import run, source file,
 * bank connection and bank sync run it points at; enum columns are text.
 */
export type LegacyTransactionRow = {
  id: LegacyTransactionId;
  accountId: LegacyAccountId | null;
  merchantId: LegacyMerchantId | null;
  /** `YYYY-MM-DD`. */
  bookingDate: string;
  /** `YYYY-MM-DD`. */
  operationDate: string | null;
  amountMinor: bigint;
  currency: string;
  sourceKind: string;
  reportingScopeOverride: string | null;
  description: string | null;
  note: string | null;
  refundOfTransactionId: LegacyTransactionId | null;
  importRunId: LegacyImportRunId | null;
  importerType: string | null;
  importerVersion: string | null;
  sourceFileId: LegacySourceFileId | null;
  sourceFileName: string | null;
  sourceFileSha256: string | null;
  sourceFileMimeType: string | null;
  sourceFileSizeBytes: bigint | null;
  sourceSheet: string | null;
  sourceCell: string | null;
  sourceRecordIndex: number | null;
  rawSourceValue: string | null;
  rawRecordHash: string | null;
  normalizedRecordHash: string | null;
  bankRecordIdHash: string | null;
  bankConnectionId: LegacyBankConnectionId | null;
  bankProvider: string | null;
  /** The old `aspsp_name`. */
  bankName: string | null;
  bankCountry: string | null;
  bankSyncRunId: LegacyBankSyncRunId | null;
  bankSyncStartedAt: Date | null;
  providerSourceMetadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

/** A row of the old `transaction_splits` table; `reportingClass` is text. */
export type LegacyTransactionPartRow = {
  transactionId: LegacyTransactionId;
  categoryId: LegacyCategoryId;
  amountMinor: bigint;
  label: string | null;
  reportingClass: string;
  manuallyApproved: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** A row of the old `classification_results` table; enum columns are text. */
export type LegacyClassificationResultRow = {
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

export type TransactionTranslationInput = {
  snapshot: {
    transactions: readonly LegacyTransactionRow[];
    parts: readonly LegacyTransactionPartRow[];
    classificationResults: readonly LegacyClassificationResultRow[];
  };
  /** The translated accounts and categories the transactions refer to. */
  plan: MigrationPlan;
};

/** The source trace of a transaction, in the shape of `legacy_transaction_sources`. */
export type NewTransactionSource = {
  sourceKind: LegacySourceKind;
  legacyMerchantId: LegacyMerchantId | null;
  legacyImportRunId: LegacyImportRunId | null;
  importerType: string | null;
  importerVersion: string | null;
  legacySourceFileId: LegacySourceFileId | null;
  sourceFileName: string | null;
  sourceFileSha256: string | null;
  sourceFileMimeType: string | null;
  sourceFileSizeBytes: bigint | null;
  sourceSheet: string | null;
  sourceCell: string | null;
  sourceRecordIndex: number | null;
  rawSourceValue: string | null;
  rawRecordHash: string | null;
  normalizedRecordHash: string | null;
  bankRecordIdHash: string | null;
  legacyBankConnectionId: LegacyBankConnectionId | null;
  bankProvider: string | null;
  bankName: string | null;
  bankCountry: string | null;
  legacyBankSyncRunId: LegacyBankSyncRunId | null;
  bankSyncStartedAt: Date | null;
  providerSourceMetadata: Record<string, unknown> | null;
};

export type NewTransactionPart = {
  /** Key of the category in the plan. */
  categoryKey: LegacyCategoryId;
  amountMinor: bigint;
  /** Only on parts in a `labeled` category. */
  label: string | null;
  reportingClass: ReportingClass;
  approved: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type NewClassificationResult = {
  legacyId: LegacyClassificationResultId;
  /** Key of the category in the plan; null when the old result named none. */
  categoryKey: LegacyCategoryId | null;
  label: string | null;
  legacyRuleId: LegacyClassificationRuleId | null;
  legacyRuleIds: LegacyClassificationRuleId[];
  classifierType: LegacyClassifierType;
  classifierVersion: string;
  confidenceBps: number | null;
  reason: string | null;
  legacyHistoricalProposalId: LegacyHistoricalProposalId | null;
  provenance: Record<string, unknown>;
  status: LegacyClassificationStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type NewTransaction = {
  legacyId: LegacyTransactionId;
  /** Key of the account in the plan; merged old accounts share one key. */
  accountKey: LegacyAccountId;
  bookingDate: string;
  operationDate: string | null;
  amountMinor: bigint;
  description: string | null;
  reportingScopeOverride: ReportingScope | null;
  createdAt: Date;
  updatedAt: Date;
  source: NewTransactionSource;
  /** In the order they are inserted. */
  parts: NewTransactionPart[];
  /** Oldest first. */
  classificationResults: NewClassificationResult[];
};

export type TransactionReport = {
  transactions: number;
  bySource: Record<LegacySourceKind, number>;
  parts: number;
  /** From `classificationState` on the migrated parts. */
  byState: Record<ClassificationState, number>;
  /** Labels on parts in a `labeled` category. */
  labelsKept: number;
  /** Labels on parts outside a `labeled` category, which the new model does not allow. */
  labelsDropped: number;
  classificationResults: number;
  resultsByStatus: Record<LegacyClassificationStatus, number>;
  possibleDuplicates: DuplicateReport;
};

export type TransactionTranslationResult =
  | {
      ok: true;
      transactions: NewTransaction[];
      /** Pairs of a bank row and a spreadsheet row that may be one money movement. */
      duplicates: NewDuplicatePair[];
      report: TransactionReport;
    }
  | { ok: false; problems: string[] };

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareNullsLast<T>(a: T | null, b: T | null, compare: (x: T, y: T) => number): number {
  if (a === null || b === null) {
    return a === b ? 0 : a === null ? 1 : -1;
  }
  return compare(a, b);
}

/** Rows from the spreadsheet come first, then rows from the bank, then manual ones. */
const SOURCE_RANK: Record<LegacySourceKind, number> = {
  legacy_excel: 0,
  bank_api: 1,
  bank_file: 1,
  manual: 2,
};

/** What the position of a transaction in its source is made of. */
export type SourcePosition = {
  legacyId: LegacyTransactionId;
  bookingDate: string;
  operationDate: string | null;
  source: Pick<
    NewTransactionSource,
    "sourceKind" | "sourceFileName" | "legacySourceFileId" | "sourceSheet" | "sourceRecordIndex"
  >;
};

/**
 * Orders transactions by their position in the source: booking date; rows from
 * the spreadsheet before rows from the bank, manual ones last; in the
 * spreadsheet by file name, then file ID (so two files of the same name do not
 * interleave), sheet and the importer's record index, in the bank
 * by operation date (missing values last); the old ID breaks the last ties.
 * The old creation time is the import time, shared by a whole import, so it
 * plays no part. Inserted in this order, the new UUIDv7 IDs keep it.
 */
export function compareSourcePosition(a: SourcePosition, b: SourcePosition): number {
  const byDate = compareText(a.bookingDate, b.bookingDate);
  if (byDate !== 0) {
    return byDate;
  }
  const rankA = SOURCE_RANK[a.source.sourceKind];
  const byRank = rankA - SOURCE_RANK[b.source.sourceKind];
  if (byRank !== 0) {
    return byRank;
  }
  let byPlace = 0;
  if (rankA === SOURCE_RANK.legacy_excel) {
    byPlace =
      compareNullsLast(a.source.sourceFileName, b.source.sourceFileName, compareText) ||
      compareNullsLast(a.source.legacySourceFileId, b.source.legacySourceFileId, compareText) ||
      compareNullsLast(a.source.sourceSheet, b.source.sourceSheet, compareText) ||
      compareNullsLast(a.source.sourceRecordIndex, b.source.sourceRecordIndex, (x, y) => x - y);
  } else if (rankA === SOURCE_RANK.bank_api) {
    byPlace = compareNullsLast(a.operationDate, b.operationDate, compareText);
  }
  return byPlace || compareText(a.legacyId, b.legacyId);
}

function compareBigint(a: bigint, b: bigint): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Old parts have no meaningful order beyond their creation time, so every
 * other value breaks ties: equal rows are interchangeable, and the result
 * never depends on the order of the input.
 */
function comparePartRows(a: LegacyTransactionPartRow, b: LegacyTransactionPartRow): number {
  return (
    a.createdAt.getTime() - b.createdAt.getTime() ||
    compareText(a.categoryId, b.categoryId) ||
    compareBigint(a.amountMinor, b.amountMinor) ||
    compareNullsLast(a.label, b.label, compareText) ||
    compareText(a.reportingClass, b.reportingClass) ||
    Number(a.manuallyApproved) - Number(b.manuallyApproved) ||
    a.updatedAt.getTime() - b.updatedAt.getTime()
  );
}

function compareResultRows(
  a: LegacyClassificationResultRow,
  b: LegacyClassificationResultRow,
): number {
  return a.createdAt.getTime() - b.createdAt.getTime() || compareText(a.id, b.id);
}

function groupByTransaction<R extends { transactionId: LegacyTransactionId }>(
  rows: readonly R[],
): Map<LegacyTransactionId, R[]> {
  const groups = new Map<LegacyTransactionId, R[]>();
  for (const row of rows) {
    const group = groups.get(row.transactionId);
    if (group === undefined) {
      groups.set(row.transactionId, [row]);
    } else {
      group.push(row);
    }
  }
  return groups;
}

function zeroCounts<K extends string>(keys: readonly K[]): Record<K, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim() === "";
}

function toSource(row: LegacyTransactionRow, sourceKind: LegacySourceKind): NewTransactionSource {
  return {
    sourceKind,
    legacyMerchantId: row.merchantId,
    legacyImportRunId: row.importRunId,
    importerType: row.importerType,
    importerVersion: row.importerVersion,
    legacySourceFileId: row.sourceFileId,
    sourceFileName: row.sourceFileName,
    sourceFileSha256: row.sourceFileSha256,
    sourceFileMimeType: row.sourceFileMimeType,
    sourceFileSizeBytes: row.sourceFileSizeBytes,
    sourceSheet: row.sourceSheet,
    sourceCell: row.sourceCell,
    sourceRecordIndex: row.sourceRecordIndex,
    rawSourceValue: row.rawSourceValue,
    rawRecordHash: row.rawRecordHash,
    normalizedRecordHash: row.normalizedRecordHash,
    bankRecordIdHash: row.bankRecordIdHash,
    legacyBankConnectionId: row.bankConnectionId,
    bankProvider: row.bankProvider,
    bankName: row.bankName,
    bankCountry: row.bankCountry,
    legacyBankSyncRunId: row.bankSyncRunId,
    bankSyncStartedAt: row.bankSyncStartedAt,
    providerSourceMetadata: row.providerSourceMetadata,
  };
}

export function translateTransactions(
  input: TransactionTranslationInput,
): TransactionTranslationResult {
  const problems: string[] = [];

  // Old account ID → account of the plan; merged old accounts share one.
  const accountOf = new Map<LegacyAccountId, { key: LegacyAccountId; currency: string }>();
  for (const account of input.plan.accounts) {
    for (const legacyId of account.legacyIds) {
      accountOf.set(legacyId, { key: account.key, currency: account.currency });
    }
  }
  // Old category ID → category of the plan; only root categories can be labeled.
  const categoryOf = new Map<LegacyCategoryId, { key: LegacyCategoryId; type: CategoryType }>();
  for (const category of [...input.plan.rootCategories, ...input.plan.subcategories]) {
    for (const legacyId of category.legacyIds) {
      categoryOf.set(legacyId, { key: category.key, type: category.type });
    }
  }

  const rows = [...input.snapshot.transactions].sort((a, b) => compareText(a.id, b.id));
  const known = new Set(rows.map((row) => row.id));
  const partsOf = groupByTransaction(input.snapshot.parts);
  const resultsOf = groupByTransaction(input.snapshot.classificationResults);
  for (const [transactionId, parts] of partsOf) {
    if (!known.has(transactionId)) {
      problems.push(
        `${parts.length} part(s) refer to a transaction (old ID ${transactionId}) that does not exist.`,
      );
    }
  }
  for (const [transactionId, results] of resultsOf) {
    if (!known.has(transactionId)) {
      problems.push(
        `${results.length} classification result(s) refer to a transaction (old ID ${transactionId}) that does not exist.`,
      );
    }
  }

  let labelsKept = 0;
  let labelsDropped = 0;
  const migrated: NewTransaction[] = [];

  for (const row of rows) {
    const transaction = `Transaction (old ID ${row.id})`;
    const ofTransaction = `of transaction (old ID ${row.id})`;
    const before = problems.length;

    let account: { key: LegacyAccountId; currency: string } | undefined;
    if (row.accountId === null) {
      problems.push(`${transaction} has no account.`);
    } else {
      account = accountOf.get(row.accountId);
      if (account === undefined) {
        problems.push(`${transaction} is on account ${row.accountId}, which is not migrated.`);
      } else if (row.currency !== account.currency) {
        problems.push(
          `${transaction} is in ${row.currency}, but its account is in ${account.currency}.`,
        );
      }
    }
    const sourceKind = LegacySourceKindSchema.safeParse(row.sourceKind);
    if (!sourceKind.success) {
      problems.push(`${transaction} has an unknown source kind "${row.sourceKind}".`);
    }
    const scope =
      row.reportingScopeOverride === null
        ? undefined
        : ReportingScopeSchema.safeParse(row.reportingScopeOverride);
    if (scope !== undefined && !scope.success) {
      problems.push(
        `${transaction} has an unknown reporting scope override "${row.reportingScopeOverride}".`,
      );
    }
    if (row.note !== null) {
      problems.push(`${transaction} has a note, which the migration does not move.`);
    }
    if (row.refundOfTransactionId !== null) {
      problems.push(
        `${transaction} is marked as a refund of another transaction, which the migration does not move.`,
      );
    }

    const partRows = [...(partsOf.get(row.id) ?? [])].sort(comparePartRows);
    const parts: NewTransactionPart[] = [];
    let kept = 0;
    let dropped = 0;
    partRows.forEach((part, index) => {
      const where = `Part ${index + 1} ${ofTransaction}`;
      const category = categoryOf.get(part.categoryId);
      if (category === undefined) {
        problems.push(`${where} is in category ${part.categoryId}, which is not migrated.`);
      }
      const reportingClassValue = ReportingClassSchema.safeParse(part.reportingClass);
      if (!reportingClassValue.success) {
        problems.push(`${where} has an unknown reporting class "${part.reportingClass}".`);
      }
      let label: string | null = null;
      if (category?.type === "labeled") {
        if (isBlank(part.label)) {
          problems.push(`${where} is in a labeled category but has no label.`);
        } else {
          label = part.label;
          kept += 1;
        }
      } else if (part.label !== null) {
        dropped += 1;
      }
      if (category !== undefined && reportingClassValue.success) {
        parts.push({
          categoryKey: category.key,
          amountMinor: part.amountMinor,
          label,
          reportingClass: reportingClassValue.data,
          approved: part.manuallyApproved,
          createdAt: part.createdAt,
          updatedAt: part.updatedAt,
        });
      }
    });
    if (partRows.length > 0) {
      try {
        assertSplitTotal(row.amountMinor, partRows.map((part) => part.amountMinor));
      } catch (error) {
        if (!(error instanceof InvalidSplitError)) {
          throw error;
        }
        problems.push(`${transaction}: its parts do not sum to its amount.`);
      }
      try {
        assertSplitDirection(row.amountMinor, partRows.map((part) => part.amountMinor));
      } catch (error) {
        if (!(error instanceof InvalidSplitError)) {
          throw error;
        }
        problems.push(`${transaction}: a part goes the other way than its amount.`);
      }
    }

    const resultRows = [...(resultsOf.get(row.id) ?? [])].sort(compareResultRows);
    const results: NewClassificationResult[] = [];
    for (const result of resultRows) {
      const where = `Classification result (old ID ${result.id}) ${ofTransaction}`;
      const category = result.categoryId === null ? null : categoryOf.get(result.categoryId);
      if (category === undefined) {
        problems.push(`${where} is in category ${result.categoryId}, which is not migrated.`);
      }
      const classifierType = ClassifierTypeSchema.safeParse(result.classifierType);
      if (!classifierType.success) {
        problems.push(`${where} has an unknown classifier type "${result.classifierType}".`);
      }
      const status = ClassificationStatusSchema.safeParse(result.status);
      if (!status.success) {
        problems.push(`${where} has an unknown status "${result.status}".`);
      }
      if (category !== undefined && classifierType.success && status.success) {
        results.push({
          legacyId: result.id,
          categoryKey: category === null ? null : category.key,
          label: result.label,
          legacyRuleId: result.ruleId,
          legacyRuleIds: result.ruleIds,
          classifierType: classifierType.data,
          classifierVersion: result.classifierVersion,
          confidenceBps: result.confidenceBps,
          reason: result.reason,
          legacyHistoricalProposalId: result.historicalProposalId,
          provenance: result.provenance,
          status: status.data,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        });
      }
    }
    // The old version counted such a transaction as needing review; without
    // parts the new rule calls it unclassified, so the state would change.
    if (partRows.length === 0 && resultRows.some((result) => result.status === "conflict")) {
      problems.push(
        `${transaction} has no parts but a conflicting classification result; the old version ` +
          "showed it as needing review, the new one would show it as unclassified.",
      );
    }

    if (problems.length > before || account === undefined || !sourceKind.success) {
      continue;
    }
    labelsKept += kept;
    labelsDropped += dropped;
    migrated.push({
      legacyId: row.id,
      accountKey: account.key,
      bookingDate: row.bookingDate,
      operationDate: row.operationDate,
      amountMinor: row.amountMinor,
      description: row.description,
      reportingScopeOverride: scope?.success ? scope.data : null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      source: toSource(row, sourceKind.data),
      parts,
      classificationResults: results,
    });
  }

  if (problems.length > 0) {
    return { ok: false, problems };
  }

  migrated.sort(compareSourcePosition);
  const duplicates = findPossibleDuplicates(migrated);

  const report: TransactionReport = {
    transactions: migrated.length,
    bySource: zeroCounts(legacySourceKind.enumValues),
    parts: 0,
    byState: zeroCounts(CLASSIFICATION_STATES),
    labelsKept,
    labelsDropped,
    classificationResults: 0,
    resultsByStatus: zeroCounts(legacyClassificationStatus.enumValues),
    possibleDuplicates: summarizeDuplicates(duplicates),
  };
  for (const transaction of migrated) {
    report.bySource[transaction.source.sourceKind] += 1;
    report.parts += transaction.parts.length;
    report.byState[classificationState(transaction.amountMinor, transaction.parts)] += 1;
    report.classificationResults += transaction.classificationResults.length;
    for (const result of transaction.classificationResults) {
      report.resultsByStatus[result.status] += 1;
    }
  }

  return { ok: true, transactions: migrated, duplicates, report };
}
