import { describe, expect, it } from 'vitest';

import {
  computeSplit,
  formatPercent,
  friendlyDate,
  isValidIsoDate,
  shareInputText,
  todayIso,
  tripMoney,
  type SplitRow,
} from '@/lib/ledger';
import type { Bill, Payment } from '@/lib/queries';

const rows = (inputs: Record<string, string>, excluded: string[] = []): SplitRow[] =>
  Object.entries(inputs).map(([memberId, input]) => ({ memberId, input, included: !excluded.includes(memberId) }));

describe('computeSplit (the bill editor preview)', () => {
  it('splits equally among the people ticked', () => {
    const r = computeSplit('equal', '10', rows({ a: '', b: '', c: '', d: '' }, ['d']));
    expect(r.ok && r.shares.map((s) => s.amountCents)).toEqual([334, 333, 333]);
    expect(r.status).toBe('$10.00 split 3 ways');
  });

  it('says how much percentage is left to assign', () => {
    const r = computeSplit('percent', '90', rows({ a: '50', b: '30' }));
    expect(r).toMatchObject({ ok: false, message: '20% still to assign.', status: '80% of 100%' });
  });

  it('accepts percentages with decimals and stores them as basis points', () => {
    const r = computeSplit('percent', '100', rows({ a: '33.33', b: '33.33', c: '33.34' }));
    expect(r.ok && r.shares).toEqual([
      { memberId: 'a', amountCents: 3333, shareInput: 3333 },
      { memberId: 'b', amountCents: 3333, shareInput: 3333 },
      { memberId: 'c', amountCents: 3334, shareInput: 3334 },
    ]);
  });

  it('says how far exact amounts are from the total', () => {
    expect(computeSplit('exact', '50', rows({ a: '20', b: '27.50' }))).toMatchObject({
      ok: false,
      message: '$2.50 still to assign.',
      status: '$47.50 of $50.00',
    });
    expect(computeSplit('exact', '50', rows({ a: '30', b: '25' }))).toMatchObject({
      ok: false,
      message: '$5.00 too much.',
    });
    const ok = computeSplit('exact', '50', rows({ a: '30', b: '20' }));
    expect(ok.ok && ok.shares.map((s) => s.shareInput)).toEqual([3000, 2000]);
  });

  it('asks for an amount and for people before anything else', () => {
    expect(computeSplit('equal', '', rows({ a: '' }))).toMatchObject({ ok: false, message: /bill amount/ });
    expect(computeSplit('equal', '12', rows({ a: '' }, ['a']))).toMatchObject({ ok: false, message: /who is splitting/ });
  });
});

describe('formatting helpers', () => {
  it('formats percentages without trailing zeros', () => {
    expect(formatPercent(10000)).toBe('100%');
    expect(formatPercent(3333)).toBe('33.33%');
    expect(formatPercent(1250)).toBe('12.5%');
  });

  it('turns stored shares back into editor text', () => {
    expect(shareInputText('percent', 3333)).toBe('33.33');
    expect(shareInputText('exact', 123456)).toBe('1234.56');
    expect(shareInputText('equal', null)).toBe('');
  });

  it('writes friendly dates', () => {
    const today = new Date(2026, 9, 17);
    expect(friendlyDate('2026-10-17', today)).toBe('Today');
    expect(friendlyDate('2026-10-16', today)).toBe('Yesterday');
    expect(friendlyDate('2026-10-12', today)).toBe('Oct 12');
    expect(friendlyDate('2025-12-30', today)).toBe('Dec 30, 2025');
    expect(todayIso(today)).toBe('2026-10-17');
  });

  it('validates typed dates', () => {
    expect(isValidIsoDate('2026-10-17')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('10/17/2026')).toBe(false);
  });
});

describe('tripMoney', () => {
  const bill = (payer: string, shares: [string, number][]): Bill => ({
    id: Math.random().toString(),
    title: null,
    vendor: null,
    category: 'Food',
    split_mode: 'exact',
    itinerary_item_id: null,
    subtotal_cents: shares.reduce((a, [, c]) => a + c, 0),
    discount_cents: 0,
    tax_cents: 0,
    tip_cents: 0,
    total_cents: shares.reduce((a, [, c]) => a + c, 0),
    bill_date: '2026-10-17',
    bill_image_path: null,
    paid_by_member_id: payer,
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

  it('turns bills and payments into balances and a Settle Up plan', () => {
    const bills = [bill('linh', [['linh', 2000], ['an', 2000], ['minh', 2000]]), bill('an', [['minh', 900]])];
    const payments: Payment[] = [
      { id: 'p', from_member_id: 'minh', to_member_id: 'linh', amount_cents: 1000, settled_on: '', created_at: '', created_by: null },
    ];
    const money = tripMoney(bills, payments, ['linh', 'an', 'minh']);
    expect(Object.fromEntries(money.balances)).toEqual({ linh: 3000, an: -1100, minh: -1900 });
    expect(money.transfers).toEqual([
      { fromId: 'minh', toId: 'linh', amountCents: 1900 },
      { fromId: 'an', toId: 'linh', amountCents: 1100 },
    ]);
    expect(money.totalSpentCents).toBe(6900);
  });
});
