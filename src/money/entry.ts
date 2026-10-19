import { formatCents, parseCents, type Cents } from './cents';

/**
 * Turning what people type into amounts. People type "12.345", "$1,234.5",
 * "12,50" or "1.234,56"; the app accepts all of them and rounds to the cent
 * once, as they leave the box, so the screen always shows what gets saved.
 */

/**
 * Cleans up a typed amount: "12.345" -> "12.35", "$1,234.5" -> "1234.50",
 * "12,50" -> "12.50", "1.234,56" -> "1234.56", "" -> "". Returns null when
 * it can't be read as an amount at all. Rounds half up, using whole-number
 * math on the digits (never floating point).
 */
export function normalizeMoneyText(text: string): string | null {
  // Currency signs, letters and spaces don't matter: "CHF 12", "12 €", "$ 5".
  const raw = text.replace(/[^\d.,-]/g, '');
  if (!raw) return text.trim() ? null : '';
  if (raw.includes('-')) return null;

  let whole: string;
  let fraction = '';
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Both: whichever comes last is the decimal point ("1,234.56" or "1.234,56").
    const point = Math.max(lastDot, lastComma);
    whole = raw.slice(0, point).replace(/[.,]/g, '');
    fraction = raw.slice(point + 1);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = raw.split(sep);
    const groupsOfThree = parts.length > 1 && parts.slice(1).every((p) => p.length === 3) && parts[0].length > 0;
    if (parts.length > 2 && !groupsOfThree) return null;
    if (sep === ',' && groupsOfThree) {
      // "1,234" or "1,234,567": thousands.
      whole = parts.join('');
    } else if (sep === '.' && parts.length > 2) {
      // "1.234.567": thousands, the European way.
      whole = parts.join('');
    } else {
      // One separator: a decimal point ("12.5", "12,50", "12.345").
      whole = parts[0];
      fraction = parts[1] ?? '';
    }
  } else {
    whole = raw;
  }
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction) || (!whole && !fraction)) return null;

  // Round to the cent from the third decimal digit, half up.
  let cents = BigInt(whole || '0') * 100n + BigInt((fraction.slice(0, 2) || '0').padEnd(2, '0'));
  if (fraction.length > 2 && Number(fraction[2]) >= 5) cents += 1n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return centsToText(Number(cents));
}

/** Reads a typed amount leniently (see normalizeMoneyText). Throws if it isn't an amount. */
export function parseMoneyText(text: string): Cents {
  const normal = normalizeMoneyText(text);
  if (normal === null || normal === '') return parseCents(text);
  return parseCents(normal);
}

/** Cents as plain text for an input box: 123450 -> "1234.50". */
export function centsToText(cents: Cents): string {
  return formatCents(cents, '').replace(/,/g, '');
}

/**
 * Cleans up a typed percentage: "12,5" -> "12.5", "33.333" -> "33.33",
 * "10%" -> "10". Returns null when it isn't a percentage.
 */
export function normalizePercentText(text: string): string | null {
  const raw = text.replace(/[%\s]/g, '').replace(',', '.');
  if (!raw) return '';
  const m = /^(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!m || (!m[1] && !m[2])) return null;
  let bp = BigInt(m[1] || '0') * 100n + BigInt(((m[2] ?? '').slice(0, 2) || '0').padEnd(2, '0'));
  if ((m[2] ?? '').length > 2 && Number(m[2][2]) >= 5) bp += 1n;
  const whole = bp / 100n;
  const frac = bp % 100n;
  return frac === 0n ? `${whole}` : `${whole}.${frac.toString().padStart(2, '0').replace(/0$/, '')}`;
}

// ---------------------------------------------------------------------------
// Currency (display only: amounts are never converted)
// ---------------------------------------------------------------------------

