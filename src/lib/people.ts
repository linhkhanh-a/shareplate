import type { Member, Payment } from '@/lib/queries';
import type { Cents } from '@/money';

/**
 * Small rules about the people in a trip, kept out of the screens so they
 * can be tested: who may remove a payment, who left with money still on
 * them, and how to describe the group.
 */

/** The payer, the receiver, whoever recorded it, or an admin. The database enforces the same rule. */
export function canRemovePayment(payment: Payment, me: Member | undefined, uid: string | undefined): boolean {
  if (!me || me.left_at || !uid) return false;
  return (
    me.role === 'admin' ||
    payment.created_by === uid ||
    payment.from_member_id === me.id ||
    payment.to_member_id === me.id
  );
}

/** People who left the trip but still have money on them. Only older trips can have these. */
export function formerWithBalance(members: Member[], balances: Map<string, Cents>): { member: Member; balance: Cents }[] {
  return members
    .filter((m) => m.left_at && (balances.get(m.id) ?? 0) !== 0)
    .map((m) => ({ member: m, balance: balances.get(m.id) ?? 0 }));
}

/** "4 people · 3 guests", "2 people", "Just you". */
export function peopleLine(active: Member[]): string {
  if (active.length <= 1) return 'Just you';
  const guests = active.filter((m) => !m.user_id).length;
  const people = `${active.length} people`;
  return guests === 0 ? people : `${people} · ${guests} ${guests === 1 ? 'guest' : 'guests'}`;
}

/** The confirmation shown before taking someone off the trip. */
export function removeMessage(member: Member): { title: string; body: string } {
  return member.user_id
    ? {
        title: `Remove ${member.display_name}?`,
        body: `They will no longer see this trip. Bills they were on stay in the history, and an admin can bring them back later.`,
      }
    : {
        title: `Remove ${member.display_name}?`,
        body: `They'll be taken off the list of people. Bills they were on stay in the history, and an admin can bring them back later.`,
      };
}

/** Whether a bill has someone on it who has left the trip, and who. */
export function formerOnBill(
  members: Member[],
  bill: { paid_by_member_id: string; shares: { group_member_id: string }[] },
): Member[] {
  const ids = new Set([bill.paid_by_member_id, ...bill.shares.map((s) => s.group_member_id)]);
  return members.filter((m) => m.left_at && ids.has(m.id));
}
