// Made-up accounts and categories that the E2E global setup writes to the
// `_e2e` database. Not taken from any instance.
//
// Accounts are listed out of order on purpose: the page sorts them by name in
// Polish ("Ć" after "C", before "D"). Category positions differ from the
// alphabetical order, and the global setup inserts the roots alphabetically,
// so only an order by position gives the expected tree.

export type FixtureAccount = {
  name: string;
  type: "bank" | "cash" | "investment" | "liability" | "other";
  currency: string;
  reportingScope: "personal" | "business" | "excluded";
};

type Kind = "income" | "expense" | "transfer" | "mixed";

export type FixtureSubcategory = { name: string; kind: Kind; position: number };

export type FixtureRootCategory = {
  name: string;
  kind: Kind;
  type?: "labeled";
  position: number;
  children?: FixtureSubcategory[];
};

export const fixtureAccounts: FixtureAccount[] = [
  { name: "Dom", type: "cash", currency: "PLN", reportingScope: "personal" },
  { name: "Ćwiczebne konto", type: "investment", currency: "EUR", reportingScope: "business" },
  { name: "bank 1", type: "bank", currency: "PLN", reportingScope: "personal" },
  { name: "Cyfrowe konto", type: "liability", currency: "PLN", reportingScope: "excluded" },
];

export const fixtureCategories: FixtureRootCategory[] = [
  { name: "Kategoria A", kind: "mixed", type: "labeled", position: 1 },
  {
    name: "Kategoria B",
    kind: "expense",
    position: 0,
    children: [
      { name: "Podkategoria 1", kind: "expense", position: 1 },
      { name: "Podkategoria 2", kind: "expense", position: 0 },
    ],
  },
  {
    name: "Kategoria C",
    kind: "income",
    position: 2,
    children: [{ name: "Podkategoria 3", kind: "income", position: 0 }],
  },
];
