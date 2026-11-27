// Translates the accounts and categories of the old version, together with the
// category layout file, into the records of the new version. A pure function:
// it reads and writes nothing, so every rule is tested without a database.
//
// Records carry no new ID (the database gives one on insert); each one is keyed
// by the old ID of its leading row, the oldest of the rows it was made from,
// and lists every old ID it replaces for the legacy maps.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// packages and relative `.ts` paths and uses only erasable syntax.

import { accountType, categoryKind, reportingScope } from "../db/schema.ts";
import { type CategoryLayout, type LayoutRoot, normalizeCategoryName } from "./category-layout.ts";

export type AccountType = (typeof accountType.enumValues)[number];
export type ReportingScope = (typeof reportingScope.enumValues)[number];
export type CategoryKind = (typeof categoryKind.enumValues)[number];
export type CategoryType = "standard" | "labeled";

/** A row of the old `accounts` table; enum columns are read as text. */
export type LegacyAccountRow = {
  id: string;
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
  id: string;
  parentId: string | null;
  name: string;
  kind: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type TranslationInput = {
  accounts: readonly LegacyAccountRow[];
  /** IDs of inactive old accounts that any row of the old database refers to. */
  referencedInactiveAccountIds: ReadonlySet<string>;
  categories: readonly LegacyCategoryRow[];
  layout: CategoryLayout;
};

export type NewAccount = {
  /** Old ID of the account, used as the working key. */
  key: string;
  legacyIds: string[];
  name: string;
  type: AccountType;
  currency: string;
  reportingScope: ReportingScope;
  createdAt: Date;
  updatedAt: Date;
};

export type NewCategory = {
  /** Old ID of the leading (oldest) row of the group, used as the working key. */
  key: string;
  /** Every old ID merged into this record, the leading one first. */
  legacyIds: string[];
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
  parentKey: string;
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
  accountsMigrated: number;
  accountsSkipped: number;
  rootCategories: number;
  subcategories: number;
  accountMapRows: number;
  categoryMapRows: number;
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

const CURRENCY = /^[A-Z]{3}$/;

function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

/** Oldest first; the old ID breaks ties so the result never depends on input order. */
function byCreation(a: { createdAt: Date; id: string }, b: { createdAt: Date; id: string }) {
  return a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Rows of one parent that share a normalized name and become one record. */
type Group = {
  rows: LegacyCategoryRow[];
  kind: CategoryKind;
  createdAt: Date;
  updatedAt: Date;
};

function describeRow(row: { id: string; name: string }): string {
  return `"${row.name}" (old ID ${row.id})`;
}

function translateAccounts(input: TranslationInput, problems: string[]) {
  const migrated: NewAccount[] = [];
  let skipped = 0;

  for (const row of [...input.accounts].sort(byCreation)) {
    const account = `Account ${describeRow(row)}`;
    if (!row.isActive) {
      skipped += 1;
      if (input.referencedInactiveAccountIds.has(row.id)) {
        problems.push(`${account} is inactive, so it is skipped, but other rows refer to it.`);
      }
      continue;
    }

    const type = row.type;
    const scope = row.reportingScope;
    const typeKnown = isOneOf(accountType.enumValues, type);
    const scopeKnown = isOneOf(reportingScope.enumValues, scope);
    const currencyValid = CURRENCY.test(row.currency);
    if (!typeKnown) {
      problems.push(`${account} has an unknown type "${type}".`);
    }
    if (!scopeKnown) {
      problems.push(`${account} has an unknown reporting scope "${scope}".`);
    }
    if (!currencyValid) {
      problems.push(`${account} has a currency "${row.currency}" that is not three capitals.`);
    }
    if (typeKnown && scopeKnown && currencyValid) {
      migrated.push({
        key: row.id,
        legacyIds: [row.id],
        name: row.name,
        type,
        currency: row.currency,
        reportingScope: scope,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
  }

  return { migrated, skipped };
}

/**
 * Checks each old category on its own and returns the valid ones split into
 * roots and subcategories; problems go to `problems`.
 */
function checkCategoryRows(rows: readonly LegacyCategoryRow[], problems: string[]) {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const roots: LegacyCategoryRow[] = [];
  const children: LegacyCategoryRow[] = [];

  for (const row of [...rows].sort(byCreation)) {
    const category = `Category ${describeRow(row)}`;
    let valid = true;
    if (!row.isActive) {
      problems.push(`${category} is inactive; the migration expects only active categories.`);
      valid = false;
    }
    if (!isOneOf(categoryKind.enumValues, row.kind)) {
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
    if (valid) {
      (row.parentId === null ? roots : children).push(row);
    }
  }

  return { roots, children };
}

/** Groups rows (already sorted oldest first) by normalized name. */
function groupByName(
  rows: readonly LegacyCategoryRow[],
  parentName: string | null,
  problems: string[],
): Map<string, Group> {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const name = normalizeCategoryName(row.name);
    const group = groups.get(name);
    if (group === undefined) {
      groups.set(name, {
        rows: [row],
        kind: row.kind as CategoryKind,
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
  const layoutRoots = new Map<string, { index: number; root: LayoutRoot }>();
  input.layout.roots.forEach((root, index) => {
    layoutRoots.set(normalizeCategoryName(root.legacyName ?? root.name), { index, root });
  });

  const rootGroups = groupByName(rows.roots, null, problems);
  // Old root ID → normalized name of its group, to attach the subcategories.
  const rootGroupOf = new Map<string, string>();
  const childrenByRoot = new Map<string, LegacyCategoryRow[]>();
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

  type PlacedRoot = { name: string; group: Group; layoutIndex: number; layoutRoot: LayoutRoot };
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

    const layoutChildren = new Map<string, { index: number; name: string }>();
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
      accountMapRows: accounts.migrated.length,
      categoryMapRows,
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
