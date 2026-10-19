import { looksLikeDiscount, type ScanResult } from '../../supabase/functions/scan-receipt/core';

import {
  centsToText,
  convertItemized,
  formatCents,
  formatIn,
  normalizeAmountIn,
  MoneyError,
  normalizePercentText,
  parseMoneyText,
  parsePercentToBasisPoints,
  percentOfCents,
  splitItemizedBill,
  type Cents,
  type ItemizedBillResult,
} from '@/money';

import { formatPercent } from '@/lib/ledger';

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
  /** Paid in another currency (null: the trip's), and the rate to the trip's currency as typed. */
  paidIn: string | null;
  rate: string;
  /** Whether each of discount, tax and tip was typed as an amount or a percentage. */
  discountMode: ExtraMode;
  taxMode: ExtraMode;
  tipMode: ExtraMode;
  imagePath: string | null;
  /** What the receipt itself printed, to compare against. */
  printedSubtotalCents: number | null;
  printedTotalCents: number | null;
  warnings: string[];
}

/** "$" or "%": how discount, tax and tip are typed. */
export type ExtraMode = 'amount' | 'percent';

let nextKey = 0;
export const newItemKey = () => `item-${Date.now().toString(36)}-${(nextKey++).toString(36)}`;

const centsText = (cents: number | null | undefined) =>
  cents === null || cents === undefined || cents === 0 ? '' : centsToText(cents);

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
    discountMode: 'amount',
    taxMode: 'amount',
    tipMode: 'amount',
    imagePath: base.imagePath ?? null,
    paidIn: null,
    rate: '',
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
    discountMode: 'amount',
    taxMode: 'amount',
    tipMode: 'amount',
    imagePath: base.imagePath,
    paidIn: null,
    rate: '',
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
  discount_rate_bp?: number | null;
  tax_rate_bp?: number | null;
  tip_rate_bp?: number | null;
  bill_image_path: string | null;
  items: { name: string; price_cents: number; member_ids: string[] }[];
  currency?: string | null;
  fx_rate?: number | null;
  entry?: Record<string, unknown> | null;
}

const rateText = (bp: number) => formatPercent(bp).replace('%', '');

export function draftFromBill(bill: SavedItemizedBill): ReceiptDraft {
  const draft = draftFromSavedAmounts(bill);
  // Paid in another currency: show what was typed in it, not the converted amounts.
  const entry = bill.currency ? (bill.entry as { prices?: unknown; discount?: unknown; tax?: unknown; tip?: unknown } | null) : null;
  if (!entry || !Array.isArray(entry.prices) || entry.prices.length !== draft.items.length) return draft;
  const text = (v: unknown, fallback: string) => (typeof v === 'string' ? v : fallback);
  return {
    ...draft,
    items: draft.items.map((i, idx) => ({ ...i, price: text((entry.prices as unknown[])[idx], i.price) })),
    discount: text(entry.discount, draft.discount),
    tax: text(entry.tax, draft.tax),
    tip: text(entry.tip, draft.tip),
  };
}

function draftFromSavedAmounts(bill: SavedItemizedBill): ReceiptDraft {
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
    discount: bill.discount_rate_bp != null ? rateText(bill.discount_rate_bp) : centsText(bill.discount_cents),
    tax: bill.tax_rate_bp != null ? rateText(bill.tax_rate_bp) : centsText(bill.tax_cents),
    tip: bill.tip_rate_bp != null ? rateText(bill.tip_rate_bp) : centsText(bill.tip_cents),
    discountMode: bill.discount_rate_bp != null ? 'percent' : 'amount',
    taxMode: bill.tax_rate_bp != null ? 'percent' : 'amount',
    tipMode: bill.tip_rate_bp != null ? 'percent' : 'amount',
    imagePath: bill.bill_image_path,
    paidIn: bill.currency ?? null,
    rate: bill.fx_rate ? String(bill.fx_rate) : '',
    printedSubtotalCents: null,
    printedTotalCents: null,
    warnings: [],
  };
}

