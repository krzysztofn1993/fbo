import { describe, expect, it } from "vitest";

import { parseLegacyRecords } from "@/lib/legacy/read";

const ACCOUNT_ID = "a0000000-0000-4000-8000-000000000001";
const ROOT_ID = "c0000000-0000-4000-8000-000000000001";
const CHILD_ID = "c0000000-0000-4000-8000-000000000002";
const CREATED = new Date("2024-01-01T12:00:00Z");
const UPDATED = new Date("2024-01-02T12:00:00Z");

/** A row as `pg` returns it for the accounts query. */
function accountRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: ACCOUNT_ID,
    name: "bank 1",
    type: "bank",
    currency: "PLN",
    reporting_scope: "personal",
    is_active: true,
    created_at: CREATED,
    updated_at: UPDATED,
    ...overrides,
  };
}

/** A row as `pg` returns it for the categories query. */
function categoryRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: ROOT_ID,
    parent_id: null,
    name: "Kategoria A",
    kind: "expense",
    is_active: true,
    created_at: CREATED,
    updated_at: UPDATED,
    ...overrides,
  };
}

describe("parseLegacyRecords", () => {
  it("turns the rows into the snapshot the translation reads", () => {
    const result = parseLegacyRecords({
      accounts: [accountRecord()],
      referencedInactive: [{ id: ACCOUNT_ID }],
      categories: [categoryRecord(), categoryRecord({ id: CHILD_ID, parent_id: ROOT_ID })],
    });

    expect(result).toEqual({
      ok: true,
      snapshot: {
        accounts: [
          {
            id: ACCOUNT_ID,
            name: "bank 1",
            type: "bank",
            currency: "PLN",
            reportingScope: "personal",
            isActive: true,
            createdAt: CREATED,
            updatedAt: UPDATED,
          },
        ],
        referencedInactiveAccountIds: new Set([ACCOUNT_ID]),
        categories: [
          {
            id: ROOT_ID,
            parentId: null,
            name: "Kategoria A",
            kind: "expense",
            isActive: true,
            createdAt: CREATED,
            updatedAt: UPDATED,
          },
          {
            id: CHILD_ID,
            parentId: ROOT_ID,
            name: "Kategoria A",
            kind: "expense",
            isActive: true,
            createdAt: CREATED,
            updatedAt: UPDATED,
          },
        ],
      },
    });
  });

  it("leaves enum values and the currency as text for the translation to check", () => {
    const result = parseLegacyRecords({
      accounts: [accountRecord({ type: "savings", currency: "zł", reporting_scope: "family" })],
      referencedInactive: [],
      categories: [categoryRecord({ kind: "unknown" })],
    });
    expect(result.ok).toBe(true);
  });

  it("reports every row of an unexpected shape by query, row and column", () => {
    const result = parseLegacyRecords({
      accounts: [accountRecord(), accountRecord({ id: "not-a-uuid", is_active: null })],
      referencedInactive: [{ id: 7 }],
      categories: [categoryRecord({ parent_id: "", created_at: "2024-01-01" })],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problems).toHaveLength(5);
      expect(result.problems[0]).toMatch(/^The old database returned an unexpected value in accounts row 2, column "id": /);
      expect(result.problems[1]).toContain('accounts row 2, column "is_active"');
      expect(result.problems[2]).toContain('referenced accounts row 1, column "id"');
      expect(result.problems[3]).toContain('categories row 1, column "parent_id"');
      expect(result.problems[4]).toContain('categories row 1, column "created_at"');
    }
  });
});
