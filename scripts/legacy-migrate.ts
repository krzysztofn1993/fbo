// Moves the active accounts and all categories of the old version into the
// empty tables of the new one, once, and prints a summary.
//
// Needs DATABASE_URL (the new database), LEGACY_DATABASE_URL (a separate
// database restored from the old version's dump) and
// LEGACY_CATEGORY_LAYOUT_FILE (the category layout file, kept outside the
// repository). Exits with 0 after a migration and with a non-zero code and a
// message on stderr when it refuses, when the data or the layout file break a
// rule, or when a file or a connection fails; in every such case nothing is
// written.
//
// Run by plain `node` (type stripping): erasable syntax and relative imports
// with the `.ts` extension only.

import { readDatabaseUrl } from "../src/lib/db/config.ts";
import { NonBlankSchema } from "../src/lib/env.ts";
import type { MigrationReport } from "../src/lib/legacy/accounts-categories.ts";
import { runLegacyMigration } from "../src/lib/legacy/migrate.ts";

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function list(title: string, items: readonly string[]): string[] {
  return items.length === 0 ? [`${title}: none`] : [`${title}:`, ...items.map((item) => `  - ${item}`)];
}

function formatReport(report: MigrationReport): string {
  const lines = [
    "Accounts and categories migrated.",
    `Accounts: ${report.accountsMigrated} migrated, ${report.accountsSkipped} inactive skipped`,
    `Categories: ${report.rootCategories} root, ${report.subcategories} subcategories`,
    `Legacy map rows: ${report.accountMapRows} accounts, ${report.categoryMapRows} categories`,
    ...list(
      "Renamed accounts",
      report.renamedAccounts.map((rename) => `${rename.from} -> ${rename.to}`),
    ),
    ...list(
      "Merged accounts",
      report.mergedAccounts.map((merge) => `${merge.name} (${merge.oldAccountCount} old accounts)`),
    ),
    ...list(
      "Merged groups",
      report.mergedGroups.map(
        (group) =>
          `${group.parentName === null ? "" : `${group.parentName} / `}${group.name} ` +
          `(${group.rowCount} old rows)`,
      ),
    ),
    ...list("Labeled categories", report.labeledCategories),
    ...list(
      "Renamed",
      report.renamedCategories.map((rename) => `${rename.from} -> ${rename.to}`),
    ),
    ...list(
      "Subcategories without a layout entry, placed last",
      report.appendedSubcategories.map((entry) => `${entry.parentName} / ${entry.name}`),
    ),
    ...list("Layout file warnings", report.layoutWarnings),
  ];
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  const problems: string[] = [];
  const newDatabase = readDatabaseUrl("DATABASE_URL");
  if (!newDatabase.ok) {
    problems.push(newDatabase.problem);
  }
  const legacyDatabase = readDatabaseUrl("LEGACY_DATABASE_URL");
  if (!legacyDatabase.ok) {
    problems.push(legacyDatabase.problem);
  }
  const layoutFile = NonBlankSchema.safeParse(process.env.LEGACY_CATEGORY_LAYOUT_FILE);
  if (!layoutFile.success) {
    problems.push("LEGACY_CATEGORY_LAYOUT_FILE is not set.");
  }
  if (!newDatabase.ok || !legacyDatabase.ok || !layoutFile.success) {
    fail(`Cannot migrate accounts and categories:\n${problems.join("\n")}`);
  }

  const outcome = await runLegacyMigration({
    newDatabaseUrl: newDatabase.url,
    legacyDatabaseUrl: legacyDatabase.url,
    layoutFile: layoutFile.data,
  });
  switch (outcome.status) {
    case "migrated":
      process.stdout.write(formatReport(outcome.report));
      return;
    case "refused":
      return fail(`Refused: ${outcome.message}`);
    case "invalid":
      return fail(
        "Nothing was migrated; fix these problems and run again:\n" +
          outcome.problems.map((problem) => `  - ${problem}`).join("\n"),
      );
    case "failed":
      return fail(`Nothing was migrated: ${outcome.message}`);
  }
}

await main();
