/**
 * /search route
 * GET /search?q=term&labels=tag1,tag2&limit=20
 *
 * Uses Supabase full-text search + trigram ILIKE.
 * KV is NOT used for search (results depend on query params).
 */

import { makeSupabase } from '../lib/supabase.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function handleSearch(request, env, ctx, url) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const q      = url.searchParams.get('q')?.trim() ?? '';
  const labels = url.searchParams.get('labels')
    ? url.searchParams.get('labels').split(',').map(l => l.trim()).filter(Boolean)
    : [];
  const limit  = Math.min(Number(url.searchParams.get('limit') ?? 20), 100);

  if (!q && labels.length === 0) {
    return json({ error: 'Provide at least one of: q, labels' }, 400);
  }

  const db      = makeSupabase(env);
  const authHeader = request.headers.get('Authorization');
  const userToken  = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  const results = await db.search('entries', q, labels, userToken);

  return json({
    query:   q,
    labels,
    count:   results.length,
    results: results.slice(0, limit),
  });
}
