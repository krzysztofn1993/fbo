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

// The old columns are of type `uuid`, which accepts any 8-4-4-4-12 hex value
// regardless of version or variant, so old IDs are checked for that form only.

export const LegacyAccountIdSchema = z.guid().brand<"LegacyAccountId">();
export type LegacyAccountId = z.infer<typeof LegacyAccountIdSchema>;

export const LegacyCategoryIdSchema = z.guid().brand<"LegacyCategoryId">();
export type LegacyCategoryId = z.infer<typeof LegacyCategoryIdSchema>;
