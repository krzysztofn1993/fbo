// Reads the category layout file: the order of the root categories and of the
// subcategories under each, which root categories take labels instead of
// subcategories, and the accounts to rename or merge. The file is prepared
// once, outside the repository, from the budget spreadsheet, and is a second
// input of the one-time migration.
//
// Format:
//   { "roots": [ { "name": string, "legacyName"?: string, "type"?: "labeled",
//                  "children"?: string[] } ],
//     "accounts"?: [ { "name": string, "legacyNames": string[] } ] }
//
// A root entry with "legacyName" matches the old root category of that name
// and gives it "name" instead, which renames it during the migration. An
// account entry matches the old active accounts named in "legacyNames" and
// makes them one account named "name": one old name renames an account,
// several merge accounts.
//
// Each field is checked by its own Zod schema, so one bad field does not hide
// the problems of the others and every problem is reported at once.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// packages and uses only erasable syntax.

import { readFile } from "node:fs/promises";

import { z } from "zod";

/** A name after `normalizeCategoryName`; only such names are compared. */
const NormalizedNameSchema = z
  .string()
  .transform((name) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase("pl"))
  .brand<"NormalizedName">();
export type NormalizedName = z.infer<typeof NormalizedNameSchema>;

export type LayoutRoot = {
  /** Spelling from the spreadsheet; the name the new category gets. */
  name: string;
  /** Name of the old root category this entry matches when it differs from `name`. */
  legacyName?: string;
  labeled: boolean;
  /** Subcategory names in spreadsheet order; always empty for a labeled root. */
  children: string[];
};

export type LayoutAccount = {
  /** Name of the new account. */
  name: string;
  /** Names of the old accounts it replaces; at least one. */
  legacyNames: string[];
};

export type CategoryLayout = {
  roots: LayoutRoot[];
  /** Present only when the file has an "accounts" array. */
  accounts?: LayoutAccount[];
};

export type CategoryLayoutResult =
  | { ok: true; layout: CategoryLayout }
  | { ok: false; problems: string[] };

/** A name in the file: a string with something other than whitespace. */
const NameSchema = z.string().refine((value) => value.trim() !== "");

/** Any JSON object, but not an array; its fields are checked one by one. */
const EntrySchema = z.record(z.string(), z.unknown());

const LAYOUT_FIELDS = {
  roots: z.array(z.unknown()),
  accounts: z.array(z.unknown()).optional(),
};

const ROOT_FIELDS = {
  name: NameSchema,
  legacyName: NameSchema.optional(),
  type: z.literal("labeled").optional(),
  children: z.array(z.unknown()).optional(),
};

const ACCOUNT_FIELDS = {
  name: NameSchema,
  legacyNames: z.array(z.unknown()).min(1),
};

function unknownFields(entry: Record<string, unknown>, fields: object): string[] {
  return Object.keys(entry).filter((key) => !Object.hasOwn(fields, key));
}

/**
 * The one name normalization of the migration: trims, collapses inner
 * whitespace to a single space and lowercases with Polish rules. Used both to
 * merge old categories and to match them with the layout file.
 */
export function normalizeCategoryName(name: string): NormalizedName {
  return NormalizedNameSchema.parse(name);
}

