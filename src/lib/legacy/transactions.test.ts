import { describe, expect, it } from "vitest";

import {
  LegacyAccountIdSchema,
  LegacyCategoryIdSchema,
  LegacyClassificationResultIdSchema,
  LegacySourceFileIdSchema,
  LegacyTransactionIdSchema,
} from "@/lib/ids";
import type { MigrationPlan, NewCategory } from "@/lib/legacy/accounts-categories";
import type { NewDuplicatePair } from "@/lib/legacy/duplicates";
import {
  type LegacyClassificationResultRow,
  type LegacyTransactionPartRow,
  type LegacyTransactionRow,
  type TransactionReport,
  type TransactionTranslationInput,
  translateTransactions,
  type NewTransaction,
} from "@/lib/legacy/transactions";

function day(n: number): Date {
  return new Date(Date.UTC(2024, 0, n, 12));
}

const BANK = LegacyAccountIdSchema.parse("a0000000-0000-4000-8000-000000000001");
/** Merged into BANK by the layout file. */
const BANK_MERGED = LegacyAccountIdSchema.parse("a0000000-0000-4000-8000-000000000002");
const CASH = LegacyAccountIdSchema.parse("a0000000-0000-4000-8000-000000000003");
const NOT_MIGRATED_ACCOUNT = LegacyAccountIdSchema.parse("a0000000-0000-4000-8000-000000000009");

const LABELED = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000001");
const ROOT = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000002");
const SUB = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000011");
/** Merged into SUB: an old name that differed only in case. */
const SUB_MERGED = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000012");
const NOT_MIGRATED_CATEGORY = LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000099");

function category(
  key: typeof ROOT,
  legacyIds: (typeof ROOT)[],
  type: "standard" | "labeled",
  position: number,
): NewCategory {
  return {
    key,
    legacyIds,
    name: `Kategoria ${position}`,
    kind: "expense",
    type,
    position,
    createdAt: day(1),
    updatedAt: day(1),
  };
}

const PLAN: MigrationPlan = {
  accounts: [
    {
      key: BANK,
      legacyIds: [BANK, BANK_MERGED],
      name: "bank 1",
      type: "bank",
      currency: "PLN",
      reportingScope: "personal",
      createdAt: day(1),
      updatedAt: day(1),
    },
    {
      key: CASH,
      legacyIds: [CASH],
      name: "cash 1",
      type: "cash",
      currency: "EUR",
      reportingScope: "business",
      createdAt: day(1),
      updatedAt: day(1),
    },
  ],
  rootCategories: [category(LABELED, [LABELED], "labeled", 0), category(ROOT, [ROOT], "standard", 1)],
  subcategories: [{ ...category(SUB, [SUB, SUB_MERGED], "standard", 0), parentKey: ROOT }],
};

