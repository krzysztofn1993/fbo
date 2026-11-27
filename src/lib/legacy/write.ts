// Writes a translated migration plan to the new database in one transaction.
//
// The transaction first locks the four tables in EXCLUSIVE mode, so nothing
// else can write to them until it ends, and only then checks that they are
// empty: the migration runs once, into empty tables. IDs come from the
// database, so roots are inserted before their subcategories and the legacy
// maps last.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// packages and relative `.ts` paths and uses only erasable syntax.

import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  accounts,
  categories,
  legacyAccountMap,
  legacyCategoryMap,
} from "../db/schema.ts";
import type { MigrationPlan, NewCategory } from "./accounts-categories.ts";

/** Thrown when any of the four tables already has rows. */
export class AlreadyMigratedError extends Error {
  constructor() {
    super(
      "Accounts and categories have already been migrated: the target tables are not empty. " +
        "To try again, start from a fresh database and run `npm run db:migrate` first.",
    );
    this.name = "AlreadyMigratedError";
  }
}

export async function writeMigrationPlan(db: NodePgDatabase, plan: MigrationPlan): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`LOCK TABLE ${accounts}, ${categories}, ${legacyAccountMap}, ${legacyCategoryMap} IN EXCLUSIVE MODE`,
    );
    const existing = await tx.execute<{ has_rows: boolean }>(sql`
      SELECT EXISTS (SELECT 1 FROM ${accounts})
          OR EXISTS (SELECT 1 FROM ${categories})
          OR EXISTS (SELECT 1 FROM ${legacyAccountMap})
          OR EXISTS (SELECT 1 FROM ${legacyCategoryMap}) AS has_rows`);
    if (existing.rows[0]?.has_rows !== false) {
      throw new AlreadyMigratedError();
    }

    const accountMap: { legacyId: string; accountId: string }[] = [];
    for (const account of plan.accounts) {
      const [row] = await tx
        .insert(accounts)
        .values({
          name: account.name,
          type: account.type,
          currency: account.currency,
          reportingScope: account.reportingScope,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
        })
        .returning({ id: accounts.id });
      for (const legacyId of account.legacyIds) {
        accountMap.push({ legacyId, accountId: row.id });
      }
    }
    if (accountMap.length > 0) {
      await tx.insert(legacyAccountMap).values(accountMap);
    }

    const categoryMap: { legacyId: string; categoryId: string }[] = [];
    const insertCategory = async (category: NewCategory, parentId: string | null) => {
      const [row] = await tx
        .insert(categories)
        .values({
          parentId,
          name: category.name,
          kind: category.kind,
          type: category.type,
          position: category.position,
          createdAt: category.createdAt,
          updatedAt: category.updatedAt,
        })
        .returning({ id: categories.id });
      for (const legacyId of category.legacyIds) {
        categoryMap.push({ legacyId, categoryId: row.id });
      }
      return row.id;
    };

    const rootIds = new Map<string, string>();
    for (const root of plan.rootCategories) {
      rootIds.set(root.key, await insertCategory(root, null));
    }
    for (const subcategory of plan.subcategories) {
      const parentId = rootIds.get(subcategory.parentKey);
      if (parentId === undefined) {
        throw new Error(`Subcategory ${subcategory.key} refers to an unknown root category.`);
      }
      await insertCategory(subcategory, parentId);
    }
    if (categoryMap.length > 0) {
      await tx.insert(legacyCategoryMap).values(categoryMap);
    }
  });
}
