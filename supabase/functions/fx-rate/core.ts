// Exchange rates for bills paid in another currency, from free sources with
// no key: the European Central Bank's daily rates through Frankfurter
// (api.frankfurter.dev), with ExchangeRate-API's open feed (open.er-api.com)
// for currencies the ECB doesn't publish, like VND and TWD.

export interface FxRate {
  /** How much of `to` one unit of `from` is worth. */
  rate: number;
  /** The day the rate is from (YYYY-MM-DD). */
  date: string;
  source: 'European Central Bank' | 'ExchangeRate-API';
}

export class FxError extends Error {
  constructor(
    public code: 'BAD_REQUEST' | 'UNAVAILABLE',
    message: string,
  ) {
    super(message);
  }
}

export const USER_AGENT = 'Shareplate trip planner (https://shareplate-trips.vercel.app)';

export function checkRequest(raw: unknown, today: string): { from: string; to: string; date: string } {
  const r = (raw ?? {}) as { from?: unknown; to?: unknown; date?: unknown };
  const code = (v: unknown) => (typeof v === 'string' && /^[A-Z]{3}$/.test(v) ? v : null);
  const from = code(r.from);
  const to = code(r.to);
  if (!from || !to) throw new FxError('BAD_REQUEST', 'Choose two currencies.');
  let date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : today;
  // No rates for days that haven't happened yet: use today's.
  if (date > today) date = today;
  return { from, to, date };
}

export function frankfurterUrl(from: string, to: string, date: string): string {
  return `https://api.frankfurter.dev/v1/${date}?base=${from}&symbols=${to}`;
}

export function openErUrl(from: string): string {
  return `https://open.er-api.com/v6/latest/${from}`;
}

export function parseFrankfurter(json: unknown, to: string): FxRate | null {
  const j = json as { date?: unknown; rates?: Record<string, unknown> };
  const rate = j?.rates?.[to];
  if (typeof rate !== 'number' || !(rate > 0) || typeof j.date !== 'string') return null;
  return { rate, date: j.date, source: 'European Central Bank' };
}

export function parseOpenEr(json: unknown, to: string): FxRate | null {
  const j = json as { result?: unknown; rates?: Record<string, unknown>; time_last_update_unix?: unknown };
  const rate = j?.rates?.[to];
  if (j?.result !== 'success' || typeof rate !== 'number' || !(rate > 0)) return null;
  const when = typeof j.time_last_update_unix === 'number' ? new Date(j.time_last_update_unix * 1000) : new Date();
  return { rate, date: when.toISOString().slice(0, 10), source: 'ExchangeRate-API' };
}

/** The rate from `from` to `to` on `date`: the ECB's if it has one, otherwise the open feed's latest. */
export async function findRate(from: string, to: string, date: string, fetcher: typeof fetch = fetch): Promise<FxRate> {
  if (from === to) return { rate: 1, date, source: 'European Central Bank' };
  const get = async (url: string) => {
    const res = await fetcher(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  try {
    const ecb = parseFrankfurter(await get(frankfurterUrl(from, to, date)), to);
    if (ecb) return ecb;
  } catch {
    // Not an ECB currency, or the ECB feed is down: try the other source.
  }
  try {
    const open = parseOpenEr(await get(openErUrl(from)), to);
    if (open) return open;
  } catch {
    // Fall through to the message below.
  }
  throw new FxError('UNAVAILABLE', `Couldn't get a ${from} to ${to} rate right now. Type the rate yourself.`);
}
