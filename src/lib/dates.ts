import { isValidIsoDate, todayIso } from '@/lib/ledger';
import { daysBetween, dateOfDay, shortDate } from '@/lib/itinerary';

/**
 * Reading dates the way people type them. Slash dates are US-style, month
 * first ("10/23" is October 23). A date without a year is in today's year.
 */

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

const pad = (n: number) => String(n).padStart(2, '0');

function build(y: number, m: number, d: number): string | null {
  const iso = `${y}-${pad(m)}-${pad(d)}`;
  return isValidIsoDate(iso) ? iso : null;
}

function fullYear(text: string | undefined, today: Date): number {
  if (!text) return today.getFullYear();
  const n = Number(text);
  return text.length <= 2 ? 2000 + n : n;
}

/** "oct", "oct.", "october", "sept" -> 10 or 9; anything else -> null. */
function monthOf(word: string): number | null {
  const w = word.toLowerCase().replace(/\.$/, '');
  if (w.length < 3) return null;
  const i = MONTHS.findIndex((m) => m.startsWith(w));
  return i < 0 ? null : i + 1;
}

/**
 * "2026-10-23", "10/23", "10/23/26", "10-23-2026", "Oct 23", "October 23, 2026",
 * "23 Oct", "Fri, Oct 23", "today", "tomorrow", "yesterday" -> "YYYY-MM-DD".
 * Returns null when it isn't a real date.
 */
export function parseDateText(text: string, today: Date = new Date()): string | null {
  const t = text.trim().toLowerCase().replace(/(\d)(st|nd|rd|th)\b/g, '$1');
  if (!t) return null;
  if (t === 'today') return todayIso(today);
  if (t === 'tomorrow') return todayIso(new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
  if (t === 'yesterday') return todayIso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));

  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(t);
  if (m) return build(Number(m[1]), Number(m[2]), Number(m[3]));

  // US style: month first.
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
  if (m) return build(fullYear(m[3], today), Number(m[1]), Number(m[2]));

  // Drop a weekday in front: "fri, oct 23".
  const words = t.replace(/^(mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+/, '').replace(/,/g, ' ').split(/\s+/);
  // "oct 23 [2026]"
  if (words.length >= 2 && monthOf(words[0]) && /^\d{1,2}$/.test(words[1]) && (!words[2] || /^\d{2,4}$/.test(words[2]))) {
    return build(fullYear(words[2], today), monthOf(words[0])!, Number(words[1]));
  }
  // "23 oct [2026]"
  if (words.length >= 2 && /^\d{1,2}$/.test(words[0]) && monthOf(words[1]) && (!words[2] || /^\d{2,4}$/.test(words[2]))) {
    return build(fullYear(words[2], today), monthOf(words[1])!, Number(words[0]));
  }
  return null;
}

/** "Fri, Oct 23, 2026" for showing a picked date. */
export function longDate(iso: string): string {
  const [y, mo, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

export interface DateChoice {
  date: string;
  label: string;
}

/**
 * Quick picks for a bill's date: the trip's days ("Day 1 · Fri, Oct 23") when
 * the trip has dates (up to three weeks), otherwise Today and Yesterday.
 */
export function dateChoices(start: string | null, end: string | null, today: Date = new Date()): DateChoice[] {
  const days = daysBetween(start, end);
  if (days > 0 && days <= 21) {
    return Array.from({ length: days }, (_, i) => {
      const date = dateOfDay(i + 1, start)!;
      return { date, label: `Day ${i + 1} · ${shortDate(date)}` };
    });
  }
  const t = todayIso(today);
  const y = todayIso(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));
  return [
    { date: t, label: 'Today' },
    { date: y, label: 'Yesterday' },
  ];
}
