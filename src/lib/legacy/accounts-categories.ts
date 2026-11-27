// Translates the accounts and categories of the old version, together with the
// category layout file, into the records of the new version. A pure function:
// it reads and writes nothing, so every rule is tested without a database.
//
// Records carry no new ID (the database gives one on insert); each one is keyed
// by the old ID of its leading row, the oldest of the rows it was made from,
// and lists every old ID it replaces for the legacy maps.
//
// The rows arrive with their shape already checked (see `read.ts`); the values
// that must fit the new schema (enums, currency) are checked here by Zod
// schemas, only on the rows that are migrated, so every problem is reported.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// packages and relative `.ts` paths and uses only erasable syntax.

import { z } from "zod";

import { accountType, categoryKind, reportingScope } from "../db/schema.ts";
import type { LegacyAccountId, LegacyCategoryId } from "../ids.ts";
import {
  type CategoryLayout,
  type LayoutRoot,
  type NormalizedName,
  normalizeCategoryName,
} from "./category-layout.ts";

const AccountTypeSchema = z.enum(accountType.enumValues);
const ReportingScopeSchema = z.enum(reportingScope.enumValues);
const CategoryKindSchema = z.enum(categoryKind.enumValues);
/** ISO 4217 code in capitals, as the new `accounts` table requires. */
const CurrencySchema = z.string().regex(/^[A-Z]{3}$/);

export type AccountType = z.infer<typeof AccountTypeSchema>;
export type ReportingScope = z.infer<typeof ReportingScopeSchema>;
export type CategoryKind = z.infer<typeof CategoryKindSchema>;
export type CategoryType = "standard" | "labeled";

/** The values of an old account that must fit the new `accounts` table. */
const AccountValuesSchema = z.object({
  type: AccountTypeSchema,
  reportingScope: ReportingScopeSchema,
  currency: CurrencySchema,
});

