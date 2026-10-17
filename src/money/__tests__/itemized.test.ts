import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MoneyError, percentOfCents, splitItemizedBill } from '@/money';

describe('itemized bill (spec formulas)', () => {
  // Worked example, also used in docs/money-engine.md:
  //   Pho $15.00 (Linh), Banh mi $9.00 (An), Spring rolls $12.00 (shared by Linh, An, Minh)
  //   Subtotal $36.00, voucher -$6.00, tax $2.40 (8% of $30.00), tip $9.00
  const example = splitItemizedBill({
    items: [
      { name: 'Pho', priceCents: 1500, memberIds: ['Linh'] },
      { name: 'Banh mi', priceCents: 900, memberIds: ['An'] },
      { name: 'Spring rolls', priceCents: 1200, memberIds: ['Linh', 'An', 'Minh'] },
    ],
    discountCents: 600,
    taxCents: 240,
    tipCents: 900,
  });

  it('matches the hand calculation', () => {
    expect(example.subtotalCents).toBe(3600);
    expect(example.discountedSubtotalCents).toBe(3000);
    expect(example.totalCents).toBe(4140);
    expect(example.members).toEqual([
      { memberId: 'Linh', itemsCents: 1900, discountCents: 317, taxCents: 127, tipCents: 300, totalCents: 2010 },
      { memberId: 'An', itemsCents: 1300, discountCents: 217, taxCents: 87, tipCents: 300, totalCents: 1470 },
      { memberId: 'Minh', itemsCents: 400, discountCents: 66, taxCents: 26, tipCents: 300, totalCents: 660 },
    ]);
  });

  it('lets a tip-only person share the tip', () => {
    const r = splitItemizedBill({
      items: [{ priceCents: 2000, memberIds: ['a'] }],
      tipCents: 400,
      tipMemberIds: ['a', 'driver-friend'],
    });
    expect(r.shares).toEqual([
      { memberId: 'a', amountCents: 2200 },
      { memberId: 'driver-friend', amountCents: 200 },
    ]);
  });

  it('explains what is wrong with a bad bill', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as MoneyError).code;
      }
      return 'no error';
    };
    expect(code(() => splitItemizedBill({ items: [] }))).toBe('NO_ITEMS');
    expect(code(() => splitItemizedBill({ items: [{ name: 'Tea', priceCents: 300, memberIds: [] }] }))).toBe(
      'ITEM_UNASSIGNED',
    );
    expect(
      code(() => splitItemizedBill({ items: [{ priceCents: 300, memberIds: ['a'] }], discountCents: 301 })),
    ).toBe('DISCOUNT_TOO_LARGE');
    expect(code(() => splitItemizedBill({ items: [{ priceCents: 300, memberIds: ['a'] }], taxCents: -1 }))).toBe(
      'NEGATIVE_AMOUNT',
    );
  });

  it('turns a tax rate into cents, rounding half up', () => {
    expect(percentOfCents(3000, 800)).toBe(240);
    expect(percentOfCents(1999, 825)).toBe(165); // 164.9175 -> 165
    expect(percentOfCents(200, 25)).toBe(1); // 0.5 -> 1
  });

  it('always adds up exactly, and each person is within a few cents of the exact math', () => {
    const members = ['a', 'b', 'c', 'd', 'e'];
    const item = fc.record({
      priceCents: fc.integer({ min: 0, max: 50_000 }),
      memberIds: fc.subarray(members, { minLength: 1 }),
    });
    fc.assert(
      fc.property(
        fc.array(item, { minLength: 1, maxLength: 12 }),
        fc.integer({ min: 0, max: 100 }), // discount as % of subtotal
        fc.integer({ min: 0, max: 20_000 }),
        fc.integer({ min: 0, max: 20_000 }),
        (items, discountPct, tax, tip) => {
          const subtotal = items.reduce((a, x) => a + x.priceCents, 0);
          fc.pre(subtotal > 0);
          const discount = Math.floor((subtotal * discountPct) / 100);
          const r = splitItemizedBill({ items, discountCents: discount, taxCents: tax, tipCents: tip });

          const sum = (key: 'itemsCents' | 'discountCents' | 'taxCents' | 'tipCents' | 'totalCents') =>
            r.members.reduce((a, m) => a + m[key], 0);
          expect(sum('itemsCents')).toBe(subtotal);
          expect(sum('discountCents')).toBe(discount);
          expect(sum('taxCents')).toBe(tax);
          expect(sum('tipCents')).toBe(tip);
          expect(sum('totalCents')).toBe(subtotal - discount + tax + tip);
          expect(r.totalCents).toBe(subtotal - discount + tax + tip);

          // Exact (unrounded) spec math for each person.
          const n = r.members.length;
          for (const m of r.members) {
            const myItems = items
              .filter((x) => x.memberIds.includes(m.memberId))
              .reduce((a, x) => a + x.priceCents / x.memberIds.length, 0);
            const disc = myItems * (1 - discount / subtotal);
            const taxShare = subtotal - discount > 0 ? disc * (tax / (subtotal - discount)) : (tax * myItems) / subtotal;
            const exact = disc + taxShare + tip / n;
            expect(Math.abs(m.totalCents - exact)).toBeLessThan(4);
            expect(m.discountCents).toBeGreaterThanOrEqual(0);
            expect(m.taxCents).toBeGreaterThanOrEqual(0);
          }
        },
      ),
    );
  });
});
