import {
  allocate,
  centsToText,
  convertCents,
  convertShares,
  computeBalances,
  FULL_PERCENT_BP,
  formatCents,
  normalizePercentText,
  parseMoneyText,
  parsePercentToBasisPoints,
  simplifyDebts,
  splitByPercent,
  splitEqual,
  splitExact,
  type Balances,
  type Cents,
  type Transfer,
} from '@/money';

import type { Bill, Payment } from '@/lib/queries';

export type ManualMode = 'equal' | 'percent' | 'exact';

export interface SplitRow {
  memberId: string;
  included: boolean;
  /** What was typed: a percentage ("33.33") or an amount ("12.50"). Unused for equal splits. */
  input: string;
}

export interface ComputedShare {
  memberId: string;
  amountCents: Cents;
  /** Basis points for percent splits, cents for exact splits, null for equal. */
  shareInput: number | null;
}

export type SplitResult =
  | { ok: true; shares: ComputedShare[]; status: string; auto: Record<string, string> }
  | { ok: false; message: string; status: string; auto: Record<string, string> };

/**
 * Works out everyone's share as the bill is being typed, using the money
 * engine, and explains what's missing when the numbers don't add up yet.
 *
 * In "By percent" and "Exact amounts", anyone left blank gets the rest
 * automatically (split equally if several are blank, to the exact cent or
 * hundredth of a percent). `auto` holds what was filled in, by person, so the
 * screen can show it in grey.
 */
export function computeSplit(
  mode: ManualMode,
  totalText: string,
  rows: SplitRow[],
  /** How amounts are written in the messages: the trip's currency, or the one the bill was paid in. */
  fmt: (cents: Cents) => string = formatCents,
): SplitResult {
  const none = {} as Record<string, string>;
  let total: Cents;
  try {
    total = parseMoneyText(totalText || '0');
  } catch {
    return { ok: false, message: 'Enter the bill amount, like 42.50.', status: '', auto: none };
  }
  if (total <= 0) return { ok: false, message: 'Enter the bill amount, like 42.50.', status: '', auto: none };

  const included = rows.filter((r) => r.included);
  if (included.length === 0) return { ok: false, message: 'Choose who is splitting this bill.', status: '', auto: none };

  if (mode === 'equal') {
    const shares = splitEqual(
      total,
      included.map((r) => r.memberId),
    );
    return {
      ok: true,
      shares: shares.map((s) => ({ ...s, shareInput: null })),
      status: `${fmt(total)} split ${included.length} ${included.length === 1 ? 'way' : 'ways'}`,
      auto: none,
    };
  }

  const typed = included.filter((r) => r.input.trim());
  const blank = included.filter((r) => !r.input.trim());

  if (mode === 'percent') {
    const values = new Map<string, number>();
    let sum = 0;
    for (const r of typed) {
      const normal = normalizePercentText(r.input);
      let bp: number;
      try {
        if (normal === null) throw new Error('bad');
        bp = parsePercentToBasisPoints(normal || '0');
      } catch {
        return { ok: false, message: 'Enter each percentage like 25 or 33.33.', status: '', auto: none };
      }
      sum += bp;
      values.set(r.memberId, bp);
    }
    const left = FULL_PERCENT_BP - sum;
    const auto: Record<string, string> = {};
    if (blank.length > 0 && left >= 0) {
      const parts = allocate(
        left,
        blank.map(() => 1),
      );
      blank.forEach((r, i) => {
        values.set(r.memberId, parts[i]);
        auto[r.memberId] = formatPercent(parts[i]).replace('%', '');
      });
    }
    const assigned = [...values.values()].reduce((a, b) => a + b, 0);
    const status = blank.length > 0 && left >= 0 ? `${formatPercent(sum)} typed, the rest filled in` : `${formatPercent(assigned)} of 100%`;
    if (assigned !== FULL_PERCENT_BP) {
      const diff = FULL_PERCENT_BP - assigned;
      return {
        ok: false,
        message: diff > 0 ? `${formatPercent(diff)} left to assign.` : `Over by ${formatPercent(-diff)}.`,
        status,
        auto,
      };
    }
    const inputs = included.map((r) => ({ memberId: r.memberId, basisPoints: values.get(r.memberId)! }));
    const shares = splitByPercent(total, inputs);
    return { ok: true, shares: shares.map((s, i) => ({ ...s, shareInput: inputs[i].basisPoints })), status, auto };
  }

  // Exact amounts
  const values = new Map<string, Cents>();
  let sum = 0;
  for (const r of typed) {
    try {
      const cents = parseMoneyText(r.input);
      if (cents < 0) throw new Error('negative');
      sum += cents;
      values.set(r.memberId, cents);
    } catch {
      return { ok: false, message: 'Enter each amount like 12.50.', status: '', auto: none };
    }
  }
  const left = total - sum;
  const auto: Record<string, string> = {};
  if (blank.length > 0 && left >= 0) {
    const parts = allocate(
      left,
      blank.map(() => 1),
    );
    blank.forEach((r, i) => {
      values.set(r.memberId, parts[i]);
      auto[r.memberId] = centsToText(parts[i]);
    });
  }
  const assigned = [...values.values()].reduce((a, b) => a + b, 0);
  const status = blank.length > 0 && left >= 0 ? `${fmt(sum)} typed, the rest filled in` : `${fmt(assigned)} of ${fmt(total)}`;
  if (assigned !== total) {
    const diff = total - assigned;
    return {
      ok: false,
      message: diff > 0 ? `${fmt(diff)} left to assign.` : `Over by ${fmt(-diff)}.`,
      status,
      auto,
    };
  }
  const shares = splitExact(
    total,
    included.map((r) => ({ memberId: r.memberId, amountCents: values.get(r.memberId)! })),
  );
  return { ok: true, shares: shares.map((s) => ({ ...s, shareInput: s.amountCents })), status, auto };
}

