import { describe, expect, it } from 'vitest';

import {
  applyPlacements,
  budgetLine,
  budgetTotals,
  checkActivity,
  dayLabel,
  daysBetween,
  draftFromActivity,
  formatTime,
  guessHalf,
  joinTime,
  mapsUrl,
  planCenter,
  timeParts,
  moveInList,
  nextPosition,
  outOfTimeOrder,
  parseTime,
  placementsFor,
  planDays,
  sortByTime,
  spentByActivity,
  timeRange,
  type Activity,
} from '@/lib/itinerary';

let n = 0;
function activity(day: number, position: number, title: string, extra: Partial<Activity> = {}): Activity {
  n += 1;
  return {
    id: `a${n}`,
    day_number: day,
    position,
    start_time: null,
    end_time: null,
    title,
    location: null,
    notes: null,
    proposed_budget_cents: 0,
    version: 1,
    created_at: `2026-10-18T00:00:${String(n).padStart(2, '0')}Z`,
    ...extra,
  };
}

describe('times', () => {
  it('reads times the way people type them', () => {
    expect(parseTime('7pm')).toBe('19:00');
    expect(parseTime('7:30 PM')).toBe('19:30');
    expect(parseTime('7.30pm')).toBe('19:30');
    expect(parseTime('7:30 p.m.')).toBe('19:30');
    expect(parseTime('12 am')).toBe('00:00');
    expect(parseTime('12pm')).toBe('12:00');
    expect(parseTime('noon')).toBe('12:00');
    expect(parseTime('19:30')).toBe('19:30');
    expect(parseTime('0930')).toBe('09:30');
    expect(parseTime('7')).toBe('07:00');
    expect(parseTime('')).toBe(null);
    expect(parseTime('25:00')).toBe(undefined);
    expect(parseTime('13pm')).toBe(undefined);
    expect(parseTime('7:75')).toBe(undefined);
    expect(parseTime('later')).toBe(undefined);
  });

  it('shows times in 12-hour form', () => {
    expect(formatTime('19:30:00')).toBe('7:30 PM');
    expect(formatTime('00:05:00')).toBe('12:05 AM');
    expect(formatTime('12:00:00')).toBe('12:00 PM');
    expect(timeRange('19:00:00', '21:30:00')).toBe('7:00 PM to 9:30 PM');
    expect(timeRange(null, '10:00:00')).toBe('Until 10:00 AM');
    expect(timeRange(null, null)).toBe('');
  });
});

describe('days', () => {
  it('counts trip days and labels them with dates', () => {
    expect(daysBetween('2026-10-23', '2026-10-26')).toBe(4);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(2);
    expect(daysBetween(null, '2026-10-26')).toBe(0);
    expect(dayLabel(2, '2026-10-23')).toBe('Day 2 · Sat, Oct 24');
    expect(dayLabel(3, null)).toBe('Day 3');
  });

  it('lays out every trip day, plus later days that have plans', () => {
    const lake = activity(1, 1, 'Lake walk');
    const market = activity(1, 0, 'Night market');
    const flight = activity(5, 0, 'Flight home');
    const days = planDays([lake, flight, market], '2026-10-23', '2026-10-25');
    expect(days.map((d) => [d.day, d.date, d.activities.map((a) => a.title)])).toEqual([
      [1, '2026-10-23', ['Night market', 'Lake walk']],
      [2, '2026-10-24', []],
      [3, '2026-10-25', []],
      [4, '2026-10-26', []],
      [5, '2026-10-27', ['Flight home']],
    ]);
    expect(planDays([], null, null)).toEqual([{ day: 1, date: null, activities: [] }]);
  });
});

describe('rearranging', () => {
  it('moves an activity and renumbers the day', () => {
    const [a, b, c] = [activity(1, 0, 'A'), activity(1, 1, 'B'), activity(1, 2, 'C')];
    const moved = moveInList([a, b, c], 2, 0);
    expect(moved.map((x) => x.title)).toEqual(['C', 'A', 'B']);
    expect(moveInList([a, b, c], 0, 9).map((x) => x.title)).toEqual(['B', 'C', 'A']);
    const placements = placementsFor(1, moved);
    expect(placements).toEqual([
      { id: c.id, day_number: 1, position: 0 },
      { id: a.id, day_number: 1, position: 1 },
      { id: b.id, day_number: 1, position: 2 },
    ]);
    const applied = applyPlacements([a, b, c], placements);
    expect(planDays(applied, null, null)[0].activities.map((x) => x.title)).toEqual(['C', 'A', 'B']);
    expect(nextPosition(applied, 1)).toBe(3);
    expect(nextPosition(applied, 2)).toBe(0);
  });

  it('sorts a day by start time, keeping untimed plans at the end', () => {
    const lunch = activity(1, 0, 'Lunch', { start_time: '12:00:00' });
    const free = activity(1, 1, 'Free time');
    const breakfast = activity(1, 2, 'Breakfast', { start_time: '08:00:00' });
    expect(outOfTimeOrder([lunch, free, breakfast])).toBe(true);
    const sorted = sortByTime([lunch, free, breakfast]);
    expect(sorted.map((x) => x.title)).toEqual(['Breakfast', 'Lunch', 'Free time']);
    expect(outOfTimeOrder(sorted)).toBe(false);
  });
});

