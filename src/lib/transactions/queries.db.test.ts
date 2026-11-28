import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  accounts,
  categories,
  legacyTransactionSources,
  possibleDuplicates,
  transactionParts,
  transactions,
} from "@/lib/db/schema";
import { testDatabaseUrl, truncateTables } from "@/lib/db/test-database";
import { type AccountId, type CategoryId, type TransactionId, TransactionIdSchema } from "@/lib/ids";
import {
  getTransaction,
  listTransactions,
  TRANSACTIONS_PAGE_SIZE,
} from "@/lib/transactions/queries";

// One connection, so the UUIDv7 IDs of rows inserted one after another grow
// in insertion order.
const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 1 });
const db = drizzle({ client: pool });

beforeEach(async () => {
  await truncateTables(pool);
});

afterAll(async () => {
  await pool.end();
});

type NewTransaction = Omit<typeof transactions.$inferInsert, "accountId">;
type NewPart = Omit<typeof transactionParts.$inferInsert, "transactionId" | "categoryId"> & {
  categoryId?: CategoryId;
};

async function insertAccount(
  values: Partial<typeof accounts.$inferInsert> = {},
): Promise<AccountId> {
  const [row] = await db
    .insert(accounts)
    .values({ name: "bank 1", type: "bank", currency: "PLN", reportingScope: "personal", ...values })
    .returning({ id: accounts.id });
  return row.id;
}

async function insertCategory(values: typeof categories.$inferInsert): Promise<CategoryId> {
  const [row] = await db.insert(categories).values(values).returning({ id: categories.id });
  return row.id;
}

/** Inserts one transaction and its parts; parts default to the given category. */
async function insertTransaction(
  accountId: AccountId,
  categoryId: CategoryId,
  values: NewTransaction,
  parts: NewPart[] = [],
): Promise<TransactionId> {
  const [row] = await db
    .insert(transactions)
    .values({ accountId, ...values })
    .returning({ id: transactions.id });
  for (const part of parts) {
    await db
      .insert(transactionParts)
      .values({ transactionId: row.id, categoryId, ...part });
  }
  return row.id;
}

/** Inserts `n` transactions one by one, booking dates going back a day each time. */
async function insertMany(
  accountId: AccountId,
  categoryId: CategoryId,
  n: number,
): Promise<TransactionId[]> {
  const ids: TransactionId[] = [];
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < n; i += 1) {
    const bookingDate = new Date(start - i * 86_400_000).toISOString().slice(0, 10);
    ids.push(await insertTransaction(accountId, categoryId, { bookingDate, amountMinor: -100n }));
  }
  return ids;
}

