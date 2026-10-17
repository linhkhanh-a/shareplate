import {
  computeBalances,
  FULL_PERCENT_BP,
  formatCents,
  MoneyError,
  parseCents,
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
  | { ok: true; shares: ComputedShare[]; status: string }
  | { ok: false; message: string; status: string };

/**
 * Works out everyone's share as the bill is being typed, using the money
 * engine, and explains what's missing when the numbers don't add up yet.
 */
export function computeSplit(mode: ManualMode, totalText: string, rows: SplitRow[]): SplitResult {
  let total: Cents;
  try {
    total = parseCents(totalText || '0');
  } catch {
    return { ok: false, message: 'Enter the bill amount, like 42.50.', status: '' };
  }
  if (total <= 0) return { ok: false, message: 'Enter the bill amount, like 42.50.', status: '' };

  const included = rows.filter((r) => r.included);
  if (included.length === 0) return { ok: false, message: 'Choose who is splitting this bill.', status: '' };

  if (mode === 'equal') {
    const shares = splitEqual(
      total,
      included.map((r) => r.memberId),
    );
    return {
      ok: true,
      shares: shares.map((s) => ({ ...s, shareInput: null })),
      status: `${formatCents(total)} split ${included.length} ${included.length === 1 ? 'way' : 'ways'}`,
    };
  }

  if (mode === 'percent') {
    let sum = 0;
    const inputs: { memberId: string; basisPoints: number }[] = [];
    for (const r of included) {
      try {
        const bp = parsePercentToBasisPoints(r.input || '0');
        sum += bp;
        inputs.push({ memberId: r.memberId, basisPoints: bp });
      } catch {
        return { ok: false, message: 'Percentages can have at most two decimals, like 33.33.', status: '' };
      }
    }
    const status = `${formatPercent(sum)} of 100%`;
    if (sum !== FULL_PERCENT_BP) {
      const diff = FULL_PERCENT_BP - sum;
      return {
        ok: false,
        message: diff > 0 ? `${formatPercent(diff)} still to assign.` : `${formatPercent(-diff)} too much.`,
        status,
      };
    }
    const shares = splitByPercent(total, inputs);
    return {
      ok: true,
      shares: shares.map((s, i) => ({ ...s, shareInput: inputs[i].basisPoints })),
      status,
    };
  }

  // Exact amounts
  let sum = 0;
  const inputs: { memberId: string; amountCents: Cents }[] = [];
  for (const r of included) {
    try {
      const cents = parseCents(r.input || '0');
      if (cents < 0) throw new Error('negative');
      sum += cents;
      inputs.push({ memberId: r.memberId, amountCents: cents });
    } catch {
      return { ok: false, message: 'Enter each amount like 12.50.', status: '' };
    }
  }
  const status = `${formatCents(sum)} of ${formatCents(total)}`;
  try {
    const shares = splitExact(total, inputs);
    return { ok: true, shares: shares.map((s) => ({ ...s, shareInput: s.amountCents })), status };
  } catch (e) {
    if (e instanceof MoneyError && e.code === 'EXACT_NOT_TOTAL') {
      const diff = total - sum;
      return {
        ok: false,
        message: diff > 0 ? `${formatCents(diff)} still to assign.` : `${formatCents(-diff)} too much.`,
        status,
      };
    }
    throw e;
  }
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
  if (mode === 'exact') return formatCents(shareInput).replace('$', '').replace(/,/g, '');
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
