import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

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
} from "@/lib/db/schema";
import { testDatabaseUrl, truncateTables } from "@/lib/db/test-database";
import {
  LegacyAccountIdSchema,
  LegacyCategoryIdSchema,
  LegacyClassificationResultIdSchema,
  LegacyTransactionIdSchema,
} from "@/lib/ids";

const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 2 });
const db = drizzle({ client: pool });

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const LEGACY_ID_1 = "6f1c2a7e-0d3b-4c8a-9e21-3b5d7f9a1c01";
const LEGACY_ID_2 = "6f1c2a7e-0d3b-4c8a-9e21-3b5d7f9a1c02";
// The same old IDs, with the brand each map requires.
const LEGACY_ACCOUNT_ID_1 = LegacyAccountIdSchema.parse(LEGACY_ID_1);
const LEGACY_ACCOUNT_ID_2 = LegacyAccountIdSchema.parse(LEGACY_ID_2);
const LEGACY_CATEGORY_ID_1 = LegacyCategoryIdSchema.parse(LEGACY_ID_1);
const LEGACY_CATEGORY_ID_2 = LegacyCategoryIdSchema.parse(LEGACY_ID_2);
const LEGACY_TRANSACTION_ID_1 = LegacyTransactionIdSchema.parse(LEGACY_ID_1);
const LEGACY_TRANSACTION_ID_2 = LegacyTransactionIdSchema.parse(LEGACY_ID_2);
const LEGACY_RESULT_ID_1 = LegacyClassificationResultIdSchema.parse(LEGACY_ID_1);

beforeEach(async () => {
  await truncateTables(pool);
});

afterAll(async () => {
  await pool.end();
});

type Violation = { code: string | undefined; constraint: string | undefined };

/** Awaits a statement that must fail and returns the PostgreSQL error code and constraint. */
async function violation(statement: PromiseLike<unknown>): Promise<Violation> {
  try {
    await statement;
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    if (cause instanceof pg.DatabaseError) {
      return { code: cause.code, constraint: cause.constraint };
    }
    throw error;
  }
  throw new Error("expected the statement to be rejected");
}

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
// Raised by ON DELETE RESTRICT; NO ACTION would raise 23503 instead.
const RESTRICT_VIOLATION = "23001";

function account(overrides: Partial<typeof accounts.$inferInsert> = {}) {
  return {
    name: "bank 1",
    type: "bank",
    currency: "PLN",
    reportingScope: "personal",
    ...overrides,
  } satisfies typeof accounts.$inferInsert;
}

async function insertRoot(
  name: string,
  position: number,
  type: (typeof categories.$inferInsert)["type"] = "standard",
) {
  const [row] = await db
    .insert(categories)
    .values({ name, kind: "expense", type, position })
    .returning();
  return row;
}

describe("accounts", () => {
  it("gets a UUIDv7 ID and timestamps from the database", async () => {
    const [first] = await db.insert(accounts).values(account()).returning();
    const [second] = await db.insert(accounts).values(account({ name: "bank 2" })).returning();

    expect(first.id).toMatch(UUID_V7);
    expect(second.id).toMatch(UUID_V7);
    expect(second.id).not.toBe(first.id);
    expect(first.createdAt).toBeInstanceOf(Date);
    expect(first.updatedAt).toBeInstanceOf(Date);
  });

  it("accepts a three-letter currency code in capitals only", async () => {
    await db.insert(accounts).values(account({ currency: "EUR" }));

    for (const currency of ["pln", "PLNX", "PL", "PL1"]) {
      expect(await violation(db.insert(accounts).values(account({ currency })))).toEqual({
        code: CHECK_VIOLATION,
        constraint: "accounts_currency_check",
      });
    }
  });
});