/** Currencies with cents (two decimal places), which is how the app counts. */
export const CURRENCIES = [
  { code: 'USD', symbol: '$', name: 'US dollar' },
  { code: 'EUR', symbol: '€', name: 'Euro' },
  { code: 'GBP', symbol: '£', name: 'British pound' },
  { code: 'CHF', symbol: 'CHF ', name: 'Swiss franc' },
  { code: 'CAD', symbol: 'CA$', name: 'Canadian dollar' },
  { code: 'AUD', symbol: 'A$', name: 'Australian dollar' },
  { code: 'NZD', symbol: 'NZ$', name: 'New Zealand dollar' },
  { code: 'SGD', symbol: 'S$', name: 'Singapore dollar' },
  { code: 'HKD', symbol: 'HK$', name: 'Hong Kong dollar' },
  { code: 'MXN', symbol: 'MX$', name: 'Mexican peso' },
  { code: 'THB', symbol: '฿', name: 'Thai baht' },
  { code: 'PHP', symbol: '₱', name: 'Philippine peso' },
  { code: 'MYR', symbol: 'RM', name: 'Malaysian ringgit' },
  { code: 'CNY', symbol: 'CN¥', name: 'Chinese yuan' },
  { code: 'INR', symbol: '₹', name: 'Indian rupee' },
] as const;

export type CurrencyCode = (typeof CURRENCIES)[number]['code'];

export function currencySymbolFor(code: string | null | undefined): string {
  return CURRENCIES.find((c) => c.code === code)?.symbol ?? '$';
}

/**
 * Currencies a bill can be paid in (and converted from). Some have no cents
 * in daily use (yen, won, dong): there, "1.200" means one thousand two
 * hundred, and amounts show without decimals.
 */
export const PAID_CURRENCIES: { code: string; symbol: string; name: string; decimals: 0 | 2 }[] = [
  ...CURRENCIES.map((c) => ({ ...c, decimals: 2 as const })),
  { code: 'JPY', symbol: '¥', name: 'Japanese yen', decimals: 0 },
  { code: 'KRW', symbol: '₩', name: 'South Korean won', decimals: 0 },
  { code: 'VND', symbol: '₫', name: 'Vietnamese dong', decimals: 0 },
  { code: 'IDR', symbol: 'Rp', name: 'Indonesian rupiah', decimals: 0 },
  { code: 'TWD', symbol: 'NT$', name: 'New Taiwan dollar', decimals: 0 },
  { code: 'HUF', symbol: 'Ft ', name: 'Hungarian forint', decimals: 0 },
  { code: 'SEK', symbol: 'kr ', name: 'Swedish krona', decimals: 2 },
  { code: 'NOK', symbol: 'kr ', name: 'Norwegian krone', decimals: 2 },
  { code: 'DKK', symbol: 'kr ', name: 'Danish krone', decimals: 2 },
  { code: 'PLN', symbol: 'zł ', name: 'Polish złoty', decimals: 2 },
  { code: 'CZK', symbol: 'Kč ', name: 'Czech koruna', decimals: 2 },
  { code: 'TRY', symbol: '₺', name: 'Turkish lira', decimals: 2 },
  { code: 'BRL', symbol: 'R$', name: 'Brazilian real', decimals: 2 },
  { code: 'ZAR', symbol: 'R ', name: 'South African rand', decimals: 2 },
  { code: 'AED', symbol: 'AED ', name: 'UAE dirham', decimals: 2 },
];

export function paidCurrency(code: string | null | undefined) {
  return PAID_CURRENCIES.find((c) => c.code === code) ?? null;
}

/** An amount in a given currency, e.g. "CHF 54.50", "¥1,200", "₫150,000". */
export function formatIn(cents: Cents, code: string): string {
  const c = paidCurrency(code);
  if (!c) return formatCents(cents, `${code} `);
  if (c.decimals === 2) return formatCents(cents, c.symbol);
  const whole = Math.round(Math.abs(cents) / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${cents < 0 ? '-' : ''}${c.symbol}${whole}`;
}

/**
 * Cleans up an amount typed in a given currency. Without cents, every dot or
 * comma is a thousands separator ("1.200" is 1200) and the result is whole.
 */
export function normalizeAmountIn(text: string, code: string | null): string | null {
  const c = code ? paidCurrency(code) : null;
  if (!c || c.decimals === 2) return normalizeMoneyText(text);
  const raw = text.replace(/[^\d.,-]/g, '');
  if (!raw) return text.trim() ? null : '';
  if (raw.includes('-') || !/^\d[\d.,]*$/.test(raw)) return null;
  return String(Number(raw.replace(/[.,]/g, '')));
}
