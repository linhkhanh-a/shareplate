import { MoneyError } from './errors';

/**
 * All money in the app is an integer number of cents.
 * $12.34 is stored as 1234. Floating-point dollars are never used for math,
 * because 0.1 + 0.2 !== 0.3 in JavaScript.
 */
export type Cents = number;

export function assertCents(value: number, label = 'amount'): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError('NOT_INTEGER_CENTS', `${label} must be a whole number of cents`, {
      label,
      value,
    });
  }
}

export function assertNonNegativeCents(value: number, label = 'amount'): void {
  assertCents(value, label);
  if (value < 0) {
    throw new MoneyError('NEGATIVE_AMOUNT', `${label} cannot be negative`, { label, value });
  }
}

const AMOUNT_PATTERN = /^(-)?\$?\s*(\d{1,3}(?:,\d{3})+|\d+)?(?:\.(\d{0,2}))?$/;

/**
 * Parses what a person types ("12", "12.5", "$1,234.56", ".99") into cents
 * without ever going through a floating-point number.
 */
export function parseCents(text: string): Cents {
  const trimmed = text.trim();
  const match = AMOUNT_PATTERN.exec(trimmed);
  if (!match || (match[2] === undefined && !match[3])) {
    throw new MoneyError('INVALID_AMOUNT_TEXT', `"${text}" is not a valid amount`, { text });
  }
  const [, minus, wholePart = '0', fractionPart = ''] = match;
  const whole = Number(wholePart.replace(/,/g, ''));
  const fraction = Number(fractionPart.padEnd(2, '0'));
  const cents = whole * 100 + fraction;
  assertCents(cents);
  return minus ? -cents : cents;
}

/** Formats cents for display: 123456 -> "$1,234.56", -500 -> "-$5.00". */
export function formatCents(cents: Cents, currencySymbol = '$'): string {
  assertCents(cents);
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (abs % 100).toString().padStart(2, '0');
  return `${sign}${currencySymbol}${whole}.${fraction}`;
}

export function sumCents(values: readonly Cents[]): Cents {
  let total = 0;
  for (const v of values) {
    assertCents(v);
    total += v;
  }
  assertCents(total, 'total');
  return total;
}
