import type { Cents } from './cents';
import { MoneyError } from './errors';
import type { Balances } from './balances';
import type { MemberId } from './splits';

/** "fromId pays toId amountCents" */
export interface Transfer {
  fromId: MemberId;
  toId: MemberId;
  amountCents: Cents;
}

/**
 * Collapses everyone's net balances into a short list of payments
 * ("Dồn tiền vào 1 người"). Greedy approach:
 *
 *   repeat: the person who owes the most pays the person who is owed the most,
 *           as much as possible, until everyone is at $0.
 *
 * Every payment clears at least one person, so a group of N people with
 * non-zero balances needs at most N - 1 payments. Finding the true minimum is
 * an NP-hard problem; this greedy method is the standard practical choice and
 * is usually optimal for real trips.
 *
 * Ties are broken by member id so the same balances always give the same plan.
 */
export function simplifyDebts(balances: Balances): Transfer[] {
  let check = 0;
  const debtors: { id: MemberId; amount: Cents }[] = [];
  const creditors: { id: MemberId; amount: Cents }[] = [];
  for (const [id, amount] of balances) {
    if (!Number.isSafeInteger(amount)) {
      throw new MoneyError('NOT_INTEGER_CENTS', 'Balances must be whole cents', { memberId: id });
    }
    check += amount;
    if (amount < 0) debtors.push({ id, amount: -amount });
    if (amount > 0) creditors.push({ id, amount });
  }
  if (check !== 0) {
    throw new MoneyError('BAD_SETTLEMENT', 'Balances do not add up to zero', { sumCents: check });
  }

  const byLargest = (a: { id: MemberId; amount: Cents }, b: { id: MemberId; amount: Cents }) =>
    b.amount - a.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const transfers: Transfer[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(byLargest);
    creditors.sort(byLargest);
    const debtor = debtors[0];
    const creditor = creditors[0];
    const amount = Math.min(debtor.amount, creditor.amount);
    transfers.push({ fromId: debtor.id, toId: creditor.id, amountCents: amount });
    debtor.amount -= amount;
    creditor.amount -= amount;
    if (debtor.amount === 0) debtors.shift();
    if (creditor.amount === 0) creditors.shift();
  }
  return transfers;
}
