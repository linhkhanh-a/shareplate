import { describe, expect, it } from 'vitest';

import { checkHandle, hasPayInfo, payNote, payOptions } from '@/lib/pay-apps';

describe('payment app usernames', () => {
  it('takes the name out of whatever was typed or pasted', () => {
    expect(checkHandle('venmo', '@An-Nguyen')).toEqual({ ok: true, value: 'An-Nguyen' });
    expect(checkHandle('venmo', 'https://account.venmo.com/u/an_ng')).toEqual({ ok: true, value: 'an_ng' });
    expect(checkHandle('venmo', 'venmo.com/an-ng?txn=pay')).toEqual({ ok: true, value: 'an-ng' });
    expect(checkHandle('paypal', 'https://www.paypal.me/AnNguyen/10')).toEqual({ ok: true, value: 'AnNguyen' });
    expect(checkHandle('paypal', 'paypal.com/paypalme/anng')).toEqual({ ok: true, value: 'anng' });
    expect(checkHandle('cashapp', '$AnNg')).toEqual({ ok: true, value: 'AnNg' });
    expect(checkHandle('cashapp', 'https://cash.app/$AnNg')).toEqual({ ok: true, value: 'AnNg' });
    expect(checkHandle('venmo', '  ')).toEqual({ ok: true, value: null });
  });

  it('explains names that cannot be right', () => {
    expect(checkHandle('venmo', 'an nguyen').ok).toBe(false);
    expect(checkHandle('paypal', 'an.nguyen').ok).toBe(false);
    expect(checkHandle('cashapp', '$1234').ok).toBe(false);
  });
});

describe('payment links', () => {
  const handles = { venmo_username: 'an-ng', paypal_username: 'anng', cashapp_cashtag: 'AnNg' };

  it('fills in the amount and a note, in US dollars', () => {
    const o = payOptions(handles, 2450, 'USD', 'Da Lat trip (Shareplate)');
    expect(o.map((x) => x.url)).toEqual([
      'https://venmo.com/?txn=pay&recipients=an-ng&amount=24.50&note=Da%20Lat%20trip%20(Shareplate)',
      'https://paypal.me/anng/24.50USD',
      'https://cash.app/$AnNg/24.50',
    ]);
    expect(o.every((x) => x.withAmount)).toBe(true);
  });

  it('leaves the amount out for Venmo and Cash App in other currencies', () => {
    const o = payOptions(handles, 2450, 'EUR', 'Trip');
    expect(o[0].url).toBe('https://venmo.com/?txn=pay&recipients=an-ng&note=Trip');
    expect(o[1].url).toBe('https://paypal.me/anng/24.50EUR');
    expect(o[2].url).toBe('https://cash.app/$AnNg');
    expect(o.map((x) => x.withAmount)).toEqual([false, true, false]);
  });

  it('lists every way to pay for messages', () => {
    expect(payNote('an@example.com', handles)).toBe('Zelle: an@example.com, Venmo: @an-ng, PayPal: paypal.me/anng, Cash App: $AnNg');
    expect(payNote(null, { venmo_username: null })).toBe('');
    expect(hasPayInfo(null, { cashapp_cashtag: 'x1' })).toBe(true);
    expect(hasPayInfo(null, null)).toBe(false);
  });
});
