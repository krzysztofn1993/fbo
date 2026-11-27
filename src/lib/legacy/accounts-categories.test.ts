import { describe, expect, it } from "vitest";

import {
  type LegacyAccountRow,
  type LegacyCategoryRow,
  type MigrationPlan,
  type MigrationReport,
  translateAccountsAndCategories,
  type TranslationInput,
} from "@/lib/legacy/accounts-categories";
import type { CategoryLayout, LayoutRoot } from "@/lib/legacy/category-layout";

function day(n: number): Date {
  return new Date(Date.UTC(2024, 0, n));
}

let nextId = 1;
function id(): string {
  return `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`;
}

function account(overrides: Partial<LegacyAccountRow> = {}): LegacyAccountRow {
  return {
    id: id(),
    name: "bank 1",
    type: "bank",
    currency: "PLN",
    reportingScope: "personal",
    isActive: true,
    createdAt: day(1),
    updatedAt: day(2),
    ...overrides,
  };
}

function category(
  name: string,
  parent: LegacyCategoryRow | null = null,
  overrides: Partial<LegacyCategoryRow> = {},
): LegacyCategoryRow {
  return {
    id: id(),
    parentId: parent?.id ?? null,
    name,
    kind: parent?.kind ?? "expense",
    isActive: true,
    createdAt: day(1),
    updatedAt: day(1),
    ...overrides,
  };
}

function root(name: string, children?: string[], labeled = false): LayoutRoot {
  return { name, labeled, children: children ?? [] };
}

function input(overrides: Partial<TranslationInput> = {}): TranslationInput {
  return {
    accounts: [],
    referencedInactiveAccountIds: new Set(),
    categories: [],
    layout: { roots: [] },
    ...overrides,
  };
}

function translated(value: TranslationInput): { plan: MigrationPlan; report: MigrationReport } {
  const result = translateAccountsAndCategories(value);
  if (!result.ok) {
    throw new Error(`expected a translation, got problems:\n${result.problems.join("\n")}`);
  }
  return result;
}

function problemsOf(value: TranslationInput): string[] {
  const result = translateAccountsAndCategories(value);
  if (result.ok) {
    throw new Error("expected problems, got a translation");
  }
  return result.problems;
}

/** Names of the roots in position order, each with its subcategories in position order. */
function tree(plan: MigrationPlan): [string, string[]][] {
  return plan.rootCategories.map((r) => {
    const children = plan.subcategories.filter((child) => child.parentKey === r.key);
    expect(children.map((child) => child.position)).toEqual(children.map((_, index) => index));
    return [r.name, children.map((child) => child.name)];
  });
}

