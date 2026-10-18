import { describe, expect, it } from 'vitest';

import { cleanQuery, nominatimUrl, parseNominatim, parsePhoton, photonUrl, PlaceSearchError, searchPlaces, validNear } from './core.ts';

const photon = {
  type: 'FeatureCollection',
  features: [
    {
      geometry: { type: 'Point', coordinates: [108.4372, 11.9429] },
      properties: { name: 'Chợ Đêm Đà Lạt', street: 'Nguyễn Thị Minh Khai', city: 'Đà Lạt', state: 'Lâm Đồng', country: 'Vietnam' },
    },
    // The same place again, as the building.
    {
      geometry: { type: 'Point', coordinates: [108.43721, 11.94291] },
      properties: { name: 'Chợ Đêm Đà Lạt', city: 'Đà Lạt', country: 'Vietnam' },
    },
    {
      geometry: { type: 'Point', coordinates: [108.44, 11.95] },
      properties: { housenumber: '12', street: 'Phan Bội Châu', city: 'Đà Lạt', country: 'Vietnam' },
    },
    { geometry: { type: 'Point', coordinates: ['x', 1] }, properties: { name: 'Broken' } },
  ],
};

describe('place search', () => {
  it('reads Photon answers into name, address and coordinates', () => {
    expect(parsePhoton(photon)).toEqual([
      { name: 'Chợ Đêm Đà Lạt', address: 'Nguyễn Thị Minh Khai, Đà Lạt, Lâm Đồng, Vietnam', lat: 11.9429, lng: 108.4372 },
      { name: '12 Phan Bội Châu', address: 'Đà Lạt, Vietnam', lat: 11.95, lng: 108.44 },
    ]);
    expect(parsePhoton({ nope: true })).toEqual([]);
  });

  it('reads Nominatim answers', () => {
    expect(
      parseNominatim([
        { lat: '46.0207', lon: '7.7491', name: 'Matterhorn Glacier Paradise', display_name: 'Matterhorn Glacier Paradise, Zermatt, Valais, Switzerland' },
        { lat: 'x', lon: '1', display_name: 'Broken' },
      ]),
    ).toEqual([{ name: 'Matterhorn Glacier Paradise', address: 'Zermatt, Valais, Switzerland', lat: 46.0207, lng: 7.7491 }]);
  });

  it('builds the search addresses, preferring places near the trip', () => {
    expect(photonUrl('night market', { lat: 11.94, lng: 108.43 })).toBe(
      'https://photon.komoot.io/api/?q=night+market&limit=6&lat=11.94000&lon=108.43000',
    );
    expect(photonUrl('x y', null)).toBe('https://photon.komoot.io/api/?q=x+y&limit=6');
    expect(nominatimUrl('zermatt')).toContain('format=jsonv2');
  });

  it('checks what was typed', () => {
    expect(cleanQuery('  night   market ')).toBe('night market');
    expect(() => cleanQuery('a')).toThrow(PlaceSearchError);
    expect(() => cleanQuery(42)).toThrow(PlaceSearchError);
    expect(validNear({ lat: 11.9, lng: 108.4 })).toEqual({ lat: 11.9, lng: 108.4 });
    expect(validNear({ lat: 120, lng: 0 })).toBeNull();
    expect(validNear('x')).toBeNull();
  });

  it('falls back to Nominatim, and explains when neither answers', async () => {
    const calls: string[] = [];
    const fallback = (async (url: string) => {
      calls.push(url);
      if (url.includes('photon')) return new Response('down', { status: 502 });
      return new Response(JSON.stringify([{ lat: '1', lon: '2', display_name: 'Somewhere, Far' }]));
    }) as unknown as typeof fetch;
    expect(await searchPlaces('somewhere', null, fallback)).toEqual([{ name: 'Somewhere', address: 'Far', lat: 1, lng: 2 }]);
    expect(calls.map((c) => new URL(c).host)).toEqual(['photon.komoot.io', 'nominatim.openstreetmap.org']);

    const down = (async () => new Response('down', { status: 503 })) as unknown as typeof fetch;
    await expect(searchPlaces('somewhere', null, down)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});