describe("categories", () => {
  it("gets a UUIDv7 ID and the standard type by default", async () => {
    const root = await insertRoot("Kategoria A", 0);

    expect(root.id).toMatch(UUID_V7);
    expect(root.type).toBe("standard");
    expect(root.parentId).toBeNull();
  });

  it("allows the labeled type only on a root category", async () => {
    const root = await insertRoot("Kategoria A", 0, "labeled");
    expect(root.type).toBe("labeled");

    const parent = await insertRoot("Kategoria B", 1);
    expect(
      await violation(
        db.insert(categories).values({
          parentId: parent.id,
          name: "Podkategoria 1",
          kind: "expense",
          type: "labeled",
          position: 0,
        }),
      ),
    ).toEqual({ code: CHECK_VIOLATION, constraint: "categories_labeled_root_check" });
  });

  it("rejects names that differ only in case under one parent", async () => {
    const parent = await insertRoot("Kategoria A", 0);
    await db
      .insert(categories)
      .values({ parentId: parent.id, name: "Łąka Ćma", kind: "expense", position: 0 });

    for (const name of ["łąka ćma", "ŁĄKA ĆMA"]) {
      expect(
        await violation(
          db.insert(categories).values({ parentId: parent.id, name, kind: "expense", position: 1 }),
        ),
      ).toEqual({ code: UNIQUE_VIOLATION, constraint: "categories_parent_id_lower_name_key" });
    }
  });

  it("rejects root category names that differ only in case", async () => {
    await insertRoot("Kategoria A", 0);

    expect(await violation(insertRoot("kategoria a", 1))).toEqual({
      code: UNIQUE_VIOLATION,
      constraint: "categories_parent_id_lower_name_key",
    });
  });

  it("allows the same name under different parents", async () => {
    const first = await insertRoot("Kategoria A", 0);
    const second = await insertRoot("Kategoria B", 1);

    await db.insert(categories).values([
      { parentId: first.id, name: "Podkategoria 1", kind: "expense", position: 0 },
      { parentId: second.id, name: "podkategoria 1", kind: "expense", position: 0 },
    ]);
    const rows = await db.select().from(categories);
    expect(rows).toHaveLength(4);
  });

  it("requires a position from 0 that is unique among siblings, roots included", async () => {
    expect(await violation(insertRoot("Kategoria A", -1))).toEqual({
      code: CHECK_VIOLATION,
      constraint: "categories_position_check",
    });

    const parent = await insertRoot("Kategoria A", 0);
    expect(await violation(insertRoot("Kategoria B", 0))).toEqual({
      code: UNIQUE_VIOLATION,
      constraint: "categories_parent_id_position_key",
    });

    await db
      .insert(categories)
      .values({ parentId: parent.id, name: "Podkategoria 1", kind: "expense", position: 0 });
    expect(
      await violation(
        db
          .insert(categories)
          .values({ parentId: parent.id, name: "Podkategoria 2", kind: "expense", position: 0 }),
      ),
    ).toEqual({ code: UNIQUE_VIOLATION, constraint: "categories_parent_id_position_key" });
  });

  it("does not delete a category that still has subcategories", async () => {
    const parent = await insertRoot("Kategoria A", 0);
    await db
      .insert(categories)
      .values({ parentId: parent.id, name: "Podkategoria 1", kind: "expense", position: 0 });

    expect(await violation(db.delete(categories).where(eq(categories.id, parent.id)))).toEqual({
      code: RESTRICT_VIOLATION,
      constraint: "categories_parent_id_categories_id_fk",
    });
  });
});

describe("legacy maps", () => {
  it("rejects the same old account ID twice", async () => {
    const [first] = await db.insert(accounts).values(account()).returning();
    const [second] = await db.insert(accounts).values(account({ name: "bank 2" })).returning();
    await db.insert(legacyAccountMap).values({ legacyId: LEGACY_ACCOUNT_ID_1, accountId: first.id });

    expect(
      await violation(
        db.insert(legacyAccountMap).values({ legacyId: LEGACY_ACCOUNT_ID_1, accountId: second.id }),
      ),
    ).toEqual({ code: UNIQUE_VIOLATION, constraint: "legacy_account_map_pkey" });
  });

  it("lets several old accounts point at one merged account", async () => {
    const [merged] = await db.insert(accounts).values(account()).returning();
    await db.insert(legacyAccountMap).values([
      { legacyId: LEGACY_ACCOUNT_ID_1, accountId: merged.id },
      { legacyId: LEGACY_ACCOUNT_ID_2, accountId: merged.id },
    ]);

    const rows = await db
      .select()
      .from(legacyAccountMap)
      .where(eq(legacyAccountMap.accountId, merged.id));
    expect(rows).toHaveLength(2);
  });

  it("rejects the same old category ID twice", async () => {
    const first = await insertRoot("Kategoria A", 0);
    const second = await insertRoot("Kategoria B", 1);
    await db.insert(legacyCategoryMap).values({ legacyId: LEGACY_CATEGORY_ID_1, categoryId: first.id });

    expect(
      await violation(
        db.insert(legacyCategoryMap).values({ legacyId: LEGACY_CATEGORY_ID_1, categoryId: second.id }),
      ),
    ).toEqual({ code: UNIQUE_VIOLATION, constraint: "legacy_category_map_pkey" });
  });

  it("lets several old categories point at one merged category", async () => {
    const merged = await insertRoot("Kategoria A", 0);
    await db.insert(legacyCategoryMap).values([
      { legacyId: LEGACY_CATEGORY_ID_1, categoryId: merged.id },
      { legacyId: LEGACY_CATEGORY_ID_2, categoryId: merged.id },
    ]);

    const rows = await db
      .select()
      .from(legacyCategoryMap)
      .where(eq(legacyCategoryMap.categoryId, merged.id));
    expect(rows).toHaveLength(2);
    expect(rows[0].migratedAt).toBeInstanceOf(Date);
  });

  it("does not delete an account or a category that a map row points at", async () => {
    const [mapped] = await db.insert(accounts).values(account()).returning();
    const category = await insertRoot("Kategoria A", 0);
    await db.insert(legacyAccountMap).values({ legacyId: LEGACY_ACCOUNT_ID_1, accountId: mapped.id });
    await db.insert(legacyCategoryMap).values({ legacyId: LEGACY_CATEGORY_ID_1, categoryId: category.id });

    expect(await violation(db.delete(accounts).where(eq(accounts.id, mapped.id)))).toEqual({
      code: RESTRICT_VIOLATION,
      constraint: "legacy_account_map_account_id_accounts_id_fk",
    });
    expect(await violation(db.delete(categories).where(eq(categories.id, category.id)))).toEqual({
      code: RESTRICT_VIOLATION,
      constraint: "legacy_category_map_category_id_categories_id_fk",
    });
  });
});