describe("accounts", () => {
  it("translates active accounts with their values 1:1", () => {
    const bank = account({ updatedAt: day(5) });
    const cash = account({
      name: "cash 1",
      type: "cash",
      currency: "EUR",
      reportingScope: "business",
      createdAt: day(3),
      updatedAt: day(3),
    });
    const { plan, report } = translated(input({ accounts: [cash, bank] }));

    expect(plan.accounts).toEqual([
      {
        key: bank.id,
        legacyIds: [bank.id],
        name: "bank 1",
        type: "bank",
        currency: "PLN",
        reportingScope: "personal",
        createdAt: day(1),
        updatedAt: day(5),
      },
      {
        key: cash.id,
        legacyIds: [cash.id],
        name: "cash 1",
        type: "cash",
        currency: "EUR",
        reportingScope: "business",
        createdAt: day(3),
        updatedAt: day(3),
      },
    ]);
    expect(report).toMatchObject({ accountsMigrated: 2, accountsSkipped: 0, accountMapRows: 2 });
  });

  it("accepts every account type and reporting scope of the old version", () => {
    const types = ["bank", "cash", "investment", "liability", "other"];
    const scopes = ["personal", "business", "excluded"];
    const rows = [
      ...types.map((type) => account({ type })),
      ...scopes.map((reportingScope) => account({ reportingScope })),
    ];
    const { plan } = translated(input({ accounts: rows }));
    expect(plan.accounts.map((a) => a.type)).toEqual([...types, "bank", "bank", "bank"]);
    expect(plan.accounts.slice(types.length).map((a) => a.reportingScope)).toEqual(scopes);
  });

  it("skips an inactive account that nothing refers to and counts it", () => {
    const inactive = account({ name: "cash 2", isActive: false });
    const { plan, report } = translated(input({ accounts: [account(), inactive] }));
    expect(plan.accounts.map((a) => a.name)).toEqual(["bank 1"]);
    expect(report).toMatchObject({ accountsMigrated: 1, accountsSkipped: 1, accountMapRows: 1 });
  });

  it("rejects an inactive account that another row refers to", () => {
    const inactive = account({ name: "cash 2", isActive: false });
    const problems = problemsOf(
      input({ accounts: [inactive], referencedInactiveAccountIds: new Set([inactive.id]) }),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(inactive.id);
    expect(problems[0]).toContain("refer");
  });

  it("rejects an unknown type or reporting scope", () => {
    const problems = problemsOf(
      input({ accounts: [account({ type: "savings" }), account({ reportingScope: "all" })] }),
    );
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('unknown type "savings"');
    expect(problems[1]).toContain('unknown reporting scope "all"');
  });

  it("rejects a currency that is not three capital letters", () => {
    const problems = problemsOf(
      input({
        accounts: ["pln", "PL", "PLNX", "P1N", " PL"].map((currency) => account({ currency })),
      }),
    );
    expect(problems).toHaveLength(5);
    for (const problem of problems) {
      expect(problem).toContain("currency");
    }
  });
});

describe("categories", () => {
  it("rejects an inactive category", () => {
    const inactive = category("Kategoria A", null, { isActive: false });
    const problems = problemsOf(
      input({ categories: [inactive], layout: { roots: [root("Kategoria A")] } }),
    );
    expect(problems).toEqual([expect.stringContaining("is inactive")]);
  });

  it("rejects a category whose parent does not exist", () => {
    const orphan = category("Podkategoria 1", null, {
      parentId: "00000000-0000-4000-8000-999999999999",
    });
    expect(problemsOf(input({ categories: [orphan] }))).toEqual([
      expect.stringContaining("does not exist"),
    ]);
  });

  it("rejects a category on a third level", () => {
    const top = category("Kategoria A");
    const middle = category("Podkategoria 1", top);
    const bottom = category("Podkategoria 1a", middle);
    const problems = problemsOf(
      input({
        categories: [top, middle, bottom],
        layout: { roots: [root("Kategoria A", ["Podkategoria 1"])] },
      }),
    );
    expect(problems).toEqual([expect.stringContaining("third level")]);
    expect(problems[0]).toContain(bottom.id);
  });

  it("rejects an unknown kind", () => {
    const odd = category("Kategoria A", null, { kind: "savings" });
    const problems = problemsOf(
      input({ categories: [odd], layout: { roots: [root("Kategoria A")] } }),
    );
    expect(problems).toEqual([expect.stringContaining('unknown kind "savings"')]);
  });

  it("accepts every kind of the old version", () => {
    const kinds = ["income", "expense", "transfer", "mixed"];
    const rows = kinds.map((kind, index) => category(`Kategoria ${index}`, null, { kind }));
    const layout: CategoryLayout = { roots: rows.map((row) => root(row.name)) };
    const { plan } = translated(input({ categories: rows, layout }));
    expect(plan.rootCategories.map((r) => r.kind)).toEqual(kinds);
  });
});

describe("merging names that differ only in case or spacing", () => {
  const parent = category("Kategoria A", null, { kind: "income" });

  it("makes one record with the layout spelling and every old ID mapped", () => {
    const older = category("premia  roczna", parent, { createdAt: day(2), updatedAt: day(6) });
    const newer = category("PREMIA ROCZNA", parent, { createdAt: day(3), updatedAt: day(4) });
    const newest = category(" Premia roczna", parent, { createdAt: day(5), updatedAt: day(5) });
    const { plan, report } = translated(
      input({
        categories: [parent, newest, newer, older],
        layout: { roots: [root("Kategoria A", ["Premia Roczna"])] },
      }),
    );

    expect(plan.subcategories).toEqual([
      {
        key: older.id,
        legacyIds: [older.id, newer.id, newest.id],
        parentKey: parent.id,
        name: "Premia Roczna",
        kind: "income",
        type: "standard",
        position: 0,
        createdAt: day(2),
        updatedAt: day(6),
      },
    ]);
    expect(report.mergedGroups).toEqual([
      { name: "Premia Roczna", parentName: "Kategoria A", rowCount: 3 },
    ]);
    expect(report).toMatchObject({ subcategories: 1, categoryMapRows: 4 });
  });

  it("keeps the spelling of the oldest row when the layout has no match", () => {
    const older = category("premia", parent, { createdAt: day(2) });
    const newer = category("Premia", parent, { createdAt: day(3) });
    const { plan, report } = translated(
      input({ categories: [parent, newer, older], layout: { roots: [root("Kategoria A")] } }),
    );
    expect(plan.subcategories.map((c) => [c.name, c.legacyIds])).toEqual([
      ["premia", [older.id, newer.id]],
    ]);
    expect(report.appendedSubcategories).toEqual([{ parentName: "Kategoria A", name: "premia" }]);
  });

  it("does not merge equal names under different parents", () => {
    const other = category("Kategoria B");
    const rows = [parent, other, category("Podkategoria 1", parent), category("podkategoria 1", other)];
    const { plan, report } = translated(
      input({ categories: rows, layout: { roots: [root("Kategoria A"), root("Kategoria B")] } }),
    );
    expect(plan.subcategories).toHaveLength(2);
    expect(report.mergedGroups).toEqual([]);
  });

  it("merges root categories and their subcategories together", () => {
    const first = category("Kategoria A", null, { createdAt: day(1) });
    const second = category("kategoria a", null, { createdAt: day(2) });
    const rows = [first, second, category("Podkategoria 1", first), category("PODKATEGORIA 1", second)];
    const { plan, report } = translated(
      input({ categories: rows, layout: { roots: [root("Kategoria A", ["Podkategoria 1"])] } }),
    );
    expect(plan.rootCategories.map((r) => [r.key, r.legacyIds])).toEqual([
      [first.id, [first.id, second.id]],
    ]);
    expect(tree(plan)).toEqual([["Kategoria A", ["Podkategoria 1"]]]);
    expect(report.mergedGroups).toHaveLength(2);
    expect(report.categoryMapRows).toBe(4);
  });

  it("rejects a group whose rows have different kinds", () => {
    const rows = [
      parent,
      category("Premia", parent, { kind: "income" }),
      category("premia", parent, { kind: "expense" }),
    ];
    const problems = problemsOf(
      input({ categories: rows, layout: { roots: [root("Kategoria A", ["Premia"])] } }),
    );
    expect(problems).toEqual([expect.stringContaining("different kinds (income, expense)")]);
  });
});

describe("order", () => {
  it("follows the layout file for roots and subcategories", () => {
    const a = category("Kategoria A");
    const b = category("Kategoria B");
    const rows = [a, b, category("Podkategoria 1", a), category("Podkategoria 2", a)];
    const { plan, report } = translated(
      input({
        categories: rows,
        layout: {
          roots: [root("kategoria b"), root("Kategoria A", ["Podkategoria 2", "Podkategoria 1"])],
        },
      }),
    );
    expect(tree(plan)).toEqual([
      ["kategoria b", []],
      ["Kategoria A", ["Podkategoria 2", "Podkategoria 1"]],
    ]);
    expect(plan.rootCategories.map((r) => r.position)).toEqual([0, 1]);
    expect(report.appendedSubcategories).toEqual([]);
    expect(report.layoutWarnings).toEqual([]);
  });

  it("places unmatched subcategories last, oldest first", () => {
    const a = category("Kategoria A");
    const rows = [
      a,
      category("Podkategoria Z", a, { createdAt: day(9) }),
      category("Podkategoria Y", a, { createdAt: day(4) }),
      category("Podkategoria 1", a, { createdAt: day(8) }),
    ];
    const { plan, report } = translated(
      input({ categories: rows, layout: { roots: [root("Kategoria A", ["Podkategoria 1"])] } }),
    );
    expect(tree(plan)).toEqual([["Kategoria A", ["Podkategoria 1", "Podkategoria Y", "Podkategoria Z"]]]);
    expect(report.appendedSubcategories).toEqual([
      { parentName: "Kategoria A", name: "Podkategoria Y" },
      { parentName: "Kategoria A", name: "Podkategoria Z" },
    ]);
  });

  it("rejects a root category without an entry in the layout file", () => {
    const rows = [category("Kategoria A"), category("Kategoria D")];
    const problems = problemsOf(input({ categories: rows, layout: { roots: [root("Kategoria A")] } }));
    expect(problems).toEqual([expect.stringContaining('"Kategoria D"')]);
    expect(problems[0]).toContain("no entry in the category layout file");
  });

  it("warns about layout entries without a counterpart", () => {
    const a = category("Kategoria A");
    const { plan, report } = translated(
      input({
        categories: [a, category("Podkategoria 1", a)],
        layout: {
          roots: [root("Kategoria X"), root("Kategoria A", ["Podkategoria 1", "Podkategoria 9"])],
        },
      }),
    );
    expect(plan.rootCategories.map((r) => [r.name, r.position])).toEqual([["Kategoria A", 0]]);
    expect(report.layoutWarnings).toEqual([
      'Layout root "Kategoria X" matches no root category.',
      'Layout subcategory "Podkategoria 9" under "Kategoria A" matches no subcategory.',
    ]);
  });
});

describe("category type", () => {
  it("marks the roots labeled in the layout file and no others", () => {
    const rows = [category("Kategoria A"), category("Kategoria B")];
    const { plan, report } = translated(
      input({
        categories: rows,
        layout: { roots: [root("Kategoria A", [], true), root("Kategoria B")] },
      }),
    );
    expect(plan.rootCategories.map((r) => [r.name, r.type])).toEqual([
      ["Kategoria A", "labeled"],
      ["Kategoria B", "standard"],
    ]);
    expect(report.labeledCategories).toEqual(["Kategoria A"]);
  });

  it("rejects a labeled root that has subcategories", () => {
    const a = category("Kategoria A");
    const problems = problemsOf(
      input({
        categories: [a, category("Podkategoria 1", a)],
        layout: { roots: [root("Kategoria A", [], true)] },
      }),
    );
    expect(problems).toEqual([
      'Root category "Kategoria A" is labeled in the layout file but has subcategories.',
    ]);
  });
});

describe("report", () => {
  it("sums up the whole translation", () => {
    const a = category("Kategoria A", null, { kind: "income" });
    const b = category("Kategoria B");
    const rows = [
      a,
      b,
      category("premia", a, { createdAt: day(2) }),
      category("Premia", a, { createdAt: day(3) }),
      category("Podkategoria 1", a, { createdAt: day(4) }),
      category("Podkategoria 2", a, { createdAt: day(5) }),
    ];
    const { report } = translated(
      input({
        accounts: [account(), account({ name: "cash 2", isActive: false })],
        categories: rows,
        layout: {
          roots: [root("Kategoria B", [], true), root("Kategoria A", ["Premia", "Podkategoria 1"])],
        },
      }),
    );
    expect(report).toEqual({
      accountsMigrated: 1,
      accountsSkipped: 1,
      rootCategories: 2,
      subcategories: 3,
      accountMapRows: 1,
      categoryMapRows: 6,
      mergedGroups: [{ name: "Premia", parentName: "Kategoria A", rowCount: 2 }],
      labeledCategories: ["Kategoria B"],
      appendedSubcategories: [{ parentName: "Kategoria A", name: "Podkategoria 2" }],
      layoutWarnings: [],
    });
  });

  it("lists every problem at once", () => {
    const problems = problemsOf(
      input({
        accounts: [account({ currency: "pln" })],
        categories: [category("Kategoria A", null, { isActive: false }), category("Kategoria D")],
        layout: { roots: [root("Kategoria A")] },
      }),
    );
    expect(problems).toHaveLength(3);
  });
});
