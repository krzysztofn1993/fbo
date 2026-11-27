// One run of the migration from the old version: read the layout file and the
// old database, translate the accounts and categories, then the transactions
// that refer to them, in memory, and write everything to the new database in
// one transaction. Any problem stops the run before the write, and a failed
// write is rolled back, so nothing is left half-written.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// packages and relative `.ts` paths and uses only erasable syntax.

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";

import {
  type MigrationReport as AccountsCategoriesReport,
  translateAccountsAndCategories,
} from "./accounts-categories.ts";
import { readCategoryLayoutFile } from "./category-layout.ts";
import { type LegacySnapshotResult, readLegacySnapshot } from "./read.ts";
import { type TransactionReport, translateTransactions } from "./transactions.ts";
import { AlreadyMigratedError, writeMigrationPlan } from "./write.ts";

/** What a run moved: the accounts and categories, and the transactions on them. */
export type MigrationReport = AccountsCategoriesReport & { transactions: TransactionReport };

export type MigrationOptions = {
  newDatabaseUrl: string;
  legacyDatabaseUrl: string;
  layoutFile: string;
};

export type MigrationOutcome =
  | { status: "migrated"; report: MigrationReport }
  /** Refused before writing anything: same database on both sides, or already migrated. */
  | { status: "refused"; message: string }
  /** The layout file or the old data break a rule or have an unexpected shape; every problem is listed. */
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

/**
 * Keeps the first error a connection emits outside a query, for example when
 * the server closes an idle connection. Without a listener `pg` raises such an
 * error as an uncaught `error` event and ends the process; with it, the next
 * query on that connection fails and the run reports a failure.
 */
function connectionErrorTrap(): { listener: (error: Error) => void; message: () => string } {
  let first: Error | undefined;
  return {
    listener: (error) => {
      first ??= error;
    },
    message: () => (first === undefined ? "" : `\nThe connection was lost: ${first.message}`),
  };
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
  const legacyErrors = connectionErrorTrap();
  legacy.on("error", legacyErrors.listener);
  let read: LegacySnapshotResult;
  try {
    await legacy.connect();
    read = await readLegacySnapshot(legacy);
  } catch (error) {
    return {
      status: "failed",
      message: `Reading the old database failed: ${describeError(error)}${legacyErrors.message()}`,
    };
  } finally {
    await legacy.end().catch(() => undefined);
  }

  if (!read.ok) {
    return { status: "invalid", problems: read.problems };
  }

  const translation = translateAccountsAndCategories({ ...read.snapshot, layout: layout.layout });
  if (!translation.ok) {
    return { status: "invalid", problems: translation.problems };
  }
  // The transactions need the keys of the translated accounts and categories,
  // so their problems show only once those translate cleanly.
  const transactions = translateTransactions({ snapshot: read.snapshot, plan: translation.plan });
  if (!transactions.ok) {
    return { status: "invalid", problems: transactions.problems };
  }

  const pool = new pg.Pool({ connectionString: options.newDatabaseUrl, max: 1 });
  const writeErrors = connectionErrorTrap();
  // The pool emits errors of idle connections; a connection checked out for
  // the transaction emits them itself, so it gets the listener as well.
  pool.on("error", writeErrors.listener);
  pool.on("connect", (client) => client.on("error", writeErrors.listener));
  try {
    await writeMigrationPlan(drizzle({ client: pool }), {
      ...translation.plan,
      transactions: transactions.transactions,
    });
  } catch (error) {
    if (error instanceof AlreadyMigratedError) {
      return { status: "refused", message: error.message };
    }
    return {
      status: "failed",
      message: `Writing the new database failed: ${describeError(error)}${writeErrors.message()}`,
    };
  } finally {
    await pool.end().catch(() => undefined);
  }

  return {
    status: "migrated",
    report: { ...translation.report, transactions: transactions.report },
  };
}
