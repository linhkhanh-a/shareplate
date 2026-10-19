import { describe, expect, it } from 'vitest';

import { balanceChanges, changeSummary, overpaid, standing } from '@/lib/impact';
import type { Bill, Payment } from '@/lib/queries';

const bill = (id: string, payer: string, shares: [string, number][]): Bill => ({
  id,
  title: id,
  vendor: null,
  category: 'Food',
  split_mode: 'exact',
  subtotal_cents: 0,
  discount_cents: 0,
  tax_cents: 0,
  tip_cents: 0,
  total_cents: shares.reduce((s, [, c]) => s + c, 0),
  bill_date: '2026-10-18',
  bill_image_path: null,
  paid_by_member_id: payer,
  itinerary_item_id: null,
  version: 1,
  created_at: '',
  shares: shares.map(([group_member_id, amount_cents]) => ({
    group_member_id,
    amount_cents,
    share_input: amount_cents,
    items_cents: amount_cents,
    discount_cents: 0,
    tax_cents: 0,
    tip_cents: 0,
  })),
});
const pay = (from: string, to: string, cents: number): Payment => ({
  id: `${from}-${to}`,
  from_member_id: from,
  to_member_id: to,
  amount_cents: cents,
  settled_on: '2026-10-18',
  created_at: '',
  created_by: null,
});

// "hihi": 2 paid $100 split three ways; you and 1 paid 2 back.
const dinner = bill('1', '2', [['me', 3334], ['1', 3333], ['2', 3333]]);
const payments = [pay('me', '2', 3334), pay('1', '2', 3333)];

describe('what deleting a bill changes', () => {
  it('lists everyone whose balance moves, biggest first', () => {
    expect(balanceChanges([dinner], [], payments)).toEqual([
      { memberId: '2', before: 0, after: -6667 },
      { memberId: 'me', before: 0, after: 3334 },
      { memberId: '1', before: 0, after: 3333 },
    ]);
    expect(balanceChanges([dinner], [dinner], payments)).toEqual([]);
  });

  it('says it in plain words, and why money may now need to go back', () => {
    const names: Record<string, string> = { '1': '1', '2': '2' };
    const text = changeSummary(balanceChanges([dinner], [], payments), (id) => names[id], 'me', true);
    expect(text).toBe(
      [
        'Balances will change:',
        '• 2: settled → owes $66.67',
        '• You: settled → owed $33.34',
        '• 1: settled → owed $33.33',
        '',
        'Payments already recorded stay as they are, so some people may now need money back.',
      ].join('\n'),
    );
    expect(changeSummary([], () => '', undefined, false)).toBe('Nobody’s balance changes.');
    expect(standing(-500, true)).toBe('owe $5.00');
    expect(standing(500, true)).toBe('are owed $5.00');
  });

  it('cuts a long list short', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ memberId: String(i), before: 0, after: i + 1 }));
    expect(changeSummary(many, (id) => id, undefined, false).split('\n')).toContain('• and 2 more');
  });
});

describe('leftover payments', () => {
  it('finds people whose payments went past what the bills ask', () => {
    // The bill was deleted after everyone paid: you and 1 are owed it back, 2 owes it back.
    expect(overpaid([], payments)).toEqual([
      { memberId: '2', cents: -6667 },
      { memberId: 'me', cents: 3334 },
      { memberId: '1', cents: 3333 },
    ]);
  });

  it('stays quiet for ordinary, partial or exact payments', () => {
    expect(overpaid([dinner], payments)).toEqual([]);
    expect(overpaid([dinner], [pay('me', '2', 1000)])).toEqual([]);
    expect(overpaid([dinner], [])).toEqual([]);
  });

  it('spots paying more than was owed', () => {
    expect(overpaid([dinner], [pay('me', '2', 5000)])).toEqual([{ memberId: 'me', cents: 1666 }]);
  });
});
