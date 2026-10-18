import { isValidIsoDate } from '@/lib/ledger';
import { centsToText, formatCents, parseMoneyText, type Cents } from '@/money';

/** One activity in the trip plan, as the screens use it. */
export interface Activity {
  id: string;
  day_number: number;
  position: number;
  /** "HH:MM:SS" from the database, or null. */
  start_time: string | null;
  end_time: string | null;
  title: string;
  location: string | null;
  /** Filled when the place was picked from place search. */
  location_address?: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  notes: string | null;
  proposed_budget_cents: number;
  version: number;
  created_at: string;
}

/** A place picked from search: its exact spot, for the map link. */
export interface PickedPlace {
  address: string;
  lat: number;
  lng: number;
}

export interface PlanDay {
  day: number;
  /** YYYY-MM-DD when the trip has a start date. */
  date: string | null;
  activities: Activity[];
}

/** The longest plan the app offers (the database allows the same). */
export const MAX_DAYS = 60;

// ---------------------------------------------------------------------------
// Times
// ---------------------------------------------------------------------------

/**
 * Reads a time the way people type it: "7pm", "7:30 PM", "19:30", "noon".
 * Bare numbers are 24-hour ("7" is 7 AM, "19" is 7 PM).
 * Returns "HH:MM", null for an empty field, or undefined if it can't be read.
 */
