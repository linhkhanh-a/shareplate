import { describe, expect, it } from 'vitest';

import { APP_VERSION, CHANGELOG, unseenReleases } from '@/lib/changelog';

describe('what’s new', () => {
  it('lists releases newest first, with unique ids', () => {
    const ids = CHANGELOG.map((r) => r.id);
    expect([...ids].sort().reverse()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(APP_VERSION).toBe(ids[0]);
  });

  it('shows only what’s newer than the last release seen', () => {
    expect(unseenReleases(CHANGELOG[1].id).map((r) => r.id)).toEqual([CHANGELOG[0].id]);
    expect(unseenReleases(APP_VERSION)).toEqual([]);
    expect(unseenReleases(null)).toEqual(CHANGELOG);
  });
});
