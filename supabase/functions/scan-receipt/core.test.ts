import { describe, expect, it } from 'vitest';

import { bytesToBase64, extractJson, normalizeReceipt, readWithGemini, ScanError, scanReceipt, toCents } from './core.ts';

const receiptJson = {
  is_receipt: true,
  vendor: 'Bếp Việt',
  date: '2026-10-17',
  category: 'Food',
  items: [
    { name: 'Phở bò', quantity: 1, line_total: 15 },
    { name: 'Bánh mì', quantity: 2, line_total: '9.00' },
    { name: 'Spring rolls', quantity: null, line_total: 12 },
    { name: 'Voucher', quantity: null, line_total: -6 },
  ],
  subtotal: 36,
  discount: null,
  tax: 2.4,
  tip: 9,
  total: 41.4,
};

describe('normalizeReceipt', () => {
  it('turns the reader’s answer into cents, moving discount lines out of the items', () => {
    const r = normalizeReceipt(receiptJson);
    expect(r).toMatchObject({
      vendor: 'Bếp Việt',
      date: '2026-10-17',
      category: 'Food',
      items: [
        { name: 'Phở bò', price_cents: 1500 },
        { name: '2× Bánh mì', price_cents: 900 },
        { name: 'Spring rolls', price_cents: 1200 },
      ],
      subtotal_cents: 3600,
      discount_cents: 600,
      tax_cents: 240,
      tip_cents: 900,
      total_cents: 4140,
      warnings: ['Counted this line as a discount, not items: Voucher. Check the discount on the next step.'],
    });
  });

  it('treats Costco-style TPD lines and trailing-minus amounts as discounts', () => {
    const r = normalizeReceipt({
      is_receipt: true,
      items: [
        { name: 'KS Paper Towel', line_total: 23.99 },
        { name: 'TPD/1234567', line_total: 4.0 },
        { name: 'Rotisserie Chicken', line_total: 4.99 },
        { name: 'Instant Savings', line_total: '1.50-' },
        { name: 'Olive oil', line_total: 18 },
      ],
      subtotal: 46.98,
      tax: 0,
      total: 41.48,
    });
    expect(r.items.map((i) => i.name)).toEqual(['KS Paper Towel', 'Rotisserie Chicken', 'Olive oil']);
    expect(r.discount_cents).toBe(550);
    expect(r.warnings).toEqual([
      'Counted 2 lines as discounts, not items: TPD/1234567, Instant Savings. Check the discount on the next step.',
    ]);
  });

  it('does not add tax that is already inside the prices ("Incl. 7.6% MwSt")', () => {
    const berghotel = {
      is_receipt: true,
      vendor: 'Berghotel Grosse Scheidegg',
      items: [
        { name: 'Latte Macchiato', quantity: 2, line_total: 9 },
        { name: 'Gloki', quantity: 1, line_total: 5 },
        { name: 'Schweinschnitzel', quantity: 1, line_total: 22 },
        { name: 'Chässpätzli', quantity: 1, line_total: 18.5 },
      ],
      subtotal: null,
      tax: 3.85,
      total: 54.5,
    };
    // The reader says so…
    const flagged = normalizeReceipt({ ...berghotel, tax_included: true });
    expect(flagged).toMatchObject({ tax_cents: 0, total_cents: 5450 });
    expect(flagged.warnings).toEqual(["The prices already include the tax (3.85), so it isn't added again."]);
    // …or the numbers give it away even when it doesn't.
    expect(normalizeReceipt(berghotel).tax_cents).toBe(0);
    // Philippine receipts too: VAT inside the subtotal, a 10% service charge on top.
    const bagOfBeans = normalizeReceipt({
      is_receipt: true,
      items: [
        { name: 'Coffee Choco Banana', line_total: 170 },
        { name: 'HotGreen Tea', line_total: 100 },
        { name: 'D White mocha', line_total: 165 },
        { name: 'Blueberry Cheesecake [Slice]', line_total: 175 },
      ],
      subtotal: 610,
      tax: 65.36,
      tip: 54.46,
      total: 664.46,
    });
    expect(bagOfBeans).toMatchObject({ tax_cents: 0, tip_cents: 5446, total_cents: 66446 });
    // Tax added on top stays as it is.
    const onTop = normalizeReceipt({ ...berghotel, tax_included: false, total: 58.35 });
    expect(onTop).toMatchObject({ tax_cents: 385, warnings: [] });
  });

  it('accepts a subtotal printed after discounts', () => {
    const r = normalizeReceipt({
      is_receipt: true,
      items: [
        { name: 'Milk', line_total: 10 },
        { name: 'Eggs', line_total: 6 },
      ],
      discount: 2,
      subtotal: 14,
      total: 14,
    });
    expect(r.warnings).toEqual([]);
  });

  it('does not mistake ordinary items for discounts', () => {
    const r = normalizeReceipt({
      is_receipt: true,
      items: [
        { name: 'Discovery Kids Book', line_total: 12 },
        { name: 'Promotional mug', line_total: 8 },
        { name: 'Tpdx cable', line_total: 5 },
      ],
    });
    expect(r.items).toHaveLength(3);
    expect(r.discount_cents).toBe(0);
  });

  it('flags prices it couldn’t read, leaving total checks to the app', () => {
    const r = normalizeReceipt({
      ...receiptJson,
      items: [{ name: 'Phở bò', line_total: 15 }, { name: 'Smudged line', line_total: null }],
    });
    expect(r.items).toEqual([
      { name: 'Phở bò', price_cents: 1500 },
      { name: 'Smudged line', price_cents: 0 },
    ]);
    expect(r.warnings.join(' ')).toMatch(/Couldn't read the price for "Smudged line"/);
    expect(r.warnings).toHaveLength(1);
  });

  it('refuses photos that aren’t receipts, and cleans up odd values', () => {
    expect(() => normalizeReceipt({ is_receipt: false, items: [] })).toThrow(ScanError);
    const r = normalizeReceipt({ is_receipt: true, items: [], category: 'Spaceships', date: '17/10/2026', tax: -1.5 });
    expect(r).toMatchObject({ category: 'Other', date: null, tax_cents: 150 });
    expect(r.warnings[0]).toMatch(/Couldn't find any items/);
  });
});

describe('helpers', () => {
  it('reads amounts in any common format', () => {
    expect(toCents(12.5)).toBe(1250);
    expect(toCents('$1,234.56')).toBe(123456);
    expect(toCents('abc')).toBe(null);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents('4.99-')).toBe(-499);
    expect(toCents('-4.99')).toBe(-499);
    expect(toCents('(4.99)')).toBe(-499);
    expect(toCents(-3)).toBe(-300);
  });

  it('pulls JSON out of fenced or chatty replies', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here you go: {"a":2} hope that helps')).toEqual({ a: 2 });
    expect(() => extractJson('no json here')).toThrow(ScanError);
  });

  it('base64-encodes photo bytes', () => {
    expect(bytesToBase64(new TextEncoder().encode('hi'))).toBe('aGk=');
  });
});