/**
 * A split typed in another currency, converted to the trip's: equal and
 * percent splits are worked out again on the converted total (so equal stays
 * equal), exact amounts are shared out in proportion. Shares always add up to
 * the converted total.
 */
export function convertSplit(mode: ManualMode, shares: ComputedShare[], rate: number | string): ComputedShare[] {
  const total = convertCents(
    shares.reduce((s, x) => s + x.amountCents, 0),
    rate,
  );
  if (mode === 'equal') {
    return splitEqual(
      total,
      shares.map((s) => s.memberId),
    ).map((s) => ({ ...s, shareInput: null }));
  }
  if (mode === 'percent') {
    return splitByPercent(
      total,
      shares.map((s) => ({ memberId: s.memberId, basisPoints: s.shareInput ?? 0 })),
    ).map((s, i) => ({ ...s, shareInput: shares[i].shareInput }));
  }
  const converted = convertShares(
    shares.map((s) => s.amountCents),
    rate,
  );
  return shares.map((s, i) => ({ memberId: s.memberId, amountCents: converted.shares[i], shareInput: converted.shares[i] }));
}

export function formatPercent(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const frac = Math.abs(basisPoints % 100);
  return frac === 0 ? `${whole}%` : `${whole}.${String(frac).padStart(2, '0').replace(/0$/, '')}%`;
}

/** Turns a stored share back into the text shown in the editor. */
export function shareInputText(mode: ManualMode, shareInput: number | null): string {
  if (shareInput === null) return '';
  if (mode === 'percent') return formatPercent(shareInput).replace('%', '');
  if (mode === 'exact') return centsToText(shareInput);
  return '';
}

export interface TripMoney {
  balances: Balances;
  transfers: Transfer[];
  totalSpentCents: Cents;
}

/** Balances and the Settle Up plan for a trip, from its bills and recorded payments. */
export function tripMoney(bills: Bill[], payments: Payment[], memberIds: string[]): TripMoney {
  const balances = computeBalances(
    bills.map((b) => ({
      payerId: b.paid_by_member_id,
      shares: b.shares.map((s) => ({ memberId: s.group_member_id, amountCents: s.amount_cents })),
    })),
    payments.map((p) => ({ fromId: p.from_member_id, toId: p.to_member_id, amountCents: p.amount_cents })),
    memberIds,
  );
  return {
    balances,
    transfers: simplifyDebts(balances),
    totalSpentCents: bills.reduce((sum, b) => sum + b.total_cents, 0),
  };
}

/** "Today", "Yesterday" or "Oct 12" for a YYYY-MM-DD date. */
export function friendlyDate(isoDate: string, today: Date = new Date()): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const days = Math.round((start.getTime() - date.getTime()) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  const sameYear = y === today.getFullYear();
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** Today's date as YYYY-MM-DD in the person's own time zone. */
export function todayIso(now: Date = new Date()): string {
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function isValidIsoDate(text: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export const CATEGORIES = ['Food', 'Transport', 'Lodging', 'Activities', 'Shopping', 'Other'] as const;
