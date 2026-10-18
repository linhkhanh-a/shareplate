import { looksLikeDiscount, type ScanResult } from '../../supabase/functions/scan-receipt/core';

import { formatCents, MoneyError, parseCents, splitItemizedBill, type Cents, type ItemizedBillResult } from '@/money';

export type { ScanResult };
export { looksLikeDiscount };

export interface DraftItem {
  key: string;
  name: string;
  /** Typed price, e.g. "12.50". */
  price: string;
  memberIds: string[];
}

/** Everything the scan wizard edits before saving. Amounts stay as typed text until the end. */
export interface ReceiptDraft {
  title: string;
  vendor: string;
  category: string;
  date: string;
  payerId: string;
  items: DraftItem[];
  discount: string;
  tax: string;
  tip: string;
  imagePath: string | null;
  /** What the receipt itself printed, to compare against. */
  printedSubtotalCents: number | null;
  printedTotalCents: number | null;
  warnings: string[];
}

let nextKey = 0;
export const newItemKey = () => `item-${Date.now().toString(36)}-${(nextKey++).toString(36)}`;

const centsText = (cents: number | null | undefined) =>
  cents === null || cents === undefined || cents === 0 ? '' : formatCents(cents).replace(/[$,]/g, '');

export function emptyDraft(base: { payerId: string; date: string; imagePath?: string | null }): ReceiptDraft {
  return {
    title: '',
    vendor: '',
    category: 'Food',
    date: base.date,
    payerId: base.payerId,
    items: [{ key: newItemKey(), name: '', price: '', memberIds: [] }],
    discount: '',
    tax: '',
    tip: '',
    imagePath: base.imagePath ?? null,
    printedSubtotalCents: null,
    printedTotalCents: null,
    warnings: [],
  };
}

export function draftFromScan(
  scan: ScanResult,
  base: { payerId: string; date: string; imagePath: string },
): ReceiptDraft {
  return {
    title: scan.vendor ?? '',
    vendor: scan.vendor ?? '',
    category: scan.category,
    date: scan.date ?? base.date,
    payerId: base.payerId,
    items: scan.items.length
      ? scan.items.map((i) => ({ key: newItemKey(), name: i.name, price: centsText(i.price_cents) || '0', memberIds: [] }))
      : [{ key: newItemKey(), name: '', price: '', memberIds: [] }],
    discount: centsText(scan.discount_cents),
    tax: centsText(scan.tax_cents),
    tip: centsText(scan.tip_cents),
    imagePath: base.imagePath,
    printedSubtotalCents: scan.subtotal_cents,
    printedTotalCents: scan.total_cents,
    warnings: scan.warnings,
  };
}

export interface SavedItemizedBill {
  title: string | null;
  vendor: string | null;
  category: string;
  bill_date: string;
  paid_by_member_id: string;
  discount_cents: number;
  tax_cents: number;
  tip_cents: number;
  bill_image_path: string | null;
  items: { name: string; price_cents: number; member_ids: string[] }[];
}

export function draftFromBill(bill: SavedItemizedBill): ReceiptDraft {
  return {
    title: bill.title ?? '',
    vendor: bill.vendor ?? '',
    category: bill.category,
    date: bill.bill_date,
    payerId: bill.paid_by_member_id,
    items: bill.items.map((i) => ({
      key: newItemKey(),
      name: i.name,
      price: centsText(i.price_cents) || '0',
      memberIds: [...i.member_ids],
    })),
    discount: centsText(bill.discount_cents),
    tax: centsText(bill.tax_cents),
    tip: centsText(bill.tip_cents),
    imagePath: bill.bill_image_path,
    printedSubtotalCents: null,
    printedTotalCents: null,
    warnings: [],
  };
}

const readAmount = (text: string): Cents | null => {
  if (!text.trim()) return 0;
  try {
    const cents = parseCents(text);
    return cents < 0 ? null : cents;
  } catch {
    return null;
  }
};

export interface DraftCheck {
  /** Step 1: per-item problems, keyed by item. */
  itemErrors: Record<string, string>;
  itemsOk: boolean;
  /** Step 2: amounts and totals. */
  totalsMessage: string | null;
  totals: { subtotal: Cents; discount: Cents; tax: Cents; tip: Cents; total: Cents } | null;
  /** Differences from what the receipt printed (warnings, not blockers). */
  mismatches: string[];
  /** Tax as a share of the discounted subtotal, e.g. "8%". */
  taxRate: string | null;
  /** Step 3: who had what. */
  assignMessage: string | null;
  result: ItemizedBillResult | null;
}