export function parseTime(text: string): string | null | undefined {
  const t = text.trim().toLowerCase().replace(/\./g, '');
  if (!t) return null;
  if (t === 'noon') return '12:00';
  if (t === 'midnight') return '00:00';
  const m = /^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/.exec(t);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = m[2] === undefined ? 0 : Number(m[2]);
  const half = m[3]?.[0];
  if (minute > 59) return undefined;
  if (half) {
    if (hour < 1 || hour > 12) return undefined;
    if (half === 'a' && hour === 12) hour = 0;
    if (half === 'p' && hour !== 12) hour += 12;
  } else if (hour > 23) {
    return undefined;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export type Half = 'AM' | 'PM';

/**
 * Splits a time into the clock part and AM/PM, for the time box and its
 * AM | PM switch: "7:30 PM" → 7:30 + PM, "19:30" → 7:30 + PM, "0:15" → 12:15 + AM,
 * "7pm" → 7 + PM, "7" → 7 with no AM/PM yet.
 */
export function timeParts(text: string): { clock: string; half: Half | null } {
  const t = text.trim().toLowerCase().replace(/\./g, '');
  if (t === 'noon') return { clock: '12:00', half: 'PM' };
  if (t === 'midnight') return { clock: '12:00', half: 'AM' };
  const m = /^(\d{1,2})(?::?(\d{0,2}))?\s*(am|pm|a|p)?$/.exec(t);
  if (!m) return { clock: text.replace(/\s*(am|pm|a|p)$/i, '').trim(), half: null };
  const hour = Number(m[1]);
  const minutes = m[2] ?? '';
  const clockOf = (h: number) => (minutes ? `${h}:${minutes}` : t.includes(':') ? `${h}:` : `${h}`);
  if (m[3]) return { clock: clockOf(hour), half: m[3][0] === 'a' ? 'AM' : 'PM' };
  // 24-hour times become 12-hour with the switch set.
  if (hour === 0) return { clock: clockOf(12), half: 'AM' };
  if (hour > 12 && hour <= 23) return { clock: clockOf(hour - 12), half: 'PM' };
  return { clock: clockOf(hour), half: null };
}

/** A sensible AM/PM guess for a time typed without one: 7 to 11 is morning, 12 to 6 afternoon or evening. */
export function guessHalf(clock: string): Half {
  const hour = Number(/^(\d{1,2})/.exec(clock.trim())?.[1] ?? NaN);
  return hour >= 7 && hour <= 11 ? 'AM' : 'PM';
}

/** The clock part and AM/PM back into one time: "7:30" + PM → "7:30 PM". Empty stays empty. */
export function joinTime(clock: string, half: Half): string {
  return clock.trim() ? `${clock.trim()} ${half}` : '';
}

/** "19:30:00" → "7:30 PM". */
export function formatTime(time: string | null | undefined): string {
  if (!time) return '';
  const [h, m] = time.split(':').map(Number);
  const half = h < 12 ? 'AM' : 'PM';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${half}`;
}

/** "7:00 PM", "7:00 PM to 9:30 PM", or "" with no times. */
export function timeRange(start: string | null, end: string | null): string {
  if (start && end) return `${formatTime(start)} to ${formatTime(end)}`;
  if (start) return formatTime(start);
  if (end) return `Until ${formatTime(end)}`;
  return '';
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const toUtc = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};

/** Number of days from start to end, counting both. */
export function daysBetween(start: string | null, end: string | null): number {
  if (!start || !end || !isValidIsoDate(start) || !isValidIsoDate(end)) return 0;
  const n = Math.round((toUtc(end) - toUtc(start)) / 86_400_000) + 1;
  return n > 0 ? n : 0;
}

/** The date of day N of a trip that starts on `start` (YYYY-MM-DD). */
export function dateOfDay(day: number, start: string | null): string | null {
  if (!start || !isValidIsoDate(start)) return null;
  return new Date(toUtc(start) + (day - 1) * 86_400_000).toISOString().slice(0, 10);
}

/** "Sat, Oct 24". */
export function shortDate(iso: string): string {
  return new Date(toUtc(iso)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** "Day 2" or "Day 2 · Sat, Oct 24". */
export function dayLabel(day: number, start: string | null): string {
  const date = dateOfDay(day, start);
  return date ? `Day ${day} · ${shortDate(date)}` : `Day ${day}`;
}

/**
 * Lays the plan out by day. A trip shows every day between its dates, plus any
 * later day that has activities, and always at least one day.
 */
export function planDays(activities: Activity[], start: string | null, end: string | null): PlanDay[] {
  const lastUsed = activities.reduce((max, a) => Math.max(max, a.day_number), 0);
  const count = Math.min(MAX_DAYS, Math.max(1, daysBetween(start, end), lastUsed));
  const days: PlanDay[] = [];
  for (let day = 1; day <= count; day++) {
    days.push({ day, date: dateOfDay(day, start), activities: [] });
  }
  for (const a of sortActivities(activities)) days[a.day_number - 1]?.activities.push(a);
  return days;
}

/** The order the plan shows: by day, then the order people arranged. */
export function sortActivities(activities: Activity[]): Activity[] {
  return [...activities].sort(
    (a, b) => a.day_number - b.day_number || a.position - b.position || a.created_at.localeCompare(b.created_at),
  );
}

// ---------------------------------------------------------------------------
// Rearranging
// ---------------------------------------------------------------------------

/** Moves one entry of a list from one index to another. */
export function moveInList<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

export interface Placement {
  id: string;
  day_number: number;
  position: number;
}

/** Positions 0, 1, 2… for a day's activities, in the given order. */
export function placementsFor(day: number, activities: Activity[]): Placement[] {
  return activities.map((a, position) => ({ id: a.id, day_number: day, position }));
}

/** Applies placements to a list of activities (for showing a move right away). */
export function applyPlacements(activities: Activity[], placements: Placement[]): Activity[] {
  const byId = new Map(placements.map((p) => [p.id, p]));
  return activities.map((a) => {
    const p = byId.get(a.id);
    return p ? { ...a, day_number: p.day_number, position: p.position } : a;
  });
}

/** Activities with a start time first, earliest to latest; the rest keep their order. */
export function sortByTime(activities: Activity[]): Activity[] {
  const timed = activities.filter((a) => a.start_time).sort((a, b) => a.start_time!.localeCompare(b.start_time!));
  return [...timed, ...activities.filter((a) => !a.start_time)];
}

/** True when sorting by time would change the order. */
export function outOfTimeOrder(activities: Activity[]): boolean {
  const sorted = sortByTime(activities);
  return sorted.some((a, i) => a.id !== activities[i].id);
}

/** Where a new activity goes: at the end of its day. */
export function nextPosition(activities: Activity[], day: number): number {
  return activities.filter((a) => a.day_number === day).reduce((max, a) => Math.max(max, a.position + 1), 0);
}

// ---------------------------------------------------------------------------
// Money
// ---------------------------------------------------------------------------

export interface PinnedBill {
  id: string;
  itinerary_item_id: string | null;
  total_cents: Cents;
}

/** How much has been spent on each activity, from the bills pinned to it. */
export function spentByActivity(bills: PinnedBill[]): Map<string, Cents> {
  const spent = new Map<string, Cents>();
  for (const b of bills) {
    if (b.itinerary_item_id) spent.set(b.itinerary_item_id, (spent.get(b.itinerary_item_id) ?? 0) + b.total_cents);
  }
  return spent;
}

/** Planned and spent for a set of activities. */
export function budgetTotals(activities: Activity[], spent: Map<string, Cents>): { planned: Cents; spent: Cents } {
  return activities.reduce(
    (t, a) => ({ planned: t.planned + a.proposed_budget_cents, spent: t.spent + (spent.get(a.id) ?? 0) }),
    { planned: 0, spent: 0 },
  );
}

/** "Planned $40.00 · Spent $52.10", or just the part that applies. */
export function budgetLine(planned: Cents, spent: Cents): string {
  const parts: string[] = [];
  if (planned > 0) parts.push(`Planned ${formatCents(planned)}`);
  if (spent > 0) parts.push(`Spent ${formatCents(spent)}`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// The activity editor
// ---------------------------------------------------------------------------

export interface ActivityDraft {
  title: string;
  day: number;
  start: string;
  end: string;
  location: string;
  /** Set when the place was picked from search; cleared when the name is edited by hand. */
  place: PickedPlace | null;
  notes: string;
  budget: string;
}

export function draftFromActivity(a: Activity): ActivityDraft {
  return {
    title: a.title,
    day: a.day_number,
    start: formatTime(a.start_time),
    end: formatTime(a.end_time),
    location: a.location ?? '',
    place:
      a.location_lat != null && a.location_lng != null
        ? { address: a.location_address ?? '', lat: a.location_lat, lng: a.location_lng }
        : null,
    notes: a.notes ?? '',
    budget: a.proposed_budget_cents ? centsToText(a.proposed_budget_cents) : '',
  };
}

export interface ActivityFields {
  title: string;
  day_number: number;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  location_address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  notes: string | null;
  proposed_budget_cents: Cents;
}

export type ActivityCheck =
  | { ok: true; fields: ActivityFields }
  | { ok: false; errors: Partial<Record<'title' | 'start' | 'end' | 'budget', string>> };

export function checkActivity(draft: ActivityDraft): ActivityCheck {
  const errors: Partial<Record<'title' | 'start' | 'end' | 'budget', string>> = {};
  const title = draft.title.trim();
  if (!title) errors.title = 'Give it a name, like "Night market".';
  const start = parseTime(draft.start);
  const end = parseTime(draft.end);
  if (start === undefined) errors.start = 'Enter a time like 7:30 PM or 19:30.';
  if (end === undefined) errors.end = 'Enter a time like 9 PM or 21:00.';
  let budget: Cents = 0;
  if (draft.budget.trim()) {
    try {
      budget = parseMoneyText(draft.budget);
      if (budget < 0) errors.budget = 'Enter an amount like 40 or 12.50.';
    } catch {
      errors.budget = 'Enter an amount like 40 or 12.50.';
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    fields: {
      title,
      day_number: draft.day,
      start_time: start ?? null,
      end_time: end ?? null,
      location: draft.location.trim() || null,
      location_address: draft.location.trim() && draft.place ? draft.place.address || null : null,
      location_lat: draft.location.trim() && draft.place ? draft.place.lat : null,
      location_lng: draft.location.trim() && draft.place ? draft.place.lng : null,
      notes: draft.notes.trim() || null,
      proposed_budget_cents: budget,
    },
  };
}

// ---------------------------------------------------------------------------
// Places
// ---------------------------------------------------------------------------

/**
 * A maps link for a place: Apple Maps on iPhone and iPad, Google Maps elsewhere.
 * A place picked from search opens at its exact spot.
 */
export function mapsUrl(place: string, os: string, spot?: { lat: number; lng: number } | null): string {
  const q = encodeURIComponent(place.trim());
  if (spot) {
    const ll = `${spot.lat},${spot.lng}`;
    return os === 'ios'
      ? `https://maps.apple.com/?ll=${ll}&q=${q}`
      : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(ll)}`;
  }
  return os === 'ios' ? `https://maps.apple.com/?q=${q}` : `https://www.google.com/maps/search/?api=1&query=${q}`;
}

/** Where to look first when searching: a place already in the plan, if any. */
export function planCenter(activities: Activity[]): { lat: number; lng: number } | null {
  const a = activities.find((x) => x.location_lat != null && x.location_lng != null);
  return a ? { lat: a.location_lat!, lng: a.location_lng! } : null;
}