const readAmount = (text: string, code: string | null = null): Cents | null => {
  if (!text.trim()) return 0;
  try {
    const normal = normalizeAmountIn(text, code);
    if (normal === null) return null;
    const cents = parseMoneyText(normal || '0');
    return cents < 0 ? null : cents;
  } catch {
    return null;
  }
};

/** A typed percentage in basis points (10% = 1000), 0 when empty, null when unreadable. */
export const readRate = (text: string): number | null => {
  if (!text.trim()) return 0;
  const normal = normalizePercentText(text);
  if (normal === null) return null;
  try {
    return parsePercentToBasisPoints(normal || '0');
  } catch {
    return null;
  }
};

/**
 * Discount, tax and tip in cents. Percentages are of: the items (discount),
 * the items after discount (tax), and the items after discount, before tax (tip).
 */
export function extrasCents(
  draft: Pick<ReceiptDraft, 'discount' | 'tax' | 'tip' | 'discountMode' | 'taxMode' | 'tipMode'> & { paidIn?: string | null },
  subtotal: Cents,
): { discount: Cents; tax: Cents; tip: Cents; rates: { discount: number | null; tax: number | null; tip: number | null } } | null {
  const read = (text: string, mode: ExtraMode) => (mode === 'percent' ? readRate(text) : readAmount(text, draft.paidIn ?? null));
  const d = read(draft.discount, draft.discountMode);
  const t = read(draft.tax, draft.taxMode);
  const p = read(draft.tip, draft.tipMode);
  if (d === null || t === null || p === null) return null;
  const discount = draft.discountMode === 'percent' ? percentOfCents(subtotal, Math.min(d, 10_000)) : d;
  const base = Math.max(subtotal - discount, 0);
  const tax = draft.taxMode === 'percent' ? percentOfCents(base, t) : t;
  const tip = draft.tipMode === 'percent' ? percentOfCents(base, p) : p;
  return {
    discount,
    tax,
    tip,
    rates: {
      discount: draft.discountMode === 'percent' ? d : null,
      tax: draft.taxMode === 'percent' ? t : null,
      tip: draft.tipMode === 'percent' ? p : null,
    },
  };
}

export interface DraftCheck {
  /** Step 1: per-item problems, keyed by item. */
  itemErrors: Record<string, string>;
  itemsOk: boolean;
  /** Step 2: amounts and totals. */
  totalsMessage: string | null;
  totals: {
    subtotal: Cents;
    discount: Cents;
    tax: Cents;
    tip: Cents;
    total: Cents;
    /** Basis points for whichever were typed as percentages. */
    rates: { discount: number | null; tax: number | null; tip: number | null };
  } | null;
  /** Differences from what the receipt printed (warnings, not blockers). */
  mismatches: string[];
  /** Tax as a share of the discounted subtotal, e.g. "8%". */
  taxRate: string | null;
  /** The receipt's total only adds up if its tax is already inside the prices ("Incl. 7.6% MwSt"). */
  taxLooksIncluded: boolean;
  /** Step 3: who had what. */
  assignMessage: string | null;
  result: ItemizedBillResult | null;
}

/** Why the items step isn't done yet, in one sentence: "Item 3 is empty…". */
export function itemsMessage(draft: ReceiptDraft, itemErrors: Record<string, string>): string {
  if (draft.items.length === 0) return 'Add at least one item.';
  const bad = draft.items.map((item, i) => ({ n: i + 1, error: itemErrors[item.key] })).filter((x) => x.error);
  if (bad.length === 0) return '';
  if (bad.length === 1) {
    const { n, error } = bad[0];
    return error.startsWith('This item is empty')
      ? `Item ${n} is empty. Fill it in, or remove it with ×.`
      : `Item ${n}: ${error.charAt(0).toLowerCase()}${error.slice(1)}`;
  }
  return `Items ${bad.map((x) => x.n).join(', ')} still need a name and a price. Fill them in, or remove empty ones with ×.`;
}