describe('budgets', () => {
  it('adds up planned and spent, from the bills pinned to each activity', () => {
    const market = activity(1, 0, 'Night market', { proposed_budget_cents: 4000 });
    const lake = activity(1, 1, 'Lake walk');
    const spent = spentByActivity([
      { id: 'b1', itinerary_item_id: market.id, total_cents: 1850 },
      { id: 'b2', itinerary_item_id: market.id, total_cents: 3360 },
      { id: 'b3', itinerary_item_id: null, total_cents: 999 },
    ]);
    expect(spent.get(market.id)).toBe(5210);
    expect(budgetTotals([market, lake], spent)).toEqual({ planned: 4000, spent: 5210 });
    expect(budgetLine(4000, 5210)).toBe('Planned $40.00 · Spent $52.10');
    expect(budgetLine(0, 0)).toBe('');
  });
});

describe('time boxes with an AM | PM switch', () => {
  it('splits a time into the clock and AM/PM', () => {
    expect(timeParts('7:30 PM')).toEqual({ clock: '7:30', half: 'PM' });
    expect(timeParts('7:30pm')).toEqual({ clock: '7:30', half: 'PM' });
    expect(timeParts('19:30')).toEqual({ clock: '7:30', half: 'PM' });
    expect(timeParts('0:15')).toEqual({ clock: '12:15', half: 'AM' });
    expect(timeParts('7a')).toEqual({ clock: '7', half: 'AM' });
    expect(timeParts('7')).toEqual({ clock: '7', half: null });
    expect(timeParts('7:')).toEqual({ clock: '7:', half: null });
    expect(timeParts('noon')).toEqual({ clock: '12:00', half: 'PM' });
  });

  it('joins them back, and guesses AM or PM sensibly', () => {
    expect(joinTime('7:30', 'PM')).toBe('7:30 PM');
    expect(joinTime(' ', 'PM')).toBe('');
    expect(parseTime(joinTime('7', 'PM'))).toBe('19:00');
    expect(guessHalf('9')).toBe('AM');
    expect(guessHalf('11:30')).toBe('AM');
    expect(guessHalf('12')).toBe('PM');
    expect(guessHalf('6:45')).toBe('PM');
  });
});

describe('the activity editor', () => {
  it('checks every field and explains what to fix', () => {
    const bad = checkActivity({ title: ' ', day: 1, start: 'later', end: '', location: '', place: null, notes: '', budget: 'abc' });
    expect(bad).toEqual({
      ok: false,
      errors: {
        title: 'Give it a name, like "Night market".',
        start: 'Enter a time like 7:30 PM or 19:30.',
        budget: 'Enter an amount like 40 or 12.50.',
      },
    });
    const good = checkActivity({
      title: ' Night market ',
      day: 2,
      start: '7pm',
      end: '9:30 pm',
      location: ' Chợ Đêm Đà Lạt ',
      place: { address: 'Nguyễn Thị Minh Khai, Đà Lạt, Vietnam', lat: 11.9429, lng: 108.4372 },
      notes: '',
      budget: '40',
    });
    expect(good).toEqual({
      ok: true,
      fields: {
        title: 'Night market',
        day_number: 2,
        start_time: '19:00',
        end_time: '21:30',
        location: 'Chợ Đêm Đà Lạt',
        location_address: 'Nguyễn Thị Minh Khai, Đà Lạt, Vietnam',
        location_lat: 11.9429,
        location_lng: 108.4372,
        notes: null,
        proposed_budget_cents: 4000,
      },
    });
  });

  it('round-trips a saved activity into the editor', () => {
    const a = activity(2, 0, 'Night market', { start_time: '19:00:00', proposed_budget_cents: 1250, location: 'Đà Lạt' });
    const draft = draftFromActivity(a);
    expect(draft).toEqual({ title: 'Night market', day: 2, start: '7:00 PM', end: '', location: 'Đà Lạt', place: null, notes: '', budget: '12.50' });
    const picked = draftFromActivity({ ...a, location_address: 'Lâm Đồng, Vietnam', location_lat: 11.94, location_lng: 108.44 });
    expect(picked.place).toEqual({ address: 'Lâm Đồng, Vietnam', lat: 11.94, lng: 108.44 });
    expect(checkActivity(draft)).toMatchObject({ ok: true, fields: { start_time: '19:00', proposed_budget_cents: 1250 } });
  });

  it('links places to the right maps app', () => {
    expect(mapsUrl('Chợ Đêm Đà Lạt', 'ios')).toBe('https://maps.apple.com/?q=Ch%E1%BB%A3%20%C4%90%C3%AAm%20%C4%90%C3%A0%20L%E1%BA%A1t');
    expect(mapsUrl('Hoan Kiem Lake', 'web')).toBe('https://www.google.com/maps/search/?api=1&query=Hoan%20Kiem%20Lake');
    // A place picked from search opens at its exact spot.
    const spot = { lat: 21.0287, lng: 105.8524 };
    expect(mapsUrl('Hoan Kiem Lake', 'web', spot)).toBe('https://www.google.com/maps/search/?api=1&query=21.0287%2C105.8524');
    expect(mapsUrl('Hoan Kiem Lake', 'ios', spot)).toBe('https://maps.apple.com/?ll=21.0287,105.8524&q=Hoan%20Kiem%20Lake');
    expect(planCenter([])).toBeNull();
  });
});
