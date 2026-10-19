import { describe, expect, it } from 'vitest';

import { convertCents, convertItemized, convertShares, formatRate, scaledRate } from '../fx';

describe('converting currencies', () => {
  it('converts one amount, rounded to the cent, half up', () => {
    expect(convertCents(5450, 1.1235)).toBe(6123); // CHF 54.50 -> $61.23 (61.230...)
    expect(convertCents(120000, 0.0067)).toBe(804); // ¥1,200 -> $8.04
    expect(convertCents(10000, '0.005')).toBe(50);
    expect(convertCents(1, 0.5)).toBe(1); // half a cent rounds up
    expect(convertCents(-5450, 1.1235)).toBe(-6123);
    expect(() => scaledRate('abc')).toThrow();
    expect(() => scaledRate(0)).toThrow();
  });

  it('keeps converted shares adding up to the converted total', () => {
    const r = convertShares([1817, 1817, 1816], 1.1235); // CHF 54.50 three ways
    expect(r.total).toBe(6123);
    expect(r.shares.reduce((a, b) => a + b, 0)).toBe(6123);
    expect(r.shares).toEqual([2042, 2041, 2040]); // in proportion to 18.17, 18.17, 18.16
    expect(convertShares([0, 0], 2)).toEqual({ total: 0, shares: [0, 0] });
  });

  it('converts a bill by item so everything still adds up, for the bill and each person', () => {
    const r = convertItemized(
      {
        itemPrices: [150000, 90000, 120000], // ¥1,500, ¥900, ¥1,200
        discountCents: 30000,
        taxCents: 33000,
        tipCents: 0,
        members: [
          { memberId: 'linh', itemsCents: 190000, discountCents: 15833, taxCents: 17417, tipCents: 0 },
          { memberId: 'an', itemsCents: 170000, discountCents: 14167, taxCents: 15583, tipCents: 0 },
        ],
      },
      0.0067,
    );
    expect(r.itemPrices).toEqual([1005, 603, 804]);
    expect(r.totalCents).toBe(1005 + 603 + 804 - 201 + 221);
    expect(r.members.reduce((s, m) => s + m.totalCents, 0)).toBe(r.totalCents);
    for (const m of r.members) expect(m.totalCents).toBe(m.itemsCents - m.discountCents + m.taxCents + m.tipCents);
    expect(r.members.reduce((s, m) => s + m.discountCents, 0)).toBe(r.discountCents);
  });

  it('shows rates readably', () => {
    expect(formatRate(1.123456)).toBe('1.1235');
    expect(formatRate(0.0067341)).toBe('0.006734');
    expect(formatRate(25370.5)).toBe('25,370.5');
  });
});