async function insertTransaction(overrides: Partial<typeof transactions.$inferInsert> = {}) {
  const [owner] = overrides.accountId
    ? [{ id: overrides.accountId }]
    : await db.insert(accounts).values(account()).returning();
  const [row] = await db
    .insert(transactions)
    .values({ accountId: owner.id, bookingDate: "2025-01-15", amountMinor: -1250n, ...overrides })
    .returning();
  return row;
}

describe("transactions", () => {
  it("gets a UUIDv7 ID and timestamps from the database", async () => {
    const first = await insertTransaction();
    const second = await insertTransaction({ accountId: first.accountId });

    expect(first.id).toMatch(UUID_V7);
    expect(second.id).toMatch(UUID_V7);
    expect(second.id).not.toBe(first.id);
    expect(first.createdAt).toBeInstanceOf(Date);
    expect(first.updatedAt).toBeInstanceOf(Date);
  });

  it("returns the amount as an exact bigint and the dates as YYYY-MM-DD", async () => {
    // Beyond Number.MAX_SAFE_INTEGER, so a number would lose the last digit.
    const amountMinor = -(2n ** 53n + 1n);
    const inserted = await insertTransaction({
      bookingDate: "2025-01-05",
      operationDate: "2024-12-31",
      amountMinor,
    });

    const [row] = await db.select().from(transactions).where(eq(transactions.id, inserted.id));
    expect(row.amountMinor).toBe(amountMinor);
    expect(row.bookingDate).toBe("2025-01-05");
    expect(row.operationDate).toBe("2024-12-31");
    expect(row.reportingScopeOverride).toBeNull();
    expect(row.description).toBeNull();
  });

  it("does not delete an account that still has transactions", async () => {
    const transaction = await insertTransaction();

    expect(
      await violation(db.delete(accounts).where(eq(accounts.id, transaction.accountId))),
    ).toEqual({ code: RESTRICT_VIOLATION, constraint: "transactions_account_id_accounts_id_fk" });
  });
});

describe("transaction parts", () => {
  it("gets a UUIDv7 ID, the standard reporting class and no approval by default", async () => {
    const transaction = await insertTransaction();
    const category = await insertRoot("Kategoria A", 0);

    const [part] = await db
      .insert(transactionParts)
      .values({ transactionId: transaction.id, categoryId: category.id, amountMinor: -1250n })
      .returning();

    expect(part.id).toMatch(UUID_V7);
    expect(part.amountMinor).toBe(-1250n);
    expect(part.reportingClass).toBe("standard");
    expect(part.approved).toBe(false);
    expect(part.label).toBeNull();
  });

  it("does not delete a category that parts point at", async () => {
    const transaction = await insertTransaction();
    const category = await insertRoot("Kategoria A", 0);
    await db
      .insert(transactionParts)
      .values({ transactionId: transaction.id, categoryId: category.id, amountMinor: -1250n });

    expect(await violation(db.delete(categories).where(eq(categories.id, category.id)))).toEqual({
      code: RESTRICT_VIOLATION,
      constraint: "transaction_parts_category_id_categories_id_fk",
    });
  });
});

