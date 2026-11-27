import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { listAccounts, listCategoryTree } from "@/lib/catalog/queries";
import { accounts, categories } from "@/lib/db/schema";
import { testDatabaseUrl, truncateTables } from "@/lib/db/test-database";
import type { CategoryId } from "@/lib/ids";

const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 2 });
const db = drizzle({ client: pool });

beforeEach(async () => {
  await truncateTables(pool);
});

afterAll(async () => {
  await pool.end();
});

type NewCategory = typeof categories.$inferInsert;

async function insertCategory(values: NewCategory): Promise<CategoryId> {
  const [row] = await db.insert(categories).values(values).returning({ id: categories.id });
  return row.id;
}

describe("listAccounts", () => {
  it("returns the display fields with enum values untranslated", async () => {
    await db
      .insert(accounts)
      .values({ name: "bank 1", type: "bank", currency: "EUR", reportingScope: "business" });

    const [account] = await listAccounts(db);
    expect(account).toEqual({
      id: expect.any(String),
      name: "bank 1",
      type: "bank",
      currency: "EUR",
      reportingScope: "business",
    });
  });

  it("sorts by name in Polish alphabetical order", async () => {
    // Code point order would put "Ćwiczebne" after "Dom", and a collation
    // without Polish rules would put it before "Cyfrowe".
    await db.insert(accounts).values(
      ["Dom", "Ćwiczebne konto", "bank 2", "Cyfrowe konto", "Bank 1"].map((name) => ({
        name,
        type: "bank" as const,
        currency: "PLN",
        reportingScope: "personal" as const,
      })),
    );

    const names = (await listAccounts(db)).map((account) => account.name);
    expect(names).toEqual(["Bank 1", "bank 2", "Cyfrowe konto", "Ćwiczebne konto", "Dom"]);
  });

  it("returns an empty list when there are no accounts", async () => {
    expect(await listAccounts(db)).toEqual([]);
  });
});

describe("listCategoryTree", () => {
  it("orders roots and subcategories by position, not by name or insertion", async () => {
    // Inserted in alphabetical order; the positions say otherwise.
    const rootA = await insertCategory({ name: "Kategoria A", kind: "expense", position: 2 });
    const rootB = await insertCategory({ name: "Kategoria B", kind: "income", position: 0 });
    await insertCategory({ name: "Kategoria C", kind: "transfer", position: 1 });
    await insertCategory({ parentId: rootA, name: "Podkategoria 1", kind: "expense", position: 1 });
    await insertCategory({ parentId: rootA, name: "Podkategoria 2", kind: "expense", position: 0 });
    await insertCategory({ parentId: rootB, name: "Podkategoria 3", kind: "income", position: 0 });

    const tree = await listCategoryTree(db);
    expect(tree.map((root) => root.name)).toEqual(["Kategoria B", "Kategoria C", "Kategoria A"]);
    expect(tree.map((root) => root.children.map((child) => child.name))).toEqual([
      ["Podkategoria 3"],
      [],
      ["Podkategoria 2", "Podkategoria 1"],
    ]);
  });

  it("nests each subcategory under its root with kind and type untranslated", async () => {
    const labeled = await insertCategory({
      name: "Kategoria A",
      kind: "mixed",
      type: "labeled",
      position: 0,
    });
    const parent = await insertCategory({ name: "Kategoria B", kind: "expense", position: 1 });
    const child = await insertCategory({
      parentId: parent,
      name: "Podkategoria 1",
      kind: "transfer",
      position: 0,
    });

    expect(await listCategoryTree(db)).toEqual([
      { id: labeled, name: "Kategoria A", kind: "mixed", type: "labeled", children: [] },
      {
        id: parent,
        name: "Kategoria B",
        kind: "expense",
        type: "standard",
        children: [{ id: child, name: "Podkategoria 1", kind: "transfer", type: "standard" }],
      },
    ]);
  });

  it("returns an empty tree when there are no categories", async () => {
    expect(await listCategoryTree(db)).toEqual([]);
  });
});
