import { tripMoney } from '@/lib/ledger';
import type { Bill, Member, Payment } from '@/lib/queries';
import { zelleOf } from '@/lib/people';
import { formatCents, type Cents } from '@/money';

export interface PersonTotals {
  id: string;
  name: string;
  isGuest: boolean;
  zelle: string | null;
  /** Bills they paid for. */
  paid: Cents;
  /** Their share of all bills (what they used). */
  share: Cents;
  /** Payments they sent and received to settle up. */
  sent: Cents;
  received: Cents;
  /** Positive: they're owed this much. Negative: they owe it. */
  balance: Cents;
}

export interface SummaryTransfer {
  fromId: string;
  toId: string;
  fromName: string;
  toName: string;
  amount: Cents;
  /** The recipient's Zelle email or phone, if they added one. */
  toZelle: string | null;
}

export interface TripSummary {
  tripName: string;
  total: Cents;
  billCount: number;
  people: PersonTotals[];
  transfers: SummaryTransfer[];
}

/** Everything the summary card, the messages and the spreadsheet need. */
export function tripSummary(input: {
  tripName: string;
  members: Member[];
  bills: Bill[];
  payments: Payment[];
}): TripSummary {
  const { tripName, members, bills, payments } = input;
  const active = members.filter((m) => !m.left_at);
  // Anyone with money involved is listed, even if they've since left.
  const involved = new Set<string>([
    ...active.map((m) => m.id),
    ...bills.flatMap((b) => [b.paid_by_member_id, ...b.shares.map((s) => s.group_member_id)]),
    ...payments.flatMap((p) => [p.from_member_id, p.to_member_id]),
  ]);
  const listed = members.filter((m) => involved.has(m.id));
  const money = tripMoney(bills, payments, listed.map((m) => m.id));
  const byId = new Map(members.map((m) => [m.id, m]));
  const name = (id: string) => byId.get(id)?.display_name ?? 'Someone';

  const people: PersonTotals[] = listed.map((m) => {
    const paid = bills.filter((b) => b.paid_by_member_id === m.id).reduce((s, b) => s + b.total_cents, 0);
    const share = bills.reduce((s, b) => s + (b.shares.find((x) => x.group_member_id === m.id)?.amount_cents ?? 0), 0);
    const sent = payments.filter((p) => p.from_member_id === m.id).reduce((s, p) => s + p.amount_cents, 0);
    const received = payments.filter((p) => p.to_member_id === m.id).reduce((s, p) => s + p.amount_cents, 0);
    return {
      id: m.id,
      name: m.display_name,
      isGuest: !m.user_id,
      zelle: zelleOf(m),
      paid,
      share,
      sent,
      received,
      balance: money.balances.get(m.id) ?? 0,
    };
  });

  return {
    tripName,
    total: money.totalSpentCents,
    billCount: bills.length,
    people,
    transfers: money.transfers.map((t) => ({
      fromId: t.fromId,
      toId: t.toId,
      fromName: name(t.fromId),
      toName: name(t.toId),
      amount: t.amountCents,
      toZelle: zelleOf(byId.get(t.toId)),
    })),
  };
}

const zelleNote = (t: SummaryTransfer) => (t.toZelle ? ` (Zelle: ${t.toZelle})` : '');

/** The whole trip as a message for the group chat. */
export function summaryText(s: TripSummary): string {
  const lines = [`${s.tripName}: ${formatCents(s.total)} spent on ${s.billCount} ${s.billCount === 1 ? 'bill' : 'bills'}.`, ''];
  lines.push('Each person’s share:');
  for (const p of s.people) lines.push(`• ${p.name}: ${formatCents(p.share)}`);
  lines.push('');
  if (s.transfers.length === 0) {
    lines.push('Everyone’s settled up.');
  } else {
    lines.push('To settle up:');
    for (const t of s.transfers) lines.push(`• ${t.fromName} pays ${t.toName} ${formatCents(t.amount)}${zelleNote(t)}`);
  }
  lines.push('', 'Split with Shareplate');
  return lines.join('\n');
}

/**
 * A personal message for one person: their share and who to pay (or who pays
 * them). `senderId` is whoever is sending it, so money owed to them reads
 * "send … to me".
 */
export function personMessage(s: TripSummary, personId: string, senderId?: string): string {
  const p = s.people.find((x) => x.id === personId);
  if (!p) return '';
  // The whole name: a first word can be a family name ("Nguyễn") or a nickname fragment.
  const lines = [`Hi ${p.name}! Your share of ${s.tripName} comes to ${formatCents(p.share)}.`];
  const pays = s.transfers.filter((t) => t.fromId === personId);
  const gets = s.transfers.filter((t) => t.toId === personId);
  const payLine = (t: SummaryTransfer) => {
    const to = t.toId === senderId ? 'me' : t.toName;
    return `${formatCents(t.amount)} to ${to}${t.toZelle ? ` by Zelle at ${t.toZelle}` : ''}`;
  };
  if (pays.length > 0) {
    lines.push(
      pays.length === 1
        ? `Please send ${payLine(pays[0])}.`
        : `Please send:\n${pays.map((t) => `• ${payLine(t)}`).join('\n')}`,
    );
  } else if (gets.length > 0) {
    lines.push(
      `You're owed ${formatCents(gets.reduce((sum, t) => sum + t.amount, 0))}: ${gets
        .map((t) => (t.fromId === senderId ? `I'll send you ${formatCents(t.amount)}` : `${t.fromName} will send you ${formatCents(t.amount)}`))
        .join(', ')}.`,
    );
  } else {
    lines.push('You’re all settled up, so there’s nothing to pay.');
  }
  lines.push('Thanks!');
  return lines.join('\n');
}
