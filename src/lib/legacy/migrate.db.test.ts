import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  accounts,
  categories,
  legacyAccountMap,
  legacyCategoryMap,
  legacyClassificationResults,
  legacyTransactionMap,
  legacyTransactionSources,
  transactionParts,
  transactions,
} from "@/lib/db/schema";
import { testDatabaseUrl, testLegacyDatabaseUrl, truncateTables } from "@/lib/db/test-database";
import { LegacyCategoryIdSchema } from "@/lib/ids";
import {
  ACCOUNT_BANK_1,
  ACCOUNT_BANK_2,
  ACCOUNT_CASH_1,
  ACCOUNT_INACTIVE,
  BANK_SYNC_RUN_1,
  createLegacySchema,
  DUP_BANK_CONTESTED,
  DUP_BANK_OPERATION_DATE,
  DUP_BANK_SAME_DAY,
  DUP_BANK_THREE_DAYS,
  DUP_SHEET_CLOSER,
  DUP_SHEET_OPERATION_DATE,
  DUP_SHEET_SAME_DAY,
  DUP_SHEET_THREE_DAYS,
  DUPLICATES_LAYOUT,
  insertLegacyAccounts,
  insertLegacyCategories,
  LEGACY_ACCOUNT_BANK_2,
  LEGACY_LAYOUT,
  LEGACY_TRANSACTIONS,
  MERCHANT_1,
  PROPOSAL_1,
  RESULT_APPROVED,
  RESULT_REJECTED,
  RESULT_SUGGESTED,
  ROOT_A,
  ROOT_B,
  ROOT_C,
  RULE_1,
  RULE_2,
  SECOND_KEY_BANK_BOTH,
  SECOND_KEY_BANK_ONE,
  SECOND_KEY_SHEET_EARLY,
  SECOND_KEY_SHEET_LATE,
  seedLegacyDatabase,
  seedLegacyDuplicates,
  SOURCE_FILE_1,
  SOURCE_ORDER,
  SUB_A1,
  SUB_A2,
  SUB_A3,
  SUB_B_BONUS_NEW,
  SUB_B_BONUS_OLD,
  SUB_B_SALARY,
  TX_BANK_APPROVED,
  TX_BANK_APRIL,
  TX_BANK_REVIEW,
  TX_BANK_UNCLASSIFIED,
  TX_SHEET_CASH,
  TX_SHEET_INCOME,
  TX_SHEET_LABELED,
  TX_SHEET_SPLIT,
  TX_SHEET_UNCLASSIFIED,
} from "@/lib/legacy/legacy-fixture";
import { type MigrationOptions, runLegacyMigration } from "@/lib/legacy/migrate";

const newPool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 2 });
const legacyPool = new pg.Pool({ connectionString: testLegacyDatabaseUrl(), max: 2 });
const db = drizzle({ client: newPool });

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let layoutDir: string;
let layoutFile: string;

beforeAll(async () => {
  await createLegacySchema(legacyPool);
  // The layout file lives outside the repository, as the real one does.
  layoutDir = await mkdtemp(join(tmpdir(), "fbo-category-layout-"));
  layoutFile = join(layoutDir, "layout.json");
});

beforeEach(async () => {
  await truncateTables(newPool);
  await truncateTables(legacyPool);
  await seedLegacyDatabase(legacyPool);
  await writeFile(layoutFile, JSON.stringify(LEGACY_LAYOUT));
});

afterAll(async () => {
  await Promise.all([newPool.end(), legacyPool.end()]);
  await rm(layoutDir, { recursive: true, force: true });
});

function migrate(overrides: Partial<MigrationOptions> = {}) {
  return runLegacyMigration({
    newDatabaseUrl: testDatabaseUrl(),
    legacyDatabaseUrl: testLegacyDatabaseUrl(),
    layoutFile,
    ...overrides,
  });
}

