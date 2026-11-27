// Reads accounts and the category tree in the shape the pages show them.
//
// Takes the database handle as a parameter and knows nothing about Next, so
// the database tests and the browser test setup can load it. Enum values stay
// the English identifiers; the pages translate them. Imports only packages and
// relative `.ts` paths.

import { asc } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { accounts, categories } from "../db/schema.ts";

type Account = typeof accounts.$inferSelect;
type Category = typeof categories.$inferSelect;

export type AccountListItem = Pick<Account, "id" | "name" | "type" | "currency" | "reportingScope">;

export type CategoryNode = Pick<Category, "id" | "name" | "kind" | "type">;

export type RootCategoryNode = CategoryNode & { children: CategoryNode[] };

const polishOrder = new Intl.Collator("pl");

/** Every account, by name in Polish alphabetical order (C before Ć before D). */
export async function listAccounts(db: NodePgDatabase): Promise<AccountListItem[]> {
  const rows = await db
    .select({
      id: accounts.id,
      name: accounts.name,
      type: accounts.type,
      currency: accounts.currency,
      reportingScope: accounts.reportingScope,
    })
    .from(accounts);

  // Sorted here rather than in SQL: the database collation need not be Polish.
  return rows.sort((a, b) => polishOrder.compare(a.name, b.name) || a.id.localeCompare(b.id));
}

/**
 * Root categories by `position`, each with its subcategories by `position`.
 * The schema allows two levels, so only direct children of a root are listed.
 */
export async function listCategoryTree(db: NodePgDatabase): Promise<RootCategoryNode[]> {
  const rows = await db
    .select({
      id: categories.id,
      parentId: categories.parentId,
      name: categories.name,
      kind: categories.kind,
      type: categories.type,
    })
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.id));

  const roots: RootCategoryNode[] = [];
  const rootsById = new Map<string, RootCategoryNode>();
  for (const { parentId, ...node } of rows) {
    if (parentId === null) {
      const root = { ...node, children: [] };
      roots.push(root);
      rootsById.set(root.id, root);
    }
  }
  for (const { parentId, ...node } of rows) {
    if (parentId !== null) {
      rootsById.get(parentId)?.children.push(node);
    }
  }
  return roots;
}