describe("deleting a transaction", () => {
  it("deletes its parts, source, old classification results and duplicate pairs", async () => {
    const transaction = await insertTransaction();
    const other = await insertTransaction({ accountId: transaction.accountId });
    const third = await insertTransaction({ accountId: transaction.accountId });
    const category = await insertRoot("Kategoria A", 0);

    await db
      .insert(transactionParts)
      .values({ transactionId: transaction.id, categoryId: category.id, amountMinor: -1250n });
    await db
      .insert(legacyTransactionSources)
      .values({ transactionId: transaction.id, sourceKind: "legacy_excel" });
    await db.insert(legacyClassificationResults).values({
      legacyId: LEGACY_RESULT_ID_1,
      transactionId: transaction.id,
      categoryId: category.id,
      legacyRuleIds: [],
      classifierType: "regex_rule",
      classifierVersion: "1",
      provenance: {},
      status: "suggested",
      createdAt: new Date("2025-01-16T10:00:00Z"),
      updatedAt: new Date("2025-01-16T10:00:00Z"),
    });
    // The transaction on either side of a pair.
    await db.insert(possibleDuplicates).values([
      { firstTransactionId: transaction.id, secondTransactionId: other.id, dayDifference: 0 },
      { firstTransactionId: third.id, secondTransactionId: transaction.id, dayDifference: 2 },
      { firstTransactionId: other.id, secondTransactionId: third.id, dayDifference: 1 },
    ]);

    await db.delete(transactions).where(eq(transactions.id, transaction.id));

    expect(await db.select().from(transactionParts)).toEqual([]);
    expect(await db.select().from(legacyTransactionSources)).toEqual([]);
    expect(await db.select().from(legacyClassificationResults)).toEqual([]);
    const pairs = await db.select().from(possibleDuplicates);
    expect(pairs.map((pair) => [pair.firstTransactionId, pair.secondTransactionId])).toEqual([
      [other.id, third.id],
    ]);
  });

  it("is refused while the transaction map points at it", async () => {
    const transaction = await insertTransaction();
    await db
      .insert(legacyTransactionMap)
      .values({ legacyId: LEGACY_TRANSACTION_ID_1, transactionId: transaction.id });

    expect(
      await violation(db.delete(transactions).where(eq(transactions.id, transaction.id))),
    ).toEqual({
      code: RESTRICT_VIOLATION,
      constraint: "legacy_transaction_map_transaction_id_transactions_id_fk",
    });
  });
});

describe("legacy transaction map", () => {
  it("maps one old transaction to one transaction", async () => {
    const transaction = await insertTransaction();
    await db
      .insert(legacyTransactionMap)
      .values({ legacyId: LEGACY_TRANSACTION_ID_1, transactionId: transaction.id });

    expect(
      await violation(
        db
          .insert(legacyTransactionMap)
          .values({ legacyId: LEGACY_TRANSACTION_ID_2, transactionId: transaction.id }),
      ),
    ).toEqual({ code: UNIQUE_VIOLATION, constraint: "legacy_transaction_map_transaction_id_key" });
  });
});

describe("legacy classification results", () => {
  it("has an index led by each foreign key, for cascades, restrict checks and lookups", async () => {
    const result = await pool.query<{ column: string }>(`
      SELECT a.attname AS column
      FROM pg_index i
      JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
      WHERE i.indrelid = 'legacy_classification_results'::regclass`);
    expect(result.rows.map((row) => row.column)).toEqual(
      expect.arrayContaining(["transaction_id", "category_id"]),
    );
  });
});

describe("possible duplicates", () => {
  it("rejects a pair of a transaction with itself", async () => {
    const transaction = await insertTransaction();

    expect(
      await violation(
        db.insert(possibleDuplicates).values({
          firstTransactionId: transaction.id,
          secondTransactionId: transaction.id,
          dayDifference: 0,
        }),
      ),
    ).toEqual({ code: CHECK_VIOLATION, constraint: "possible_duplicates_distinct_check" });
  });

  it("rejects a negative day difference", async () => {
    const first = await insertTransaction();
    const second = await insertTransaction({ accountId: first.accountId });

    expect(
      await violation(
        db.insert(possibleDuplicates).values({
          firstTransactionId: first.id,
          secondTransactionId: second.id,
          dayDifference: -1,
        }),
      ),
    ).toEqual({ code: CHECK_VIOLATION, constraint: "possible_duplicates_day_difference_check" });
  });
});
