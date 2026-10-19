import { allocate } from './allocate';
import { assertCents, type Cents } from './cents';
import { MoneyError } from './errors';

/**
 * Converting a bill paid in another currency into the trip's currency.
 * Amounts are hundredths of a unit in both currencies (¥1,200 is 120000, like
 * $12.00 is 1200), so the same rounding rules apply everywhere. A rate is how
 * much of the trip's currency one unit of the bill's currency is worth.
 */

const SCALE = 1_000_000_000n; // rates are kept to 9 decimal places

/** A rate as an exact scaled integer: 1.1235 -> 1123500000n. */
export function scaledRate(rate: number | string): bigint {
  const text = typeof rate === 'number' ? rate.toFixed(9) : rate.trim();
  const m = /^(\d+)(?:\.(\d*))?$/.exec(text);
  if (!m) throw new MoneyError('INVALID_AMOUNT_TEXT', `"${rate}" is not a valid exchange rate`, { rate });
  const scaled = BigInt(m[1]) * SCALE + BigInt((m[2] ?? '').slice(0, 9).padEnd(9, '0'));
  if (scaled <= 0n) throw new MoneyError('INVALID_AMOUNT_TEXT', 'An exchange rate must be above 0', { rate });
  return scaled;
}

/** One amount, converted and rounded to the cent, half up. */
export function convertCents(cents: Cents, rate: number | string): Cents {
  assertCents(cents);
  const r = scaledRate(rate);
  const sign = cents < 0 ? -1n : 1n;
  const abs = BigInt(Math.abs(cents));
  return Number((sign * (abs * r + SCALE / 2n)) / SCALE);
}

/**
 * A split converted: the total is converted once, then shared out in
 * proportion to the original shares, so the shares still add up exactly.
 */
export function convertShares(originalShares: readonly Cents[], rate: number | string): { total: Cents; shares: Cents[] } {
  const originalTotal = originalShares.reduce((a, b) => a + b, 0);
  const total = convertCents(originalTotal, rate);
  if (originalTotal === 0) return { total, shares: originalShares.map(() => 0) };
  return { total, shares: allocate(total, originalShares) };
}

export interface ConvertedMember {
  memberId: string;
  itemsCents: Cents;
  discountCents: Cents;
  taxCents: Cents;
  tipCents: Cents;
  totalCents: Cents;
}

/** Shares out a converted amount like the original was shared, or zeros when there was none. */
function spread(total: Cents, originals: readonly Cents[]): Cents[] {
  const sum = originals.reduce((a, b) => a + b, 0);
  return sum === 0 || total === 0 ? originals.map(() => 0) : allocate(total, originals);
}

/**
 * A bill by item, converted. Each item price and the discount, tax and tip
 * are converted on their own (that's what the bill shows), and each person's
 * part of each is shared out like before, so everything still adds up:
 * items − discount + tax + tip = total, for the bill and for each person.
 */
export function convertItemized(
  input: {
    itemPrices: readonly Cents[];
    discountCents: Cents;
    taxCents: Cents;
    tipCents: Cents;
    members: readonly { memberId: string; itemsCents: Cents; discountCents: Cents; taxCents: Cents; tipCents: Cents }[];
  },
  rate: number | string,
): { itemPrices: Cents[]; discountCents: Cents; taxCents: Cents; tipCents: Cents; totalCents: Cents; members: ConvertedMember[] } {
  const itemPrices = input.itemPrices.map((p) => convertCents(p, rate));
  const subtotal = itemPrices.reduce((a, b) => a + b, 0);
  const discountCents = convertCents(input.discountCents, rate);
  const taxCents = convertCents(input.taxCents, rate);
  const tipCents = convertCents(input.tipCents, rate);
  const items = spread(subtotal, input.members.map((m) => m.itemsCents));
  const discounts = spread(discountCents, input.members.map((m) => m.discountCents));
  const taxes = spread(taxCents, input.members.map((m) => m.taxCents));
  const tips = spread(tipCents, input.members.map((m) => m.tipCents));
  const members = input.members.map((m, i) => ({
    memberId: m.memberId,
    itemsCents: items[i],
    discountCents: discounts[i],
    taxCents: taxes[i],
    tipCents: tips[i],
    totalCents: items[i] - discounts[i] + taxes[i] + tips[i],
  }));
  return { itemPrices, discountCents, taxCents, tipCents, totalCents: subtotal - discountCents + taxCents + tipCents, members };
}

/** A rate for showing: "1.1235", "0.006734", "25,370". */
export function formatRate(rate: number): string {
  if (rate >= 100) return rate.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (rate >= 1) return String(Number(rate.toFixed(4)));
  return String(Number(rate.toPrecision(4)));
}