describe("listTransactions", () => {
  it("orders by booking date, newest first, and by ID within a date", async () => {
    const account = await insertAccount();
    const category = await insertCategory({ name: "Kategoria A", kind: "expense", position: 0 });
    const older = await insertTransaction(account, category, {
      bookingDate: "2026-03-01",
      amountMinor: -100n,
      description: "starsza",
    });
    const firstOfDay = await insertTransaction(account, category, {
      bookingDate: "2026-03-05",
      amountMinor: -200n,
      description: "pierwsza z dnia",
    });
    const newer = await insertTransaction(account, category, {
      bookingDate: "2026-03-09",
      amountMinor: -300n,
      description: "nowsza",
    });
    const secondOfDay = await insertTransaction(account, category, {
      bookingDate: "2026-03-05",
      amountMinor: -400n,
      description: "druga z dnia",
    });
    expect(secondOfDay > firstOfDay).toBe(true);

    const list = await listTransactions(db, 1);
    expect(list.items.map((item) => item.id)).toEqual([newer, secondOfDay, firstOfDay, older]);
    expect(list).toMatchObject({ total: 4, page: 1, pageCount: 1 });
  });

  it("returns the display fields with the account name and currency", async () => {
    const account = await insertAccount({ name: "konto 1", currency: "EUR" });
    const root = await insertCategory({ name: "Kategoria A", kind: "expense", position: 0 });
    const child = await insertCategory({
      parentId: root,
      name: "Podkategoria 1",
      kind: "expense",
      position: 0,
    });
    const id = await insertTransaction(
      account,
      child,
      { bookingDate: "2026-04-01", amountMinor: -1234n, description: "opis 1" },
      [
        { amountMinor: -1000n, approved: true },
        { categoryId: root, amountMinor: -234n, approved: true },
      ],
    );

    const { items } = await listTransactions(db, 1);
    expect(items).toEqual([
      {
        id,
        bookingDate: "2026-04-01",
        description: "opis 1",
        accountName: "konto 1",
        currency: "EUR",
        amountMinor: -1234n,
        state: "approved",
        parts: [
          { categoryName: "Podkategoria 1", parentCategoryName: "Kategoria A" },
          { categoryName: "Kategoria A", parentCategoryName: null },
        ],
        hasPossibleDuplicate: false,
      },
    ]);
  });

  it("fits exactly one page size on one page", async () => {
    const account = await insertAccount();
    const category = await insertCategory({ name: "Kategoria A", kind: "expense", position: 0 });
    await insertMany(account, category, TRANSACTIONS_PAGE_SIZE);

    const list = await listTransactions(db, 1);
    expect(list.items).toHaveLength(TRANSACTIONS_PAGE_SIZE);
    expect(list).toMatchObject({ total: TRANSACTIONS_PAGE_SIZE, page: 1, pageCount: 1 });
  });

  it("puts the transaction after a full page on the second page", async () => {
    const account = await insertAccount();
    const category = await insertCategory({ name: "Kategoria A", kind: "expense", position: 0 });
    const ids = await insertMany(account, category, TRANSACTIONS_PAGE_SIZE + 1);

    const first = await listTransactions(db, 1);
    expect(first.items.map((item) => item.id)).toEqual(ids.slice(0, TRANSACTIONS_PAGE_SIZE));
    expect(first).toMatchObject({ total: TRANSACTIONS_PAGE_SIZE + 1, page: 1, pageCount: 2 });

    const second = await listTransactions(db, 2);
    expect(second.items.map((item) => item.id)).toEqual([ids[TRANSACTIONS_PAGE_SIZE]]);
    expect(second).toMatchObject({ page: 2, pageCount: 2 });
  });

  it("gives the nearest page for a page outside the range", async () => {
    const account = await insertAccount();
    const category = await insertCategory({ name: "Kategoria A", kind: "expense", position: 0 });
    const ids = await insertMany(account, category, TRANSACTIONS_PAGE_SIZE + 1);

    expect(await listTransactions(db, 0)).toMatchObject({ page: 1, pageCount: 2 });
    expect(await listTransactions(db, -3)).toMatchObject({ page: 1 });
    const beyond = await listTransactions(db, 99);
    expect(beyond).toMatchObject({ page: 2, pageCount: 2 });
    expect(beyond.items.map((item) => item.id)).toEqual([ids[TRANSACTIONS_PAGE_SIZE]]);
  });

  it("shows one empty page when there are no transactions", async () => {
    expect(await listTransactions(db, 3)).toEqual({ items: [], total: 0, page: 1, pageCount: 1 });
  });

  it("derives each classification state from the parts", async () => {
    const account = await insertAccount();
    const category = await insertCategory({ name: "Kategoria A", kind: "expense", position: 0 });
    const unclassified = await insertTransaction(account, category, {
      bookingDate: "2026-05-04",
      amountMinor: -500n,
    });
    const notApproved = await insertTransaction(
      account,
      category,
      { bookingDate: "2026-05-03", amountMinor: -500n },
      [
        { amountMinor: -300n, approved: true },
        { amountMinor: -200n, approved: false },
      ],
    );
    const sumMismatch = await insertTransaction(
      account,
      category,
      { bookingDate: "2026-05-02", amountMinor: -500n },
      [{ amountMinor: -499n, approved: true }],
    );
    const approved = await insertTransaction(
      account,
      category,
      { bookingDate: "2026-05-01", amountMinor: -500n },
      [{ amountMinor: -500n, approved: true }],
    );

    const { items } = await listTransactions(db, 1);
    expect(items.map((item) => [item.id, item.state, item.parts.length])).toEqual([
      [unclassified, "unclassified", 0],
      [notApproved, "needs_review", 2],
      [sumMismatch, "needs_review", 1],
      [approved, "approved", 1],
    ]);
  });

  it("marks both transactions of a possible duplicate pair", async () => {
    const account = await insertAccount();
    const category = await insertCategory({ name: "Kategoria A", kind: "expense", position: 0 });
    const first = await insertTransaction(account, category, {
      bookingDate: "2026-06-03",
      amountMinor: -700n,
    });
    const second = await insertTransaction(account, category, {
      bookingDate: "2026-06-02",
      amountMinor: -700n,
    });
    const alone = await insertTransaction(account, category, {
      bookingDate: "2026-06-01",
      amountMinor: -700n,
    });
    await db
      .insert(possibleDuplicates)
      .values({ firstTransactionId: first, secondTransactionId: second, dayDifference: 1 });

    const { items } = await listTransactions(db, 1);
    expect(items.map((item) => [item.id, item.hasPossibleDuplicate])).toEqual([
      [first, true],
      [second, true],
      [alone, false],
    ]);
  });
});

