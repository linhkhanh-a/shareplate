/**
 * Reading a receipt photo with Gemini. Pure logic with no Supabase or Deno
 * APIs, so it runs in the edge function and in the app's tests alike.
 */

export const CATEGORIES = ['Food', 'Transport', 'Lodging', 'Activities', 'Shopping', 'Other'] as const;

export interface ScannedItem {
  name: string;
  price_cents: number;
}

export interface ScanResult {
  vendor: string | null;
  date: string | null;
  category: (typeof CATEGORIES)[number];
  items: ScannedItem[];
  subtotal_cents: number | null;
  discount_cents: number;
  tax_cents: number;
  tip_cents: number;
  total_cents: number | null;
  /** Things the person should double-check, in plain words. */
  warnings: string[];
}

export class ScanError extends Error {
  constructor(
    readonly code: 'RATE_LIMITED' | 'READER_FAILED' | 'NOT_A_RECEIPT',
    message: string,
  ) {
    super(message);
  }
}

export const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    is_receipt: { type: 'boolean' },
    vendor: { type: ['string', 'null'] },
    date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
    category: { type: 'string', enum: [...CATEGORIES] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: ['number', 'null'] },
          line_total: { type: ['number', 'null'] },
        },
        required: ['name', 'line_total'],
      },
    },
    subtotal: { type: ['number', 'null'] },
    discount: { type: ['number', 'null'] },
    tax: { type: ['number', 'null'] },
    tip: { type: ['number', 'null'] },
    total: { type: ['number', 'null'] },
  },
  required: ['is_receipt', 'items'],
} as const;

export const PROMPT = `You read photos of receipts and bills for a trip expense-splitting app.
Return JSON only, matching this shape:
{"is_receipt": boolean, "vendor": string|null, "date": "YYYY-MM-DD"|null,
 "category": one of ${CATEGORIES.join(', ')},
 "items": [{"name": string, "quantity": number|null, "line_total": number|null}],
 "subtotal": number|null, "discount": number|null, "tax": number|null, "tip": number|null, "total": number|null}
Rules:
- line_total is the price printed on that line (quantity already multiplied in). Plain numbers, no currency signs.
- List every purchased item once. Do not list subtotal, tax, tip, service charge, total, payment, change or card lines as items.
- Lines that lower the price are discounts, not items: instant savings, coupons, vouchers, promos, member savings,
  markdowns, store codes like "TPD/123456", and any amount printed with a minus (4.99-, -4.99) or in parentheses.
  Do not list them as items; add them up into discount.
- discount is the total of all discounts as a POSITIVE number.
- subtotal is exactly what the receipt prints next to SUBTOTAL (some stores print it after discounts).
- tax is the total of all taxes. tip includes service charges and gratuity.
- The receipt may be blurry, crumpled or handwritten: give your best reading, and use null when a value is not printed.
- category: Food for restaurants, cafes, groceries and drinks; Transport for taxis, rides, fuel, tickets; Lodging for hotels and stays; Activities for tours, museums, events; Shopping for stores; otherwise Other.
- If the photo is not a receipt or bill, set is_receipt to false and items to [].`;

