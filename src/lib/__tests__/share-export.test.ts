import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';

import { billsCsv, csvValue, exportSheets, fileSlug, type ExportInput } from '@/lib/export';
import type { Bill, Member, Payment } from '@/lib/queries';
import { personMessage, summaryText, tripSummary } from '@/lib/summary';
import { buildXlsx, columnName, safeSheetNames } from '@/lib/xlsx';

const member = (id: string, name: string, zelle: string | null, guest = false): Member => ({
  zelle_identifier: guest ? zelle : null,
  id,
  user_id: guest ? null : `u-${id}`,
  display_name: name,
  role: 'member',
  joined_at: '2026-10-17T00:00:00Z',
  left_at: null,
  daily_allowance_cents: 0,
  profile: guest ? null : { zelle_identifier: zelle },
});

const members = [
  member('linh', 'Linh Bui', 'linh@example.com'),
  member('an', 'An Nguyễn', '(614) 555-0142'),
  member('huong', 'Hương', 'huong@example.com', true),
];

const bill = (id: string, date: string, payer: string, shares: [string, number][], extra: Partial<Bill> = {}): Bill => {
  const total = shares.reduce((s, [, c]) => s + c, 0);
  return {
    id,
    title: null,
    vendor: null,
    category: 'Food',
    split_mode: 'equal',
    subtotal_cents: total,
    discount_cents: 0,
    tax_cents: 0,
    tip_cents: 0,
    total_cents: total,
    bill_date: date,
    bill_image_path: null,
    paid_by_member_id: payer,
    itinerary_item_id: null,
    version: 1,
    created_at: `${date}T12:00:00Z`,
    shares: shares.map(([group_member_id, amount_cents]) => ({
      group_member_id,
      amount_cents,
      share_input: null,
      items_cents: amount_cents,
      discount_cents: 0,
      tax_cents: 0,
      tip_cents: 0,
    })),
    ...extra,
  };
};

const bills = [
  bill('b1', '2026-10-24', 'linh', [['linh', 2000], ['an', 2000], ['huong', 2000]], { title: 'Hotpot, "the good one"', itinerary_item_id: 'a1' }),
  bill('b2', '2026-10-23', 'an', [['an', 600], ['huong', 1200]], { title: '=Grab', split_mode: 'exact', category: 'Transport' }),
];
const payments: Payment[] = [
  { id: 'p1', from_member_id: 'huong', to_member_id: 'linh', amount_cents: 1000, settled_on: '2026-10-25', created_at: '', created_by: null },
];

const input: ExportInput = {
  tripName: 'Đà Lạt spring break',
  members,
  bills,
  payments,
  activities: [
    {
      id: 'a1',
      day_number: 2,
      position: 0,
      start_time: null,
      end_time: null,
      title: 'Night market',
      location: null,
      notes: null,
      proposed_budget_cents: 0,
      version: 1,
      created_at: '',
    },
  ],
  items: new Map([['b1', [{ id: 'i1', name: 'Hotpot for 3', price_cents: 6000, position: 0, member_ids: ['linh', 'an', 'huong'] }]]]),
};

describe('trip summary', () => {
  it('works out what everyone paid, used, and owes', () => {
    const s = tripSummary(input);
    expect(s.total).toBe(7800);
    expect(s.people.map((p) => [p.name, p.paid, p.share, p.sent, p.received, p.balance])).toEqual([
      ['Linh Bui', 6000, 2000, 0, 1000, 3000],
      ['An Nguyễn', 1800, 2600, 0, 0, -800],
      ['Hương', 0, 3200, 1000, 0, -2200],
    ]);
    expect(s.people.reduce((sum, p) => sum + p.balance, 0)).toBe(0);
    expect(s.transfers.map((t) => [t.fromName, t.toName, t.amount, t.toZelle])).toEqual([
      ['Hương', 'Linh Bui', 2200, 'linh@example.com'],
      ['An Nguyễn', 'Linh Bui', 800, 'linh@example.com'],
    ]);
  });

  it('writes a group message and a personal one for each person', () => {
    const s = tripSummary(input);
    expect(summaryText(s)).toBe(
      [
        'Đà Lạt spring break: $78.00 spent on 2 bills.',
        '',
        'Each person’s share:',
        '• Linh Bui: $20.00',
        '• An Nguyễn: $26.00',
        '• Hương: $32.00',
        '',
        'To settle up:',
        '• Hương pays Linh Bui $22.00 (Zelle: linh@example.com)',
        '• An Nguyễn pays Linh Bui $8.00 (Zelle: linh@example.com)',
        '',
        'Split with Shareplate',
      ].join('\n'),
    );
    expect(personMessage(s, 'huong')).toBe(
      'Hi Hương! Your share of Đà Lạt spring break comes to $32.00.\nPlease send $22.00 to Linh Bui by Zelle at linh@example.com.\nThanks!',
    );
    // Sent by Linh, money owed to Linh reads "to me".
    expect(personMessage(s, 'an', 'linh')).toBe(
      'Hi An Nguyễn! Your share of Đà Lạt spring break comes to $26.00.\nPlease send $8.00 to me by Zelle at linh@example.com.\nThanks!',
    );
    expect(personMessage(s, 'linh')).toBe(
      "Hi Linh Bui! Your share of Đà Lạt spring break comes to $20.00.\nYou're owed $30.00: Hương will send you $22.00, An Nguyễn will send you $8.00.\nThanks!",
    );
  });
});