describe("getTransaction", () => {
  it("returns the fields, the parts by ID with their root category, and the source kind", async () => {
    const account = await insertAccount({ name: "konto 1", reportingScope: "business" });
    const labeled = await insertCategory({
      name: "Kategoria A",
      kind: "mixed",
      type: "labeled",
      position: 0,
    });
    const root = await insertCategory({ name: "Kategoria B", kind: "expense", position: 1 });
    const child = await insertCategory({
      parentId: root,
      name: "Podkategoria 1",
      kind: "expense",
      position: 0,
    });
    const id = await insertTransaction(
      account,
      child,
      {
        bookingDate: "2026-07-02",
        operationDate: "2026-07-01",
        amountMinor: -3000n,
        description: "opis 1",
        reportingScopeOverride: "personal",
      },
      [
        { amountMinor: -2000n, reportingClass: "business_expense", approved: true },
        { categoryId: labeled, amountMinor: -1000n, label: "etykieta 1", approved: false },
      ],
    );
    await db.insert(legacyTransactionSources).values({ transactionId: id, sourceKind: "bank_api" });

    expect(await getTransaction(db, id)).toEqual({
      id,
      bookingDate: "2026-07-02",
      operationDate: "2026-07-01",
      description: "opis 1",
      amountMinor: -3000n,
      reportingScopeOverride: "personal",
      accountName: "konto 1",
      currency: "PLN",
      accountReportingScope: "business",
      sourceKind: "bank_api",
      state: "needs_review",
      parts: [
        {
          id: expect.any(String),
          categoryName: "Podkategoria 1",
          parentCategoryName: "Kategoria B",
          amountMinor: -2000n,
          label: null,
          reportingClass: "business_expense",
          approved: true,
        },
        {
          id: expect.any(String),
          categoryName: "Kategoria A",
          parentCategoryName: null,
          amountMinor: -1000n,
          label: "etykieta 1",
          reportingClass: "standard",
          approved: false,
        },
      ],
      hasPossibleDuplicate: false,
      possibleDuplicates: [],
    });
  });

  it("gives null dates, scope and source kind for a bare transaction without a trace", async () => {
    const account = await insertAccount();
    const category = await insertCategory({ name: "Kategoria A", kind: "expense", position: 0 });
    const id = await insertTransaction(account, category, {
      bookingDate: "2026-07-03",
      amountMinor: 100n,
    });

    expect(await getTransaction(db, id)).toMatchObject({
      operationDate: null,
      description: null,
      reportingScopeOverride: null,
      sourceKind: null,
      state: "unclassified",
      parts: [],
    });
  });

  it("returns the other transaction of every pair, from either column", async () => {
    const account = await insertAccount();
    const category = await insertCategory({ name: "Kategoria A", kind: "expense", position: 0 });
    const bank = await insertTransaction(account, category, {
      bookingDate: "2026-08-03",
      amountMinor: -900n,
      description: "z banku",
    });
    const sheetLater = await insertTransaction(account, category, {
      bookingDate: "2026-08-04",
      amountMinor: -900n,
      description: "z arkusza 2",
    });
    const sheetEarlier = await insertTransaction(account, category, {
      bookingDate: "2026-08-02",
      amountMinor: -900n,
    });
    const target = await insertTransaction(account, category, {
      bookingDate: "2026-08-03",
      amountMinor: -900n,
    });
    await db.insert(legacyTransactionSources).values([
      { transactionId: bank, sourceKind: "bank_api" },
      { transactionId: sheetLater, sourceKind: "legacy_excel" },
    ]);
    // The target is second in one pair and first in two others.
    await db.insert(possibleDuplicates).values([
      { firstTransactionId: bank, secondTransactionId: target, dayDifference: 0 },
      { firstTransactionId: target, secondTransactionId: sheetLater, dayDifference: 1 },
      { firstTransactionId: target, secondTransactionId: sheetEarlier, dayDifference: 1 },
    ]);

    const details = await getTransaction(db, target);
    expect(details?.hasPossibleDuplicate).toBe(true);
    expect(details?.possibleDuplicates).toEqual([
      {
        id: sheetEarlier,
        bookingDate: "2026-08-02",
        amountMinor: -900n,
        description: null,
        currency: "PLN",
        sourceKind: null,
      },
      {
        id: bank,
        bookingDate: "2026-08-03",
        amountMinor: -900n,
        description: "z banku",
        currency: "PLN",
        sourceKind: "bank_api",
      },
      {
        id: sheetLater,
        bookingDate: "2026-08-04",
        amountMinor: -900n,
        description: "z arkusza 2",
        currency: "PLN",
        sourceKind: "legacy_excel",
      },
    ]);

    const fromBank = await getTransaction(db, bank);
    expect(fromBank?.possibleDuplicates.map((other) => other.id)).toEqual([target]);
  });

  it("returns null for an unknown ID", async () => {
    const account = await insertAccount();
    const category = await insertCategory({ name: "Kategoria A", kind: "expense", position: 0 });
    await insertTransaction(account, category, { bookingDate: "2026-09-01", amountMinor: 1n });

    const unknown = TransactionIdSchema.parse("01900000-0000-7000-8000-000000000000");
    expect(await getTransaction(db, unknown)).toBeNull();
  });
});
