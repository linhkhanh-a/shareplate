/// <reference lib="deno.ns" />
// Reads a receipt photo the person already uploaded to the private "receipts"
// bucket and returns the items, tax, tip and so on for them to review.
//
// Who can use it: any signed-in trip member. The photo is downloaded with the
// caller's own permissions, so storage rules decide whether they may read it.
// Needs the GEMINI_API_KEY secret (Supabase -> Edge Functions -> Secrets).

import { createClient } from 'npm:@supabase/supabase-js@2';

import { bytesToBase64, ScanError, scanReceipt } from './core.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[A-Za-z0-9._-]{1,100}$/;

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

function publishableKey(req: Request): string | undefined {
  const legacy = Deno.env.get('SUPABASE_ANON_KEY');
  if (legacy) return legacy;
  const keys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (keys) {
    try {
      const parsed = JSON.parse(keys) as Record<string, string>;
      const first = Object.values(parsed)[0];
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

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.replace(/^Bearer\s+/i, '');
  const url = Deno.env.get('SUPABASE_URL');
  const key = publishableKey(req);
  if (!token || !url || !key) return reply(401, { code: 'NOT_SIGNED_IN', message: 'Sign in to scan receipts.' });

  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: user, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user.user) return reply(401, { code: 'NOT_SIGNED_IN', message: 'Sign in to scan receipts.' });

  let path: unknown;
  try {
    path = ((await req.json()) as { path?: unknown }).path;
  } catch {
    return reply(400, { code: 'BAD_REQUEST', message: 'Send the photo path as JSON.' });
  }
  if (typeof path !== 'string' || !PATH.test(path)) {
    return reply(400, { code: 'BAD_REQUEST', message: 'That photo path is not valid.' });
  }

  const apiKey = Deno.env.get('GEMINI_API_KEY');
  if (!apiKey) {
    return reply(503, {
      code: 'READER_NOT_SET_UP',
      message: "The receipt reader isn't set up yet. Enter the items by hand for now.",
    });
  }

  // Storage rules only let trip members read their trip's photos.
  const { data: file, error: fileError } = await supabase.storage.from('receipts').download(path);
  if (fileError || !file) {
    return reply(404, { code: 'PHOTO_NOT_FOUND', message: "Couldn't open that photo. Try uploading it again." });
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await scanReceipt({
      apiKey,
      model: Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.8-flash',
      imageBase64: bytesToBase64(bytes),
      mimeType: file.type || 'image/jpeg',
      fetchImpl: fetch,
    });
    return reply(200, result);
  } catch (e) {
    if (e instanceof ScanError) {
      return reply(e.code === 'RATE_LIMITED' ? 429 : 422, { code: e.code, message: e.message });
    }
    console.error('scan-receipt failed', e);
    return reply(500, { code: 'READER_FAILED', message: 'Something went wrong reading the receipt. Enter the items by hand, or try again.' });
  }
});
