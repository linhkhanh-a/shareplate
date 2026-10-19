import type { Activity } from '@/lib/itinerary';
import type { Bill, BillItem, Member, Payment } from '@/lib/queries';
import { tripSummary } from '@/lib/summary';
import type { Cell, Sheet } from '@/lib/xlsx';
import { formatIn, type Cents } from '@/money';

export interface ExportInput {
  tripName: string;
  members: Member[];
  bills: Bill[];
  payments: Payment[];
  activities: Activity[];
  /** Items of scanned (itemized) bills, by bill id. */
  items: Map<string, BillItem[]>;
}

const MODE_NAMES: Record<string, string> = {
  equal: 'Equally',
  percent: 'By percent',
  exact: 'Exact amounts',
  itemized: 'By item',
};

// Spreadsheets show dollars; the app's cents are only converted here, for display.
const money = (cents: Cents): Cell => ({ money: cents / 100 });

/** The workbook: bills, items, people, payments and how to settle up. */
export function exportSheets(input: ExportInput): Sheet[] {
  const { members, bills, payments, activities, items } = input;
  const summary = tripSummary(input);
  const name = new Map(members.map((m) => [m.id, m.display_name]));
  const who = (id: string) => name.get(id) ?? 'Someone';
  const plan = new Map(activities.map((a) => [a.id, a.title]));
  const people = summary.people;
  const byDate = [...bills].sort((a, b) => a.bill_date.localeCompare(b.bill_date) || a.created_at.localeCompare(b.created_at));

  const billSheet: Sheet = {
    name: 'Bills',
    widths: [12, 28, 12, 16, 11, 11, 10, 10, 11, 16, 14, 22, ...people.map(() => 14)],
    rows: [
      ['Date', 'What', 'Category', 'Paid by', 'Subtotal', 'Discount', 'Tax', 'Tip', 'Total', 'Paid in', 'Split', 'Plan', ...people.map((p) => p.name)],
      ...byDate.map((b): Cell[] => [
        { date: b.bill_date },
        b.title || b.vendor || b.category,
        b.category,
        who(b.paid_by_member_id),
        money(b.subtotal_cents),
        money(b.discount_cents),
        money(b.tax_cents),
        money(b.tip_cents),
        money(b.total_cents),
        // Paid in another currency: what was actually paid (the rest of the row is converted).
        b.currency && b.original_total_cents ? `${formatIn(b.original_total_cents, b.currency)} at ${b.fx_rate}` : '',
        MODE_NAMES[b.split_mode] ?? b.split_mode,
        b.itinerary_item_id ? (plan.get(b.itinerary_item_id) ?? '') : '',
        ...people.map((p) => {
          const share = b.shares.find((s) => s.group_member_id === p.id);
          return share ? money(share.amount_cents) : null;
        }),
      ]),
    ],
  };

  const itemRows: Cell[][] = [];
  for (const b of byDate) {
    for (const item of items.get(b.id) ?? []) {
      itemRows.push([
        { date: b.bill_date },
        b.title || b.vendor || b.category,
        item.name,
        money(item.price_cents),
        item.member_ids.map(who).join(', '),
      ]);
    }
  }

  const sheets: Sheet[] = [
    billSheet,
    {
      name: 'People',
      widths: [20, 12, 14, 14, 16, 12, 18, 26],
      rows: [
        ['Name', 'Paid for', 'Share of bills', 'Payments sent', 'Payments received', 'Balance', 'Status', 'Zelle'],
        ...people.map((p): Cell[] => [
          p.isGuest ? `${p.name} (guest)` : p.name,
          money(p.paid),
          money(p.share),
          money(p.sent),
          money(p.received),
          money(p.balance),
          p.balance > 0 ? 'Is owed' : p.balance < 0 ? 'Owes' : 'Settled up',
          p.zelle ?? '',
        ]),
      ],
    },
    {
      name: 'Settle up',
      widths: [20, 20, 12, 26],
      rows: [
        ['From', 'To', 'Amount', 'Zelle'],
        ...summary.transfers.map((t): Cell[] => [t.fromName, t.toName, money(t.amount), t.toZelle ?? '']),
      ],
    },
    {
      name: 'Payments',
      widths: [12, 20, 20, 12],
      rows: [
        ['Date', 'From', 'To', 'Amount'],
        ...[...payments]
          .sort((a, b) => a.settled_on.localeCompare(b.settled_on))
          .map((p): Cell[] => [{ date: p.settled_on }, who(p.from_member_id), who(p.to_member_id), money(p.amount_cents)]),
      ],
    },
  ];
  if (itemRows.length > 0) {
    sheets.splice(1, 0, {
      name: 'Items',
      widths: [12, 28, 30, 11, 30],
      rows: [['Date', 'Bill', 'Item', 'Price', 'Shared by'], ...itemRows],
    });
  }
  return sheets;
}

/** One CSV value: quoted when needed, and never read as a formula by a spreadsheet. */
export function csvValue(cell: Cell): string {
  let text: string;
  if (cell === null) text = '';
  else if (typeof cell === 'string') text = /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
  else if (typeof cell === 'number') text = Number.isFinite(cell) ? String(cell) : '';
  else if ('money' in cell) text = Number.isFinite(cell.money) ? cell.money.toFixed(2) : '';
  else text = cell.date;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The bills as CSV, which opens in Excel, Numbers and Google Sheets. */
export function billsCsv(input: ExportInput): string {
  const [bills] = exportSheets(input);
  // The byte order mark tells Excel it's UTF-8, so names like "Nguyễn" show correctly.
  return '﻿' + bills.rows.map((row) => row.map(csvValue).join(',')).join('\r\n') + '\r\n';
}

/** "Đà Lạt spring break" → "da-lat-spring-break". */
export function fileSlug(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'trip'
  );
}
