import { describe, expect, it } from 'vitest';

import {
  checkDraft,
  draftFromBill,
  draftFromScan,
  emptyDraft,
  itemizedPayload,
  looksLikeDiscount,
  moveItemToDiscount,
  type ReceiptDraft,
} from '@/lib/receipt';

const scan = {
  vendor: 'Bếp Việt',
  date: '2026-10-16',
  category: 'Food' as const,
  items: [
    { name: 'Pho', price_cents: 1500 },
    { name: 'Banh mi', price_cents: 900 },
    { name: 'Spring rolls', price_cents: 1200 },
  ],
  subtotal_cents: 3600,
  discount_cents: 600,
  tax_cents: 240,
  tip_cents: 900,
  total_cents: 4140,
  warnings: [],
};

const base = { payerId: 'linh', date: '2026-10-17', imagePath: 'trip/receipt.jpg' };

function assign(draft: ReceiptDraft, people: string[][]): ReceiptDraft {
  return { ...draft, items: draft.items.map((i, idx) => ({ ...i, memberIds: people[idx] })) };
}

describe('scan wizard drafts', () => {
  it('fills the draft from a scan, using the receipt’s date and vendor', () => {
    const d = draftFromScan(scan, base);
    expect(d).toMatchObject({ title: 'Bếp Việt', date: '2026-10-16', discount: '6.00', tax: '2.40', tip: '9.00' });
    expect(d.items.map((i) => [i.name, i.price])).toEqual([
      ['Pho', '15.00'],
      ['Banh mi', '9.00'],
      ['Spring rolls', '12.00'],
    ]);
  });

  it('checks items, then totals, then who had what, with the spec’s worked example', () => {
    const d = draftFromScan(scan, base);
    const before = checkDraft(d);
    expect(before.itemsOk).toBe(true);
    expect(before.totals).toEqual({ subtotal: 3600, discount: 600, tax: 240, tip: 900, total: 4140, rates: { discount: null, tax: null, tip: null } });
    expect(before.taxRate).toBe('8%');
    expect(before.mismatches).toEqual([]);
    expect(before.assignMessage).toBe('Choose who had "Pho" and "Banh mi" and 1 more.');

    const ready = checkDraft(assign(d, [['linh'], ['an'], ['linh', 'an', 'minh']]));
    expect(ready.result?.members.map((m) => [m.memberId, m.totalCents])).toEqual([
      ['linh', 2010],
      ['an', 1470],
      ['minh', 660],
    ]);
  });

  it('points at the exact item that needs fixing', () => {
    const d = draftFromScan(scan, base);
    d.items[1] = { ...d.items[1], price: 'abc' };
    d.items[2] = { ...d.items[2], name: ' ' };
    const c = checkDraft(d);
    expect(c.itemsOk).toBe(false);
    expect(c.itemErrors[d.items[1].key]).toMatch(/price/);
    expect(c.itemErrors[d.items[2].key]).toMatch(/name/);
  });

  it('warns when the typed numbers disagree with the printed receipt', () => {
    const d = { ...draftFromScan(scan, base), tip: '10' };
    expect(checkDraft(d).mismatches[0]).toMatch(/comes to \$42\.40, but the receipt's total says \$41\.40/);
  });

  it('builds the save payload with each person’s breakdown', () => {
    const d = assign(draftFromScan(scan, base), [['linh'], ['an'], ['linh', 'an', 'minh']]);
    const c = checkDraft(d);
    const p = itemizedPayload(d, c.result!, { tripId: 't1' });
    expect(p).toMatchObject({ group_id: 't1', paid_by_member_id: 'linh', discount_cents: 600, tax_cents: 240, tip_cents: 900 });
    expect(p.items[2]).toEqual({ name: 'Spring rolls', price_cents: 1200, member_ids: ['linh', 'an', 'minh'] });
    expect(p.participants.reduce((s, x) => s + x.amount_cents, 0)).toBe(4140);
  });

  it('round-trips a saved bill back into an editable draft', () => {
    const d = draftFromBill({
      title: 'Dinner',
      vendor: 'Bếp Việt',
      category: 'Food',
      bill_date: '2026-10-16',
      paid_by_member_id: 'an',
      discount_cents: 0,
      tax_cents: 240,
      tip_cents: 0,
      bill_image_path: null,
      items: [{ name: 'Pho', price_cents: 1500, member_ids: ['linh'] }],
    });
    expect(d).toMatchObject({ payerId: 'an', discount: '', tax: '2.40', tip: '' });
    expect(checkDraft(d).result?.totalCents).toBe(1740);
  });

  it('starts a hand-typed bill with one empty item', () => {
    const d = emptyDraft({ payerId: 'linh', date: '2026-10-17' });
    expect(d.items).toHaveLength(1);
    expect(checkDraft(d).itemsOk).toBe(false);
  });

  it('says how far the items are from the printed subtotal, and accepts either style of subtotal', () => {
    // Printed before discounts: matches.
    expect(checkDraft(draftFromScan(scan, base)).mismatches).toEqual([]);
    // Printed after discounts: also matches.
    expect(checkDraft(draftFromScan({ ...scan, subtotal_cents: 3000 }, base)).mismatches).toEqual([]);
    // A $4 TPD line read as an item: says by how much.
    const withTpd = draftFromScan(
      { ...scan, subtotal_cents: 3000, total_cents: null, items: [...scan.items, { name: 'TPD/1234567', price_cents: 400 }] },
      base,
    );
    expect(checkDraft(withTpd).mismatches).toEqual([
      "Items come to $34.00 after discounts, $4.00 more than the receipt's subtotal of $30.00. " +
        "Look for discount lines read as items (they'd add up to $2.00 or $4.00), or a misread price.",
    ]);
  });

  it('moves a discount line out of the items with one tap', () => {
    const d = draftFromScan(
      // The receipt prints its subtotal after both discounts ($6 + $4): $26.00, total $37.40.
      { ...scan, subtotal_cents: 2600, total_cents: 3740, items: [...scan.items, { name: 'TPD/1234567', price_cents: 400 }] },
      base,
    );
    expect(checkDraft(d).mismatches).toHaveLength(2);
    const tpd = d.items[3];
    expect(looksLikeDiscount(tpd.name)).toBe(true);
    expect(looksLikeDiscount('Spring rolls')).toBe(false);

    const moved = moveItemToDiscount(d, tpd.key);
    expect(moved.items.map((i) => i.name)).toEqual(['Pho', 'Banh mi', 'Spring rolls']);
    expect(moved.discount).toBe('10.00');
    const c = checkDraft(moved);
    expect(c.totals).toMatchObject({ subtotal: 3600, discount: 1000, total: 3740 });
    expect(c.mismatches).toEqual([]);
    // Unknown keys leave the draft alone.
    expect(moveItemToDiscount(d, 'nope')).toBe(d);
  });

  it('spots a total that only adds up with the tax already included, and fixes it in one tap', () => {
    const d = draftFromScan(
      {
        vendor: 'Berghotel Grosse Scheidegg',
        date: '2007-07-30',
        category: 'Food',
        items: [
          { name: '2× Latte Macchiato', price_cents: 900 },
          { name: 'Gloki', price_cents: 500 },
          { name: 'Schweinschnitzel', price_cents: 2200 },
          { name: 'Chässpätzli', price_cents: 1850 },
        ],
        subtotal_cents: null,
        discount_cents: 0,
        tax_cents: 385,
        tip_cents: 0,
        total_cents: 5450,
        warnings: [],
      },
      base,
    );
    const c = checkDraft(d);
    expect(c.totals?.total).toBe(5835);
    expect(c.taxLooksIncluded).toBe(true);
    expect(c.mismatches[0]).toMatch(/exactly the tax less\. The tax looks already included/);

    const fixed = checkDraft({ ...d, tax: '' });
    expect(fixed).toMatchObject({ taxLooksIncluded: false, mismatches: [] });
    expect(fixed.totals?.total).toBe(5450);

    // A total that's off for another reason isn't blamed on tax.
    expect(checkDraft({ ...d, tip: '1' }).taxLooksIncluded).toBe(false);
  });
});

describe('discount, tax and tip as $ or %', () => {
  const draft = (): ReceiptDraft => ({
    ...emptyDraft({ payerId: 'linh', date: '2026-10-17' }),
    items: [
      { key: 'a', name: 'Pho', price: '15', memberIds: ['linh'] },
      { key: 'b', name: 'Banh mi', price: '25', memberIds: ['an'] },
    ],
  });

  it('works out percentages from the right base, rounded to the cent', () => {
    // $40 of items, 10% off = $4; 8.875% tax on $36 = $3.195 -> $3.20; 18% tip on $36 = $6.48.
    const d = { ...draft(), discount: '10', discountMode: 'percent' as const, tax: '8.875', taxMode: 'percent' as const, tip: '18', tipMode: 'percent' as const };
    const c = checkDraft(d);
    expect(c.totals).toMatchObject({ subtotal: 4000, discount: 400, tax: 320, tip: 648, total: 4568 });
    expect(c.totals?.rates).toEqual({ discount: 1000, tax: 888, tip: 1800 });
    const payload = itemizedPayload(d, c.result!, { tripId: 't' });
    expect(payload).toMatchObject({ discount_cents: 400, tax_cents: 320, tip_cents: 648, discount_rate_bp: 1000, tax_rate_bp: 888, tip_rate_bp: 1800 });
  });

  it('mixes amounts and percentages, and refuses a discount over 100%', () => {
    const c = checkDraft({ ...draft(), discount: '5', tax: '10%', taxMode: 'percent' });
    expect(c.totals).toMatchObject({ discount: 500, tax: 350, total: 3850 });
    expect(checkDraft({ ...draft(), discount: '120', discountMode: 'percent' }).totalsMessage).toBe('A discount can be at most 100%.');
    expect(checkDraft({ ...draft(), tip: 'abc', tipMode: 'percent' }).totalsMessage).toMatch(/like 3.50 or 10%/);
  });

  it('reopens a saved bill showing the percentages that were typed', () => {
    const d = draftFromBill({
      title: 'Pho',
      vendor: null,
      category: 'Food',
      bill_date: '2026-10-17',
      paid_by_member_id: 'linh',
      discount_cents: 400,
      tax_cents: 320,
      tip_cents: 500,
      discount_rate_bp: 1000,
      tax_rate_bp: 888,
      tip_rate_bp: null,
      bill_image_path: null,
      items: [{ name: 'Pho', price_cents: 4000, member_ids: ['linh'] }],
    });
    expect(d).toMatchObject({ discount: '10', discountMode: 'percent', tax: '8.88', taxMode: 'percent', tip: '5.00', tipMode: 'amount' });
  });

  it('accepts prices with extra decimals, rounded to the cent', () => {
    const c = checkDraft({ ...draft(), items: [{ key: 'a', name: 'Pho', price: '12.345', memberIds: ['linh'] }] });
    expect(c.totals?.subtotal).toBe(1235);
  });
});