async function rowCounts() {
  const result = await newPool.query<Record<string, number>>(`
    SELECT (SELECT count(*)::int FROM accounts) AS accounts,
           (SELECT count(*)::int FROM categories) AS categories,
           (SELECT count(*)::int FROM legacy_account_map) AS account_map,
           (SELECT count(*)::int FROM legacy_category_map) AS category_map,
           (SELECT count(*)::int FROM transactions) AS transactions,
           (SELECT count(*)::int FROM transaction_parts) AS transaction_parts,
           (SELECT count(*)::int FROM legacy_transaction_map) AS transaction_map,
           (SELECT count(*)::int FROM legacy_transaction_sources) AS transaction_sources,
           (SELECT count(*)::int FROM legacy_classification_results) AS classification_results,
           (SELECT count(*)::int FROM possible_duplicates) AS possible_duplicates`);
  return result.rows[0];
}

const NO_ROWS = {
  accounts: 0,
  categories: 0,
  account_map: 0,
  category_map: 0,
  transactions: 0,
  transaction_parts: 0,
  transaction_map: 0,
  transaction_sources: 0,
  classification_results: 0,
  possible_duplicates: 0,
};

/** The marked pairs by old IDs, the first and the second transaction, with the source kinds. */
async function duplicatePairs() {
  const result = await newPool.query<{
    first: string;
    second: string;
    day_difference: number;
    first_source: string;
    second_source: string;
    same_account: boolean;
  }>(`
    SELECT fm.legacy_id::text AS first, sm.legacy_id::text AS second, d.day_difference,
           fs.source_kind::text AS first_source, ss.source_kind::text AS second_source,
           ft.account_id = st.account_id AS same_account
    FROM possible_duplicates d
    JOIN legacy_transaction_map fm ON fm.transaction_id = d.first_transaction_id
    JOIN legacy_transaction_map sm ON sm.transaction_id = d.second_transaction_id
    JOIN legacy_transaction_sources fs ON fs.transaction_id = d.first_transaction_id
    JOIN legacy_transaction_sources ss ON ss.transaction_id = d.second_transaction_id
    JOIN transactions ft ON ft.id = d.first_transaction_id
    JOIN transactions st ON st.id = d.second_transaction_id
    ORDER BY 1, 2`);
  return result.rows;
}

/** Sum of the amounts per booking month and currency, as text. */
const OLD_TOTALS_SQL = `
  SELECT to_char(booking_date, 'YYYY-MM') AS month, currency, sum(amount_minor)::text AS total
  FROM transactions GROUP BY 1, 2 ORDER BY 1, 2`;
const NEW_TOTALS_SQL = `
  SELECT to_char(t.booking_date, 'YYYY-MM') AS month, a.currency,
         sum(t.amount_minor)::text AS total
  FROM transactions t JOIN accounts a ON a.id = t.account_id GROUP BY 1, 2 ORDER BY 1, 2`;

