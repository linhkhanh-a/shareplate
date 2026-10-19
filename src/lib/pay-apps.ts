import type { Cents } from '@/money';

/**
 * Venmo, PayPal and Cash App, next to Zelle, as places to send someone
 * money. Shareplate only shows them and opens a link with the amount filled
 * in; it never sees an account or moves money.
 */

export type PayApp = 'venmo' | 'paypal' | 'cashapp';

export const PAY_APPS: { app: PayApp; name: string; field: 'venmo_username' | 'paypal_username' | 'cashapp_cashtag'; prefix: string }[] = [
  { app: 'venmo', name: 'Venmo', field: 'venmo_username', prefix: '@' },
  { app: 'paypal', name: 'PayPal', field: 'paypal_username', prefix: 'paypal.me/' },
  { app: 'cashapp', name: 'Cash App', field: 'cashapp_cashtag', prefix: '$' },
];

export interface PayHandles {
  venmo_username?: string | null;
  paypal_username?: string | null;
  cashapp_cashtag?: string | null;
}

export type HandleCheck = { ok: true; value: string | null } | { ok: false; message: string };

/** The part after a site's address in a pasted link: "https://venmo.com/u/an-ng" -> "an-ng". */
function afterSite(text: string, sites: RegExp): string {
  const t = text.trim().replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  const m = sites.exec(t);
  if (!m) return t;
  return t.slice(m[0].length).split(/[/?#]/)[0];
}

/**
 * Cleans up what someone typed or pasted as their username: drops the @ or
 * $, and takes the name out of a profile link. Blank is fine (not set).
 */
export function checkHandle(app: PayApp, text: string): HandleCheck {
  if (!text.trim()) return { ok: true, value: null };
  if (app === 'venmo') {
    const v = afterSite(text, /^(account\.)?venmo\.com\/(u\/)?/i).replace(/^@/, '');
    return /^[A-Za-z0-9_-]{1,30}$/.test(v)
      ? { ok: true, value: v }
      : { ok: false, message: 'A Venmo username has letters, numbers, - and _ only, like @An-Nguyen.' };
  }
  if (app === 'paypal') {
    const v = afterSite(text, /^(paypal\.me\/|paypal\.com\/paypalme\/)/i).replace(/^@/, '');
    return /^[A-Za-z0-9]{1,30}$/.test(v)
      ? { ok: true, value: v }
      : { ok: false, message: 'Your PayPal.Me name is the part after paypal.me/, letters and numbers only.' };
  }
  const v = afterSite(text, /^(cash\.app|cash\.me)\//i).replace(/^\$/, '');
  return /^[A-Za-z0-9_-]{1,30}$/.test(v) && /[A-Za-z]/.test(v)
    ? { ok: true, value: v }
    : { ok: false, message: 'A $Cashtag has letters and numbers, like $AnNguyen.' };
}

/** How a username is shown: "@an-ng", "paypal.me/anng", "$anng". */
export function showHandle(app: PayApp, value: string): string {
  return `${PAY_APPS.find((a) => a.app === app)!.prefix}${value}`;
}

export interface PayOption {
  app: PayApp;
  name: string;
  handle: string;
  url: string;
  /** Whether the link fills in the amount (Venmo and Cash App only take US dollars). */
  withAmount: boolean;
}

/** "12.34" from 1234 cents, for links. */
function plainAmount(cents: Cents): string {
  return `${Math.trunc(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

/**
 * Links that open each app ready to pay: Venmo and Cash App with the amount
 * (in US dollars only, which is all they send), PayPal with the amount in
 * the trip's currency. A note says what it's for.
 */
export function payOptions(handles: PayHandles | null | undefined, amountCents: Cents, currency: string, note: string): PayOption[] {
  if (!handles) return [];
  const usd = currency === 'USD' && amountCents > 0;
  const amount = plainAmount(Math.max(0, amountCents));
  const out: PayOption[] = [];
  const venmo = handles.venmo_username;
  if (venmo) {
    // Spaces as %20, not +, which Venmo would show in the note.
    const q = [['txn', 'pay'], ['recipients', venmo], ...(usd ? [['amount', amount]] : []), ['note', note]]
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&');
    out.push({ app: 'venmo', name: 'Venmo', handle: showHandle('venmo', venmo), url: `https://venmo.com/?${q}`, withAmount: usd });
  }
  const paypal = handles.paypal_username;
  if (paypal) {
    const withAmount = amountCents > 0;
    out.push({
      app: 'paypal',
      name: 'PayPal',
      handle: showHandle('paypal', paypal),
      url: `https://paypal.me/${encodeURIComponent(paypal)}${withAmount ? `/${amount}${currency}` : ''}`,
      withAmount,
    });
  }
  const cash = handles.cashapp_cashtag;
  if (cash) {
    out.push({
      app: 'cashapp',
      name: 'Cash App',
      handle: showHandle('cashapp', cash),
      url: `https://cash.app/$${encodeURIComponent(cash)}${usd ? `/${amount}` : ''}`,
      withAmount: usd,
    });
  }
  return out;
}

/** Every way to pay someone, for a message: "Zelle: an@x.com, Venmo: @an-ng". */
export function payNote(zelle: string | null, handles: PayHandles | null | undefined): string {
  const parts: string[] = [];
  if (zelle) parts.push(`Zelle: ${zelle}`);
  for (const a of PAY_APPS) {
    const v = handles?.[a.field];
    if (v) parts.push(`${a.name}: ${showHandle(a.app, v)}`);
  }
  return parts.join(', ');
}

/** Whether someone has any way to be paid saved. */
export function hasPayInfo(zelle: string | null, handles: PayHandles | null | undefined): boolean {
  return !!zelle || PAY_APPS.some((a) => !!handles?.[a.field]);
}

/** The names shown for a recorded payment's app. */
export const METHOD_NAMES: Record<string, string> = {
  zelle: 'Zelle',
  venmo: 'Venmo',
  paypal: 'PayPal',
  cashapp: 'Cash App',
  cash: 'Cash',
};