export function checkDraft(draft: ReceiptDraft): DraftCheck {
  const itemErrors: Record<string, string> = {};
  const prices: Cents[] = [];
  for (const item of draft.items) {
    const price = item.price.trim() ? readAmount(item.price) : null;
    if (!item.name.trim()) itemErrors[item.key] = 'Add a name.';
    else if (price === null) itemErrors[item.key] = 'Enter a price like 12.50.';
    prices.push(price ?? 0);
  }
  const itemsOk = draft.items.length > 0 && Object.keys(itemErrors).length === 0;

  const empty: DraftCheck = {
    itemErrors,
    itemsOk,
    totalsMessage: null,
    totals: null,
    mismatches: [],
    taxRate: null,
    assignMessage: null,
    result: null,
  };
  if (!itemsOk) return { ...empty, totalsMessage: draft.items.length ? 'Fix the items first.' : 'Add at least one item.' };

  const discount = readAmount(draft.discount);
  const tax = readAmount(draft.tax);
  const tip = readAmount(draft.tip);
  if (discount === null || tax === null || tip === null) {
    return { ...empty, totalsMessage: 'Enter discount, tax and tip like 3.50, or leave them empty.' };
  }
  const subtotal = prices.reduce((a, b) => a + b, 0);
  if (discount > subtotal) return { ...empty, totalsMessage: 'The discount is bigger than the items subtotal.' };
  const total = subtotal - discount + tax + tip;
  if (total <= 0) return { ...empty, totalsMessage: 'The bill needs an amount above $0.00.' };

  const mismatches: string[] = [];
  const printed = draft.printedSubtotalCents;
  // Stores print the subtotal either before or after discounts; either one counts as a match.
  if (printed !== null && printed !== subtotal && printed !== subtotal - discount) {
    const compare = subtotal - discount;
    const diff = compare - printed;
    // A discount read as an item is off twice when the receipt prints its subtotal after discounts.
    const hint =
      diff < 0
        ? 'Look for a missed line or a misread price.'
        : `Look for discount lines read as items (they'd add up to ${diff % 2 === 0 ? `${formatCents(diff / 2)} or ` : ''}${formatCents(diff)}), or a misread price.`;
    mismatches.push(
      `Items come to ${formatCents(compare)}${discount > 0 ? ' after discounts' : ''}, ` +
        `${formatCents(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than the receipt's subtotal of ${formatCents(printed)}. ${hint}`,
    );
  }
  if (draft.printedTotalCents !== null && draft.printedTotalCents !== total) {
    mismatches.push(`This comes to ${formatCents(total)}, but the receipt's total says ${formatCents(draft.printedTotalCents)}.`);
  }
  const discounted = subtotal - discount;
  const taxRate = tax > 0 && discounted > 0 ? `${(Math.round((tax / discounted) * 1000) / 10).toString()}%` : null;

  const totals = { subtotal, discount, tax, tip, total };
  const unassigned = draft.items.filter((i) => i.memberIds.length === 0);
  if (unassigned.length > 0) {
    const names = unassigned.slice(0, 2).map((i) => `"${i.name.trim()}"`);
    const more = unassigned.length > 2 ? ` and ${unassigned.length - 2} more` : '';
    return {
      ...empty,
      totals,
      mismatches,
      taxRate,
      assignMessage: `Choose who had ${names.join(' and ')}${more}.`,
    };
  }

  try {
    const result = splitItemizedBill({
      items: draft.items.map((i, idx) => ({ name: i.name, priceCents: prices[idx], memberIds: i.memberIds })),
      discountCents: discount,
      taxCents: tax,
      tipCents: tip,
    });
    return { ...empty, totals, mismatches, taxRate, result };
  } catch (e) {
    return { ...empty, totals, mismatches, taxRate, assignMessage: e instanceof MoneyError ? e.message : String(e) };
  }
}

/** The JSON sent to the database's save_itemized_bill function. */
export function itemizedPayload(
  draft: ReceiptDraft,
  result: ItemizedBillResult,
  ctx: { tripId: string; billId?: string; expectedVersion?: number },
) {
  return {
    id: ctx.billId,
    expected_version: ctx.expectedVersion,
    group_id: ctx.tripId,
    paid_by_member_id: draft.payerId,
    title: draft.title.trim() || draft.vendor.trim(),
    vendor: draft.vendor.trim(),
    category: draft.category,
    bill_date: draft.date,
    image_path: draft.imagePath,
    discount_cents: result.members.reduce((s, m) => s + m.discountCents, 0),
    tax_cents: result.members.reduce((s, m) => s + m.taxCents, 0),
    tip_cents: result.members.reduce((s, m) => s + m.tipCents, 0),
    items: draft.items.map((i) => ({ name: i.name.trim(), price_cents: readAmount(i.price) ?? 0, member_ids: i.memberIds })),
    participants: result.members.map((m) => ({
      member_id: m.memberId,
      items_cents: m.itemsCents,
      discount_cents: m.discountCents,
      tax_cents: m.taxCents,
      tip_cents: m.tipCents,
      amount_cents: m.totalCents,
    })),
  };
}

/** Turns an item into part of the discount, for discount lines read as items. */
export function moveItemToDiscount(draft: ReceiptDraft, key: string): ReceiptDraft {
  const item = draft.items.find((i) => i.key === key);
  if (!item) return draft;
  const price = readAmount(item.price) ?? 0;
  const current = readAmount(draft.discount) ?? 0;
  return {
    ...draft,
    items: draft.items.filter((i) => i.key !== key),
    discount: centsText(current + price),
  };
}