describe("runLegacyMigration", () => {
  it("moves active accounts and all categories with legacy maps", async () => {
    const outcome = await migrate();
    expect(outcome.status).toBe("migrated");

    const accountRows = await db.select().from(accounts).orderBy(asc(accounts.createdAt));
    expect(accountRows.map(({ name, type, currency, reportingScope }) => ({
      name,
      type,
      currency,
      reportingScope,
    }))).toEqual([
      { name: "bank 1", type: "bank", currency: "PLN", reportingScope: "personal" },
      { name: "cash 1", type: "cash", currency: "EUR", reportingScope: "business" },
    ]);
    const accountMap = await db.select().from(legacyAccountMap);
    const accountIdOf = new Map(accountMap.map((row) => [row.legacyId, row.accountId]));
    expect([...accountIdOf.keys()].sort()).toEqual([ACCOUNT_BANK_1, ACCOUNT_CASH_1]);
    expect(accountIdOf.has(ACCOUNT_INACTIVE)).toBe(false);
    expect(accountIdOf.get(ACCOUNT_BANK_1)).toBe(accountRows[0].id);

    const categoryRows = await db.select().from(categories);
    const categoryMap = await db.select().from(legacyCategoryMap);
    const categoryIdOf = new Map(categoryMap.map((row) => [row.legacyId, row.categoryId]));
    expect(categoryRows).toHaveLength(8);
    expect(categoryMap).toHaveLength(9);
    for (const row of [...accountRows, ...categoryRows]) {
      expect(row.id).toMatch(UUID_V7);
    }

    const byId = new Map(categoryRows.map((row) => [row.id, row]));
    const tree = (parentId: string | null) =>
      categoryRows
        .filter((row) => row.parentId === parentId)
        .sort((a, b) => a.position - b.position)
        .map((row) => ({ name: row.name, position: row.position, type: row.type }));

    // Roots and subcategories follow the layout file; the one missing from it is last.
    expect(tree(null)).toEqual([
      { name: "Kategoria C", position: 0, type: "labeled" },
      { name: "Kategoria A", position: 1, type: "standard" },
      { name: "Kategoria B", position: 2, type: "standard" },
    ]);
    expect(tree(categoryIdOf.get(ROOT_A) ?? "")).toEqual([
      { name: "Podkategoria 2", position: 0, type: "standard" },
      { name: "Podkategoria 1", position: 1, type: "standard" },
      { name: "Podkategoria 3", position: 2, type: "standard" },
    ]);
    expect(tree(categoryIdOf.get(ROOT_B) ?? "")).toEqual([
      { name: "Wynagrodzenie", position: 0, type: "standard" },
      { name: "Premia", position: 1, type: "standard" },
    ]);

    // The pair that differs only in case is one record with two map rows.
    const merged = categoryIdOf.get(SUB_B_BONUS_OLD);
    expect(merged).toBeDefined();
    expect(categoryIdOf.get(SUB_B_BONUS_NEW)).toBe(merged);
    expect(categoryMap.filter((row) => row.categoryId === merged)).toHaveLength(2);
    const mergedRow = merged === undefined ? undefined : byId.get(merged);
    expect(mergedRow?.kind).toBe("income");
    expect(mergedRow?.createdAt.toISOString()).toBe("2024-01-04T12:00:00.000Z");
    expect(mergedRow?.updatedAt.toISOString()).toBe("2024-01-08T12:00:00.000Z");

    for (const legacyId of [ROOT_A, ROOT_B, ROOT_C, SUB_A1, SUB_A2, SUB_A3, SUB_B_SALARY]) {
      const categoryId = categoryIdOf.get(legacyId);
      expect(categoryId !== undefined && byId.has(categoryId)).toBe(true);
    }

    if (outcome.status === "migrated") {
      expect(outcome.report).toMatchObject({
        accountsMigrated: 2,
        accountsSkipped: 1,
        rootCategories: 3,
        subcategories: 5,
        accountMapRows: 2,
        categoryMapRows: 9,
        mergedGroups: [{ name: "Premia", parentName: "Kategoria B", rowCount: 2 }],
        labeledCategories: ["Kategoria C"],
        appendedSubcategories: [{ parentName: "Kategoria A", name: "Podkategoria 3" }],
      });
      expect(outcome.report.layoutWarnings).toHaveLength(1);
      expect(outcome.report.layoutWarnings[0]).toContain("Podkategoria 9");
    }
  });

  it("moves every transaction with its parts, source trace and classification results", async () => {
    const outcome = await migrate();
    expect(outcome.status).toBe("migrated");

    expect(await rowCounts()).toEqual({
      accounts: 2,
      categories: 8,
      account_map: 2,
      category_map: 9,
      transactions: LEGACY_TRANSACTIONS.length,
      transaction_parts: 8,
      transaction_map: LEGACY_TRANSACTIONS.length,
      transaction_sources: LEGACY_TRANSACTIONS.length,
      classification_results: 3,
      possible_duplicates: 1,
    });

    const accountIdOf = new Map(
      (await db.select().from(legacyAccountMap)).map((row) => [row.legacyId, row.accountId]),
    );
    const categoryIdOf = new Map(
      (await db.select().from(legacyCategoryMap)).map((row) => [row.legacyId, row.categoryId]),
    );
    const transactionMap = await db.select().from(legacyTransactionMap);
    const transactionIdOf = new Map(transactionMap.map((row) => [row.legacyId, row.transactionId]));
    expect([...transactionIdOf.keys()].sort()).toEqual(
      LEGACY_TRANSACTIONS.map((row) => row.id).sort(),
    );
    const newId = (legacyId: (typeof SOURCE_ORDER)[number]) => {
      const id = transactionIdOf.get(legacyId);
      if (id === undefined) {
        throw new Error(`transaction ${legacyId} was not migrated`);
      }
      return id;
    };

    const transactionRows = await db.select().from(transactions);
    for (const row of transactionRows) {
      expect(row.id).toMatch(UUID_V7);
    }
    const transactionOf = new Map(transactionRows.map((row) => [row.id, row]));
    expect(transactionOf.get(newId(TX_SHEET_CASH))).toMatchObject({
      accountId: accountIdOf.get(ACCOUNT_CASH_1),
      bookingDate: "2024-03-05",
      operationDate: null,
      amountMinor: -700n,
      description: "opis 2",
      reportingScopeOverride: "personal",
      createdAt: new Date("2024-01-10T12:00:00Z"),
    });
    expect(transactionOf.get(newId(TX_BANK_APPROVED))).toMatchObject({
      accountId: accountIdOf.get(ACCOUNT_BANK_1),
      operationDate: "2024-03-04",
      reportingScopeOverride: null,
    });
    expect(transactionOf.get(newId(TX_SHEET_UNCLASSIFIED))?.description).toBeNull();

    // Inserted one by one in source order, so the UUIDv7 IDs keep it.
    const ordered = await newPool.query<{ legacy_id: string }>(`
      SELECT m.legacy_id::text AS legacy_id
      FROM transactions t JOIN legacy_transaction_map m ON m.transaction_id = t.id
      ORDER BY t.booking_date, t.id`);
    expect(ordered.rows.map((row) => row.legacy_id)).toEqual(SOURCE_ORDER);

    const partsOf = async (legacyId: (typeof SOURCE_ORDER)[number]) =>
      (
        await db
          .select()
          .from(transactionParts)
          .where(eq(transactionParts.transactionId, newId(legacyId)))
          .orderBy(asc(transactionParts.id))
      ).map(({ categoryId, amountMinor, label, reportingClass, approved }) => ({
        categoryId,
        amountMinor,
        label,
        reportingClass,
        approved,
      }));
    const part = { label: null, reportingClass: "standard", approved: true };
    expect(await partsOf(TX_SHEET_LABELED)).toEqual([
      { ...part, categoryId: categoryIdOf.get(ROOT_C), amountMinor: -1500n, label: "etykieta 1" },
    ]);
    // The income label is dropped; the part keeps the merged category and the amount.
    expect(await partsOf(TX_SHEET_INCOME)).toEqual([
      { ...part, categoryId: categoryIdOf.get(SUB_B_BONUS_NEW), amountMinor: 50000n },
    ]);
    expect(categoryIdOf.get(SUB_B_BONUS_NEW)).toBe(categoryIdOf.get(SUB_B_BONUS_OLD));
    expect(await partsOf(TX_SHEET_CASH)).toEqual([
      {
        ...part,
        categoryId: categoryIdOf.get(SUB_A1),
        amountMinor: -700n,
        reportingClass: "business_expense",
      },
    ]);
    expect(await partsOf(TX_SHEET_SPLIT)).toEqual([
      { ...part, categoryId: categoryIdOf.get(SUB_A1), amountMinor: -1000n },
      {
        ...part,
        categoryId: categoryIdOf.get(SUB_A2),
        amountMinor: -2000n,
        reportingClass: "business_tax",
      },
    ]);
    expect(await partsOf(TX_BANK_REVIEW)).toEqual([
      { ...part, categoryId: categoryIdOf.get(SUB_A1), amountMinor: -900n, approved: false },
    ]);
    expect(await partsOf(TX_SHEET_UNCLASSIFIED)).toEqual([]);
    expect(await partsOf(TX_BANK_UNCLASSIFIED)).toEqual([]);

    const results = new Map(
      (await db.select().from(legacyClassificationResults)).map((row) => [row.legacyId, row]),
    );
    expect(results.get(RESULT_APPROVED)).toMatchObject({
      transactionId: newId(TX_BANK_APPROVED),
      categoryId: categoryIdOf.get(SUB_A2),
      legacyRuleId: RULE_1,
      legacyRuleIds: [RULE_1, RULE_2],
      classifierType: "merchant_rule",
      confidenceBps: 10000,
      provenance: { rule: "reguła 1" },
      status: "approved",
      createdAt: new Date("2024-01-20T12:00:00Z"),
      updatedAt: new Date("2024-01-21T12:00:00Z"),
    });
    expect(results.get(RESULT_SUGGESTED)).toMatchObject({
      transactionId: newId(TX_BANK_REVIEW),
      categoryId: categoryIdOf.get(SUB_A1),
      classifierType: "similar_history",
      classifierVersion: "2",
      legacyHistoricalProposalId: PROPOSAL_1,
      reason: "podobna transakcja",
      status: "suggested",
    });
    expect(results.get(RESULT_REJECTED)).toMatchObject({
      transactionId: newId(TX_BANK_UNCLASSIFIED),
      categoryId: null,
      legacyRuleIds: [],
      status: "rejected",
    });

    const sources = new Map(
      (await db.select().from(legacyTransactionSources)).map((row) => [row.transactionId, row]),
    );
    expect(sources.get(newId(TX_SHEET_LABELED))).toMatchObject({
      sourceKind: "legacy_excel",
      legacySourceFileId: SOURCE_FILE_1,
      sourceFileName: "plik 1.xlsx",
      sourceFileSha256: "sha-1",
      sourceFileMimeType: "application/vnd.ms-excel",
      sourceFileSizeBytes: 2048n,
      importerType: "importer 1",
      importerVersion: "1.0",
      sourceSheet: "Arkusz 1",
      sourceCell: "B3",
      sourceRecordIndex: 2,
      rawSourceValue: "-1500",
      legacyBankConnectionId: null,
      providerSourceMetadata: null,
    });
    expect(sources.get(newId(TX_BANK_APPROVED))).toMatchObject({
      sourceKind: "bank_api",
      legacyMerchantId: MERCHANT_1,
      legacyImportRunId: null,
      sourceFileName: null,
      bankProvider: "provider 1",
      bankName: "bank 1",
      bankCountry: "PL",
      legacyBankSyncRunId: BANK_SYNC_RUN_1,
      bankSyncStartedAt: new Date("2024-01-20T12:00:00Z"),
      bankRecordIdHash: "bank-record-03",
      providerSourceMetadata: { status: "BOOK" },
    });

    // Every month and currency adds up to the same total as in the old database.
    const oldTotals = await legacyPool.query(OLD_TOTALS_SQL);
    const newTotals = await newPool.query(NEW_TOTALS_SQL);
    expect(oldTotals.rows.length).toBeGreaterThan(2);
    expect(newTotals.rows).toEqual(oldTotals.rows);

    if (outcome.status === "migrated") {
      expect(outcome.report.transactions).toEqual({
        transactions: LEGACY_TRANSACTIONS.length,
        bySource: { legacy_excel: 5, bank_file: 0, bank_api: 4, manual: 0 },
        parts: 8,
        byState: { unclassified: 2, needs_review: 1, approved: 6 },
        labelsKept: 1,
        labelsDropped: 1,
        classificationResults: 3,
        resultsByStatus: { suggested: 1, approved: 1, rejected: 1, conflict: 0, superseded: 0 },
        possibleDuplicates: {
          pairs: 1,
          sameDayWithoutCompetitor: 1,
          nearDateWithoutCompetitor: 0,
          withCompetitor: 0,
          byMonth: { "2024-03": 1 },
        },
      });
    }
    // The labeled spreadsheet row and the approved bank row share account, day and amount.
    expect(await duplicatePairs()).toEqual([
      {
        first: TX_BANK_APPROVED,
        second: TX_SHEET_LABELED,
        day_difference: 0,
        first_source: "bank_api",
        second_source: "legacy_excel",
        same_account: true,
      },
    ]);
  });

  it.each<[string, string, unknown[], string]>([
    [
      "a transaction without an account",
      "UPDATE transactions SET account_id = NULL WHERE id = $1",
      [TX_SHEET_UNCLASSIFIED],
      "has no account",
    ],
    [
      "a transaction in another currency than its account",
      "UPDATE transactions SET currency = 'EUR' WHERE id = $1",
      [TX_BANK_APRIL],
      "but its account is in PLN",
    ],
    [
      "a transaction with a note",
      "UPDATE transactions SET note = 'notatka' WHERE id = $1",
      [TX_BANK_APRIL],
      "has a note",
    ],
    [
      "a transaction marked as a refund",
      "UPDATE transactions SET refund_of_transaction_id = $2 WHERE id = $1",
      [TX_BANK_APRIL, TX_BANK_APPROVED],
      "refund",
    ],
    [
      "parts that do not sum to the amount",
      "UPDATE transaction_splits SET amount_minor = amount_minor - 1 WHERE transaction_id = $1",
      [TX_BANK_APRIL],
      "do not sum to its amount",
    ],
    [
      "a part that goes the other way than the amount",
      `WITH moved AS (
         UPDATE transaction_splits SET amount_minor = amount_minor - 100 WHERE transaction_id = $1
         RETURNING transaction_id, category_id, created_at, updated_at
       )
       INSERT INTO transaction_splits (transaction_id, category_id, amount_minor, created_at, updated_at)
       SELECT transaction_id, category_id, 100, created_at, updated_at FROM moved`,
      [TX_BANK_APRIL],
      "a part goes the other way than its amount",
    ],
    [
      "a part in the labeled category without a label",
      "UPDATE transaction_splits SET label = NULL WHERE transaction_id = $1",
      [TX_SHEET_LABELED],
      "labeled category but has no label",
    ],
    [
      "a conflicting result on a transaction without parts",
      "UPDATE classification_results SET status = 'conflict' WHERE id = $1",
      [RESULT_REJECTED],
      "no parts but a conflicting classification result",
    ],
  ])("writes neither accounts nor transactions with %s", async (_, statement, values, message) => {
    await legacyPool.query(statement, values);

    const outcome = await migrate();
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") {
      expect(outcome.problems).toEqual([expect.stringContaining(message)]);
    }
    expect(await rowCounts()).toEqual(NO_ROWS);
  });

  it("writes nothing when an old enum has a value the new schema does not know", async () => {
    // Added outside a transaction, and kept: the next file run recreates the type.
    await legacyPool.query("ALTER TYPE transaction_source_kind ADD VALUE IF NOT EXISTS 'fax'");
    await legacyPool.query("UPDATE transactions SET source_kind = 'fax' WHERE id = $1", [
      TX_SHEET_SPLIT,
    ]);

    const outcome = await migrate();
    expect(outcome).toEqual({
      status: "invalid",
      problems: [expect.stringContaining('unknown source kind "fax"')],
    });
    expect(await rowCounts()).toEqual(NO_ROWS);
  });

  it.each<[string, () => Promise<void>]>([
    [
      "an account with a transaction",
      async () => {
        const [account] = await db
          .insert(accounts)
          .values({ name: "bank 9", type: "bank", currency: "PLN", reportingScope: "personal" })
          .returning({ id: accounts.id });
        await db
          .insert(transactions)
          .values({ accountId: account.id, bookingDate: "2024-05-01", amountMinor: -100n });
      },
    ],
    [
      "a category",
      async () => {
        await db.insert(categories).values({ name: "Kategoria 9", kind: "expense", position: 0 });
      },
    ],
  ])("refuses when only some of the tables are empty: %s", async (_, fill) => {
    await fill();
    const before = await rowCounts();

    const outcome = await migrate();
    expect(outcome.status).toBe("refused");
    if (outcome.status === "refused") {
      expect(outcome.message).toContain("already been migrated");
    }
    expect(await rowCounts()).toEqual(before);
  });

  it("refuses a second run and leaves the rows as they are", async () => {
    expect((await migrate()).status).toBe("migrated");
    const before = await rowCounts();

    const second = await migrate();
    expect(second.status).toBe("refused");
    if (second.status === "refused") {
      expect(second.message).toContain("already been migrated");
    }
    expect(await rowCounts()).toEqual(before);
  });

  it("writes nothing when a category is on a third level", async () => {
    await insertLegacyCategories(legacyPool, [
      {
        id: LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000031"),
        parentId: SUB_A1,
        name: "Podkategoria 1a",
        kind: "expense",
        isActive: true,
        createdAt: new Date("2024-02-01T00:00:00Z"),
        updatedAt: new Date("2024-02-01T00:00:00Z"),
      },
    ]);

    const outcome = await migrate();
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") {
      expect(outcome.problems.join("\n")).toContain("third level");
    }
    expect(await rowCounts()).toEqual(NO_ROWS);
  });

  it("writes nothing when another row refers to the skipped inactive account", async () => {
    await legacyPool.query("INSERT INTO account_balance_snapshots (account_id) VALUES ($1)", [
      ACCOUNT_INACTIVE,
    ]);

    const outcome = await migrate();
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") {
      expect(outcome.problems).toHaveLength(1);
      expect(outcome.problems[0]).toContain(ACCOUNT_INACTIVE);
    }
    expect(await rowCounts()).toEqual(NO_ROWS);
  });

  it("writes nothing when a root category has no entry in the layout file", async () => {
    await insertLegacyCategories(legacyPool, [
      {
        id: LegacyCategoryIdSchema.parse("c0000000-0000-4000-8000-000000000004"),
        parentId: null,
        name: "Kategoria D",
        kind: "expense",
        isActive: true,
        createdAt: new Date("2024-02-01T00:00:00Z"),
        updatedAt: new Date("2024-02-01T00:00:00Z"),
      },
    ]);

    const outcome = await migrate();
    expect(outcome.status).toBe("invalid");
    if (outcome.status === "invalid") {
      expect(outcome.problems.join("\n")).toContain("Kategoria D");
    }
    expect(await rowCounts()).toEqual(NO_ROWS);
  });

  it("writes nothing when an old row has an unexpected shape", async () => {
    // The made-up old schema forbids it, so the column is relaxed for this test only.
    await legacyPool.query("ALTER TABLE categories ALTER COLUMN is_active DROP NOT NULL");
    try {
      await legacyPool.query("UPDATE categories SET is_active = NULL WHERE id = $1", [SUB_A1]);

      const outcome = await migrate();
      expect(outcome).toEqual({
        status: "invalid",
        problems: [expect.stringContaining('categories row 4, column "is_active"')],
      });
      expect(await rowCounts()).toEqual(NO_ROWS);
    } finally {
      await truncateTables(legacyPool);
      await legacyPool.query("ALTER TABLE categories ALTER COLUMN is_active SET NOT NULL");
    }
  });

  it("writes nothing when the layout file cannot be read", async () => {
    const outcome = await migrate({ layoutFile: join(layoutDir, "missing.json") });
    expect(outcome.status).toBe("invalid");
    expect(await rowCounts()).toEqual(NO_ROWS);
  });

  it("refuses the same database on both sides", async () => {
    const sameUrl = new URL(testDatabaseUrl());
    sameUrl.searchParams.set("application_name", "legacy");

    for (const legacyDatabaseUrl of [testDatabaseUrl(), sameUrl.toString()]) {
      const outcome = await migrate({ legacyDatabaseUrl });
      expect(outcome.status).toBe("refused");
      if (outcome.status === "refused") {
        expect(outcome.message).toContain("same database");
      }
    }
    expect(await rowCounts()).toEqual(NO_ROWS);
  });

  describe("with accounts renamed and merged by the layout file", () => {
    beforeEach(async () => {
      await insertLegacyAccounts(legacyPool, [LEGACY_ACCOUNT_BANK_2]);
    });

    it("maps every merged old account to one new account", async () => {
      await writeFile(
        layoutFile,
        JSON.stringify({
          ...LEGACY_LAYOUT,
          accounts: [
            { name: "Konto wspólne", legacyNames: ["bank 1", "Bank 2"] },
            { name: "Gotówka", legacyNames: ["cash 1"] },
          ],
        }),
      );

      const outcome = await migrate();
      expect(outcome.status).toBe("migrated");
      if (outcome.status === "migrated") {
        expect(outcome.report).toMatchObject({
          accountsMigrated: 2,
          accountMapRows: 3,
          renamedAccounts: [{ from: "cash 1", to: "Gotówka" }],
          mergedAccounts: [{ name: "Konto wspólne", oldAccountCount: 2 }],
        });
      }

      const accountRows = await db.select().from(accounts);
      const idOf = new Map(accountRows.map((row) => [row.name, row.id]));
      expect([...idOf.keys()].sort()).toEqual(["Gotówka", "Konto wspólne"]);
      const accountMap = await db.select().from(legacyAccountMap);
      expect(
        Object.fromEntries(accountMap.map((row) => [row.legacyId, row.accountId])),
      ).toEqual({
        [ACCOUNT_BANK_1]: idOf.get("Konto wspólne"),
        [ACCOUNT_BANK_2]: idOf.get("Konto wspólne"),
        [ACCOUNT_CASH_1]: idOf.get("Gotówka"),
      });
      // The merged account keeps the creation time of the older old account.
      const merged = accountRows.find((row) => row.name === "Konto wspólne");
      expect(merged?.createdAt.toISOString()).toBe("2023-12-01T00:00:00.000Z");
    });

    it("writes nothing when merged accounts differ in currency", async () => {
      await writeFile(
        layoutFile,
        JSON.stringify({
          ...LEGACY_LAYOUT,
          accounts: [{ name: "Konto wspólne", legacyNames: ["bank 2", "cash 1"] }],
        }),
      );

      const outcome = await migrate();
      expect(outcome.status).toBe("invalid");
      if (outcome.status === "invalid") {
        expect(outcome.problems).toEqual([
          expect.stringContaining("merges accounts that differ in type, currency or reporting scope"),
        ]);
      }
      expect(await rowCounts()).toEqual(NO_ROWS);
    });
  });

  describe("with possible duplicates on merged accounts", () => {
    beforeEach(async () => {
      await seedLegacyDuplicates(legacyPool);
      await writeFile(layoutFile, JSON.stringify(DUPLICATES_LAYOUT));
    });

    it("stores one-to-one pairs, the bank row first, counted in disjoint buckets", async () => {
      const outcome = await migrate();
      expect(outcome.status).toBe("migrated");

      const pair = (
        first: string,
        second: string,
        dayDifference: number,
        firstSource = "bank_api",
      ) => ({
        first,
        second,
        day_difference: dayDifference,
        first_source: firstSource,
        second_source: "legacy_excel",
        same_account: true,
      });
      const expected = [
        pair(TX_BANK_APPROVED, TX_SHEET_LABELED, 0),
        pair(DUP_BANK_SAME_DAY, DUP_SHEET_SAME_DAY, 0),
        pair(DUP_BANK_OPERATION_DATE, DUP_SHEET_OPERATION_DATE, 1),
        pair(DUP_BANK_THREE_DAYS, DUP_SHEET_THREE_DAYS, 3, "bank_file"),
        pair(DUP_BANK_CONTESTED, DUP_SHEET_CLOSER, 0),
        pair(SECOND_KEY_BANK_BOTH, SECOND_KEY_SHEET_LATE, 2),
        pair(SECOND_KEY_BANK_ONE, SECOND_KEY_SHEET_EARLY, 2),
      ].sort((a, b) => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0));
      expect(await duplicatePairs()).toEqual(expected);

      // The pairs join rows of both merged old accounts.
      const accountMap = await db.select().from(legacyAccountMap);
      const accountIdOf = new Map(accountMap.map((row) => [row.legacyId, row.accountId]));
      expect(accountIdOf.get(ACCOUNT_BANK_2)).toBe(accountIdOf.get(ACCOUNT_BANK_1));

      if (outcome.status === "migrated") {
        const report = outcome.report.transactions.possibleDuplicates;
        expect(report).toEqual({
          pairs: expected.length,
          sameDayWithoutCompetitor: 2,
          nearDateWithoutCompetitor: 2,
          withCompetitor: 3,
          byMonth: { "2024-03": 1, "2024-05": 3, "2024-06": 3 },
        });
        expect(
          report.sameDayWithoutCompetitor +
            report.nearDateWithoutCompetitor +
            report.withCompetitor,
        ).toBe(report.pairs);
      }
    });
  });
});
