// Applies the migrations from drizzle/ to the database in DATABASE_URL.
//
// Migrations already applied are skipped, so running it again changes nothing.
// Exits with a non-zero code and a message on stderr when the variable is
// missing or a migration fails.
//
// Run by plain `node` (type stripping): erasable syntax and relative imports
// with the `.ts` extension only.

import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

import { readDatabaseUrl } from "../src/lib/db/config.ts";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

// Drizzle wraps database errors; the cause carries the PostgreSQL message.
function describeError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const cause = error.cause instanceof Error ? `\n${error.cause.message}` : "";
  return `${error.message.trimEnd()}${cause}`;
}

async function main(): Promise<void> {
  const result = readDatabaseUrl("DATABASE_URL");
  if (!result.ok) {
    fail(`Cannot apply migrations: ${result.problem}`);
  }

  const pool = new pg.Pool({ connectionString: result.url, max: 1 });
  try {
    await migrate(drizzle({ client: pool }), { migrationsFolder: MIGRATIONS_FOLDER });
  } catch (error) {
    await pool.end().catch(() => undefined);
    fail(`Migrations failed: ${describeError(error)}`);
  }
  await pool.end();
  process.stdout.write("Migrations are up to date.\n");
}

await main();
