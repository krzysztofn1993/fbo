// Vitest global setup of the `db` project: runs once before the database tests
// and leaves the test databases empty, the new one with the migrations applied.

import {
  prepareTestDatabase,
  testDatabaseUrl,
  testLegacyDatabaseUrl,
} from "./test-database.ts";

export default async function setup(): Promise<void> {
  await prepareTestDatabase(testDatabaseUrl());
  // Shaped like the old version by the tests that use it, so no migrations.
  await prepareTestDatabase(testLegacyDatabaseUrl(), { migrations: false });
}
