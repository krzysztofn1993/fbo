import { describe, expect, it } from "vitest";

import { formatAmount } from "@/lib/money/format";

// Polish groups digits and separates the currency with a no-break space.
const NBSP = " ";

describe("formatAmount", () => {
  it("groups a four-digit negative amount with no-break spaces", () => {
    expect(formatAmount(-123456n, "PLN")).toBe(`-1${NBSP}234,56${NBSP}zł`);
  });

  it("keeps the leading zero of amounts below one unit", () => {
    expect(formatAmount(5n, "PLN")).toBe(`0,05${NBSP}zł`);
    expect(formatAmount(-99n, "PLN")).toBe(`-0,99${NBSP}zł`);
    expect(formatAmount(10n, "PLN")).toBe(`0,10${NBSP}zł`);
  });

  it("formats zero without a sign", () => {
    expect(formatAmount(0n, "PLN")).toBe(`0,00${NBSP}zł`);
  });

  it("keeps every digit of an amount beyond Number.MAX_SAFE_INTEGER", () => {
    const amount = BigInt(Number.MAX_SAFE_INTEGER) * 100n + 1n;
    expect(formatAmount(amount, "PLN")).toBe(
      ["9", "007", "199", "254", "740", "991"].join(NBSP) + `,01${NBSP}zł`,
    );
    expect(formatAmount(-amount, "PLN")).toBe(
      "-" + ["9", "007", "199", "254", "740", "991"].join(NBSP) + `,01${NBSP}zł`,
    );
  });

  it("uses the symbol and decimal places of another currency", () => {
    expect(formatAmount(123456n, "EUR")).toBe(`1${NBSP}234,56${NBSP}€`);
    // The yen has no minor unit and the dinar three decimal places.
    expect(formatAmount(-1234n, "JPY")).toBe(`-1${NBSP}234${NBSP}JPY`);
    expect(formatAmount(1234567n, "KWD")).toBe(`1${NBSP}234,567${NBSP}KWD`);
  });
});
