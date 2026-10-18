// Place search for the trip plan, using free OpenStreetMap data: Photon
// (photon.komoot.io) first, Nominatim (nominatim.openstreetmap.org) if Photon
// can't answer. No API key or billing account is needed. Pure functions here,
// so they can be tested without the network.

export interface Place {
  /** What the place is called, e.g. "Chợ Đêm Đà Lạt". */
  name: string;
  /** Where it is, e.g. "Nguyễn Thị Minh Khai, Đà Lạt, Lâm Đồng, Vietnam". */
  address: string;
  lat: number;
  lng: number;
}

export class PlaceSearchError extends Error {
  constructor(
    public code: 'BAD_QUERY' | 'UNAVAILABLE',
    message: string,
  ) {
    super(message);
  }
}

export const USER_AGENT = 'Shareplate trip planner (https://shareplate-trips.vercel.app)';

/** Cleans up what was typed; refuses empty or very long searches. */
export function cleanQuery(raw: unknown): string {
  const q = typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
  if (q.length < 2) throw new PlaceSearchError('BAD_QUERY', 'Type at least 2 letters to search.');
  if (q.length > 200) throw new PlaceSearchError('BAD_QUERY', 'That search is too long.');
  return q;
}

export interface Near {
  lat: number;
  lng: number;
}

export function validNear(raw: unknown): Near | null {
  if (!raw || typeof raw !== 'object') return null;
  const { lat, lng } = raw as { lat?: unknown; lng?: unknown };
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

export function photonUrl(q: string, near: Near | null, limit = 6): string {
  const params = new URLSearchParams({ q, limit: String(limit) });
  // Prefer places near the rest of the trip, without excluding anywhere else.
  if (near) {
    params.set('lat', near.lat.toFixed(5));
    params.set('lon', near.lng.toFixed(5));
  }
  return `https://photon.komoot.io/api/?${params}`;
}

export function nominatimUrl(q: string, limit = 6): string {
  const params = new URLSearchParams({ q, format: 'jsonv2', limit: String(limit), addressdetails: '1' });
  return `https://nominatim.openstreetmap.org/search?${params}`;
}

const join = (parts: (string | undefined | null)[]) =>
  parts
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p, i, all) => p && all.indexOf(p) === i)
    .join(', ');

/** Photon's GeoJSON answer as places. */
export function parsePhoton(json: unknown): Place[] {
  const features = (json as { features?: unknown })?.features;
  if (!Array.isArray(features)) return [];
  const places: Place[] = [];
  for (const f of features) {
    const coords = (f as { geometry?: { coordinates?: unknown } })?.geometry?.coordinates;
    const p = ((f as { properties?: Record<string, string | undefined> })?.properties ?? {}) as Record<string, string | undefined>;
    if (!Array.isArray(coords) || typeof coords[0] !== 'number' || typeof coords[1] !== 'number') continue;
    const street = join([p.housenumber && p.street ? `${p.housenumber} ${p.street}` : p.street]);
    const name = (p.name ?? street ?? p.city ?? '').trim();
    if (!name) continue;
    const address = join([street !== name ? street : null, p.district, p.city ?? p.town ?? p.village, p.state, p.country]);
    places.push({ name, address, lat: coords[1], lng: coords[0] });
  }
  return dedupe(places);
}

/** Nominatim's answer as places. */
export function parseNominatim(json: unknown): Place[] {
  if (!Array.isArray(json)) return [];
  const places: Place[] = [];
  for (const r of json as Record<string, unknown>[]) {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const display = typeof r.display_name === 'string' ? r.display_name : '';
    const name = (typeof r.name === 'string' && r.name.trim()) || display.split(',')[0]?.trim() || '';
    if (!name) continue;
    const address = display
      .split(',')
      .map((s) => s.trim())
      .filter((s, i) => !(i === 0 && s === name))
      .join(', ');
    places.push({ name, address, lat, lng });
  }
  return dedupe(places);
}

/** The same place often comes back twice (a building and its venue). */
function dedupe(places: Place[]): Place[] {
  const seen = new Set<string>();
  return places.filter((p) => {
    const key = `${p.name.toLowerCase()}|${p.lat.toFixed(4)}|${p.lng.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Searches Photon, then Nominatim if Photon fails. `fetcher` is swappable for tests. */
export async function searchPlaces(q: string, near: Near | null, fetcher: typeof fetch = fetch): Promise<Place[]> {
  const get = async (url: string) => {
    const res = await fetcher(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  };
  try {
    return parsePhoton(await get(photonUrl(q, near)));
  } catch {
    try {
      return parseNominatim(await get(nominatimUrl(q)));
    } catch {
      throw new PlaceSearchError('UNAVAILABLE', "Place search isn't answering right now. Type the place name instead.");
    }
  }
}
