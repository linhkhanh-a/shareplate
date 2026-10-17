import { assertNonNegativeCents, sumCents, type Cents } from './cents';
import { MoneyError } from './errors';
import type { MemberId, Share } from './splits';

export interface BillForBalance {
  /** The group member (registered user or guest) who paid the whole bill. */
  payerId: MemberId;
  /** What each person owes for this bill. The payer can be in here too. */
  shares: readonly Share[];
}

/** A recorded payment, e.g. "An paid Linh $20 on Zelle". */
export interface SettlementForBalance {
  fromId: MemberId;
  toId: MemberId;
  amountCents: Cents;
}

/**
 * Net balance per member, in cents.
 *   positive = the group owes them money
 *   negative = they owe the group money
 * The balances of a group always add up to exactly 0.
 */
export type Balances = Map<MemberId, Cents>;

export function computeBalances(
  bills: readonly BillForBalance[],
  settlements: readonly SettlementForBalance[] = [],
  memberIds: readonly MemberId[] = [],
): Balances {
  const balances: Balances = new Map();
  const add = (id: MemberId, delta: Cents) => balances.set(id, (balances.get(id) ?? 0) + delta);
  memberIds.forEach((id) => add(id, 0));

  for (const bill of bills) {
    bill.shares.forEach((s) => assertNonNegativeCents(s.amountCents, 'share'));
    const total = sumCents(bill.shares.map((s) => s.amountCents));
    add(bill.payerId, total);
    for (const share of bill.shares) add(share.memberId, -share.amountCents);
  }

  for (const s of settlements) {
    assertNonNegativeCents(s.amountCents, 'payment');
    if (s.fromId === s.toId) {
      throw new MoneyError('BAD_SETTLEMENT', 'Someone cannot pay themselves', { memberId: s.fromId });
    }
    // Paying off debt moves the payer's balance up and the receiver's down.
    add(s.fromId, s.amountCents);
    add(s.toId, -s.amountCents);
  }

  return balances;
}

/** True when nobody owes anybody anything. */
export function isSettled(balances: Balances): boolean {
  for (const value of balances.values()) if (value !== 0) return false;
  return true;
}
