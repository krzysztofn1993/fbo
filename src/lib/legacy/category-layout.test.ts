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
