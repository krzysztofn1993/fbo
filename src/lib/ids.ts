// Branded identifiers: one brand per entity, and separate brands for the IDs
// of the old version, so an old ID cannot be passed where a new one is
// expected, nor an account ID where a category ID is expected.
//
// A value gets its brand where it enters: parsed by one of these schemas, or
// typed by its column in `db/schema.ts` when it comes from the database.
// Loaded by plain `node` scripts, so it imports only packages.

import { z } from "zod";

/** New IDs are UUIDv7, given by the database. */
export const AccountIdSchema = z.uuid({ version: "v7" }).brand<"AccountId">();
export type AccountId = z.infer<typeof AccountIdSchema>;

export const CategoryIdSchema = z.uuid({ version: "v7" }).brand<"CategoryId">();
export type CategoryId = z.infer<typeof CategoryIdSchema>;

export const TransactionIdSchema = z.uuid({ version: "v7" }).brand<"TransactionId">();
export type TransactionId = z.infer<typeof TransactionIdSchema>;

export const TransactionPartIdSchema = z.uuid({ version: "v7" }).brand<"TransactionPartId">();
export type TransactionPartId = z.infer<typeof TransactionPartIdSchema>;

// The old columns are of type `uuid`, which accepts any 8-4-4-4-12 hex value
// regardless of version or variant, so old IDs are checked for that form only.

export const LegacyAccountIdSchema = z.guid().brand<"LegacyAccountId">();
export type LegacyAccountId = z.infer<typeof LegacyAccountIdSchema>;

export const LegacyCategoryIdSchema = z.guid().brand<"LegacyCategoryId">();
export type LegacyCategoryId = z.infer<typeof LegacyCategoryIdSchema>;

export const LegacyTransactionIdSchema = z.guid().brand<"LegacyTransactionId">();
export type LegacyTransactionId = z.infer<typeof LegacyTransactionIdSchema>;

export const LegacyClassificationResultIdSchema = z
  .guid()
  .brand<"LegacyClassificationResultId">();
export type LegacyClassificationResultId = z.infer<typeof LegacyClassificationResultIdSchema>;

// Old IDs of records that are not migrated: they stay in the `legacy_*` tables
// without a foreign key, for the changes that move those records later.

export const LegacyMerchantIdSchema = z.guid().brand<"LegacyMerchantId">();
export type LegacyMerchantId = z.infer<typeof LegacyMerchantIdSchema>;

export const LegacyClassificationRuleIdSchema = z.guid().brand<"LegacyClassificationRuleId">();
export type LegacyClassificationRuleId = z.infer<typeof LegacyClassificationRuleIdSchema>;

export const LegacyHistoricalProposalIdSchema = z.guid().brand<"LegacyHistoricalProposalId">();
export type LegacyHistoricalProposalId = z.infer<typeof LegacyHistoricalProposalIdSchema>;

export const LegacySourceFileIdSchema = z.guid().brand<"LegacySourceFileId">();
export type LegacySourceFileId = z.infer<typeof LegacySourceFileIdSchema>;

export const LegacyImportRunIdSchema = z.guid().brand<"LegacyImportRunId">();
export type LegacyImportRunId = z.infer<typeof LegacyImportRunIdSchema>;

export const LegacyBankConnectionIdSchema = z.guid().brand<"LegacyBankConnectionId">();
export type LegacyBankConnectionId = z.infer<typeof LegacyBankConnectionIdSchema>;

export const LegacyBankSyncRunIdSchema = z.guid().brand<"LegacyBankSyncRunId">();
export type LegacyBankSyncRunId = z.infer<typeof LegacyBankSyncRunIdSchema>;
