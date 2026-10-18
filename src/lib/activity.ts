import { formatCents } from '@/money';

export type TripEventKind =
  | 'bill_added'
  | 'bill_edited'
  | 'bill_deleted'
  | 'payment_added'
  | 'payment_deleted'
  | 'member_joined'
  | 'guest_added'
  | 'member_left'
  | 'member_removed'
  | 'member_returned'
  | 'activity_added'
  | 'activity_deleted'
  | 'money_cleared';

export interface TripEvent {
  id: string;
  actor_member_id: string | null;
  kind: TripEventKind;
  subject: string | null;
  amount_cents: number | null;
  details: {
    bill_id?: string;
    activity_id?: string;
    from?: string;
    to?: string;
    day?: number;
    member?: string;
    bills?: number;
    payments?: number;
  };
  created_at: string;
}

/** One line for the "What's new" list, e.g. "An added Phở · $18.00". */
export function describeEvent(e: TripEvent, nameOf: (memberId: string) => string, myMemberId?: string): string {
  const who = (id: string | null | undefined) => (!id ? 'Someone' : id === myMemberId ? 'You' : nameOf(id));
  const actor = who(e.actor_member_id);
  const what = e.subject || 'a bill';
  const amount = e.amount_cents ? formatCents(e.amount_cents) : '';
  switch (e.kind) {
    case 'bill_added':
      return `${actor} added ${what}${amount ? ` · ${amount}` : ''}`;
    case 'bill_edited':
      return `${actor} edited ${what}${amount ? ` · now ${amount}` : ''}`;
    case 'bill_deleted':
      return `${actor} deleted ${what}${amount ? ` (${amount})` : ''}`;
    case 'payment_added':
    case 'payment_deleted': {
      const from = who(e.details.from);
      const to = who(e.details.to);
      const paid = `${from} paid ${to === 'You' ? 'you' : to} ${amount}`;
      if (e.kind === 'payment_deleted') return `${actor} removed a payment: ${paid}`;
      return e.actor_member_id && e.actor_member_id !== e.details.from ? `${paid} (recorded by ${actor === 'You' ? 'you' : actor})` : paid;
    }
    case 'member_joined':
      return `${e.subject ?? 'Someone'} joined the trip`;
    case 'guest_added':
      return `${actor} added ${e.subject ?? 'a guest'} as a guest`;
    case 'member_left':
      return `${e.subject ?? 'Someone'} left the trip`;
    case 'member_removed':
      return `${actor} removed ${e.subject ?? 'someone'} from the trip`;
    case 'member_returned':
      return `${actor} brought ${e.subject ?? 'someone'} back to the trip`;
    case 'activity_added':
      return `${actor} added ${what} to day ${e.details.day ?? 1} of the plan`;
    case 'activity_deleted':
      return `${actor} removed ${what} from the plan`;
    case 'money_cleared': {
      const bills = e.details.bills ?? 0;
      const payments = e.details.payments ?? 0;
      return `${actor} started over: cleared ${bills} ${bills === 1 ? 'bill' : 'bills'} and ${payments} ${payments === 1 ? 'payment' : 'payments'}`;
    }
    default:
      return `${actor} made a change`;
  }
}

/** "Just now", "5 min ago", "3 hr ago", "Yesterday", "Oct 12". */
export function timeAgo(iso: string, now: Date = new Date()): string {
  const then = new Date(iso);
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24 && then.getDate() === now.getDate()) return `${hours} hr ago`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (then >= yesterday && then < new Date(now.getFullYear(), now.getMonth(), now.getDate())) return 'Yesterday';
  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(then.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}
