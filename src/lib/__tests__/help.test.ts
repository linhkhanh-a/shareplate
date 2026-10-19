import { describe, expect, it } from 'vitest';

import { FAQ, GUIDES, searchHelp, TOUR, tripChecklist } from '@/lib/help';

describe('help content', () => {
  it('has a short tour, guides with steps, and distinct questions', () => {
    expect(TOUR.length).toBeGreaterThanOrEqual(4);
    expect(TOUR.length).toBeLessThanOrEqual(7);
    expect(GUIDES.every((g) => g.steps.length >= 2)).toBe(true);
    expect(new Set(GUIDES.map((g) => g.id)).size).toBe(GUIDES.length);
    expect(new Set(FAQ.map((f) => f.q)).size).toBe(FAQ.length);
  });

  it('finds guides and questions by any words, in any case', () => {
    const r = searchHelp('ROUNDING');
    expect(r.faq.map((f) => f.q)).toContain('How does rounding work?');
    expect(searchHelp('zelle guest').faq.map((f) => f.q)).toContain('What’s a guest?');
    expect(searchHelp('invite').guides.map((g) => g.id)).toContain('people');
    expect(searchHelp('   ')).toEqual({ guides: GUIDES, faq: FAQ });
    expect(searchHelp('xylophone')).toEqual({ guides: [], faq: [] });
  });
});

describe('getting started on a new trip', () => {
  const base = { activePeople: 1, bills: 0, payments: 0, hasDates: false, myZelle: false, quick: false };

  it('ticks things off as they happen', () => {
    expect(tripChecklist(base).filter((i) => i.done)).toEqual([]);
    const later = tripChecklist({ ...base, activePeople: 3, bills: 2, myZelle: true });
    expect(later.filter((i) => i.done).map((i) => i.id)).toEqual(['people', 'zelle', 'bill']);
  });

  it('words the first step for quick splits', () => {
    expect(tripChecklist({ ...base, quick: true })[0].title).toBe('Add the people');
    expect(tripChecklist(base)[0].title).toBe('Invite your friends');
  });
});
