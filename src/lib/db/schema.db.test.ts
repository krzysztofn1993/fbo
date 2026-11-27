import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";

import {
  accounts,
  categories,
  legacyAccountMap,
  legacyCategoryMap,
} from "@/lib/db/schema";
import { testDatabaseUrl, truncateTables } from "@/lib/db/test-database";

const pool = new pg.Pool({ connectionString: testDatabaseUrl(), max: 2 });
const db = drizzle({ client: pool });

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const LEGACY_ID_1 = "6f1c2a7e-0d3b-4c8a-9e21-3b5d7f9a1c01";
const LEGACY_ID_2 = "6f1c2a7e-0d3b-4c8a-9e21-3b5d7f9a1c02";

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
    await db.insert(legacyAccountMap).values({ legacyId: LEGACY_ID_1, accountId: first.id });

    expect(
      await violation(
        db.insert(legacyAccountMap).values({ legacyId: LEGACY_ID_1, accountId: second.id }),
      ),
    ).toEqual({ code: UNIQUE_VIOLATION, constraint: "legacy_account_map_pkey" });
  });

  it("lets several old accounts point at one merged account", async () => {
    const [merged] = await db.insert(accounts).values(account()).returning();
    await db.insert(legacyAccountMap).values([
      { legacyId: LEGACY_ID_1, accountId: merged.id },
      { legacyId: LEGACY_ID_2, accountId: merged.id },
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
    await db.insert(legacyCategoryMap).values({ legacyId: LEGACY_ID_1, categoryId: first.id });

    expect(
      await violation(
        db.insert(legacyCategoryMap).values({ legacyId: LEGACY_ID_1, categoryId: second.id }),
      ),
    ).toEqual({ code: UNIQUE_VIOLATION, constraint: "legacy_category_map_pkey" });
  });

  it("lets several old categories point at one merged category", async () => {
    const merged = await insertRoot("Kategoria A", 0);
    await db.insert(legacyCategoryMap).values([
      { legacyId: LEGACY_ID_1, categoryId: merged.id },
      { legacyId: LEGACY_ID_2, categoryId: merged.id },
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
    await db.insert(legacyAccountMap).values({ legacyId: LEGACY_ID_1, accountId: mapped.id });
    await db.insert(legacyCategoryMap).values({ legacyId: LEGACY_ID_1, categoryId: category.id });

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