/** Pulls the JSON object out of a model reply, tolerating ```json fences or chatter. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1));
    throw new ScanError('READER_FAILED', "Couldn't read the reply from the receipt reader.");
  }
}

/** 12.5, "12.50", "$1,234.56", "-3.00" -> cents. Anything unreadable -> null. */
export function toCents(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  let n: number;
  if (typeof value === 'number') {
    n = value;
  } else {
    const text = String(value).trim();
    // Receipts print negatives as "-4.99", "4.99-" or "(4.99)".
    const negative = /^-|-$|^\(.*\)$/.test(text);
    const digits = text.replace(/[^0-9.]/g, '');
    if (!/\d/.test(digits)) return null;
    n = Number(digits) * (negative ? -1 : 1);
  }
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

/** Names that stores use for money taken off, e.g. Costco's "TPD/253667". */
const DISCOUNT_NAME =
  /^(tpd\b|instant sav|inst sav|coupons?\b|discount\b|disc\b|promo\b|member sav|savings\b|markdown\b|vouchers?\b|mfr cpn|cpn\b)/i;

export function looksLikeDiscount(name: string): boolean {
  return DISCOUNT_NAME.test(name.trim());
}

/** Cleans up whatever the model returned into amounts the app can trust to edit. */
export function normalizeReceipt(raw: unknown): ScanResult {
  const r = (raw ?? {}) as Record<string, unknown>;
  if (r.is_receipt === false) {
    throw new ScanError('NOT_A_RECEIPT', "That photo doesn't look like a receipt. Try another photo, or enter the items by hand.");
  }

  const warnings: string[] = [];
  const items: ScannedItem[] = [];
  let extraDiscount = 0;
  const movedDiscounts: string[] = [];

  for (const entry of Array.isArray(r.items) ? r.items : []) {
    const item = (entry ?? {}) as Record<string, unknown>;
    const name = String(item.name ?? '').trim().slice(0, 120);
    const price = toCents(item.line_total);
    if (!name && price === null) continue;
    if (price === null) {
      items.push({ name: name || 'Item', price_cents: 0 });
      warnings.push(`Couldn't read the price for "${name || 'an item'}".`);
      continue;
    }
    if (price < 0 || looksLikeDiscount(name)) {
      // A discount printed as a line item (with or without a minus sign).
      extraDiscount += Math.abs(price);
      movedDiscounts.push(name || 'a discount line');
      continue;
    }
    const qty = typeof item.quantity === 'number' && item.quantity > 1 ? Math.round(item.quantity) : 1;
    const label = qty > 1 && !/^\d+\s*[x×]/i.test(name) ? `${qty}× ${name}` : name;
    items.push({ name: label || 'Item', price_cents: price });
  }

  const positive = (v: unknown) => Math.abs(toCents(v) ?? 0);
  const discount = positive(r.discount) + extraDiscount;
  const tax = positive(r.tax);
  const tip = positive(r.tip);
  const subtotal = toCents(r.subtotal);
  const total = toCents(r.total);

  if (items.length === 0) warnings.push("Couldn't find any items. Add them by hand.");
  if (movedDiscounts.length > 0) {
    warnings.push(
      `Counted ${movedDiscounts.length === 1 ? 'this line as a discount' : `${movedDiscounts.length} lines as discounts`}, not items: ` +
        `${movedDiscounts.slice(0, 4).join(', ')}${movedDiscounts.length > 4 ? '…' : ''}. Check the discount on the next step.`,
    );
  }
  // Subtotal and total mismatches are checked live in the app as people edit, so they aren't repeated here.

  const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
  const category = (CATEGORIES as readonly string[]).includes(String(r.category))
    ? (r.category as ScanResult['category'])
    : 'Other';

  return {
    vendor: typeof r.vendor === 'string' && r.vendor.trim() ? r.vendor.trim().slice(0, 120) : null,
    date,
    category,
    items,
    subtotal_cents: subtotal,
    discount_cents: discount,
    tax_cents: tax,
    tip_cents: tip,
    total_cents: total,
    warnings,
  };
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * Asks Gemini to read the image. Uses Google's current Interactions API, and
 * falls back to the long-standing generateContent API if that request shape
 * is refused, so a change on Google's side doesn't break scanning.
 */
export async function readWithGemini(opts: {
  apiKey: string;
  model: string;
  imageBase64: string;
  mimeType: string;
  fetchImpl: FetchLike;
}): Promise<string> {
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey };
  const image = { type: 'image', data: opts.imageBase64, mime_type: opts.mimeType };
  const attempts: { url: string; body: unknown; read: (json: unknown) => string | null }[] = [
    {
      url: `${BASE}/interactions`,
      body: {
        model: opts.model,
        store: false,
        system_instruction: PROMPT,
        input: [{ type: 'text', text: 'Read this receipt.' }, image],
        response_format: { type: 'text', mime_type: 'application/json', schema: RECEIPT_SCHEMA },
      },
      read: textFromInteraction,
    },
    {
      url: `${BASE}/interactions`,
      body: {
        model: opts.model,
        store: false,
        system_instruction: PROMPT,
        input: [{ type: 'text', text: 'Read this receipt. Reply with the JSON only.' }, image],
      },
      read: textFromInteraction,
    },
    {
      url: `${BASE}/models/${encodeURIComponent(opts.model)}:generateContent`,
      body: {
        system_instruction: { parts: [{ text: PROMPT }] },
        contents: [
          {
            role: 'user',
            parts: [{ text: 'Read this receipt.' }, { inline_data: { mime_type: opts.mimeType, data: opts.imageBase64 } }],
          },
        ],
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      },
      read: textFromGenerateContent,
    },
  ];

  let lastStatus = 0;
  for (const attempt of attempts) {
    const res = await opts.fetchImpl(attempt.url, { method: 'POST', headers, body: JSON.stringify(attempt.body) });
    if (res.status === 429) {
      throw new ScanError('RATE_LIMITED', 'The receipt reader is busy (free-tier limit). Wait a minute and try again, or enter the items by hand.');
    }
    if (res.ok) {
      const text = attempt.read(await res.json());
      if (text) return text;
      lastStatus = res.status;
      continue;
    }
    lastStatus = res.status;
    // 400/404: this request shape isn't accepted; try the next one. Anything else is a real failure.
    if (res.status !== 400 && res.status !== 404) break;
  }
  throw new ScanError('READER_FAILED', `The receipt reader didn't respond as expected (status ${lastStatus}). Enter the items by hand, or try again later.`);
}

function textFromInteraction(json: unknown): string | null {
  const steps = (json as { steps?: { type?: string; content?: { type?: string; text?: string }[] }[] })?.steps ?? [];
  const parts = steps
    .filter((s) => s.type === 'model_output')
    .flatMap((s) => s.content ?? [])
    .filter((c) => c.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text as string);
  return parts.length ? parts.join('') : null;
}

function textFromGenerateContent(json: unknown): string | null {
  const candidates = (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates ?? [];
  const parts = candidates[0]?.content?.parts?.map((p) => p.text ?? '') ?? [];
  const text = parts.join('');
  return text || null;
}

export async function scanReceipt(opts: Parameters<typeof readWithGemini>[0]): Promise<ScanResult> {
  const text = await readWithGemini(opts);
  return normalizeReceipt(extractJson(text));
}

/** Base64 without blowing the stack on large photos. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
