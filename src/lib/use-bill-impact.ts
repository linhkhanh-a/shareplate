import { balanceChanges, changeSummary } from '@/lib/impact';
import { useBills, useMembers, usePayments, type Bill } from '@/lib/queries';

/**
 * Before deleting or changing a bill: what it does to everyone's balance, as
 * the text for the "are you sure?" question. `null` while the trip's bills or
 * payments are still loading.
 */
export function useBillImpact(tripId: string, myMemberId?: string) {
  const bills = useBills(tripId);
  const payments = usePayments(tripId);
  const members = useMembers(tripId);
  const nameOf = (id: string) => members.data?.find((m) => m.id === id)?.display_name ?? 'Someone';
  const hasPayments = (payments.data?.length ?? 0) > 0;

  /** The summary for replacing `billId` with `next` (or deleting it, when `next` is null). */
  function describe(billId: string, next: Bill | null): { text: string; changes: number } | null {
    if (!bills.data || !payments.data) return null;
    const nextBills = next ? bills.data.map((b) => (b.id === billId ? next : b)) : bills.data.filter((b) => b.id !== billId);
    const changes = balanceChanges(bills.data, nextBills, payments.data);
    return { text: changeSummary(changes, nameOf, myMemberId, hasPayments), changes: changes.length };
  }

  return { describe, hasPayments };
}
