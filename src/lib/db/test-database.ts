// Prepares disposable databases for tests: the Vitest database tests and the
// browser tests. Preparing drops and recreates the schema, so it refuses any
// database whose name does not mark it as a test database.
//
// Loaded by Vitest and Playwright setup code as well as by tests, so it uses
// only package and relative `.ts` imports, never `@/` or `server-only`.

import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { type Env, nonBlankOr } from "../env.ts";

export const DEFAULT_TEST_DATABASE_URL = "postgres://fbo:fbo@127.0.0.1:5433/fbo_test";
export const DEFAULT_TEST_LEGACY_DATABASE_URL =
  "postgres://fbo:fbo@127.0.0.1:5433/fbo_test_legacy";

const DISPOSABLE_SUFFIXES = ["_test", "_test_legacy", "_e2e"];

// Relative to the working directory, the project root for npm scripts, Vitest
// and Playwright: `import.meta.url` would break the CommonJS loader Playwright
// uses for TypeScript in this package.
const MIGRATIONS_FOLDER = resolve("drizzle");

/** Database for the tests of the new version: `TEST_DATABASE_URL` or the local default. */
export function testDatabaseUrl(env: Env = process.env): string {
  return nonBlankOr(env, "TEST_DATABASE_URL", DEFAULT_TEST_DATABASE_URL);
}

/** Database shaped like the old version: `TEST_LEGACY_DATABASE_URL` or the local default. */
export function testLegacyDatabaseUrl(env: Env = process.env): string {
  return nonBlankOr(env, "TEST_LEGACY_DATABASE_URL", DEFAULT_TEST_LEGACY_DATABASE_URL);
}

/**
 * Returns the database name of `url`, or throws when the name does not end in
 * `_test`, `_test_legacy` or `_e2e`. The message names the database only.
 */
export function disposableDatabaseName(url: string): string {
  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  } catch {
    throw new Error("The test database URL is not a valid URL.");
  }
  if (!DISPOSABLE_SUFFIXES.some((suffix) => name.endsWith(suffix) && name !== suffix)) {
    throw new Error(
      `Refusing to prepare database "${name}": the name of a test database must end in ` +
        `${DISPOSABLE_SUFFIXES.join(", ")}.`,
    );
  }
  return name;
}

function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** Creates the database of `url` when it does not exist, through the `postgres` database. */
async function ensureDatabase(url: string, name: string): Promise<void> {
  const maintenanceUrl = new URL(url);
  maintenanceUrl.pathname = "/postgres";
  const client = new pg.Client({ connectionString: maintenanceUrl.toString() });
  await client.connect();
  try {
    const existing = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [name]);
    if (existing.rowCount === 0) {
      try {
        await client.query(`CREATE DATABASE ${quoteIdentifier(name)}`);
      } catch (error) {
        // Another process created it in the meantime.
        if (!(error instanceof Error && "code" in error && error.code === "42P04")) {
          throw error;
        }
      }
    }
  } finally {
    await client.end();
  }
}

export type PrepareOptions = {
  /** Apply the migrations from drizzle/ after recreating the schema (default true). */
  migrations?: boolean;
};

/**
 * Makes the database of `url` exist and start empty: creates it if needed,
 * drops the `public` and `drizzle` schemas with everything in them, recreates
 * `public` and, unless `migrations` is false, applies the migrations.
 */
export async function prepareTestDatabase(
  url: string,
  options: PrepareOptions = {},
): Promise<void> {
  const name = disposableDatabaseName(url);
  await ensureDatabase(url, name);

  const pool = new pg.Pool({ connectionString: url, max: 1 });
  try {
    await pool.query(
      "DROP SCHEMA IF EXISTS drizzle CASCADE;" +
        " DROP SCHEMA IF EXISTS public CASCADE;" +
        " CREATE SCHEMA public;",
    );
    if (options.migrations ?? true) {
      await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
    }
  } finally {
    await pool.end();
  }
}

/** A pool, a client or a pool client. */
type Queryable = {
  query<R extends pg.QueryResultRow>(text: string): Promise<pg.QueryResult<R>>;
};

/** Empties every table in the `public` schema; run between tests. */
export async function truncateTables(client: Queryable): Promise<void> {
  const result = await client.query<{ name: string }>(
    "SELECT quote_ident(tablename) AS name FROM pg_tables WHERE schemaname = 'public'",
  );
  if (result.rows.length === 0) {
    return;
  }
  const tables = result.rows.map((row) => `public.${row.name}`).join(", ");
  await client.query(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
}
