// The database of the Next server: one connection pool per process, created
// on the first call and never at import time, so `next build` and pages that
// never reach a query do not need the database.
//
// Only for Server Components and Server Actions. Scripts and tests build their
// own pool and pass the handle to the queries.

import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";

import { readDatabaseUrl } from "@/lib/db/config";

export type DbResult = { ok: true; db: NodePgDatabase } | { ok: false };

// Kept on globalThis so that every copy of this module shares one pool: the
// bundler may load the same module more than once in one server process.
const GLOBAL_KEY = "__fboDb";

type DbHolder = { [GLOBAL_KEY]?: NodePgDatabase };

export function getDb(): DbResult {
  const holder = globalThis as typeof globalThis & DbHolder;
  const existing = holder[GLOBAL_KEY];
  if (existing !== undefined) {
    return { ok: true, db: existing };
  }

  const result = readDatabaseUrl("DATABASE_URL");
  if (!result.ok) {
    // The problem names the variable only, never its value.
    console.error(`The database is not configured: ${result.problem}`);
    return { ok: false };
  }

  const pool = new pg.Pool({ connectionString: result.url });
  // An idle connection that breaks (for example when the server restarts)
  // emits an error on the pool; without a listener it would end the process.
  pool.on("error", (error) => {
    console.error(`An idle database connection failed: ${error.message}`);
  });
  const db = drizzle({ client: pool });
  holder[GLOBAL_KEY] = db;
  return { ok: true, db };
}
