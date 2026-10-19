import { describe, expect, it } from 'vitest';

import { checkRequest, findRate, frankfurterUrl, parseFrankfurter, parseOpenEr } from './core.ts';

describe('exchange rates', () => {
  it('checks the request, and never asks for a future date', () => {
    expect(checkRequest({ from: 'CHF', to: 'USD', date: '2026-10-17' }, '2026-10-19')).toEqual({ from: 'CHF', to: 'USD', date: '2026-10-17' });
    expect(checkRequest({ from: 'CHF', to: 'USD', date: '2027-01-01' }, '2026-10-19').date).toBe('2026-10-19');
    expect(checkRequest({ from: 'CHF', to: 'USD' }, '2026-10-19').date).toBe('2026-10-19');
    expect(() => checkRequest({ from: 'chf', to: 'USD' }, '2026-10-19')).toThrow();
    expect(frankfurterUrl('CHF', 'USD', '2026-10-17')).toBe('https://api.frankfurter.dev/v1/2026-10-17?base=CHF&symbols=USD');
  });

  it('reads both sources', () => {
    expect(parseFrankfurter({ amount: 1, base: 'CHF', date: '2026-10-16', rates: { USD: 1.1235 } }, 'USD')).toEqual({
      rate: 1.1235,
      date: '2026-10-16',
      source: 'European Central Bank',
    });
    expect(parseFrankfurter({ rates: {} }, 'USD')).toBeNull();
    expect(parseOpenEr({ result: 'success', time_last_update_unix: 1792022400, rates: { USD: 0.0000394 } }, 'USD')).toMatchObject({
      rate: 0.0000394,
      source: 'ExchangeRate-API',
    });
    expect(parseOpenEr({ result: 'error' }, 'USD')).toBeNull();
  });

  it('uses the ECB first, the open feed for currencies the ECB lacks, and explains when neither answers', async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(new URL(url).host);
      if (url.includes('frankfurter')) return new Response('{"message":"not found"}', { status: 404 });
      return new Response(JSON.stringify({ result: 'success', time_last_update_unix: 1792022400, rates: { USD: 0.0000394 } }));
    }) as unknown as typeof fetch;
    expect((await findRate('VND', 'USD', '2026-10-17', fake)).source).toBe('ExchangeRate-API');
    expect(calls).toEqual(['api.frankfurter.dev', 'open.er-api.com']);
    expect(await findRate('USD', 'USD', '2026-10-17', fake)).toMatchObject({ rate: 1 });
    const down = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    await expect(findRate('CHF', 'USD', '2026-10-17', down)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
