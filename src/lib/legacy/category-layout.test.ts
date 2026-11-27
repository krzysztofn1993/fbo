import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeCategoryName,
  parseCategoryLayout,
  readCategoryLayoutFile,
} from "@/lib/legacy/category-layout";

function problemsOf(value: unknown): string[] {
  const result = parseCategoryLayout(typeof value === "string" ? value : JSON.stringify(value));
  expect(result.ok).toBe(false);
  return result.ok ? [] : result.problems;
}

describe("normalizeCategoryName", () => {
  it("trims, collapses inner whitespace and lowercases with Polish letters", () => {
    expect(normalizeCategoryName("  Łąka \t  ĆMA  ")).toBe("łąka ćma");
    expect(normalizeCategoryName("Kategoria A")).toBe(normalizeCategoryName("kategoria  a"));
  });
});

describe("parseCategoryLayout", () => {
  it("reads roots in order, with children and the labeled type", () => {
    const result = parseCategoryLayout(
      JSON.stringify({
        roots: [
          { name: "Kategoria B", children: ["Podkategoria 2", "Podkategoria 1"] },
          { name: "Kategoria A", type: "labeled" },
          { name: "Kategoria C" },
        ],
      }),
    );

    expect(result).toEqual({
      ok: true,
      layout: {
        roots: [
          { name: "Kategoria B", labeled: false, children: ["Podkategoria 2", "Podkategoria 1"] },
          { name: "Kategoria A", labeled: true, children: [] },
          { name: "Kategoria C", labeled: false, children: [] },
        ],
      },
    });
  });

  it("rejects text that is not JSON", () => {
    expect(problemsOf("{ roots: [")).toEqual(["The category layout file is not valid JSON."]);
  });

  it("rejects a file without a roots array", () => {
    for (const value of [{}, { roots: {} }, [], "null"]) {
      expect(problemsOf(value)[0]).toContain('"roots"');
    }
  });

  it("rejects children on a labeled root", () => {
    const problems = problemsOf({
      roots: [{ name: "Kategoria A", type: "labeled", children: ["Podkategoria 1"] }],
    });
    expect(problems).toEqual(['roots[0] "Kategoria A" is labeled, so it cannot have "children".']);
  });

  it("rejects two roots with the same name after normalization", () => {
    const problems = problemsOf({ roots: [{ name: "Kategoria A" }, { name: " kategoria  A" }] });
    expect(problems).toEqual(['roots[1] " kategoria  A" repeats the name of roots[0].']);
  });

  it("rejects two children of one root with the same name after normalization", () => {
    const problems = problemsOf({
      roots: [{ name: "Kategoria A", children: ["Podkategoria Ł", "podkategoria ł "] }],
    });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("repeats the name of children[0]");
  });

  it("allows the same child name under different roots", () => {
    const result = parseCategoryLayout(
      JSON.stringify({
        roots: [
          { name: "Kategoria A", children: ["Podkategoria 1"] },
          { name: "Kategoria B", children: ["Podkategoria 1"] },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects malformed entries, unknown types and unknown fields", () => {
    const problems = problemsOf({
      roots: [
        "Kategoria A",
        { name: "" },
        { name: "Kategoria B", type: "standard" },
        { name: "Kategoria C", childern: [] },
        { name: "Kategoria D", children: "Podkategoria 1" },
        { name: "Kategoria E", children: [1] },
      ],
    });
    expect(problems).toEqual([
      "roots[0] must be an object.",
      "roots[1].name must be a non-empty string.",
      'roots[2] "Kategoria B": "type" must be "labeled" when present.',
      'roots[3] has an unknown field "childern".',
      'roots[4] "Kategoria D": "children" must be an array of names.',
      'roots[5] "Kategoria E": children[0] must be a non-empty string.',
    ]);
  });

  it("keeps the old name of a root that the layout renames", () => {
    const result = parseCategoryLayout(
      JSON.stringify({
        roots: [
          { name: "Wpływy", legacyName: "Income", children: ["Premia"] },
          { name: "Kategoria A" },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      layout: {
        roots: [
          { name: "Wpływy", legacyName: "Income", labeled: false, children: ["Premia"] },
          { name: "Kategoria A", labeled: false, children: [] },
        ],
      },
    });
  });

  it("rejects an empty or non-string legacyName", () => {
    expect(
      problemsOf({
        roots: [
          { name: "Kategoria A", legacyName: " " },
          { name: "Kategoria B", legacyName: 1 },
        ],
      }),
    ).toEqual([
      'roots[0] "Kategoria A": "legacyName" must be a non-empty string when present.',
      'roots[1] "Kategoria B": "legacyName" must be a non-empty string when present.',
    ]);
  });

  it("rejects two roots that resolve to the same old name", () => {
    expect(
      problemsOf({
        roots: [
          { name: "Kategoria A", legacyName: "Old  Name" },
          { name: "Kategoria B", legacyName: "old name" },
        ],
      }),
    ).toEqual(['roots[1] "Kategoria B" matches the same old root category as roots[0].']);
    expect(
      problemsOf({
        roots: [{ name: "Kategoria A" }, { name: "Kategoria B", legacyName: "kategoria a" }],
      }),
    ).toEqual(['roots[1] "Kategoria B" matches the same old root category as roots[0].']);
  });

  it("rejects a rename to a name another root already has", () => {
    expect(
      problemsOf({
        roots: [{ name: "Kategoria A" }, { name: "kategoria  A", legacyName: "Income" }],
      }),
    ).toEqual(['roots[1] "kategoria  A" repeats the name of roots[0].']);
  });

  it("reads account entries when the file has them", () => {
    const result = parseCategoryLayout(
      JSON.stringify({
        roots: [{ name: "Kategoria A" }],
        accounts: [
          { name: "Konto wspólne", legacyNames: ["bank 1", "bank 2"] },
          { name: "Gotówka", legacyNames: ["cash 1"] },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      layout: {
        roots: [{ name: "Kategoria A", labeled: false, children: [] }],
        accounts: [
          { name: "Konto wspólne", legacyNames: ["bank 1", "bank 2"] },
          { name: "Gotówka", legacyNames: ["cash 1"] },
        ],
      },
    });
  });

  it("rejects malformed account entries and unknown top-level fields", () => {
    expect(problemsOf({ roots: [], accounts: {} })).toEqual(['"accounts" must be an array.']);
    expect(problemsOf({ roots: [], acounts: [] })).toEqual([
      'The category layout file has an unknown field "acounts".',
    ]);
    expect(
      problemsOf({
        roots: [],
        accounts: [
          "bank 1",
          { name: "", legacyNames: ["bank 1"] },
          { name: "Konto A", legacyNames: [] },
          { name: "Konto B", legacyName: ["bank 2"] },
          { name: "Konto C", legacyNames: ["bank 3", " "] },
        ],
      }),
    ).toEqual([
      "accounts[0] must be an object.",
      "accounts[1].name must be a non-empty string.",
      'accounts[2] "Konto A": "legacyNames" must be a non-empty array of names.',
      'accounts[3] has an unknown field "legacyName".',
      'accounts[3] "Konto B": "legacyNames" must be a non-empty array of names.',
      'accounts[4] "Konto C": legacyNames[1] must be a non-empty string.',
    ]);
  });

  it("rejects an old account listed twice and new account names that collide", () => {
    expect(
      problemsOf({
        roots: [],
        accounts: [
          { name: "Konto A", legacyNames: ["bank 1", "Bank  1"] },
          { name: "Konto B", legacyNames: ["bank 2"] },
          { name: "Konto C", legacyNames: ["BANK 2"] },
          { name: "konto  a", legacyNames: ["bank 3"] },
        ],
      }),
    ).toEqual([
      'accounts[0] "Konto A" lists the old account "Bank  1" twice.',
      'accounts[2] "Konto C" lists the old account "BANK 2" that accounts[1] lists.',
      'accounts[3] "konto  a" repeats the name of accounts[0].',
    ]);
  });

  it("allows renaming one root to the old name of another renamed root", () => {
    const result = parseCategoryLayout(
      JSON.stringify({
        roots: [
          { name: "Kategoria B", legacyName: "Kategoria A" },
          { name: "Kategoria C", legacyName: "Kategoria B" },
        ],
      }),
    );
    expect(result.ok).toBe(true);
  });
});

describe("readCategoryLayoutFile", () => {
  it("reads a file and reports one that cannot be read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "fbo-category-layout-"));
    try {
      const path = join(dir, "layout.json");
      await writeFile(path, JSON.stringify({ roots: [{ name: "Kategoria A" }] }));
      expect((await readCategoryLayoutFile(path)).ok).toBe(true);

      expect(await readCategoryLayoutFile(join(dir, "missing.json"))).toEqual({
        ok: false,
        problems: ["Cannot read the category layout file (ENOENT)."],
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
