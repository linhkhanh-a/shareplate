import { describe, expect, it } from 'vitest';

import { dateChoices, longDate, parseDateText } from '@/lib/dates';

const today = new Date(2026, 9, 18); // Sun, Oct 18, 2026

describe('reading typed dates', () => {
  it.each([
    ['2026-10-23', '2026-10-23'],
    ['2026/10/23', '2026-10-23'],
    ['10/23', '2026-10-23'],
    ['10/23/26', '2026-10-23'],
    ['10-23-2026', '2026-10-23'],
    ['Oct 23', '2026-10-23'],
    ['october 23, 2026', '2026-10-23'],
    ['23 Oct 2026', '2026-10-23'],
    ['Fri, Oct 23', '2026-10-23'],
    ['Oct 23rd', '2026-10-23'],
    ['today', '2026-10-18'],
    ['Tomorrow', '2026-10-19'],
    ['yesterday', '2026-10-17'],
  ])('%j is %j', (typed, iso) => {
    expect(parseDateText(typed, today)).toBe(iso);
  });

  it.each(['', '13/40', '2/30', 'next week', 'Octember 3', '2026-02-30'])('refuses %j', (typed) => {
    expect(parseDateText(typed, today)).toBeNull();
  });

  it('shows dates in full', () => {
    expect(longDate('2026-10-23')).toBe('Fri, Oct 23, 2026');
  });
});

describe('quick date choices for a bill', () => {
  it('lists the trip days when the trip has dates', () => {
    expect(dateChoices('2026-10-23', '2026-10-25', today)).toEqual([
      { date: '2026-10-23', label: 'Day 1 · Fri, Oct 23' },
      { date: '2026-10-24', label: 'Day 2 · Sat, Oct 24' },
      { date: '2026-10-25', label: 'Day 3 · Sun, Oct 25' },
    ]);
  });

  it('falls back to Today and Yesterday', () => {
    expect(dateChoices(null, null, today)).toEqual([
      { date: '2026-10-18', label: 'Today' },
      { date: '2026-10-17', label: 'Yesterday' },
    ]);
    expect(dateChoices('2026-01-01', '2026-03-01', today)).toHaveLength(2);
  });
});