type Call = { url: string; body: Record<string, unknown> };
function fakeGoogle(replies: { status: number; json?: unknown }[]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    return { ok: r.status < 300, status: r.status, json: async () => r.json, text: async () => JSON.stringify(r.json) };
  };
  return { calls, fetchImpl };
}

const opts = { apiKey: 'k', model: 'gemini-3.8-flash', imageBase64: 'aGk=', mimeType: 'image/jpeg' };
const interactionReply = (text: string) => ({ steps: [{ type: 'model_output', content: [{ type: 'text', text }] }] });

describe('readWithGemini', () => {
  it('uses Google’s current API and reads the model output', async () => {
    const google = fakeGoogle([{ status: 200, json: interactionReply(JSON.stringify(receiptJson)) }]);
    const r = await scanReceipt({ ...opts, fetchImpl: google.fetchImpl });
    expect(r.total_cents).toBe(4140);
    expect(google.calls).toHaveLength(1);
    expect(google.calls[0].url).toMatch(/\/v1beta\/interactions$/);
    expect(google.calls[0].body).toMatchObject({ model: 'gemini-3.8-flash', store: false });
  });

  it('falls back to simpler requests when Google refuses the request shape', async () => {
    const google = fakeGoogle([
      { status: 400, json: { error: 'unknown field response_format' } },
      { status: 404, json: {} },
      { status: 200, json: { candidates: [{ content: { parts: [{ text: JSON.stringify(receiptJson) }] } }] } },
    ]);
    const r = await scanReceipt({ ...opts, fetchImpl: google.fetchImpl });
    expect(r.items).toHaveLength(3);
    expect(google.calls.map((c) => c.url)).toEqual([
      expect.stringMatching(/interactions$/),
      expect.stringMatching(/interactions$/),
      expect.stringMatching(/models\/gemini-3\.8-flash:generateContent$/),
    ]);
    expect(google.calls[1].body).not.toHaveProperty('response_format');
  });

  it('explains the free-tier limit instead of failing silently', async () => {
    const google = fakeGoogle([{ status: 429 }]);
    await expect(readWithGemini({ ...opts, fetchImpl: google.fetchImpl })).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('stops on real errors like a bad API key', async () => {
    const google = fakeGoogle([{ status: 403, json: { error: 'API key not valid' } }]);
    await expect(readWithGemini({ ...opts, fetchImpl: google.fetchImpl })).rejects.toMatchObject({
      code: 'READER_FAILED',
      message: expect.stringContaining('status 403'),
    });
    expect(google.calls).toHaveLength(1);
  });
});
