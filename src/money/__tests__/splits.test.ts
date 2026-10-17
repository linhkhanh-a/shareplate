import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  MoneyError,
  parsePercentToBasisPoints,
  splitByPercent,
  splitEqual,
  splitExact,
} from '@/money';

const amounts = (shares: { amountCents: number }[]) => shares.map((s) => s.amountCents);

describe('equal split', () => {
  it('splits $10.00 among 3 people without losing a cent', () => {
    expect(amounts(splitEqual(1000, ['a', 'b', 'c']))).toEqual([334, 333, 333]);
  });

  it('rejects an empty or duplicated member list', () => {
    expect(() => splitEqual(1000, [])).toThrow(MoneyError);
    expect(() => splitEqual(1000, ['a', 'a'])).toThrow(MoneyError);
  });

  it('never differs by more than 1 cent between people', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), fc.integer({ min: 1, max: 30 }), (total, n) => {
        const shares = amounts(splitEqual(total, Array.from({ length: n }, (_, i) => `m${i}`)));
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
      }),
    );
  });
});

describe('percentage split', () => {
  it('parses typed percentages into basis points', () => {
    expect(parsePercentToBasisPoints('33.33')).toBe(3333);
    expect(parsePercentToBasisPoints('50%')).toBe(5000);
    expect(parsePercentToBasisPoints('12.5')).toBe(1250);
    expect(() => parsePercentToBasisPoints('12.345')).toThrow(MoneyError);
  });

  it('splits by percentage and still adds up exactly', () => {
    const shares = splitByPercent(1000, [
      { memberId: 'a', basisPoints: 3333 },
      { memberId: 'b', basisPoints: 3333 },
      { memberId: 'c', basisPoints: 3334 },
    ]);
    expect(amounts(shares)).toEqual([333, 333, 334]);
  });

  it('refuses percentages that do not add up to 100%', () => {
    try {
      splitByPercent(1000, [
        { memberId: 'a', basisPoints: 5000 },
        { memberId: 'b', basisPoints: 4800 },
      ]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(MoneyError);
      expect((e as MoneyError).code).toBe('PERCENT_NOT_100');
      expect((e as MoneyError).message).toBe('Percentages add up to 98%, not 100%');
    }
  });
});

describe('exact amount split', () => {
  it('accepts amounts that match the total', () => {
    const input = [
      { memberId: 'a', amountCents: 700 },
      { memberId: 'b', amountCents: 300 },
    ];
    expect(splitExact(1000, input)).toEqual(input);
  });

  it('reports how far off the amounts are', () => {
    try {
      splitExact(1000, [
        { memberId: 'a', amountCents: 700 },
        { memberId: 'b', amountCents: 250 },
      ]);
      expect.unreachable();
    } catch (e) {
      expect((e as MoneyError).code).toBe('EXACT_NOT_TOTAL');
      expect((e as MoneyError).details?.differenceCents).toBe(50);
    }
  });
});
