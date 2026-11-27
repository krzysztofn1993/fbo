// drizzle-kit configuration: `npm run db:generate` compares the schema with the
// last snapshot in drizzle/ and writes a new SQL migration there. Generating
// needs no database; `npm run db:migrate` applies the migrations.

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
});
