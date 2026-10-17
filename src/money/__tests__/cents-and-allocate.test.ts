import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { allocate, formatCents, MoneyError, parseCents } from '@/money';

describe('parseCents / formatCents', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.34', 1234],
    ['$1,234.56', 123456],
    ['.99', 99],
    ['0', 0],
    ['-5', -500],
  ])('parses %s as %d cents', (text, cents) => {
    expect(parseCents(text)).toBe(cents);
  });

  it.each(['', 'abc', '1.234', '1,23', '$'])('rejects %j', (text) => {
    expect(() => parseCents(text)).toThrow(MoneyError);
  });

  it('formats cents for display', () => {
    expect(formatCents(123456)).toBe('$1,234.56');
    expect(formatCents(5)).toBe('$0.05');
    expect(formatCents(-500)).toBe('-$5.00');
  });

  it('round-trips any amount', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1e10, max: 1e10 }), (cents) => {
        expect(parseCents(formatCents(cents))).toBe(cents);
      }),
    );
  });
});

describe('allocate (largest remainder)', () => {
  it('splits $10.00 three ways as 3.34 / 3.33 / 3.33', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
  });

  it('gives leftover cents to the biggest fractional parts', () => {
    // exact: 1.666..., 3.333... -> floors 1, 3 (leftover 1) -> bigger fraction is .666
    expect(allocate(5, [1, 2])).toEqual([2, 3]);
  });

  it('gives zero to zero weights', () => {
    expect(allocate(100, [0, 1, 0, 1])).toEqual([0, 50, 0, 50]);
  });

  it('handles negative totals as a mirror image', () => {
    expect(allocate(-1000, [1, 1, 1])).toEqual([-334, -333, -333]);
  });

  it('rejects bad weights', () => {
    expect(() => allocate(100, [])).toThrow(MoneyError);
    expect(() => allocate(100, [0, 0])).toThrow(MoneyError);
    expect(() => allocate(100, [-1, 2])).toThrow(MoneyError);
    expect(() => allocate(100.5, [1])).toThrow(MoneyError);
  });

  it('always sums exactly and stays within 1 cent of the exact share', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000_000 }),
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 20 }),
        (total, weights) => {
          fc.pre(weights.some((w) => w > 0));
          const pieces = allocate(total, weights);
          const weightSum = weights.reduce((a, b) => a + b, 0);
          expect(pieces.reduce((a, b) => a + b, 0)).toBe(total);
          pieces.forEach((piece, i) => {
            const exact = (total * weights[i]) / weightSum;
            expect(Math.abs(piece - exact)).toBeLessThan(1 + 1e-6);
            if (weights[i] === 0) expect(piece).toBe(0);
          });
        },
      ),
    );
  });
});