export function checkDraft(draft: ReceiptDraft): DraftCheck {
  // Amounts on the bill are in the currency it was paid in.
  const fmt = (cents: Cents) => (draft.paidIn ? formatIn(cents, draft.paidIn) : formatCents(cents));
  const itemErrors: Record<string, string> = {};
  const prices: Cents[] = [];
  for (const item of draft.items) {
    const price = item.price.trim() ? readAmount(item.price, draft.paidIn) : null;
    if (!item.name.trim() && !item.price.trim()) itemErrors[item.key] = 'This item is empty. Fill it in, or remove it with ×.';
    else if (!item.name.trim()) itemErrors[item.key] = 'Add a name.';
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
    taxLooksIncluded: false,
    assignMessage: null,
    result: null,
  };
  if (!itemsOk) return { ...empty, totalsMessage: itemsMessage(draft, itemErrors) };

  const subtotal = prices.reduce((a, b) => a + b, 0);
  const extras = extrasCents(draft, subtotal);
  if (extras === null) {
    return { ...empty, totalsMessage: 'Enter discount, tax and tip like 3.50 or 10%, or leave them empty.' };
  }
  if (draft.discountMode === 'percent' && (readRate(draft.discount) ?? 0) > 10_000) {
    return { ...empty, totalsMessage: 'A discount can be at most 100%.' };
  }
  const { discount, tax, tip } = extras;
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
        : `Look for discount lines read as items (they'd add up to ${diff % 2 === 0 ? `${fmt(diff / 2)} or ` : ''}${fmt(diff)}), or a misread price.`;
    mismatches.push(
      `Items come to ${fmt(compare)}${discount > 0 ? ' after discounts' : ''}, ` +
        `${fmt(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than the receipt's subtotal of ${fmt(printed)}. ${hint}`,
    );
  }
  const taxLooksIncluded = tax > 0 && draft.printedTotalCents !== null && draft.printedTotalCents === total - tax;
  if (draft.printedTotalCents !== null && draft.printedTotalCents !== total) {
    mismatches.push(
      taxLooksIncluded
        ? `This comes to ${fmt(total)}, but the receipt's total is ${fmt(draft.printedTotalCents)}: exactly the tax less. The tax looks already included in the prices (receipts often say "incl." or "VAT included").`
        : `This comes to ${fmt(total)}, but the receipt's total says ${fmt(draft.printedTotalCents)}.`,
    );
  }
  const discounted = subtotal - discount;
  const taxRate = tax > 0 && discounted > 0 ? `${(Math.round((tax / discounted) * 1000) / 10).toString()}%` : null;

  const totals = { subtotal, discount, tax, tip, total, rates: extras.rates };
  const unassigned = draft.items.filter((i) => i.memberIds.length === 0);
  if (unassigned.length > 0) {
    const names = unassigned.slice(0, 2).map((i) => `"${i.name.trim()}"`);
    const more = unassigned.length > 2 ? ` and ${unassigned.length - 2} more` : '';
    return {
      ...empty,
      totals,
      mismatches,
      taxRate,
      taxLooksIncluded,
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
    return { ...empty, totals, mismatches, taxRate, taxLooksIncluded, result };
  } catch (e) {
    return { ...empty, totals, mismatches, taxRate, taxLooksIncluded, assignMessage: e instanceof MoneyError ? e.message : String(e) };
  }
}

