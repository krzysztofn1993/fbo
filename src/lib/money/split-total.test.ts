import { describe, expect, it } from "vitest";

import { assertSplitDirection, assertSplitTotal, InvalidSplitError } from "@/lib/money/split-total";

// Runs the assertion and returns the error it throws, failing the test if it
// does not throw an InvalidSplitError.
function captureError(total: bigint, parts: readonly bigint[]): InvalidSplitError {
  try {
    assertSplitTotal(total, parts);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidSplitError);
    return error as InvalidSplitError;
  }
  throw new Error("expected assertSplitTotal to throw");
}

describe("assertSplitTotal", () => {
  it("accepts a zero total split into a single zero part", () => {
    expect(() => assertSplitTotal(0n, [0n])).not.toThrow();
  });

  it("accepts positive parts that sum exactly to the total", () => {
    expect(() => assertSplitTotal(10000n, [2500n, 7500n])).not.toThrow();
  });

  it("accepts negative parts that sum exactly to a negative total", () => {
    expect(() => assertSplitTotal(-4200n, [-1200n, -3000n])).not.toThrow();
  });

  it("rejects parts that fall short of the total by one unit", () => {
    const error = captureError(10000n, [2500n, 7499n]);
    expect(error.name).toBe("InvalidSplitError");
    expect(error.reason).toBe("total-mismatch");
    expect(error.expected).toBe(10000n);
    expect(error.actual).toBe(9999n);
  });

  it("rejects parts that exceed the total by one unit", () => {
    const error = captureError(10000n, [2500n, 7501n]);
    expect(error.reason).toBe("total-mismatch");
    expect(error.expected).toBe(10000n);
    expect(error.actual).toBe(10001n);
  });

  it("sums amounts above Number.MAX_SAFE_INTEGER exactly", () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
    expect(() => assertSplitTotal(big * 2n, [big, big])).not.toThrow();

    // A single-unit difference at this magnitude is still detected.
    const error = captureError(big * 2n, [big, big + 1n]);
    expect(error.reason).toBe("total-mismatch");
    expect(error.expected).toBe(big * 2n);
    expect(error.actual).toBe(big * 2n + 1n);
  });

  it("rejects an empty parts list even when the total is zero", () => {
    const error = captureError(0n, []);
    expect(error.reason).toBe("no-parts");
    expect(error.expected).toBe(0n);
    expect(error.actual).toBe(0n);
  });
});

// Runs the direction check and returns the error it throws, failing the test
// if it does not throw an InvalidSplitError.
function captureDirectionError(total: bigint, parts: readonly bigint[]): InvalidSplitError {
  try {
    assertSplitDirection(total, parts);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidSplitError);
    return error as InvalidSplitError;
  }
  throw new Error("expected assertSplitDirection to throw");
}

describe("assertSplitDirection", () => {
  it("accepts parts of an inflow that are all positive", () => {
    expect(() => assertSplitDirection(100n, [60n, 40n])).not.toThrow();
  });

  it("accepts parts of an outflow that are all negative", () => {
    expect(() => assertSplitDirection(-100n, [-60n, -40n])).not.toThrow();
  });

  it("accepts a zero part next to parts that go the way of the total", () => {
    expect(() => assertSplitDirection(-100n, [-100n, 0n])).not.toThrow();
    expect(() => assertSplitDirection(0n, [0n])).not.toThrow();
  });

  it("rejects a negative part of an inflow even when the parts sum to it", () => {
    expect(() => assertSplitTotal(100n, [140n, -40n])).not.toThrow();
    const error = captureDirectionError(100n, [140n, -40n]);
    expect(error.name).toBe("InvalidSplitError");
    expect(error.reason).toBe("direction-mismatch");
    expect(error.expected).toBe(100n);
    expect(error.actual).toBe(-40n);
  });

  it("rejects a positive part of an outflow and reports the first such part", () => {
    const error = captureDirectionError(-100n, [-160n, 25n, 35n]);
    expect(error.reason).toBe("direction-mismatch");
    expect(error.actual).toBe(25n);
  });

  it("rejects non-zero parts of a zero total", () => {
    const error = captureDirectionError(0n, [5n, -5n]);
    expect(error.reason).toBe("direction-mismatch");
    expect(error.actual).toBe(5n);
  });

  it("compares directions above Number.MAX_SAFE_INTEGER exactly", () => {
    const big = BigInt(Number.MAX_SAFE_INTEGER) + 2n;
    expect(() => assertSplitDirection(-big, [-big - 1n, 1n])).toThrow(InvalidSplitError);
    expect(() => assertSplitDirection(-big, [-big + 1n, -1n])).not.toThrow();
  });

  it("rejects an empty parts list", () => {
    const error = captureDirectionError(-100n, []);
    expect(error.reason).toBe("no-parts");
  });
});
