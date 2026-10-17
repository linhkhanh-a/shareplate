import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { computeBalances, isSettled, MoneyError, simplifyDebts, splitEqual, type Balances } from '@/money';

const asObject = (b: Balances) => Object.fromEntries(b);

describe('balances', () => {
  it('credits the payer and debits everyone who owes', () => {
    const balances = computeBalances([{ payerId: 'Linh', shares: splitEqual(3000, ['Linh', 'An', 'Minh']) }]);
    expect(asObject(balances)).toEqual({ Linh: 2000, An: -1000, Minh: -1000 });
  });

  it('applies recorded payments', () => {
    const balances = computeBalances(
      [{ payerId: 'Linh', shares: splitEqual(3000, ['Linh', 'An', 'Minh']) }],
      [{ fromId: 'An', toId: 'Linh', amountCents: 1000 }],
    );
    expect(asObject(balances)).toEqual({ Linh: 1000, An: 0, Minh: -1000 });
  });

  it('shows members with no activity at zero', () => {
    expect(asObject(computeBalances([], [], ['guest-1']))).toEqual({ 'guest-1': 0 });
  });

  it('rejects paying yourself', () => {
    expect(() => computeBalances([], [{ fromId: 'a', toId: 'a', amountCents: 5 }])).toThrow(MoneyError);
  });
});

describe('debt simplification', () => {
  it('collapses a circle of debts to nothing', () => {
    // A paid for B, B paid for C, C paid for A, all $10.
    const balances = computeBalances([
      { payerId: 'A', shares: [{ memberId: 'B', amountCents: 1000 }] },
      { payerId: 'B', shares: [{ memberId: 'C', amountCents: 1000 }] },
      { payerId: 'C', shares: [{ memberId: 'A', amountCents: 1000 }] },
    ]);
    expect(isSettled(balances)).toBe(true);
    expect(simplifyDebts(balances)).toEqual([]);
  });

  it('routes payments through as few transfers as possible', () => {
    const balances: Balances = new Map([
      ['Linh', 5000],
      ['An', -3000],
      ['Minh', -2000],
    ]);
    expect(simplifyDebts(balances)).toEqual([
      { fromId: 'An', toId: 'Linh', amountCents: 3000 },
      { fromId: 'Minh', toId: 'Linh', amountCents: 2000 },
    ]);
  });

  it('refuses balances that do not add up to zero', () => {
    expect(() => simplifyDebts(new Map([['a', 5]]))).toThrow(MoneyError);
  });

  it('always settles everyone, with at most N - 1 payments', () => {
    const members = ['a', 'b', 'c', 'd', 'e', 'f'];
    const bill = fc.record({
      payerId: fc.constantFrom(...members),
      total: fc.integer({ min: 0, max: 100_000 }),
      split: fc.subarray(members, { minLength: 1 }),
    });
    fc.assert(
      fc.property(fc.array(bill, { maxLength: 25 }), (bills) => {
        const balances = computeBalances(
          bills.map((b) => ({ payerId: b.payerId, shares: splitEqual(b.total, b.split) })),
        );
        const sum = [...balances.values()].reduce((a, b) => a + b, 0);
        expect(sum).toBe(0);

        const transfers = simplifyDebts(balances);
        const nonZero = [...balances.values()].filter((v) => v !== 0).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
        transfers.forEach((t) => expect(t.amountCents).toBeGreaterThan(0));

        // Paying every transfer must bring everyone to exactly $0.
        const after = computeBalances(
          bills.map((b) => ({ payerId: b.payerId, shares: splitEqual(b.total, b.split) })),
          transfers,
        );
        expect(isSettled(after)).toBe(true);
      }),
    );
  });
});
