import { describe, expect, it } from 'vitest';

import { checkDraft, draftFromBill, draftFromScan, emptyDraft, itemizedPayload, type ReceiptDraft } from '@/lib/receipt';

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
    expect(before.totals).toEqual({ subtotal: 3600, discount: 600, tax: 240, tip: 900, total: 4140 });
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
});
