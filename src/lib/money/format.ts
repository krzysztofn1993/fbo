// Formats an amount in minor units for display, in Polish.
//
// The amount stays a bigint all the way: it becomes an exact decimal string
// that `Intl.NumberFormat` formats without converting it to a `number`, so no
// precision is lost at any magnitude. Imports nothing, so plain `node` scripts
// and tests can load it.

const formatters = new Map<string, Intl.NumberFormat>();

function formatterFor(currency: string): Intl.NumberFormat {
  let formatter = formatters.get(currency);
  if (formatter === undefined) {
    // The Polish default leaves four-digit numbers ungrouped ("1234,56 zł").
    formatter = new Intl.NumberFormat("pl-PL", { style: "currency", currency, useGrouping: "always" });
    formatters.set(currency, formatter);
  }
  return formatter;
}

/**
 * `amountMinor` in the smallest unit of `currency` (an ISO 4217 code), for
 * example `-123456n` PLN → "-1 234,56 zł". Groups and the space before the
 * currency are U+00A0. The number of decimal places is the one of the
 * currency.
 */
export function formatAmount(amountMinor: bigint, currency: string): string {
  const formatter = formatterFor(currency);
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2;

  const negative = amountMinor < 0n;
  const magnitude = (negative ? -amountMinor : amountMinor).toString().padStart(digits + 1, "0");
  const whole = magnitude.slice(0, magnitude.length - digits);
  const fraction = magnitude.slice(magnitude.length - digits);
  const decimal = `${negative ? "-" : ""}${whole}${digits > 0 ? `.${fraction}` : ""}`;

  // The string is an exact decimal numeral; the overload for it keeps every digit.
  return formatter.format(decimal as Intl.StringNumericLiteral);
}
