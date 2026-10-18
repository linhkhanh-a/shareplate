import { tripMoney } from '@/lib/ledger';
import type { Bill, Payment } from '@/lib/queries';
import { formatCents, type Cents } from '@/money';

/**
 * What a change to the bills does to everyone's balance, so the app can say
 * so before it happens, and spotting money that only makes sense as leftover
 * payments for bills that were deleted or changed.
 */

export interface BalanceChange {
  memberId: string;
  before: Cents;
  after: Cents;
}

/** Everyone whose balance moves when `bills` become `nextBills`, biggest change first. */
export function balanceChanges(bills: Bill[], nextBills: Bill[], payments: Payment[]): BalanceChange[] {
  const before = tripMoney(bills, payments, []).balances;
  const after = tripMoney(nextBills, payments, []).balances;
  const ids = new Set([...before.keys(), ...after.keys()]);
  return [...ids]
    .map((memberId) => ({ memberId, before: before.get(memberId) ?? 0, after: after.get(memberId) ?? 0 }))
    .filter((c) => c.before !== c.after)
    .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before));
}

/** "owed $746.65", "owes $66.67", "settled". `you` switches to "are owed" / "owe". */
export function standing(cents: Cents, you = false): string {
  if (cents > 0) return `${you ? 'are owed' : 'owed'} ${formatCents(cents)}`;
  if (cents < 0) return `${you ? 'owe' : 'owes'} ${formatCents(-cents)}`;
  return 'settled';
}

/**
 * The message for "are you sure?": who goes from what to what, and, when
 * payments were already recorded, why someone may now need money back.
 */
export function changeSummary(
  changes: BalanceChange[],
  nameOf: (memberId: string) => string,
  myMemberId: string | undefined,
  hasPayments: boolean,
  limit = 6,
): string {
  if (changes.length === 0) return 'Nobody’s balance changes.';
  const lines = changes.slice(0, limit).map((c) => {
    const who = c.memberId === myMemberId ? 'You' : nameOf(c.memberId);
    return `• ${who}: ${standing(c.before)} → ${standing(c.after)}`;
  });
  if (changes.length > limit) lines.push(`• and ${changes.length - limit} more`);
  if (hasPayments) {
    lines.push('', 'Payments already recorded stay as they are, so some people may now need money back.');
  }
  return ['Balances will change:', ...lines].join('\n');
}

/**
 * People whose recorded payments went past what the bills ask of them: the
 * bills alone say they owe less (or nothing, or are owed less) than the
 * payments now leave them with. This is what's left when a bill is deleted or
 * lowered after people paid for it.
 */
export function overpaid(bills: Bill[], payments: Payment[]): { memberId: string; cents: Cents }[] {
  if (payments.length === 0) return [];
  const billsOnly = tripMoney(bills, [], []).balances;
  const withPayments = tripMoney(bills, payments, []).balances;
  const out: { memberId: string; cents: Cents }[] = [];
  for (const [memberId, now] of withPayments) {
    const owedByBills = billsOnly.get(memberId) ?? 0;
    // Paid out more than the bills ever asked: now owed money back.
    if (now > 0 && owedByBills <= 0) out.push({ memberId, cents: now });
    // Received more than the bills say they're owed: now owes it back.
    else if (now < 0 && owedByBills >= 0) out.push({ memberId, cents: now });
  }
  return out.sort((a, b) => Math.abs(b.cents) - Math.abs(a.cents));
}

/** The bill as it would be after an edit: new payer and shares, for previewing. */
export function withShares(bill: Bill, payerId: string, shares: { memberId: string; amountCents: Cents }[]): Bill {
  return {
    ...bill,
    paid_by_member_id: payerId,
    total_cents: shares.reduce((s, x) => s + x.amountCents, 0),
    shares: shares.map((x) => ({
      group_member_id: x.memberId,
      amount_cents: x.amountCents,
      share_input: null,
      items_cents: x.amountCents,
      discount_cents: 0,
      tax_cents: 0,
      tip_cents: 0,
    })),
  };
}
