// Invariant: the parts of a split transaction sum exactly to the
// transaction amount, down to the smallest currency unit.
//
// All amounts are signed integers in minor units (for example cents) and are
// handled as bigint throughout, so no precision is lost at any magnitude.

export type InvalidSplitReason = "no-parts" | "total-mismatch";

export class InvalidSplitError extends Error {
  readonly reason: InvalidSplitReason;
  /** The transaction amount the parts must add up to. */
  readonly expected: bigint;
  /** The sum of the parts; 0n when there are no parts. */
  readonly actual: bigint;

  constructor(reason: InvalidSplitReason, expected: bigint, actual: bigint) {
    super(
      reason === "no-parts"
        ? "A split needs at least one part"
        : `Split parts sum to ${actual} but the transaction amount is ${expected}`,
    );
    this.name = "InvalidSplitError";
    this.reason = reason;
    this.expected = expected;
    this.actual = actual;
  }
}

/**
 * Throws InvalidSplitError unless `parts` is non-empty and sums exactly to
 * `total`. An empty list is rejected even for a zero total: a transaction
 * without parts is unclassified, not split.
 */
export function assertSplitTotal(total: bigint, parts: readonly bigint[]): void {
  if (parts.length === 0) {
    throw new InvalidSplitError("no-parts", total, 0n);
  }

  let sum = 0n;
  for (const part of parts) {
    sum += part;
  }

  if (sum !== total) {
    throw new InvalidSplitError("total-mismatch", total, sum);
  }
}
