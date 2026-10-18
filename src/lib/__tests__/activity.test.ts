import { describe, expect, it } from 'vitest';

import { describeEvent, timeAgo, type TripEvent } from '@/lib/activity';

const names: Record<string, string> = { linh: 'Linh', an: 'An', minh: 'Minh' };
const nameOf = (id: string) => names[id] ?? 'Someone';
const ev = (kind: TripEvent['kind'], extra: Partial<TripEvent> = {}): TripEvent => ({
  id: 'e',
  actor_member_id: 'an',
  kind,
  subject: 'Phở',
  amount_cents: 1800,
  details: {},
  created_at: '2026-10-18T10:00:00Z',
  ...extra,
});

describe("what's new", () => {
  it('reads like a sentence, with "You" for your own changes', () => {
    expect(describeEvent(ev('bill_added'), nameOf, 'linh')).toBe('An added Phở · $18.00');
    expect(describeEvent(ev('bill_edited', { actor_member_id: 'linh' }), nameOf, 'linh')).toBe('You edited Phở · now $18.00');
    expect(describeEvent(ev('bill_deleted', { actor_member_id: null }), nameOf, 'linh')).toBe('Someone deleted Phở ($18.00)');
    expect(describeEvent(ev('payment_added', { subject: null, actor_member_id: 'an', details: { from: 'an', to: 'linh' } }), nameOf, 'linh')).toBe(
      'An paid you $18.00',
    );
    expect(describeEvent(ev('payment_added', { subject: null, actor_member_id: 'minh', details: { from: 'an', to: 'linh' } }), nameOf, 'linh')).toBe(
      'An paid you $18.00 (recorded by Minh)',
    );
    expect(describeEvent(ev('payment_deleted', { subject: null, actor_member_id: 'linh', details: { from: 'an', to: 'linh' } }), nameOf, 'linh')).toBe(
      'You undid a payment: An paid you $18.00',
    );
    expect(describeEvent(ev('guest_added', { subject: 'Hương', amount_cents: null }), nameOf)).toBe('An added Hương as a guest');
    expect(describeEvent(ev('member_joined', { subject: 'Tuấn' }), nameOf)).toBe('Tuấn joined the trip');
    expect(describeEvent(ev('member_left', { subject: 'Minh' }), nameOf)).toBe('Minh left the trip');
    expect(describeEvent(ev('activity_added', { subject: 'Lake walk', details: { day: 2 } }), nameOf)).toBe(
      'An added Lake walk to day 2 of the plan',
    );
    expect(describeEvent(ev('activity_deleted', { subject: 'Lake walk' }), nameOf)).toBe('An removed Lake walk from the plan');
  });

  it('says how long ago', () => {
    const now = new Date(2026, 9, 18, 15, 0);
    expect(timeAgo(new Date(2026, 9, 18, 14, 59, 40).toISOString(), now)).toBe('Just now');
    expect(timeAgo(new Date(2026, 9, 18, 14, 25).toISOString(), now)).toBe('35 min ago');
    expect(timeAgo(new Date(2026, 9, 18, 9, 0).toISOString(), now)).toBe('6 hr ago');
    expect(timeAgo(new Date(2026, 9, 17, 22, 0).toISOString(), now)).toBe('Yesterday');
    expect(timeAgo(new Date(2026, 9, 12, 9, 0).toISOString(), now)).toBe('Oct 12');
    expect(timeAgo(new Date(2025, 9, 12, 9, 0).toISOString(), now)).toBe('Oct 12, 2025');
  });
});
