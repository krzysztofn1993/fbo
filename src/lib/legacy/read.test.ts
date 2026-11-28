import { describe, expect, it } from "vitest";

import { parseLegacyRecords } from "@/lib/legacy/read";

const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";
const ROOT_ID = "c0000000-0000-4000-8000-000000000001";
const CHILD_ID = "c0000000-0000-4000-8000-000000000002";
const CREATED = new Date("2024-01-01T12:00:00Z");
const UPDATED = new Date("2024-01-02T12:00:00Z");

/** A row as `pg` returns it for the accounts query. */
function accountRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    name: "bank 1",
    type: "bank",
    currency: "PLN",
    reporting_scope: "personal",
    is_active: true,
    created_at: CREATED,
    updated_at: UPDATED,
    ...overrides,
  };
}

/** A row as `pg` returns it for the categories query. */
function categoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOT_ID,
    parent_id: null,
    name: "Kategoria A",
    kind: "expense",
    is_active: true,
    created_at: CREATED,
    updated_at: UPDATED,
    ...overrides,
  };
}

const NO_TRANSACTIONS = { transactions: [], parts: [], classificationResults: [] };

describe("parseLegacyRecords", () => {
  it("turns the rows into the snapshot the translation reads", () => {
    const result = parseLegacyRecords({
      accounts: [accountRecord()],
      referencedInactive: [{ id: ACCOUNT_ID }],
      categories: [categoryRecord(), categoryRecord({ id: CHILD_ID, parent_id: ROOT_ID })],
      ...NO_TRANSACTIONS,
    });

    expect(result).toEqual({
      ok: true,
      snapshot: {
        accounts: [
          {
            id: ACCOUNT_ID,
            name: "bank 1",
            type: "bank",
            currency: "PLN",
            reportingScope: "personal",
            isActive: true,
            createdAt: CREATED,
            updatedAt: UPDATED,
          },
        ],
        referencedInactiveAccountIds: new Set([ACCOUNT_ID]),
        categories: [
          {
            id: ROOT_ID,
            parentId: null,
            name: "Kategoria A",
            kind: "expense",
            isActive: true,
            createdAt: CREATED,
            updatedAt: UPDATED,
          },
          {
            id: CHILD_ID,
            parentId: ROOT_ID,
            name: "Kategoria A",
            kind: "expense",
            isActive: true,
            createdAt: CREATED,
            updatedAt: UPDATED,
          },
        ],
        transactions: [],
        parts: [],
        classificationResults: [],
      },
    });
  });

  it("leaves enum values and the currency as text for the translation to check", () => {
    const result = parseLegacyRecords({
      accounts: [accountRecord({ type: "savings", currency: "zł", reporting_scope: "family" })],
      referencedInactive: [],
      categories: [categoryRecord({ kind: "unknown" })],
      ...NO_TRANSACTIONS,
    });
    expect(result.ok).toBe(true);
  });

  it("reports every row of an unexpected shape by query, row and column", () => {
    const result = parseLegacyRecords({
      accounts: [accountRecord(), accountRecord({ id: "not-a-uuid", is_active: null })],
      referencedInactive: [{ id: 7 }],
      categories: [categoryRecord({ parent_id: "", created_at: "2024-01-01" })],
      ...NO_TRANSACTIONS,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toHaveLength(5);
      expect(result.problems[0]).toMatch(/^The old database returned an unexpected value in accounts row 2, column "id": /);
      expect(result.problems[1]).toContain('accounts row 2, column "is_active"');
      expect(result.problems[2]).toContain('referenced accounts row 1, column "id"');
      expect(result.problems[3]).toContain('categories row 1, column "parent_id"');
      expect(result.problems[4]).toContain('categories row 1, column "created_at"');
    }
  });
});

const TRANSACTION_ID = "d0000000-0000-4000-8000-000000000001";
const RESULT_ID = "e0000000-0000-4000-8000-000000000001";
const RULE_ID = "f6000000-0000-4000-8000-000000000001";
const SYNC_STARTED = new Date("2024-01-03T12:00:00Z");

/** A row as `pg` returns it for the transactions query: text amounts and dates, parsed jsonb. */
function transactionRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: TRANSACTION_ID,
    account_id: ACCOUNT_ID,
    merchant_id: null,
    booking_date: "2024-03-05",
    operation_date: "2024-03-04",
    amount_minor: "-12345678901234567",
    currency: "PLN",
    source_kind: "bank_api",
    reporting_scope_override: null,
    description: "opis 1",
    note: null,
    refund_of_transaction_id: null,
    import_run_id: null,
    importer_type: null,
    importer_version: null,
    source_file_id: null,
    source_file_name: null,
    source_file_sha256: null,
    source_file_mime_type: null,
    source_file_size_bytes: "2048",
    source_sheet: null,
    source_cell: null,
    source_record_index: 3,
    raw_source_value: null,
    raw_record_hash: "raw-1",
    normalized_record_hash: null,
    bank_record_id_hash: "bank-record-1",
    bank_connection_id: "f3000000-0000-4000-8000-000000000001",
    bank_provider: "provider 1",
    bank_name: "bank 1",
    bank_country: "PL",
    bank_sync_run_id: "f4000000-0000-4000-8000-000000000001",
    bank_sync_started_at: SYNC_STARTED,
    provider_source_metadata: { status: "BOOK" },
    created_at: CREATED,
    updated_at: UPDATED,
    ...overrides,
  };
}

