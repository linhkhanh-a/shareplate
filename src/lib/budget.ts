import { dateOfDay, daysBetween, shortDate, type Activity } from '@/lib/itinerary';
import { allocate, formatCents, type Cents } from '@/money';

/** The parts of a bill the budget needs. */
export interface BudgetBill {
  bill_date: string;
  total_cents: Cents;
  shares: { group_member_id: string; amount_cents: Cents }[];
}

export interface BudgetRow {
  /** "Day 2 · Sat, Oct 24", or a date like "Oct 16" when the trip has no dates. */
  label: string;
  date: string;
  spent: Cents;
  /** What the plan expects for the day (trip view only). */
  planned: Cents;
  /** That day's share of the budget or allowance, if one is set. */
  allowance: Cents | null;
  isToday: boolean;
}

export interface TripBudget {
  budget: Cents;
  spent: Cents;
  planned: Cents;
  /** Budget minus spent; negative when over. */
  left: Cents;
  /** Number of trip days, or 0 without dates. */
  days: number;
  /** About how much a day the budget allows (exact days add up to the budget). */
  perDay: Cents | null;
  rows: BudgetRow[];
  /** Spending dated before the first day or after the last. */
  outside: { before: Cents; after: Cents };
}

const label = (day: number, date: string) => `Day ${day} · ${shortDate(date)}`;

/** Splits a budget across days so the days add up to it exactly. */
function perDayAmounts(total: Cents, days: number): Cents[] | null {
  if (total <= 0 || days <= 0) return null;
  return allocate(total, Array.from({ length: days }, () => 1));
}

/**
 * The trip's spending against its budget and plan. With trip dates, there's a
 * row for each day; without them, a row for each date that has spending.
 */
export function tripBudget(input: {
  budgetCents: Cents;
  bills: BudgetBill[];
  activities: Activity[];
  start: string | null;
  end: string | null;
  today: string;
}): TripBudget {
  const { budgetCents, bills, activities, start, end, today } = input;
  const spent = bills.reduce((s, b) => s + b.total_cents, 0);
  const planned = activities.reduce((s, a) => s + a.proposed_budget_cents, 0);
  const days = daysBetween(start, end);
  const byDate = new Map<string, Cents>();
  for (const b of bills) byDate.set(b.bill_date, (byDate.get(b.bill_date) ?? 0) + b.total_cents);

  const outside = { before: 0, after: 0 };
  let rows: BudgetRow[];
  if (days > 0) {
    const shares = perDayAmounts(budgetCents, days);
    rows = Array.from({ length: days }, (_, i) => {
      const date = dateOfDay(i + 1, start)!;
      return {
        label: label(i + 1, date),
        date,
        spent: byDate.get(date) ?? 0,
        planned: activities.filter((a) => a.day_number === i + 1).reduce((s, a) => s + a.proposed_budget_cents, 0),
        allowance: shares ? shares[i] : null,
        isToday: date === today,
      };
    });
    for (const [date, cents] of byDate) {
      if (date < start!) outside.before += cents;
      if (date > end!) outside.after += cents;
    }
  } else {
    rows = [...byDate.keys()].sort().map((date) => ({
      label: shortDate(date),
      date,
      spent: byDate.get(date)!,
      planned: 0,
      allowance: null,
      isToday: date === today,
    }));
  }

  return {
    budget: budgetCents,
    spent,
    planned,
    left: budgetCents - spent,
    days,
    perDay: budgetCents > 0 && days > 0 ? Math.round(budgetCents / days) : null,
    rows,
    outside,
  };
}

export interface PersonBudget {
  memberId: string;
  /** Their share of every bill so far (what they used, not what they paid). */
  spent: Cents;
  allowancePerDay: Cents;
  /** Allowance for the whole trip (per day × days), when the trip has dates. */
  allowanceTotal: Cents | null;
  rows: BudgetRow[];
}

/**
 * One person's spending against their daily allowance. Spending is their share
 * of each bill, so a $60 dinner split three ways counts $20 for them.
 */
export function personBudget(input: {
  memberId: string;
  allowancePerDay: Cents;
  bills: BudgetBill[];
  start: string | null;
  end: string | null;
  today: string;
}): PersonBudget {
  const { memberId, allowancePerDay, bills, start, end, today } = input;
  const byDate = new Map<string, Cents>();
  for (const b of bills) {
    const share = b.shares.find((s) => s.group_member_id === memberId)?.amount_cents ?? 0;
    if (share > 0) byDate.set(b.bill_date, (byDate.get(b.bill_date) ?? 0) + share);
  }
  const spent = [...byDate.values()].reduce((a, b) => a + b, 0);
  const days = daysBetween(start, end);
  const allowance = allowancePerDay > 0 ? allowancePerDay : null;

  const rows: BudgetRow[] =
    days > 0
      ? Array.from({ length: days }, (_, i) => {
          const date = dateOfDay(i + 1, start)!;
          return { label: label(i + 1, date), date, spent: byDate.get(date) ?? 0, planned: 0, allowance, isToday: date === today };
        })
      : [...byDate.keys()].sort().map((date) => ({
          label: shortDate(date),
          date,
          spent: byDate.get(date)!,
          planned: 0,
          allowance,
          isToday: date === today,
        }));

  return {
    memberId,
    spent,
    allowancePerDay,
    allowanceTotal: allowance && days > 0 ? allowance * days : null,
    rows,
  };
}

/** How full a bar is, from 0 to 1, against the largest value on the chart. */
export function fraction(value: Cents, max: Cents): number {
  if (max <= 0 || value <= 0) return 0;
  return Math.min(1, value / max);
}

/** The scale for a set of rows: the biggest of any spent, planned or allowance. */
export function scaleFor(rows: BudgetRow[], includePlanned = true): Cents {
  return rows.reduce(
    (max, r) => Math.max(max, r.spent, r.allowance ?? 0, includePlanned ? r.planned : 0),
    0,
  );
}

/** "$12.00 left", "$4.50 over", or "On budget". */
export function leftOrOver(left: Cents): string {
  if (left > 0) return `${formatCents(left)} left`;
  if (left < 0) return `${formatCents(-left)} over`;
  return 'Right on budget';
}