/** Parses and checks the layout file contents; reports every problem found. */
export function parseCategoryLayout(text: string): CategoryLayoutResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["The category layout file is not valid JSON."] };
  }

  const file = EntrySchema.safeParse(data);
  const rootEntries = file.success ? LAYOUT_FIELDS.roots.safeParse(file.data.roots) : undefined;
  if (!file.success || !rootEntries?.success) {
    return {
      ok: false,
      problems: ['The category layout file must be an object with a "roots" array.'],
    };
  }

  const problems: string[] = [];
  for (const key of unknownFields(file.data, LAYOUT_FIELDS)) {
    problems.push(`The category layout file has an unknown field "${key}".`);
  }
  const roots: LayoutRoot[] = [];
  const rootNames = new Map<NormalizedName, number>();
  // Normalized old name each entry matches → index of the first such entry.
  const matchedNames = new Map<NormalizedName, number>();

  rootEntries.data.forEach((value, index) => {
    const where = `roots[${index}]`;
    const entry = EntrySchema.safeParse(value);
    if (!entry.success) {
      problems.push(`${where} must be an object.`);
      return;
    }
    for (const key of unknownFields(entry.data, ROOT_FIELDS)) {
      problems.push(`${where} has an unknown field "${key}".`);
    }

    const name = ROOT_FIELDS.name.safeParse(entry.data.name);
    if (!name.success) {
      problems.push(`${where}.name must be a non-empty string.`);
      return;
    }
    const label = `${where} "${name.data}"`;

    const legacyName = ROOT_FIELDS.legacyName.safeParse(entry.data.legacyName);
    if (!legacyName.success) {
      problems.push(`${label}: "legacyName" must be a non-empty string when present.`);
    }
    const oldName = legacyName.success ? legacyName.data : undefined;

    const type = ROOT_FIELDS.type.safeParse(entry.data.type);
    if (!type.success) {
      problems.push(`${label}: "type" must be "labeled" when present.`);
    }
    const labeled = type.success && type.data === "labeled";
    if (labeled && entry.data.children !== undefined) {
      problems.push(`${label} is labeled, so it cannot have "children".`);
    }

    const normalized = normalizeCategoryName(name.data);
    const previous = rootNames.get(normalized);
    const matchedName = normalizeCategoryName(oldName ?? name.data);
    const earlier = matchedNames.get(matchedName);
    if (previous !== undefined) {
      problems.push(`${label} repeats the name of roots[${previous}].`);
    } else if (earlier !== undefined) {
      problems.push(`${label} matches the same old root category as roots[${earlier}].`);
    } else {
      rootNames.set(normalized, index);
      matchedNames.set(matchedName, index);
    }

    const childNames: string[] = [];
    const children = ROOT_FIELDS.children.safeParse(entry.data.children);
    if (!children.success) {
      problems.push(`${label}: "children" must be an array of names.`);
    } else {
      const seen = new Map<NormalizedName, number>();
      (children.data ?? []).forEach((value, childIndex) => {
        const child = NameSchema.safeParse(value);
        if (!child.success) {
          problems.push(`${label}: children[${childIndex}] must be a non-empty string.`);
          return;
        }
        const childNormalized = normalizeCategoryName(child.data);
        const first = seen.get(childNormalized);
        if (first !== undefined) {
          problems.push(
            `${label}: children[${childIndex}] "${child.data}" repeats the name of children[${first}].`,
          );
          return;
        }
        seen.set(childNormalized, childIndex);
        childNames.push(child.data);
      });
    }

    roots.push({
      name: name.data,
      ...(oldName === undefined ? {} : { legacyName: oldName }),
      labeled,
      children: labeled ? [] : childNames,
    });
  });

  const accounts =
    file.data.accounts === undefined ? undefined : parseAccounts(file.data.accounts, problems);

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, layout: accounts === undefined ? { roots } : { roots, accounts } };
}

/** Checks the "accounts" array; problems go to `problems`. */
function parseAccounts(value: unknown, problems: string[]): LayoutAccount[] {
  const accountEntries = LAYOUT_FIELDS.accounts.safeParse(value);
  if (!accountEntries.success) {
    problems.push('"accounts" must be an array.');
    return [];
  }

  const accounts: LayoutAccount[] = [];
  // Normalized new name / old name → index of the first entry that has it.
  const newNames = new Map<NormalizedName, number>();
  const oldNames = new Map<NormalizedName, number>();

  (accountEntries.data ?? []).forEach((value, index) => {
    const where = `accounts[${index}]`;
    const entry = EntrySchema.safeParse(value);
    if (!entry.success) {
      problems.push(`${where} must be an object.`);
      return;
    }
    for (const key of unknownFields(entry.data, ACCOUNT_FIELDS)) {
      problems.push(`${where} has an unknown field "${key}".`);
    }

    const name = ACCOUNT_FIELDS.name.safeParse(entry.data.name);
    if (!name.success) {
      problems.push(`${where}.name must be a non-empty string.`);
      return;
    }
    const label = `${where} "${name.data}"`;

    const normalized = normalizeCategoryName(name.data);
    const previous = newNames.get(normalized);
    if (previous !== undefined) {
      problems.push(`${label} repeats the name of accounts[${previous}].`);
    } else {
      newNames.set(normalized, index);
    }

    const legacyNames = ACCOUNT_FIELDS.legacyNames.safeParse(entry.data.legacyNames);
    if (!legacyNames.success) {
      problems.push(`${label}: "legacyNames" must be a non-empty array of names.`);
      return;
    }
    const names: string[] = [];
    legacyNames.data.forEach((value, nameIndex) => {
      const legacyName = NameSchema.safeParse(value);
      if (!legacyName.success) {
        problems.push(`${label}: legacyNames[${nameIndex}] must be a non-empty string.`);
        return;
      }
      const key = normalizeCategoryName(legacyName.data);
      const first = oldNames.get(key);
      if (first === index) {
        problems.push(`${label} lists the old account "${legacyName.data}" twice.`);
        return;
      }
      if (first !== undefined) {
        problems.push(
          `${label} lists the old account "${legacyName.data}" that accounts[${first}] lists.`,
        );
        return;
      }
      oldNames.set(key, index);
      names.push(legacyName.data);
    });
    accounts.push({ name: name.data, legacyNames: names });
  });

  return accounts;
}

/** Reads and parses the layout file at `path`. */
export async function readCategoryLayoutFile(path: string): Promise<CategoryLayoutResult> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    const code = error instanceof Error && "code" in error ? ` (${String(error.code)})` : "";
    return { ok: false, problems: [`Cannot read the category layout file${code}.`] };
  }
  return parseCategoryLayout(text);
}