describe('messages for people who are settled', () => {
  it('says there is nothing to pay', () => {
    const s = tripSummary({ ...input, payments: [...payments, { id: 'p2', from_member_id: 'huong', to_member_id: 'linh', amount_cents: 2200, settled_on: '2026-10-26', created_at: '', created_by: null }, { id: 'p3', from_member_id: 'an', to_member_id: 'linh', amount_cents: 800, settled_on: '2026-10-26', created_at: '', created_by: null }] });
    expect(s.transfers).toEqual([]);
    expect(personMessage(s, 'an')).toContain('You’re all settled up, so there’s nothing to pay.');
  });
});

describe('spreadsheet export', () => {
  it('lays out bills by date with everyone’s share, plus items, people, settle up and payments', () => {
    const sheets = exportSheets(input);
    expect(sheets.map((s) => s.name)).toEqual(['Bills', 'Items', 'People', 'Settle up', 'Payments']);
    const [billsSheet, items, people] = sheets;
    expect(billsSheet.rows[0]).toEqual([
      'Date', 'What', 'Category', 'Paid by', 'Subtotal', 'Discount', 'Tax', 'Tip', 'Total', 'Split', 'Plan', 'Linh Bui', 'An Nguyễn', 'Hương',
    ]);
    expect(billsSheet.rows[1].slice(0, 4)).toEqual([{ date: '2026-10-23' }, '=Grab', 'Transport', 'An Nguyễn']);
    expect(billsSheet.rows[1].slice(-3)).toEqual([null, { money: 6 }, { money: 12 }]);
    expect(billsSheet.rows[2][10]).toBe('Night market');
    expect(items.rows[1]).toEqual([{ date: '2026-10-24' }, 'Hotpot, "the good one"', 'Hotpot for 3', { money: 60 }, 'Linh Bui, An Nguyễn, Hương']);
    expect(people.rows[3]).toEqual(['Hương (guest)', { money: 0 }, { money: 32 }, { money: 10 }, { money: 0 }, { money: -22 }, 'Owes', 'huong@example.com']);
  });

  it('writes CSV that spreadsheets open safely', () => {
    const csv = billsCsv(input);
    expect(csv.startsWith('﻿Date,What,')).toBe(true);
    const lines = csv.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    // A title starting with "=" is never run as a formula; quotes and commas are escaped.
    expect(lines[1]).toBe("2026-10-23,'=Grab,Transport,An Nguyễn,18.00,0.00,0.00,0.00,18.00,Exact amounts,,,6.00,12.00");
    expect(lines[2]).toContain('"Hotpot, ""the good one"""');
    expect(csvValue('line\nbreak')).toBe('"line\nbreak"');
  });

  it('builds a valid .xlsx workbook', () => {
    const bytes = buildXlsx(exportSheets(input));
    const files = unzipSync(bytes);
    expect(Object.keys(files).sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
      'xl/worksheets/sheet3.xml',
      'xl/worksheets/sheet4.xml',
      'xl/worksheets/sheet5.xml',
    ]);
    const sheet1 = strFromU8(files['xl/worksheets/sheet1.xml']);
    expect(sheet1).toContain('<c r="A2" s="3"><v>46318</v></c>'); // 2026-10-23 as an Excel date
    expect(sheet1).toContain('<c r="I2" s="2"><v>18</v></c>'); // $18.00
    expect(sheet1).toContain('Hotpot, &quot;the good one&quot;');
    expect(strFromU8(files['xl/workbook.xml'])).toContain('<sheet name="Settle up" sheetId="4" r:id="rId4"/>');
  });

  it('never writes a broken number into a file', () => {
    const files = unzipSync(buildXlsx([{ name: 'S', rows: [['A', 'B'], [{ money: NaN }, Infinity]] }]));
    expect(strFromU8(files['xl/worksheets/sheet1.xml'])).toContain('<row r="2"></row>');
    expect(csvValue({ money: NaN })).toBe('');
  });

  it('names columns, sheets and files safely', () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(['A', 'Z', 'AA', 'AB', 'ZZ', 'AAA']);
    expect(safeSheetNames(['Bills', 'bills', 'a/b:c', 'x'.repeat(40)])).toEqual(['Bills', 'bills 2', 'a b c', 'x'.repeat(31)]);
    expect(fileSlug('Đà Lạt spring break!')).toBe('da-lat-spring-break');
    expect(fileSlug('🎉')).toBe('trip');
  });
});

describe('spreadsheet currency', () => {
  it('shows money cells with the trip currency sign', () => {
    const files = unzipSync(buildXlsx(exportSheets(input), 'CHF '));
    expect(strFromU8(files['xl/styles.xml'])).toContain('formatCode="&quot;CHF &quot;#,##0.00"');
    expect(strFromU8(unzipSync(buildXlsx(exportSheets(input)))['xl/styles.xml'])).toContain('&quot;$&quot;#,##0.00');
  });
});
