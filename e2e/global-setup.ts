// Playwright global setup: recreates the `_e2e` database, applies the
// migrations and writes the made-up accounts, categories and transactions the
// pages show.
//
// Playwright loads this file as CommonJS, so it imports only packages and
// relative `.ts` paths and never uses `import.meta`.

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import {
  accounts,
  categories,
  legacyTransactionSources,
  possibleDuplicates,
  transactionParts,
  transactions,
} from "../src/lib/db/schema.ts";
import { prepareTestDatabase } from "../src/lib/db/test-database.ts";
import { type Env, nonBlankOr } from "../src/lib/env.ts";
import type { AccountId, CategoryId, TransactionId } from "../src/lib/ids.ts";
import { fixtureAccounts, fixtureCategories } from "./fixtures/catalog.ts";
import { fixtureDuplicatePairs, fixtureTransactions } from "./fixtures/transactions.ts";

export const DEFAULT_E2E_DATABASE_URL = "postgres://fbo:fbo@127.0.0.1:5433/fbo_e2e";

/** Database of the browser tests: `E2E_DATABASE_URL` or the local default. */
export function e2eDatabaseUrl(env: Env = process.env): string {
  return nonBlankOr(env, "E2E_DATABASE_URL", DEFAULT_E2E_DATABASE_URL);
}

export default async function globalSetup(): Promise<void> {
  const url = e2eDatabaseUrl();
  // Refuses any database whose name does not end in `_e2e` or another test suffix.
  await prepareTestDatabase(url);

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle({ client: pool });
    const accountRows = await db
      .insert(accounts)
      .values(fixtureAccounts)
      .returning({ id: accounts.id, name: accounts.name });
    const accountIds = new Map<string, AccountId>(accountRows.map((row) => [row.name, row.id]));

    // Keyed "Root" or "Root / Subcategory", as the transaction fixtures name them.
    const categoryIds = new Map<string, CategoryId>();
    const roots = [...fixtureCategories].sort((a, b) => a.name.localeCompare(b.name));
    for (const root of roots) {
      const [row] = await db
        .insert(categories)
        .values({ name: root.name, kind: root.kind, type: root.type, position: root.position })
        .returning({ id: categories.id });
      categoryIds.set(root.name, row.id);
      for (const child of root.children ?? []) {
        const [childRow] = await db
          .insert(categories)
          .values({ parentId: row.id, ...child })
          .returning({ id: categories.id });
        categoryIds.set(`${root.name} / ${child.name}`, childRow.id);
      }
    }

    // One by one on the single connection, so the UUIDv7 IDs follow the
    // order of the fixtures.
    const transactionIds = new Map<string, TransactionId>();
    for (const fixture of fixtureTransactions) {
      const [row] = await db
        .insert(transactions)
        .values({
          accountId: lookUp(accountIds, fixture.account),
          bookingDate: fixture.bookingDate,
          operationDate: fixture.operationDate,
          amountMinor: fixture.amountMinor,
          description: fixture.description,
          reportingScopeOverride: fixture.reportingScopeOverride,
        })
        .returning({ id: transactions.id });
      if (fixture.description !== null) {
        transactionIds.set(fixture.description, row.id);
      }
      for (const part of fixture.parts) {
        await db.insert(transactionParts).values({
          transactionId: row.id,
          categoryId: lookUp(categoryIds, part.category),
          amountMinor: part.amountMinor,
          label: part.label,
          reportingClass: part.reportingClass,
          approved: part.approved,
        });
      }
      if (fixture.sourceKind !== undefined) {
        await db
          .insert(legacyTransactionSources)
          .values({ transactionId: row.id, sourceKind: fixture.sourceKind });
      }
    }

    for (const pair of fixtureDuplicatePairs) {
      await db.insert(possibleDuplicates).values({
        firstTransactionId: lookUp(transactionIds, pair.first),
        secondTransactionId: lookUp(transactionIds, pair.second),
        dayDifference: pair.dayDifference,
      });
    }
  } finally {
    await pool.end();
  }
}

/** The ID for a fixture name; a fixture that names a missing record fails the setup. */
function lookUp<T>(ids: ReadonlyMap<string, T>, name: string): T {
  const id = ids.get(name);
  if (id === undefined) {
    throw new Error(`The E2E fixtures refer to an unknown record: ${name}`);
  }
  return id;
}