let nextId = 1;
function transactionId() {
  return LegacyTransactionIdSchema.parse(
    `d0000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
  );
}

function transaction(overrides: Partial<LegacyTransactionRow> = {}): LegacyTransactionRow {
  return {
    id: transactionId(),
    accountId: BANK,
    merchantId: null,
    bookingDate: "2024-03-05",
    operationDate: null,
    amountMinor: -1500n,
    currency: "PLN",
    sourceKind: "legacy_excel",
    reportingScopeOverride: null,
    description: "opis 1",
    note: null,
    refundOfTransactionId: null,
    importRunId: null,
    importerType: null,
    importerVersion: null,
    sourceFileId: null,
    sourceFileName: "plik 1.xlsx",
    sourceFileSha256: null,
    sourceFileMimeType: null,
    sourceFileSizeBytes: null,
    sourceSheet: "Arkusz 1",
    sourceCell: null,
    sourceRecordIndex: null,
    rawSourceValue: null,
    rawRecordHash: null,
    normalizedRecordHash: null,
    bankRecordIdHash: null,
    bankConnectionId: null,
    bankProvider: null,
    bankName: null,
    bankCountry: null,
    bankSyncRunId: null,
    bankSyncStartedAt: null,
    providerSourceMetadata: null,
    createdAt: day(10),
    updatedAt: day(10),
    ...overrides,
  };
}

function bankTransaction(overrides: Partial<LegacyTransactionRow> = {}): LegacyTransactionRow {
  return transaction({
    sourceKind: "bank_api",
    sourceFileName: null,
    sourceSheet: null,
    bankName: "bank 1",
    ...overrides,
  });
}

function part(
  of: LegacyTransactionRow,
  overrides: Partial<LegacyTransactionPartRow> = {},
): LegacyTransactionPartRow {
  return {
    transactionId: of.id,
    categoryId: SUB,
    amountMinor: of.amountMinor,
    label: null,
    reportingClass: "standard",
    manuallyApproved: true,
    createdAt: day(10),
    updatedAt: day(10),
    ...overrides,
  };
}

let nextResultId = 1;
function result(
  of: LegacyTransactionRow,
  overrides: Partial<LegacyClassificationResultRow> = {},
): LegacyClassificationResultRow {
  return {
    id: LegacyClassificationResultIdSchema.parse(
      `e0000000-0000-4000-8000-${String(nextResultId++).padStart(12, "0")}`,
    ),
    transactionId: of.id,
    categoryId: SUB,
    label: null,
    ruleId: null,
    ruleIds: [],
    classifierType: "merchant_rule",
    classifierVersion: "1",
    confidenceBps: null,
    reason: null,
    historicalProposalId: null,
    provenance: {},
    status: "approved",
    createdAt: day(11),
    updatedAt: day(11),
    ...overrides,
  };
}

function input(
  snapshot: Partial<TransactionTranslationInput["snapshot"]>,
): TransactionTranslationInput {
  return {
    snapshot: { transactions: [], parts: [], classificationResults: [], ...snapshot },
    plan: PLAN,
  };
}

function translated(value: TransactionTranslationInput): {
  transactions: NewTransaction[];
  duplicates: NewDuplicatePair[];
  report: TransactionReport;
} {
  const outcome = translateTransactions(value);
  if (!outcome.ok) {
    throw new Error(`expected a translation, got problems:\n${outcome.problems.join("\n")}`);
  }
  return outcome;
}

function problemsOf(value: TransactionTranslationInput): string[] {
  const outcome = translateTransactions(value);
  if (outcome.ok) {
    throw new Error("expected problems, got a translation");
  }
  return outcome.problems;
}

describe("translateTransactions", () => {
  it("translates a transaction with its parts, results and source trace", () => {
    const row = bankTransaction({
      accountId: BANK_MERGED,
      operationDate: "2024-03-04",
      reportingScopeOverride: "business",
      providerSourceMetadata: { status: "BOOK" },
      bankRecordIdHash: "bank-record-1",
    });
    const kept = result(row, { categoryId: SUB_MERGED, ruleIds: [] });
    const withoutCategory = result(row, { categoryId: null, status: "rejected", createdAt: day(12) });
    const { transactions } = translated(
      input({
        transactions: [row],
        parts: [part(row, { categoryId: SUB_MERGED, reportingClass: "business_tax" })],
        classificationResults: [withoutCategory, kept],
      }),
    );

    expect(transactions).toEqual([
      {
        legacyId: row.id,
        // A merged old account and category map to the key of their group.
        accountKey: BANK,
        bookingDate: "2024-03-05",
        operationDate: "2024-03-04",
        amountMinor: -1500n,
        description: "opis 1",
        reportingScopeOverride: "business",
        createdAt: day(10),
        updatedAt: day(10),
        source: expect.objectContaining({
          sourceKind: "bank_api",
          bankName: "bank 1",
          bankRecordIdHash: "bank-record-1",
          providerSourceMetadata: { status: "BOOK" },
        }),
        parts: [
          {
            categoryKey: SUB,
            amountMinor: -1500n,
            label: null,
            reportingClass: "business_tax",
            approved: true,
            createdAt: day(10),
            updatedAt: day(10),
          },
        ],
        classificationResults: [
          expect.objectContaining({ legacyId: kept.id, categoryKey: SUB, status: "approved" }),
          expect.objectContaining({
            legacyId: withoutCategory.id,
            categoryKey: null,
            status: "rejected",
          }),
        ],
      },
    ]);
  });

  it("keeps labels in a labeled category and drops them elsewhere, with the part", () => {
    const labeled = transaction();
    const income = transaction({ amountMinor: 50000n });
    const { transactions, report } = translated(
      input({
        transactions: [labeled, income],
        parts: [
          part(labeled, { categoryId: LABELED, label: "etykieta 1" }),
          part(income, { label: "Premia" }),
        ],
      }),
    );

    const byId = new Map(transactions.map((item) => [item.legacyId, item]));
    expect(byId.get(labeled.id)?.parts).toEqual([
      expect.objectContaining({ categoryKey: LABELED, label: "etykieta 1" }),
    ]);
    expect(byId.get(income.id)?.parts).toEqual([
      expect.objectContaining({ categoryKey: SUB, amountMinor: 50000n, label: null }),
    ]);
    expect(report).toMatchObject({ labelsKept: 1, labelsDropped: 1 });
  });

  it("derives the states from the parts and their approval, and counts everything", () => {
    const approved = transaction();
    const split = transaction({ amountMinor: -3000n });
    const review = bankTransaction({ amountMinor: -900n });
    const unclassified = bankTransaction();
    const unclassifiedSheet = transaction({ description: null });

    const { report } = translated(
      input({
        transactions: [approved, split, review, unclassified, unclassifiedSheet],
        parts: [
          part(approved),
          part(split, { amountMinor: -1000n }),
          part(split, { amountMinor: -2000n, categoryId: ROOT }),
          part(review, { manuallyApproved: false }),
        ],
        classificationResults: [
          result(review, { status: "suggested" }),
          result(unclassified, { status: "rejected" }),
          result(approved),
        ],
      }),
    );

    expect(report).toEqual({
      transactions: 5,
      bySource: { legacy_excel: 3, bank_file: 0, bank_api: 2, manual: 0 },
      parts: 4,
      byState: { unclassified: 2, needs_review: 1, approved: 2 },
      labelsKept: 0,
      labelsDropped: 0,
      classificationResults: 3,
      resultsByStatus: { suggested: 1, approved: 1, rejected: 1, conflict: 0, superseded: 0 },
      // The bank row without parts has two spreadsheet rows of its amount and day.
      possibleDuplicates: {
        pairs: 1,
        sameDayWithoutCompetitor: 0,
        nearDateWithoutCompetitor: 0,
        withCompetitor: 1,
        byMonth: { "2024-03": 1 },
      },
    });
  });

  it("marks possible duplicates across merged old accounts, the bank row first", () => {
    const sheet = transaction({ accountId: BANK_MERGED, bookingDate: "2024-03-06" });
    const bank = bankTransaction({ bookingDate: "2024-03-08", operationDate: "2024-03-07" });
    const otherAccount = bankTransaction({ accountId: CASH, currency: "EUR" });
    const { duplicates, report } = translated(
      input({ transactions: [otherAccount, bank, sheet] }),
    );

    expect(duplicates).toEqual([
      {
        bankLegacyId: bank.id,
        sheetLegacyId: sheet.id,
        bankBookingDate: "2024-03-08",
        dayDifference: 1,
        hasCompetitor: false,
      },
    ]);
    expect(report.possibleDuplicates).toEqual({
      pairs: 1,
      sameDayWithoutCompetitor: 0,
      nearDateWithoutCompetitor: 1,
      withCompetitor: 0,
      byMonth: { "2024-03": 1 },
    });
  });

  it("orders by booking date, the spreadsheet before the bank, then by place in the source", () => {
    const later = transaction({ bookingDate: "2024-03-06", sourceRecordIndex: 0 });
    const bankNoOperationDate = bankTransaction({ operationDate: null });
    const bankLate = bankTransaction({ operationDate: "2024-03-05" });
    const bankEarly = bankTransaction({ operationDate: "2024-03-03" });
    const manual = transaction({ sourceKind: "manual", sourceFileName: null, sourceSheet: null });
    const sheetNoIndex = transaction({ sourceRecordIndex: null });
    const sheetTwo = transaction({ sourceRecordIndex: 2 });
    const sheetOne = transaction({ sourceRecordIndex: 1 });
    const secondSheet = transaction({ sourceSheet: "Arkusz 2", sourceRecordIndex: 0 });
    const secondFile = transaction({ sourceFileName: "plik 2.xlsx", sourceRecordIndex: 0 });
    const bankFile = bankTransaction({ sourceKind: "bank_file", operationDate: "2024-03-04" });
    const earlier = bankTransaction({ bookingDate: "2024-03-01" });
    // Same place in the source: the old ID decides.
    const tieA = bankTransaction({ bookingDate: "2024-03-07" });
    const tieB = bankTransaction({ bookingDate: "2024-03-07" });

    const { transactions } = translated(
      input({
        transactions: [
          tieB,
          later,
          bankNoOperationDate,
          bankLate,
          manual,
          bankEarly,
          sheetNoIndex,
          sheetTwo,
          secondFile,
          sheetOne,
          bankFile,
          secondSheet,
          earlier,
          tieA,
        ],
      }),
    );

    expect(transactions.map((item) => item.legacyId)).toEqual(
      [
        earlier,
        sheetOne,
        sheetTwo,
        sheetNoIndex,
        secondSheet,
        secondFile,
        bankEarly,
        bankFile,
        bankLate,
        bankNoOperationDate,
        manual,
        later,
        tieA,
        tieB,
      ].map((row) => row.id),
    );
  });

  it("keeps the rows of two files with the same name apart, by file ID", () => {
    const fileA = LegacySourceFileIdSchema.parse("e0000000-0000-4000-8000-000000000001");
    const fileB = LegacySourceFileIdSchema.parse("e0000000-0000-4000-8000-000000000002");
    const aFirst = transaction({ sourceFileId: fileA, sourceRecordIndex: 0 });
    const aThird = transaction({ sourceFileId: fileA, sourceRecordIndex: 2 });
    const bSecond = transaction({ sourceFileId: fileB, sourceRecordIndex: 1 });
    // A file without an ID comes after the files with one of the same name.
    const noFile = transaction({ sourceFileId: null, sourceRecordIndex: 0 });

    const { transactions } = translated(input({ transactions: [noFile, bSecond, aThird, aFirst] }));

    expect(transactions.map((item) => item.legacyId)).toEqual(
      [aFirst, aThird, bSecond, noFile].map((row) => row.id),
    );
  });

  it("gives the same result whatever the order of the input", () => {
    const first = transaction({ sourceRecordIndex: 1 });
    const second = bankTransaction({ operationDate: "2024-03-04" });
    const third = transaction({ bookingDate: "2024-03-01" });
    const transactions = [first, second, third];
    const parts = [
      part(first, { amountMinor: -500n, createdAt: day(10) }),
      part(first, { amountMinor: -1000n, categoryId: ROOT, createdAt: day(10) }),
      part(second),
      part(third, { amountMinor: -700n, label: "a" }),
      part(third, { amountMinor: -800n }),
    ];
    const results = [
      result(second, { createdAt: day(11) }),
      result(second, { createdAt: day(11), status: "superseded" }),
      result(first, { createdAt: day(9) }),
    ];

    const expected = translated(input({ transactions, parts, classificationResults: results }));
    const reversed = translated(
      input({
        transactions: [...transactions].reverse(),
        parts: [...parts].reverse(),
        classificationResults: [...results].reverse(),
      }),
    );
    expect(reversed).toEqual(expected);
  });

  describe("problems that stop the run", () => {
    function problemFor(
      snapshot: (row: LegacyTransactionRow) => Partial<TransactionTranslationInput["snapshot"]>,
      overrides: Partial<LegacyTransactionRow> = {},
    ): string[] {
      const row = transaction(overrides);
      return problemsOf(input({ transactions: [row], ...snapshot(row) }));
    }

    it.each<[string, Partial<LegacyTransactionRow>, string]>([
      ["without an account", { accountId: null }, "has no account"],
      ["on an account that is not migrated", { accountId: NOT_MIGRATED_ACCOUNT }, "not migrated"],
      ["in another currency than its account", { currency: "EUR" }, "is in EUR, but its account is in PLN"],
      ["with an unknown source kind", { sourceKind: "fax" }, 'unknown source kind "fax"'],
      [
        "with an unknown reporting scope override",
        { reportingScopeOverride: "family" },
        'unknown reporting scope override "family"',
      ],
      ["with a note", { note: "notatka" }, "has a note"],
      [
        "marked as a refund",
        { refundOfTransactionId: LegacyTransactionIdSchema.parse("d0000000-0000-4000-8000-000000009999") },
        "refund",
      ],
    ])("a transaction %s", (_, overrides, message) => {
      const problems = problemFor(() => ({}), overrides);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(message);
    });

    it.each<[string, (row: LegacyTransactionRow) => Partial<TransactionTranslationInput["snapshot"]>, string]>([
      [
        "a part in a category that is not migrated",
        (row) => ({ parts: [part(row, { categoryId: NOT_MIGRATED_CATEGORY })] }),
        `category ${NOT_MIGRATED_CATEGORY}, which is not migrated`,
      ],
      [
        "a part with an unknown reporting class",
        (row) => ({ parts: [part(row, { reportingClass: "other" })] }),
        'unknown reporting class "other"',
      ],
      [
        "parts that do not sum to the amount",
        (row) => ({ parts: [part(row, { amountMinor: -1000n }), part(row, { amountMinor: -499n })] }),
        "do not sum to its amount",
      ],
      [
        "a part that goes the other way than the amount",
        (row) => ({ parts: [part(row, { amountMinor: -1700n }), part(row, { amountMinor: 200n })] }),
        "a part goes the other way than its amount",
      ],
      [
        "a part in a labeled category without a label",
        (row) => ({ parts: [part(row, { categoryId: LABELED })] }),
        "labeled category but has no label",
      ],
      [
        "a part in a labeled category with a blank label",
        (row) => ({ parts: [part(row, { categoryId: LABELED, label: "  " })] }),
        "labeled category but has no label",
      ],
      [
        "a result in a category that is not migrated",
        (row) => ({
          parts: [part(row)],
          classificationResults: [result(row, { categoryId: NOT_MIGRATED_CATEGORY })],
        }),
        `category ${NOT_MIGRATED_CATEGORY}, which is not migrated`,
      ],
      [
        "a result with an unknown classifier type",
        (row) => ({ parts: [part(row)], classificationResults: [result(row, { classifierType: "oracle" })] }),
        'unknown classifier type "oracle"',
      ],
      [
        "a result with an unknown status",
        (row) => ({ parts: [part(row)], classificationResults: [result(row, { status: "maybe" })] }),
        'unknown status "maybe"',
      ],
      [
        "no parts and a conflicting result",
        (row) => ({ classificationResults: [result(row, { status: "conflict" })] }),
        "no parts but a conflicting classification result",
      ],
    ])("%s", (_, snapshot, message) => {
      const problems = problemFor(snapshot);
      expect(problems).toHaveLength(1);
      expect(problems[0]).toContain(message);
    });

    it("accepts a conflicting result when the transaction has parts", () => {
      const row = transaction();
      const { report } = translated(
        input({
          transactions: [row],
          parts: [part(row, { manuallyApproved: false })],
          classificationResults: [result(row, { status: "conflict" })],
        }),
      );
      expect(report.byState.needs_review).toBe(1);
    });

    it("reports parts and results of a transaction that does not exist", () => {
      const missing = transaction();
      const problems = problemsOf(
        input({ parts: [part(missing)], classificationResults: [result(missing)] }),
      );
      expect(problems).toHaveLength(2);
      expect(problems.every((problem) => problem.includes(missing.id))).toBe(true);
    });

    it("lists every problem of every transaction at once, by old ID, without descriptions or amounts", () => {
      const first = transaction({ accountId: null, note: "notatka", description: "opis tajny" });
      const second = bankTransaction({ currency: "EUR", amountMinor: -98765n });
      const problems = problemsOf(
        input({
          transactions: [second, first],
          parts: [part(second, { amountMinor: -1n })],
        }),
      );
      expect(problems).toHaveLength(4);
      expect(problems.slice(0, 2).every((problem) => problem.includes(first.id))).toBe(true);
      expect(problems.slice(2).every((problem) => problem.includes(second.id))).toBe(true);
      expect(problems.join("\n")).not.toMatch(/opis tajny|98765/);
    });
  });
});
