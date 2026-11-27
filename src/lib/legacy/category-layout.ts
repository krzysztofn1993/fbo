// Reads the category layout file: the order of the root categories and of the
// subcategories under each, and which root categories take labels instead of
// subcategories. The file is prepared once, outside the repository, from the
// budget spreadsheet, and is a second input of the one-time migration.
//
// Format:
//   { "roots": [ { "name": string, "legacyName"?: string, "type"?: "labeled",
//                  "children"?: string[] } ] }
//
// A root entry with "legacyName" matches the old root category of that name
// and gives it "name" instead, which renames it during the migration.
//
// Loaded by the `legacy:migrate` script under plain `node`, so it imports only
// `node:` modules and uses only erasable syntax.

import { readFile } from "node:fs/promises";

export type LayoutRoot = {
  /** Spelling from the spreadsheet; the name the new category gets. */
  name: string;
  /** Name of the old root category this entry matches when it differs from `name`. */
  legacyName?: string;
  labeled: boolean;
  /** Subcategory names in spreadsheet order; always empty for a labeled root. */
  children: string[];
};

export type CategoryLayout = { roots: LayoutRoot[] };

export type CategoryLayoutResult =
  | { ok: true; layout: CategoryLayout }
  | { ok: false; problems: string[] };

const ROOT_KEYS = new Set(["name", "legacyName", "type", "children"]);

/**
 * The one name normalization of the migration: trims, collapses inner
 * whitespace to a single space and lowercases with Polish rules. Used both to
 * merge old categories and to match them with the layout file.
 */
export function normalizeCategoryName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("pl");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isName(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Parses and checks the layout file contents; reports every problem found. */
export function parseCategoryLayout(text: string): CategoryLayoutResult {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, problems: ["The category layout file is not valid JSON."] };
  }

  if (!isRecord(data) || !Array.isArray(data.roots)) {
    return {
      ok: false,
      problems: ['The category layout file must be an object with a "roots" array.'],
    };
  }

  const problems: string[] = [];
  const roots: LayoutRoot[] = [];
  const rootNames = new Map<string, number>();
  // Normalized old name each entry matches → index of the first such entry.
  const matchedNames = new Map<string, number>();

  data.roots.forEach((entry: unknown, index) => {
    const where = `roots[${index}]`;
    if (!isRecord(entry)) {
      problems.push(`${where} must be an object.`);
      return;
    }
    for (const key of Object.keys(entry)) {
      if (!ROOT_KEYS.has(key)) {
        problems.push(`${where} has an unknown field "${key}".`);
      }
    }

    const { name, legacyName, type, children } = entry;
    if (!isName(name)) {
      problems.push(`${where}.name must be a non-empty string.`);
      return;
    }
    const label = `${where} "${name}"`;

    if (legacyName !== undefined && !isName(legacyName)) {
      problems.push(`${label}: "legacyName" must be a non-empty string when present.`);
    }
    const renamed = isName(legacyName);

    if (type !== undefined && type !== "labeled") {
      problems.push(`${label}: "type" must be "labeled" when present.`);
    }
    const labeled = type === "labeled";
    if (labeled && children !== undefined) {
      problems.push(`${label} is labeled, so it cannot have "children".`);
    }

    const normalized = normalizeCategoryName(name);
    const previous = rootNames.get(normalized);
    const matchedName = normalizeCategoryName(renamed ? legacyName : name);
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
    if (children !== undefined && !Array.isArray(children)) {
      problems.push(`${label}: "children" must be an array of names.`);
    } else if (children !== undefined) {
      const seen = new Map<string, number>();
      children.forEach((child: unknown, childIndex) => {
        if (!isName(child)) {
          problems.push(`${label}: children[${childIndex}] must be a non-empty string.`);
          return;
        }
        const childNormalized = normalizeCategoryName(child);
        const first = seen.get(childNormalized);
        if (first !== undefined) {
          problems.push(
            `${label}: children[${childIndex}] "${child}" repeats the name of children[${first}].`,
          );
          return;
        }
        seen.set(childNormalized, childIndex);
        childNames.push(child);
      });
    }

    roots.push({
      name,
      ...(renamed ? { legacyName } : {}),
      labeled,
      children: labeled ? [] : childNames,
    });
  });

  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, layout: { roots } };
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
