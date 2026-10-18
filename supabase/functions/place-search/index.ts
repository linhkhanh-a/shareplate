/// <reference lib="deno.ns" />
// Finds places for the trip plan ("night market da lat") using free
// OpenStreetMap search. Signed-in people only, so the app can't be used as an
// open proxy. No secrets needed.

import { createClient } from 'npm:@supabase/supabase-js@2';

import { cleanQuery, PlaceSearchError, searchPlaces, validNear } from './core.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

function publishableKey(req: Request): string | undefined {
  const legacy = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacy) return legacy;
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (keys) {
    try {
      const first = Object.values(JSON.parse(keys) as Record<string, string>)[0];
      if (first) return first;
    } catch {
      // Fall through to the key the app sent.
    }
  }
  return req.headers.get('apikey') ?? undefined;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return reply(405, { code: 'METHOD', message: 'Use POST.' });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const url = Deno.env.get('SUPABASE_URL');
  const key = publishableKey(req);
  if (!token || !url || !key) return reply(401, { code: 'NOT_SIGNED_IN', message: 'Sign in to search for places.' });
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: user, error } = await supabase.auth.getUser(token);
  if (error || !user.user) return reply(401, { code: 'NOT_SIGNED_IN', message: 'Sign in to search for places.' });

  try {
    const body = (await req.json().catch(() => ({}))) as { query?: unknown; near?: unknown };
    const places = await searchPlaces(cleanQuery(body.query), validNear(body.near));
    return reply(200, { places });
  } catch (e) {
    if (e instanceof PlaceSearchError) return reply(e.code === 'BAD_QUERY' ? 400 : 503, { code: e.code, message: e.message });
    return reply(500, { code: 'UNAVAILABLE', message: "Place search isn't answering right now. Type the place name instead." });
  }
});
