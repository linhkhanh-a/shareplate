import { describe, expect, it } from 'vitest';

import { fraction, leftOrOver, personBudget, scaleFor, tripBudget, type BudgetBill } from '@/lib/budget';
import type { Activity } from '@/lib/itinerary';

const bill = (date: string, total: number, shares: [string, number][]): BudgetBill => ({
  bill_date: date,
  total_cents: total,
  shares: shares.map(([group_member_id, amount_cents]) => ({ group_member_id, amount_cents })),
});

const activity = (day: number, planned: number): Activity => ({
  id: `a${day}-${planned}`,
  day_number: day,
  position: 0,
  start_time: null,
  end_time: null,
  title: 'x',
  location: null,
  notes: null,
  proposed_budget_cents: planned,
  version: 1,
  created_at: '2026-10-18T00:00:00Z',
});

const bills = [
  bill('2026-10-20', 2000, [['linh', 2000]]), // booked before the trip
  bill('2026-10-23', 6000, [['linh', 2000], ['an', 2000], ['minh', 2000]]),
  bill('2026-10-23', 1800, [['an', 1800]]),
  bill('2026-10-24', 24000, [['linh', 12000], ['an', 12000]]),
];

describe('trip budget', () => {
  it('compares each trip day with its share of the budget and the plan', () => {
    const t = tripBudget({
      budgetCents: 100000,
      bills,
      activities: [activity(1, 4000), activity(1, 1500), activity(2, 20000)],
      start: '2026-10-23',
      end: '2026-10-25',
      today: '2026-10-24',
    });
    expect(t).toMatchObject({ budget: 100000, spent: 33800, planned: 25500, left: 66200, days: 3, perDay: 33333 });
    expect(t.rows).toEqual([
      { label: 'Day 1 · Fri, Oct 23', date: '2026-10-23', spent: 7800, planned: 5500, allowance: 33334, isToday: false },
      { label: 'Day 2 · Sat, Oct 24', date: '2026-10-24', spent: 24000, planned: 20000, allowance: 33333, isToday: true },
      { label: 'Day 3 · Sun, Oct 25', date: '2026-10-25', spent: 0, planned: 0, allowance: 33333, isToday: false },
    ]);
    // The days add up to the budget exactly.
    expect(t.rows.reduce((s, r) => s + (r.allowance ?? 0), 0)).toBe(100000);
    expect(t.outside).toEqual({ before: 2000, after: 0 });
  });

  it('without dates or a budget, shows spending by date', () => {
    const t = tripBudget({ budgetCents: 0, bills, activities: [], start: null, end: null, today: '2026-10-23' });
    expect(t.perDay).toBe(null);
    expect(t.rows.map((r) => [r.label, r.spent, r.allowance])).toEqual([
      ['Tue, Oct 20', 2000, null],
      ['Fri, Oct 23', 7800, null],
      ['Sat, Oct 24', 24000, null],
    ]);
    expect(leftOrOver(t.left)).toBe('$338.00 over');
  });
});

describe('personal allowance', () => {
  it('counts each person’s share of the bills, not what they paid', () => {
    const p = personBudget({
      memberId: 'an',
      allowancePerDay: 5000,
      bills,
      start: '2026-10-23',
      end: '2026-10-25',
      today: '2026-10-23',
    });
    expect(p.spent).toBe(15800);
    expect(p.allowanceTotal).toBe(15000);
    expect(p.rows.map((r) => [r.label, r.spent, r.allowance])).toEqual([
      ['Day 1 · Fri, Oct 23', 3800, 5000],
      ['Day 2 · Sat, Oct 24', 12000, 5000],
      ['Day 3 · Sun, Oct 25', 0, 5000],
    ]);
  });

  it('works without trip dates or an allowance', () => {
    const p = personBudget({ memberId: 'minh', allowancePerDay: 0, bills, start: null, end: null, today: '2026-10-23' });
    expect(p).toMatchObject({ spent: 2000, allowanceTotal: null });
    expect(p.rows).toEqual([
      { label: 'Fri, Oct 23', date: '2026-10-23', spent: 2000, planned: 0, allowance: null, isToday: true },
    ]);
  });
});

describe('bars', () => {
  it('scales bars to the largest value and never overflows', () => {
    const t = tripBudget({ budgetCents: 30000, bills, activities: [], start: '2026-10-23', end: '2026-10-25', today: '' });
    const max = scaleFor(t.rows);
    expect(max).toBe(24000);
    expect(fraction(12000, max)).toBe(0.5);
    expect(fraction(-1, max)).toBe(0);
    expect(fraction(50000, max)).toBe(1);
    expect(leftOrOver(0)).toBe('Right on budget');
  });
});
