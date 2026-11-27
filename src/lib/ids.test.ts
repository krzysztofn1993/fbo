import { describe, expect, it } from "vitest";

import {
  type AccountId,
  AccountIdSchema,
  type CategoryId,
  CategoryIdSchema,
  type LegacyAccountId,
  LegacyAccountIdSchema,
  LegacyCategoryIdSchema,
} from "@/lib/ids";

const UUID_V7 = "019a1b2c-3d4e-7f00-8a00-000000000001";
const UUID_V4 = "a0000000-0000-4000-8000-000000000001";

describe("new IDs", () => {
  it("accept a UUIDv7 and keep its value", () => {
    expect(AccountIdSchema.parse(UUID_V7)).toBe(UUID_V7);
    expect(CategoryIdSchema.parse(UUID_V7)).toBe(UUID_V7);
  });

  it("reject other UUID versions and anything that is not a UUID", () => {
    for (const value of [UUID_V4, "", "not-a-uuid", `${UUID_V7}0`, 1, null]) {
      expect(AccountIdSchema.safeParse(value).success, String(value)).toBe(false);
      expect(CategoryIdSchema.safeParse(value).success, String(value)).toBe(false);
    }
  });
});

describe("old IDs", () => {
  it("accept any value of the PostgreSQL uuid form, whatever its version", () => {
    for (const value of [UUID_V4, UUID_V7, "00000000-0000-0000-0000-000000000000"]) {
      expect(LegacyAccountIdSchema.parse(value)).toBe(value);
      expect(LegacyCategoryIdSchema.parse(value)).toBe(value);
    }
  });

  it("reject anything that is not of that form", () => {
    for (const value of ["", "a0000000-0000-4000-8000-00000000000", "a0000000000040008000000000000001", 1]) {
      expect(LegacyAccountIdSchema.safeParse(value).success, String(value)).toBe(false);
      expect(LegacyCategoryIdSchema.safeParse(value).success, String(value)).toBe(false);
    }
  });
});

describe("brands", () => {
  it("keep new and old IDs, and accounts and categories, apart at compile time", () => {
    const categoryId = CategoryIdSchema.parse(UUID_V7);
    const legacyAccountId = LegacyAccountIdSchema.parse(UUID_V7);
    const legacyCategoryId = LegacyCategoryIdSchema.parse(UUID_V7);

    // @ts-expect-error A category ID is not an account ID.
    const fromCategory: AccountId = categoryId;
    // @ts-expect-error An old account ID is not a new one.
    const fromLegacy: AccountId = legacyAccountId;
    // @ts-expect-error An old category ID is not an old account ID.
    const fromLegacyCategory: LegacyAccountId = legacyCategoryId;
    // @ts-expect-error A plain string has no brand.
    const fromString: CategoryId = UUID_V7;

    // The brands exist only in the types; the values are the same strings.
    expect([fromCategory, fromLegacy, fromLegacyCategory, fromString]).toEqual(
      Array(4).fill(UUID_V7),
    );
  });
});
