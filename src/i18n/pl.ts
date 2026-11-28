// Polish names of the values that the code and the database keep as English
// identifiers. Used only by the presentation layer. Each record is typed from
// the schema enum or the list of values it names, so a new value without a name
// here fails the type check.

import type {
  accountType,
  categoryKind,
  categoryType,
  legacySourceKind,
  reportingClass,
  reportingScope,
} from "@/lib/db/schema";
import type { ClassificationState } from "@/lib/transactions/classification-state";

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

export const reportingClassNames: Record<EnumValue<typeof reportingClass>, string> = {
  standard: "Zwykła",
  business_tax: "Podatek firmowy",
  business_expense: "Koszt firmowy",
  savings_investment: "Oszczędności i inwestycje",
};

export const classificationStateNames: Record<ClassificationState, string> = {
  unclassified: "Niesklasyfikowana",
  needs_review: "Do przeglądu",
  approved: "Zatwierdzona",
};

export const legacySourceKindNames: Record<EnumValue<typeof legacySourceKind>, string> = {
  legacy_excel: "Arkusz",
  bank_file: "Plik z banku",
  bank_api: "Połączenie z bankiem",
  manual: "Ręcznie",
};
