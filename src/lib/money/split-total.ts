// Invariants: the parts of a split transaction sum exactly to the
// transaction amount, down to the smallest currency unit, and no part goes
// the other way than the transaction (an outflow is not split into an inflow
// and a larger outflow).
//
// All amounts are signed integers in minor units (for example cents) and are
// handled as bigint throughout, so no precision is lost at any magnitude.

export type InvalidSplitReason = "no-parts" | "total-mismatch" | "direction-mismatch";

export class InvalidSplitError extends Error {
  readonly reason: InvalidSplitReason;
  /** The transaction amount the parts must add up to. */
  readonly expected: bigint;
  /**
   * The sum of the parts, 0n when there are no parts; for a direction
   * mismatch, the first part that goes the other way.
   */
  readonly actual: bigint;

  constructor(reason: InvalidSplitReason, expected: bigint, actual: bigint) {
    super(
      reason === "no-parts"
        ? "A split needs at least one part"
        : reason === "total-mismatch"
          ? `Split parts sum to ${actual} but the transaction amount is ${expected}`
          : `Split part ${actual} goes the other way than the transaction amount ${expected}`,
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

/** -1n, 0n or 1n, the direction of an amount. */
function direction(amount: bigint): bigint {
  return amount > 0n ? 1n : amount < 0n ? -1n : 0n;
}

/**
 * Throws InvalidSplitError unless `parts` is non-empty and every part goes the
 * same way as `total`: a part of a positive total is zero or positive, a part
 * of a negative total is zero or negative, and every part of a zero total is
 * zero. It does not check the sum; call assertSplitTotal for that.
 */
export function assertSplitDirection(total: bigint, parts: readonly bigint[]): void {
  if (parts.length === 0) {
    throw new InvalidSplitError("no-parts", total, 0n);
  }

  const expected = direction(total);
  for (const part of parts) {
    if (part !== 0n && direction(part) !== expected) {
      throw new InvalidSplitError("direction-mismatch", total, part);
    }
  }
}
