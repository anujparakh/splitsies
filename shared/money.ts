/**
 * Conversion between integer cents (how money is stored and computed) and
 * dollar strings (how money is typed and displayed).
 *
 * Shared by the Worker and the client so that a value parsed from the expense
 * form and a value rendered in the activity feed can never disagree.
 */

/** $1,000,000 in cents. An upper bound on a plausible shared expense. */
export const MAX_AMOUNT_CENTS = 100_000_000;

/**
 * Parses user input into integer cents.
 *
 * Tolerates what people actually type: a leading `$`, thousands separators,
 * a bare `.50`, or a whole number with no decimal point. Rejects anything
 * with more than two decimal places rather than rounding it, because silently
 * turning `10.999` into `$11.00` is worse than asking the user to retype it.
 *
 * @returns cents, or `null` if the input is not a valid non-negative amount.
 */
export function parseDollarsToCents(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, "").replace(/,/g, "");

  // Digits, then at most one dot with at most two digits after it.
  if (!/^\d*(?:\.\d{0,2})?$/.test(cleaned)) return null;
  // Rejects "", ".", and "$" alone, all of which pass the regex above.
  if (!/\d/.test(cleaned)) return null;

  const [whole, frac = ""] = cleaned.split(".");
  const cents = Number(whole || "0") * 100 + Number(frac.padEnd(2, "0"));

  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * Formats cents as a dollar amount with no currency symbol: `1234.56`.
 * Negative inputs keep their sign.
 */
export function formatCentsPlain(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Formats cents for display: `$1,234.56`, or `-$1,234.56` when negative.
 *
 * The sign precedes the symbol because `$-5.00` reads as a typo.
 */
export function formatUsd(cents: number): string {
  const abs = Math.abs(cents);
  const sign = cents < 0 ? "-" : "";
  const dollars = Math.floor(abs / 100).toLocaleString("en-US");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}