/** A row of the old `accounts` table; enum columns are read as text. */
export type LegacyAccountRow = {
  id: LegacyAccountId;
  name: string;
  type: string;
  currency: string;
  reportingScope: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

/** A row of the old `categories` table; `kind` is read as text. */
export type LegacyCategoryRow = {
  id: LegacyCategoryId;
  parentId: LegacyCategoryId | null;
  name: string;
  kind: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type TranslationInput = {
  accounts: readonly LegacyAccountRow[];
  /** IDs of inactive old accounts that any row of the old database refers to. */
  referencedInactiveAccountIds: ReadonlySet<LegacyAccountId>;
  categories: readonly LegacyCategoryRow[];
  layout: CategoryLayout;
};

export type NewAccount = {
  /** Old ID of the leading (oldest) account, used as the working key. */
  key: LegacyAccountId;
  /** Every old ID merged into this account, the leading one first. */
  legacyIds: LegacyAccountId[];
  name: string;
  type: AccountType;
  currency: string;
  reportingScope: ReportingScope;
  createdAt: Date;
  updatedAt: Date;
};

export type NewCategory = {
  /** Old ID of the leading (oldest) row of the group, used as the working key. */
  key: LegacyCategoryId;
  /** Every old ID merged into this record, the leading one first. */
  legacyIds: LegacyCategoryId[];
  name: string;
  kind: CategoryKind;
  type: CategoryType;
  /** Order among the siblings, from 0 without gaps. */
  position: number;
  createdAt: Date;
  updatedAt: Date;
};

export type NewSubcategory = NewCategory & {
  /** Key of the root category this one belongs to. */
  parentKey: LegacyCategoryId;
};

export type MigrationPlan = {
  accounts: NewAccount[];
  /** In position order. */
  rootCategories: NewCategory[];
  /** Grouped by parent in the order of `rootCategories`, each group in position order. */
  subcategories: NewSubcategory[];
};

export type MergedGroup = {
  /** Resulting name. */
  name: string;
  /** Name of the root category, or null when the group is a root category. */
  parentName: string | null;
  rowCount: number;
};

export type MigrationReport = {
  /** New accounts; merged old accounts count once. */
  accountsMigrated: number;
  accountsSkipped: number;
  rootCategories: number;
  subcategories: number;
  accountMapRows: number;
  categoryMapRows: number;
  /** Accounts renamed by a layout entry with one old name. */
  renamedAccounts: { from: string; to: string }[];
  /** Accounts made by a layout entry from several old accounts. */
  mergedAccounts: { name: string; oldAccountCount: number }[];
  mergedGroups: MergedGroup[];
  labeledCategories: string[];
  /** Root categories renamed by a layout entry with `legacyName`. */
  renamedCategories: { from: string; to: string }[];
  /** Subcategories without a layout entry, placed after the matched ones. */
  appendedSubcategories: { parentName: string; name: string }[];
  layoutWarnings: string[];
};

export type TranslationResult =
  | { ok: true; plan: MigrationPlan; report: MigrationReport }
  | { ok: false; problems: string[] };

/** Oldest first; the old ID breaks ties so the result never depends on input order. */
function byCreation(a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) {
  return a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** An old category whose kind fits the new schema. */
type ValidCategoryRow = Omit<LegacyCategoryRow, "kind"> & { kind: CategoryKind };

/** Rows of one parent that share a normalized name and become one record. */
type Group = {
  rows: ValidCategoryRow[];
  kind: CategoryKind;
  createdAt: Date;
  updatedAt: Date;
};

function describeRow(row: { id: string; name: string }): string {
  return `"${row.name}" (old ID ${row.id})`;
}

type AccountValues = z.infer<typeof AccountValuesSchema>;
type ValidAccount = Omit<LegacyAccountRow, keyof AccountValues> & AccountValues;

/**
 * Checks one active old account and returns it with its values parsed, or
 * undefined; every problem goes to `problems`.
 */
function checkAccount(row: LegacyAccountRow, problems: string[]): ValidAccount | undefined {
  const result = AccountValuesSchema.safeParse(row);
  if (result.success) {
    return { ...row, ...result.data };
  }
  const failed = new Set(result.error.issues.map((issue) => issue.path[0]));
  const account = `Account ${describeRow(row)}`;
  if (failed.has("type")) {
    problems.push(`${account} has an unknown type "${row.type}".`);
  }
  if (failed.has("reportingScope")) {
    problems.push(`${account} has an unknown reporting scope "${row.reportingScope}".`);
  }
  if (failed.has("currency")) {
    problems.push(`${account} has a currency "${row.currency}" that is not three capitals.`);
  }
  return undefined;
}

function translateAccounts(input: TranslationInput, problems: string[]) {
  const migrated: NewAccount[] = [];
  const renamed: { from: string; to: string }[] = [];
  const merged: { name: string; oldAccountCount: number }[] = [];
  let skipped = 0;

  const active: LegacyAccountRow[] = [];
  const inactiveNames = new Set<NormalizedName>();
  for (const row of [...input.accounts].sort(byCreation)) {
    if (row.isActive) {
      active.push(row);
      continue;
    }
    skipped += 1;
    inactiveNames.add(normalizeCategoryName(row.name));
    if (input.referencedInactiveAccountIds.has(row.id)) {
      problems.push(
        `Account ${describeRow(row)} is inactive, so it is skipped, but other rows refer to it.`,
      );
    }
  }

  // Old account ID → index of the layout entry that takes it.
  const entryOf = new Map<LegacyAccountId, number>();
  const layoutAccounts = input.layout.accounts ?? [];
  const groups: ValidAccount[][] = layoutAccounts.map(() => []);
  layoutAccounts.forEach((entry, index) => {
    for (const legacyName of entry.legacyNames) {
      const key = normalizeCategoryName(legacyName);
      const matches = active.filter((row) => normalizeCategoryName(row.name) === key);
      if (matches.length === 0) {
        problems.push(
          inactiveNames.has(key)
            ? `Layout account "${entry.name}" lists "${legacyName}", which matches only an inactive account.`
            : `Layout account "${entry.name}" lists "${legacyName}", which matches no account.`,
        );
      }
      for (const row of matches) {
        const taken = entryOf.get(row.id);
        if (taken !== undefined) {
          problems.push(
            `Account ${describeRow(row)} is listed by layout accounts ` +
              `"${layoutAccounts[taken].name}" and "${entry.name}".`,
          );
          continue;
        }
        entryOf.set(row.id, index);
        const valid = checkAccount(row, problems);
        if (valid !== undefined) {
          groups[index].push(valid);
        }
      }
    }
  });

  type Planned = { name: string; rows: ValidAccount[]; fromLayout: boolean };
  const planned: Planned[] = [];
  for (const row of active) {
    const valid = entryOf.has(row.id) ? undefined : checkAccount(row, problems);
    if (valid !== undefined) {
      planned.push({ name: row.name, rows: [valid], fromLayout: false });
    }
  }
  layoutAccounts.forEach((entry, index) => {
    const rows = groups[index].sort(byCreation);
    if (rows.length === 0) {
      return;
    }
    const values = (row: ValidAccount) => `${row.type}, ${row.currency}, ${row.reportingScope}`;
    const kinds = new Set(rows.map(values));
    if (kinds.size > 1) {
      problems.push(
        `Layout account "${entry.name}" merges accounts that differ in type, currency or ` +
          `reporting scope: ${rows.map((row) => `${describeRow(row)}: ${values(row)}`).join("; ")}.`,
      );
      return;
    }
    planned.push({ name: entry.name, rows, fromLayout: true });
    if (rows.length === 1) {
      renamed.push({ from: rows[0].name, to: entry.name });
    } else {
      merged.push({ name: entry.name, oldAccountCount: rows.length });
    }
  });

  // A name from the layout must not collide, regardless of case and spacing,
  // with the name of an account that keeps its old name; accounts the layout
  // does not list migrate unchanged, so they are not compared with each other.
  // The parser already keeps the layout names apart.
  const unlistedByName = new Map<NormalizedName, Planned>();
  for (const account of planned) {
    if (!account.fromLayout) {
      unlistedByName.set(normalizeCategoryName(account.name), account);
    }
  }
  for (const account of planned) {
    const other = account.fromLayout
      ? unlistedByName.get(normalizeCategoryName(account.name))
      : undefined;
    if (other !== undefined) {
      problems.push(
        `Layout account "${account.name}" would have the same name as account ${describeRow(other.rows[0])}.`,
      );
    }
  }

  for (const { name, rows } of planned.sort((a, b) => byCreation(a.rows[0], b.rows[0]))) {
    const lead = rows[0];
    migrated.push({
      key: lead.id,
      legacyIds: rows.map((row) => row.id),
      name,
      type: lead.type,
      currency: lead.currency,
      reportingScope: lead.reportingScope,
      createdAt: lead.createdAt,
      updatedAt: new Date(Math.max(...rows.map((row) => row.updatedAt.getTime()))),
    });
  }

  return { migrated, skipped, renamed, merged };
}

/**
 * Checks each old category on its own and returns the valid ones split into
 * roots and subcategories; problems go to `problems`.
 */
function checkCategoryRows(rows: readonly LegacyCategoryRow[], problems: string[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const roots: ValidCategoryRow[] = [];
  const children: ValidCategoryRow[] = [];

  for (const row of [...rows].sort(byCreation)) {
    const category = `Category ${describeRow(row)}`;
    let valid = true;
    if (!row.isActive) {
      problems.push(`${category} is inactive; the migration expects only active categories.`);
      valid = false;
    }
    const kind = CategoryKindSchema.safeParse(row.kind);
    if (!kind.success) {
      problems.push(`${category} has an unknown kind "${row.kind}".`);
      valid = false;
    }
    if (row.parentId !== null) {
      const parent = byId.get(row.parentId);
      if (row.parentId === row.id) {
        problems.push(`${category} is its own parent.`);
        valid = false;
      } else if (parent === undefined) {
        problems.push(`${category} has a parent ${row.parentId} that does not exist.`);
        valid = false;
      } else if (parent.parentId !== null) {
        problems.push(
          `${category} is on a third level: its parent ${describeRow(parent)} is a subcategory.`,
        );
        valid = false;
      }
    }
    if (valid && kind.success) {
      (row.parentId === null ? roots : children).push({ ...row, kind: kind.data });
    }
  }

  return { roots, children };
}

/** Groups rows (already sorted oldest first) by normalized name. */
function groupByName(
  rows: readonly ValidCategoryRow[],
  parentName: string | null,
  problems: string[],
): Map<NormalizedName, Group> {
  const groups = new Map<NormalizedName, Group>();
  for (const row of rows) {
    const name = normalizeCategoryName(row.name);
    const group = groups.get(name);
    if (group === undefined) {
      groups.set(name, {
        rows: [row],
        kind: row.kind,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
      continue;
    }
    group.rows.push(row);
    if (row.createdAt < group.createdAt) {
      group.createdAt = row.createdAt;
    }
    if (row.updatedAt > group.updatedAt) {
      group.updatedAt = row.updatedAt;
    }
  }

  for (const group of groups.values()) {
    const kinds = new Set(group.rows.map((row) => row.kind));
    if (kinds.size > 1) {
      const where = parentName === null ? "Root categories" : `Subcategories of "${parentName}"`;
      problems.push(
        `${where} ${group.rows.map(describeRow).join(", ")} differ only in case or spacing ` +
          `but have different kinds (${[...kinds].join(", ")}).`,
      );
    }
  }
  return groups;
}

export function translateAccountsAndCategories(input: TranslationInput): TranslationResult {
  const problems: string[] = [];
  const layoutWarnings: string[] = [];
  const mergedGroups: MergedGroup[] = [];
  const labeledCategories: string[] = [];
  const renamedCategories: { from: string; to: string }[] = [];
  const appendedSubcategories: { parentName: string; name: string }[] = [];

  const accounts = translateAccounts(input, problems);
  const rows = checkCategoryRows(input.categories, problems);

  // Keyed by the normalized old name each entry matches: `legacyName` when the
  // entry renames the category, otherwise its own name.
  const layoutRoots = new Map<NormalizedName, { index: number; root: LayoutRoot }>();
  input.layout.roots.forEach((root, index) => {
    layoutRoots.set(normalizeCategoryName(root.legacyName ?? root.name), { index, root });
  });

  const rootGroups = groupByName(rows.roots, null, problems);
  // Old root ID → normalized name of its group, to attach the subcategories.
  const rootGroupOf = new Map<LegacyCategoryId, NormalizedName>();
  const childrenByRoot = new Map<NormalizedName, ValidCategoryRow[]>();
  for (const [name, group] of rootGroups) {
    childrenByRoot.set(name, []);
    for (const row of group.rows) {
      rootGroupOf.set(row.id, name);
    }
  }
  for (const child of rows.children) {
    // A child of an invalid root has no group; that root is reported already.
    const rootName = child.parentId === null ? undefined : rootGroupOf.get(child.parentId);
    if (rootName !== undefined) {
      childrenByRoot.get(rootName)?.push(child);
    }
  }

  type PlacedRoot = {
    name: NormalizedName;
    group: Group;
    layoutIndex: number;
    layoutRoot: LayoutRoot;
  };
  const placedRoots: PlacedRoot[] = [];
  for (const [name, group] of rootGroups) {
    const match = layoutRoots.get(name);
    if (match === undefined) {
      problems.push(
        `Root category ${describeRow(group.rows[0])} has no entry in the category layout file.`,
      );
      continue;
    }
    placedRoots.push({ name, group, layoutIndex: match.index, layoutRoot: match.root });
  }
  for (const [name, { root }] of layoutRoots) {
    if (!rootGroups.has(name)) {
      const oldName = root.legacyName === undefined ? "" : ` (old name "${root.legacyName}")`;
      layoutWarnings.push(`Layout root "${root.name}"${oldName} matches no root category.`);
    }
  }
  placedRoots.sort((a, b) => a.layoutIndex - b.layoutIndex);

  const rootCategories: NewCategory[] = [];
  const subcategories: NewSubcategory[] = [];

  placedRoots.forEach(({ name, group, layoutRoot }, position) => {
    const type = layoutRoot.labeled ? "labeled" : "standard";
    const root = toCategory(group, layoutRoot.name, position, type);
    rootCategories.push(root);
    if (layoutRoot.legacyName !== undefined) {
      renamedCategories.push({ from: group.rows[0].name, to: root.name });
    }
    if (group.rows.length > 1) {
      mergedGroups.push({ name: root.name, parentName: null, rowCount: group.rows.length });
    }

    const childGroups = groupByName(childrenByRoot.get(name) ?? [], root.name, problems);
    if (layoutRoot.labeled) {
      labeledCategories.push(root.name);
      if (childGroups.size > 0) {
        problems.push(
          `Root category "${root.name}" is labeled in the layout file but has subcategories.`,
        );
      }
    }

    const layoutChildren = new Map<NormalizedName, { index: number; name: string }>();
    layoutRoot.children.forEach((childName, index) => {
      layoutChildren.set(normalizeCategoryName(childName), { index, name: childName });
    });
    for (const [childKey, { name: childName }] of layoutChildren) {
      if (!childGroups.has(childKey)) {
        layoutWarnings.push(
          `Layout subcategory "${childName}" under "${layoutRoot.name}" matches no subcategory.`,
        );
      }
    }

    const matched: { group: Group; index: number; name: string }[] = [];
    const unmatched: Group[] = [];
    for (const [childKey, childGroup] of childGroups) {
      const match = layoutChildren.get(childKey);
      if (match === undefined) {
        unmatched.push(childGroup);
      } else {
        matched.push({ group: childGroup, index: match.index, name: match.name });
      }
    }
    matched.sort((a, b) => a.index - b.index);
    unmatched.sort((a, b) => byCreation(a.rows[0], b.rows[0]));

    // Without a layout entry a subcategory keeps the spelling of its oldest row.
    const ordered = [
      ...matched,
      ...unmatched.map((childGroup) => ({ group: childGroup, name: childGroup.rows[0].name })),
    ];
    ordered.forEach(({ group: childGroup, name: childName }, childPosition) => {
      const child = toCategory(childGroup, childName, childPosition, "standard");
      subcategories.push({ ...child, parentKey: root.key });
      if (childGroup.rows.length > 1) {
        mergedGroups.push({
          name: child.name,
          parentName: root.name,
          rowCount: childGroup.rows.length,
        });
      }
    });
    for (const childGroup of unmatched) {
      appendedSubcategories.push({ parentName: root.name, name: childGroup.rows[0].name });
    }
  });

  if (problems.length > 0) {
    return { ok: false, problems };
  }

  const categoryMapRows = [...rootCategories, ...subcategories].reduce(
    (sum, category) => sum + category.legacyIds.length,
    0,
  );
  return {
    ok: true,
    plan: { accounts: accounts.migrated, rootCategories, subcategories },
    report: {
      accountsMigrated: accounts.migrated.length,
      accountsSkipped: accounts.skipped,
      rootCategories: rootCategories.length,
      subcategories: subcategories.length,
      accountMapRows: accounts.migrated.reduce((sum, account) => sum + account.legacyIds.length, 0),
      categoryMapRows,
      renamedAccounts: accounts.renamed,
      mergedAccounts: accounts.merged,
      mergedGroups,
      labeledCategories,
      renamedCategories,
      appendedSubcategories,
      layoutWarnings,
    },
  };
}

function toCategory(group: Group, name: string, position: number, type: CategoryType): NewCategory {
  return {
    key: group.rows[0].id,
    legacyIds: group.rows.map((row) => row.id),
    name,
    kind: group.kind,
    type,
    position,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  };
}
