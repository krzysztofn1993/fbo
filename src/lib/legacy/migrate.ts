// One run of the migration of accounts and categories from the old version:
// read the layout file and the old database, translate in memory, then write
// to the new database in one transaction. Any problem stops the run before the
// write, and a failed write is rolled back, so nothing is left half-written.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// packages and relative `.ts` paths and uses only erasable syntax.

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import { type MigrationReport, translateAccountsAndCategories } from "./accounts-categories.ts";
import { readCategoryLayoutFile } from "./category-layout.ts";
import { type LegacySnapshot, readLegacySnapshot } from "./read.ts";
import { AlreadyMigratedError, writeMigrationPlan } from "./write.ts";

export type MigrationOptions = {
  newDatabaseUrl: string;
  legacyDatabaseUrl: string;
  layoutFile: string;
};

export type MigrationOutcome =
  | { status: "migrated"; report: MigrationReport }
  /** Refused before writing anything: same database on both sides, or already migrated. */
  | { status: "refused"; message: string }
  /** The layout file or the old data break a rule; every problem is listed. */
  | { status: "invalid"; problems: string[] }
  /** A connection or database error. */
  | { status: "failed"; message: string };

const DEFAULT_PORT = "5432";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

type DatabaseIdentity = { host: string; port: string; database: string };

/**
 * Host, port and database name of a PostgreSQL URL, with the defaults `pg`
 * applies: port 5432, and the user name when the URL names no database.
 * Loopback addresses count as one host.
 */
function databaseIdentity(url: string): DatabaseIdentity {
  const parsed = new URL(url);
  const host = (parsed.searchParams.get("host") ?? parsed.hostname).toLowerCase();
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  return {
    host: LOOPBACK_HOSTS.has(host) ? "localhost" : host,
    port: parsed.searchParams.get("port") ?? (parsed.port || DEFAULT_PORT),
    database: database || decodeURIComponent(parsed.username),
  };
}

/** True when both URLs point at the same host, port and database. */
export function isSameDatabase(first: string, second: string): boolean {
  const a = databaseIdentity(first);
  const b = databaseIdentity(second);
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

// Drizzle wraps database errors; the cause carries the PostgreSQL message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = error.cause instanceof Error ? `\n${error.cause.message}` : "";
  return `${error.message.trimEnd()}${cause}`;
}

export async function runLegacyMigration(options: MigrationOptions): Promise<MigrationOutcome> {
  if (isSameDatabase(options.newDatabaseUrl, options.legacyDatabaseUrl)) {
    return {
      status: "refused",
      message:
        "DATABASE_URL and LEGACY_DATABASE_URL point at the same database; " +
        "restore the old database into a separate one.",
    };
  }

  const layout = await readCategoryLayoutFile(options.layoutFile);
  if (!layout.ok) {
    return { status: "invalid", problems: layout.problems };
  }

  const legacy = new pg.Client({ connectionString: options.legacyDatabaseUrl });
  let snapshot: LegacySnapshot;
  try {
    await legacy.connect();
    snapshot = await readLegacySnapshot(legacy);
  } catch (error) {
    return { status: "failed", message: `Reading the old database failed: ${describeError(error)}` };
  } finally {
    await legacy.end().catch(() => undefined);
  }

  const translation = translateAccountsAndCategories({ ...snapshot, layout: layout.layout });
  if (!translation.ok) {
    return { status: "invalid", problems: translation.problems };
  }

  const pool = new pg.Pool({ connectionString: options.newDatabaseUrl, max: 1 });
  try {
    await writeMigrationPlan(drizzle({ client: pool }), translation.plan);
  } catch (error) {
    if (error instanceof AlreadyMigratedError) {
      return { status: "refused", message: error.message };
    }
    return { status: "failed", message: `Writing the new database failed: ${describeError(error)}` };
  } finally {
    await pool.end().catch(() => undefined);
  }

  return { status: "migrated", report: translation.report };
}
