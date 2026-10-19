import { describe, expect, it } from 'vitest';

import { parseShares, sharesText, splitByShares } from '@/money';

describe('split by shares', () => {
  it('reads typed shares as hundredths', () => {
    expect(parseShares('2')).toBe(200);
    expect(parseShares('1.5')).toBe(150);
    expect(parseShares('0,5')).toBe(50);
    expect(parseShares('.25')).toBe(25);
    expect(parseShares('0.333')).toBe(33);
    expect(parseShares('0.335')).toBe(34);
    expect(parseShares('abc')).toBeNull();
    expect(parseShares('')).toBeNull();
    expect(parseShares('1001')).toBeNull();
  });

  it('writes shares back as short text', () => {
    expect(sharesText(200)).toBe('2');
    expect(sharesText(150)).toBe('1.5');
    expect(sharesText(25)).toBe('0.25');
  });

  it('splits in proportion and always adds up to the cent', () => {
    const s = splitByShares(10000, [
      { memberId: 'a', shares: 200 },
      { memberId: 'b', shares: 100 },
      { memberId: 'c', shares: 100 },
    ]);
    expect(s.map((x) => x.amountCents)).toEqual([5000, 2500, 2500]);
    const odd = splitByShares(1000, [
      { memberId: 'a', shares: 100 },
      { memberId: 'b', shares: 100 },
      { memberId: 'c', shares: 100 },
    ]);
    expect(odd.reduce((t, x) => t + x.amountCents, 0)).toBe(1000);
    const kid = splitByShares(2500, [
      { memberId: 'a', shares: 100 },
      { memberId: 'b', shares: 100 },
      { memberId: 'kid', shares: 50 },
    ]);
    expect(kid.map((x) => x.amountCents)).toEqual([1000, 1000, 500]);
  });

  it('needs everyone to have some shares', () => {
    expect(() => splitByShares(1000, [{ memberId: 'a', shares: 0 }])).toThrow();
  });
});
