import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { asc } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { accounts, categories, legacyAccountMap, legacyCategoryMap } from "@/lib/db/schema";
import { testDatabaseUrl, testLegacyDatabaseUrl, truncateTables } from "@/lib/db/test-database";
import { LegacyAccountIdSchema, LegacyCategoryIdSchema } from "@/lib/ids";
import {
  ACCOUNT_BANK_1,
  ACCOUNT_CASH_1,
  ACCOUNT_INACTIVE,
  createLegacySchema,
  insertLegacyAccounts,
  insertLegacyCategories,
  LEGACY_LAYOUT,
  ROOT_A,
  ROOT_B,
  ROOT_C,
  seedLegacyDatabase,
  SUB_A1,
  SUB_A2,
  SUB_A3,
  SUB_B_BONUS_NEW,
  SUB_B_BONUS_OLD,
  SUB_B_SALARY,
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
           (SELECT count(*)::int FROM legacy_category_map) AS category_map`);
  return result.rows[0];
}

const NO_ROWS = { accounts: 0, categories: 0, account_map: 0, category_map: 0 };

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
    const ACCOUNT_BANK_2 = LegacyAccountIdSchema.parse("a0000000-0000-4000-8000-000000000004");

    beforeEach(async () => {
      await insertLegacyAccounts(legacyPool, [
        {
          id: ACCOUNT_BANK_2,
          name: "bank 2",
          type: "bank",
          currency: "PLN",
          reportingScope: "personal",
          isActive: true,
          createdAt: new Date("2023-12-01T00:00:00Z"),
          updatedAt: new Date("2023-12-02T00:00:00Z"),
        },
      ]);
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
});
