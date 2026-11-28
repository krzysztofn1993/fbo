// Classification state of a transaction, derived from its parts and never
// stored: the one rule behind the migration report and the transaction list.
//
// Loaded by plain `node` scripts, so it imports nothing but relative `.ts`
// paths and uses erasable TypeScript only.

export const CLASSIFICATION_STATES = ["unclassified", "needs_review", "approved"] as const;
export type ClassificationState = (typeof CLASSIFICATION_STATES)[number];

/** What the rule needs of a part: its amount in minor units and whether it is approved. */
export type ClassifiedPart = { amountMinor: bigint; approved: boolean };

/**
 * `unclassified` without parts; `needs_review` when the parts do not sum to
 * the amount exactly or any part is not approved; `approved` otherwise.
 */
export function classificationState(
  amountMinor: bigint,
  parts: readonly ClassifiedPart[],
): ClassificationState {
  if (parts.length === 0) {
    return "unclassified";
  }
  let total = 0n;
  for (const part of parts) {
    if (!part.approved) {
      return "needs_review";
    }
    total += part.amountMinor;
  }
  return total === amountMinor ? "approved" : "needs_review";
}