function partRecord(overrides: Record<string, unknown> = {}) {
  return {
    transaction_id: TRANSACTION_ID,
    category_id: ROOT_ID,
    amount_minor: "-1500",
    label: null,
    reporting_class: "standard",
    manually_approved: true,
    created_at: CREATED,
    updated_at: UPDATED,
    ...overrides,
  };
}

function resultRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: RESULT_ID,
    transaction_id: TRANSACTION_ID,
    category_id: null,
    label: null,
    rule_id: RULE_ID,
    rule_ids: [RULE_ID],
    classifier_type: "merchant_rule",
    classifier_version: "1",
    confidence_bps: 9000,
    reason: null,
    historical_proposal_id: null,
    provenance: { rule: "reguła 1" },
    status: "approved",
    created_at: CREATED,
    updated_at: UPDATED,
    ...overrides,
  };
}

function records(overrides: Partial<Record<"transactions" | "parts" | "classificationResults", unknown[]>>) {
  return {
    accounts: [],
    referencedInactive: [],
    categories: [],
    transactions: [],
    parts: [],
    classificationResults: [],
    ...overrides,
  };
}

describe("parseLegacyRecords for transactions", () => {
  it("parses amounts to bigint, keeps dates as text and brands the old IDs", () => {
    const result = parseLegacyRecords(
      records({
        transactions: [transactionRecord()],
        parts: [partRecord()],
        classificationResults: [resultRecord()],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const [transaction] = result.snapshot.transactions;
    expect(transaction).toMatchObject({
      id: TRANSACTION_ID,
      accountId: ACCOUNT_ID,
      bookingDate: "2024-03-05",
      operationDate: "2024-03-04",
      // Beyond Number.MAX_SAFE_INTEGER, so it must never pass through a number.
      amountMinor: -12345678901234567n,
      sourceKind: "bank_api",
      sourceFileSizeBytes: 2048n,
      sourceRecordIndex: 3,
      bankName: "bank 1",
      bankSyncStartedAt: SYNC_STARTED,
      providerSourceMetadata: { status: "BOOK" },
    });
    expect(result.snapshot.parts).toEqual([
      {
        transactionId: TRANSACTION_ID,
        categoryId: ROOT_ID,
        amountMinor: -1500n,
        label: null,
        reportingClass: "standard",
        manuallyApproved: true,
        createdAt: CREATED,
        updatedAt: UPDATED,
      },
    ]);
    expect(result.snapshot.classificationResults).toEqual([
      {
        id: RESULT_ID,
        transactionId: TRANSACTION_ID,
        categoryId: null,
        label: null,
        ruleId: RULE_ID,
        ruleIds: [RULE_ID],
        classifierType: "merchant_rule",
        classifierVersion: "1",
        confidenceBps: 9000,
        reason: null,
        historicalProposalId: null,
        provenance: { rule: "reguła 1" },
        status: "approved",
        createdAt: CREATED,
        updatedAt: UPDATED,
      },
    ]);
  });

  it("leaves the enum values and the currency as text for the translation to check", () => {
    const result = parseLegacyRecords(
      records({
        transactions: [
          transactionRecord({
            source_kind: "fax",
            reporting_scope_override: "family",
            currency: "zł",
            provider_source_metadata: null,
          }),
        ],
        parts: [partRecord({ reporting_class: "other" })],
        classificationResults: [resultRecord({ classifier_type: "oracle", status: "maybe" })],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("reports amounts, dates, IDs and jsonb of an unexpected shape by query, row and column, never the value", () => {
    const result = parseLegacyRecords(
      records({
        transactions: [
          transactionRecord(),
          transactionRecord({
            amount_minor: "12.50",
            booking_date: "05.03.2024",
            account_id: "konto-1",
            provider_source_metadata: ["BOOK"],
          }),
        ],
        parts: [partRecord({ amount_minor: 1500 })],
        classificationResults: [resultRecord({ rule_ids: [RULE_ID, "reguła-1"], provenance: null })],
      }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.problems).toHaveLength(7);
    const columns = [
      'transactions row 2, column "account_id"',
      'transactions row 2, column "booking_date"',
      'transactions row 2, column "amount_minor"',
      'transactions row 2, column "provider_source_metadata"',
      'transaction parts row 1, column "amount_minor"',
      'classification results row 1, column "rule_ids"',
      'classification results row 1, column "provenance"',
    ];
    columns.forEach((column, index) => {
      expect(result.problems[index]).toContain(column);
    });
    for (const value of ["12.50", "05.03.2024", "konto-1", "reguła-1"]) {
      expect(result.problems.join("\n")).not.toContain(value);
    }
  });
});
