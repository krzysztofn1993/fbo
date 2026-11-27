// Playwright global setup: recreates the `_e2e` database, applies the
// migrations and writes the made-up accounts and categories the pages show.
//
// Playwright loads this file as CommonJS, so it imports only packages and
// relative `.ts` paths and never uses `import.meta`.

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { accounts, categories } from "../src/lib/db/schema.ts";
import { prepareTestDatabase } from "../src/lib/db/test-database.ts";
import { fixtureAccounts, fixtureCategories } from "./fixtures/catalog.ts";

export const DEFAULT_E2E_DATABASE_URL = "postgres://fbo:fbo@127.0.0.1:5433/fbo_e2e";

/** Database of the browser tests: `E2E_DATABASE_URL` or the local default. */
export function e2eDatabaseUrl(env: Readonly<Record<string, string | undefined>> = process.env) {
  const value = env.E2E_DATABASE_URL;
  return value === undefined || value.trim() === "" ? DEFAULT_E2E_DATABASE_URL : value;
}

export default async function globalSetup(): Promise<void> {
  const url = e2eDatabaseUrl();
  // Refuses any database whose name does not end in `_e2e` or another test suffix.
  await prepareTestDatabase(url);

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    const db = drizzle({ client: pool });
    await db.insert(accounts).values(fixtureAccounts);

    const roots = [...fixtureCategories].sort((a, b) => a.name.localeCompare(b.name));
    for (const root of roots) {
      const [row] = await db
        .insert(categories)
        .values({ name: root.name, kind: root.kind, type: root.type, position: root.position })
        .returning({ id: categories.id });
      for (const child of root.children ?? []) {
        await db.insert(categories).values({ parentId: row.id, ...child });
      }
    }
  } finally {
    await pool.end();
  }
}
