import { describe, expect, it } from "vitest";

import {
  type AccountId,
  AccountIdSchema,
  type CategoryId,
  CategoryIdSchema,
  type LegacyAccountId,
  LegacyAccountIdSchema,
  LegacyBankConnectionIdSchema,
  LegacyBankSyncRunIdSchema,
  LegacyCategoryIdSchema,
  LegacyClassificationResultIdSchema,
  LegacyClassificationRuleIdSchema,
  LegacyHistoricalProposalIdSchema,
  LegacyImportRunIdSchema,
  LegacyMerchantIdSchema,
  LegacySourceFileIdSchema,
  type LegacyTransactionId,
  LegacyTransactionIdSchema,
  type TransactionId,
  TransactionIdSchema,
  TransactionPartIdSchema,
} from "@/lib/ids";

const UUID_V7 = "019a1b2c-3d4e-7f00-8a00-000000000001";
const UUID_V4 = "a0000000-0000-4000-8000-000000000001";

const NEW_ID_SCHEMAS = {
  AccountIdSchema,
  CategoryIdSchema,
  TransactionIdSchema,
  TransactionPartIdSchema,
};

const LEGACY_ID_SCHEMAS = {
  LegacyAccountIdSchema,
  LegacyCategoryIdSchema,
  LegacyTransactionIdSchema,
  LegacyClassificationResultIdSchema,
  LegacyMerchantIdSchema,
  LegacyClassificationRuleIdSchema,
  LegacyHistoricalProposalIdSchema,
  LegacySourceFileIdSchema,
  LegacyImportRunIdSchema,
  LegacyBankConnectionIdSchema,
  LegacyBankSyncRunIdSchema,
};

describe("new IDs", () => {
  it.each(Object.entries(NEW_ID_SCHEMAS))("%s accepts a UUIDv7 and keeps its value", (_, schema) => {
    expect(schema.parse(UUID_V7)).toBe(UUID_V7);
  });

  it.each(Object.entries(NEW_ID_SCHEMAS))(
    "%s rejects other UUID versions and anything that is not a UUID",
    (_, schema) => {
      for (const value of [UUID_V4, "", "not-a-uuid", `${UUID_V7}0`, 1, null]) {
        expect(schema.safeParse(value).success, String(value)).toBe(false);
      }
    },
  );
});

describe("old IDs", () => {
  it.each(Object.entries(LEGACY_ID_SCHEMAS))(
    "%s accepts any value of the PostgreSQL uuid form, whatever its version",
    (_, schema) => {
      for (const value of [UUID_V4, UUID_V7, "00000000-0000-0000-0000-000000000000"]) {
        expect(schema.parse(value)).toBe(value);
      }
    },
  );

  it.each(Object.entries(LEGACY_ID_SCHEMAS))(
    "%s rejects anything that is not of that form",
    (_, schema) => {
      for (const value of [
        "",
        "a0000000-0000-4000-8000-00000000000",
        "a0000000000040008000000000000001",
        1,
      ]) {
        expect(schema.safeParse(value).success, String(value)).toBe(false);
      }
    },
  );
});

describe("brands", () => {
  it("keep new and old IDs, and the IDs of different entities, apart at compile time", () => {
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

    const transactionPartId = TransactionPartIdSchema.parse(UUID_V7);
    const legacyTransactionId = LegacyTransactionIdSchema.parse(UUID_V7);
    const legacyMerchantId = LegacyMerchantIdSchema.parse(UUID_V7);

    // @ts-expect-error A transaction part ID is not a transaction ID.
    const fromPart: TransactionId = transactionPartId;
    // @ts-expect-error An old transaction ID is not a new one.
    const fromLegacyTransaction: TransactionId = legacyTransactionId;
    // @ts-expect-error An old merchant ID is not an old transaction ID.
    const fromLegacyMerchant: LegacyTransactionId = legacyMerchantId;

    // The brands exist only in the types; the values are the same strings.
    expect([
      fromCategory,
      fromLegacy,
      fromLegacyCategory,
      fromString,
      fromPart,
      fromLegacyTransaction,
      fromLegacyMerchant,
    ]).toEqual(Array(7).fill(UUID_V7));
  });
});
