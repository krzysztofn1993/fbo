// Polish names of the values that the code and the database keep as English
// identifiers. Used only by the presentation layer. Each record is typed from
// the schema enum, so a new enum value without a name here fails the type check.

import type { accountType, categoryKind, categoryType, reportingScope } from "@/lib/db/schema";

type EnumValue<E extends { enumValues: readonly string[] }> = E["enumValues"][number];

export const accountTypeNames: Record<EnumValue<typeof accountType>, string> = {
  bank: "Konto bankowe",
  cash: "Gotówka",
  investment: "Inwestycje",
  liability: "Zobowiązanie",
  other: "Inne",
};

export const reportingScopeNames: Record<EnumValue<typeof reportingScope>, string> = {
  personal: "Prywatne",
  business: "Firmowe",
  excluded: "Wyłączone",
};

export const categoryKindNames: Record<EnumValue<typeof categoryKind>, string> = {
  income: "Przychód",
  expense: "Wydatek",
  transfer: "Transfer",
  mixed: "Mieszany",
};

export const categoryTypeNames: Record<EnumValue<typeof categoryType>, string> = {
  standard: "Zwykła",
  labeled: "Z etykietami",
};