/** The JSON sent to the database's save_itemized_bill function. */
export function itemizedPayload(
  draft: ReceiptDraft,
  result: ItemizedBillResult,
  ctx: { tripId: string; billId?: string; expectedVersion?: number },
) {
  const base = {
    id: ctx.billId,
    expected_version: ctx.expectedVersion,
    group_id: ctx.tripId,
    paid_by_member_id: draft.payerId,
    title: draft.title.trim() || draft.vendor.trim(),
    vendor: draft.vendor.trim(),
    category: draft.category,
    bill_date: draft.date,
    image_path: draft.imagePath,
    ...rates(draft),
  };
  const prices = draft.items.map((i) => readAmount(i.price, draft.paidIn) ?? 0);
  const fx = foreignRate(draft);
  if (!fx) {
    return {
      ...base,
      discount_cents: result.members.reduce((s, m) => s + m.discountCents, 0),
      tax_cents: result.members.reduce((s, m) => s + m.taxCents, 0),
      tip_cents: result.members.reduce((s, m) => s + m.tipCents, 0),
      items: draft.items.map((i, idx) => ({ name: i.name.trim(), price_cents: prices[idx], member_ids: i.memberIds })),
      participants: result.members.map((m) => ({
        member_id: m.memberId,
        items_cents: m.itemsCents,
        discount_cents: m.discountCents,
        tax_cents: m.taxCents,
        tip_cents: m.tipCents,
        amount_cents: m.totalCents,
      })),
      currency: null,
      fx_rate: null,
      original_total_cents: null,
      entry: null,
    };
  }
  // Paid in another currency: convert everything, and keep what was typed.
  const c = convertItemized(
    {
      itemPrices: prices,
      discountCents: result.members.reduce((s, m) => s + m.discountCents, 0),
      taxCents: result.members.reduce((s, m) => s + m.taxCents, 0),
      tipCents: result.members.reduce((s, m) => s + m.tipCents, 0),
      members: result.members,
    },
    fx.rate,
  );
  return {
    ...base,
    discount_cents: c.discountCents,
    tax_cents: c.taxCents,
    tip_cents: c.tipCents,
    items: draft.items.map((i, idx) => ({ name: i.name.trim(), price_cents: c.itemPrices[idx], member_ids: i.memberIds })),
    participants: c.members.map((m) => ({
      member_id: m.memberId,
      items_cents: m.itemsCents,
      discount_cents: m.discountCents,
      tax_cents: m.taxCents,
      tip_cents: m.tipCents,
      amount_cents: m.totalCents,
    })),
    currency: fx.currency,
    fx_rate: fx.rate,
    original_total_cents: result.totalCents,
    entry: { prices: draft.items.map((i) => i.price), discount: draft.discount, tax: draft.tax, tip: draft.tip },
  };
}

/** The currency and rate when a draft is paid in another currency with a usable rate, else null. */
export function foreignRate(draft: Pick<ReceiptDraft, 'paidIn' | 'rate'>): { currency: string; rate: string } | null {
  if (!draft.paidIn) return null;
  const rate = draft.rate.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(rate) || Number(rate) <= 0) return null;
  return { currency: draft.paidIn, rate };
}

function rates(draft: ReceiptDraft) {
  const bp = (text: string, mode: ExtraMode) => (mode === 'percent' ? (readRate(text) ?? 0) : null);
  return {
    discount_rate_bp: bp(draft.discount, draft.discountMode),
    tax_rate_bp: bp(draft.tax, draft.taxMode),
    tip_rate_bp: bp(draft.tip, draft.tipMode),
  };
}

/** Turns an item into part of the discount, for discount lines read as items. */
export function moveItemToDiscount(draft: ReceiptDraft, key: string): ReceiptDraft {
  const item = draft.items.find((i) => i.key === key);
  if (!item) return draft;
  const price = readAmount(item.price, draft.paidIn) ?? 0;
  const items = draft.items.filter((i) => i.key !== key);
  // A percentage discount becomes the amount it came to, plus this line.
  const subtotal = draft.items.reduce((sum, i) => sum + (readAmount(i.price, draft.paidIn) ?? 0), 0);
  const current = extrasCents(draft, subtotal)?.discount ?? 0;
  return { ...draft, items, discount: centsText(current + price), discountMode: 'amount' };
}
