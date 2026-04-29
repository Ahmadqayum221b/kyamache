/**
 * /entries route
 * GET    /entries          → list recent entries (KV-cached)
 * GET    /entries/:id      → single entry (KV-first, fallback Supabase)
 * POST   /entries          → create entry, fire async AI classification
 * DELETE /entries/:id      → delete entry + KV + B2 file (if any)
 */

import { makeSupabase } from '../lib/supabase.js';
import { makeB2 }       from '../lib/b2.js';
import { kvGet, kvSet, kvDelete, kvGetList, kvSetList, kvInvalidateList } from '../lib/kv.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function extractId(url) {
  const parts = url.pathname.split('/');
  return parts[2] || null;  // /entries/:id
}

export async function handleEntries(request, env, ctx, url) {
  const db  = makeSupabase(env);
  const ttl = Number(env.KV_TTL ?? 3600);
  const id  = extractId(url);
  const authHeader = request.headers.get('Authorization');
  const userToken  = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  // ── GET /entries/:id ────────────────────────────────────────────────────
  if (request.method === 'GET' && id) {
    // For single entries, we can still try KV but maybe skip for now if we want strict RLS
    const entry = await db.selectOne('entries', id, userToken);
    if (!entry) return json({ error: 'Entry not found' }, 404);
    return json(entry);
  }

  // ── GET /entries ─────────────────────────────────────────────────────────
  if (request.method === 'GET') {
    const limit  = Number(url.searchParams.get('limit')  ?? 20);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    let status = url.searchParams.get('status') ?? 'active';
    // If status already has a filter operator (like eq. or in.), use it directly
    if (!status.includes('.')) status = `eq.${status}`;

    const params = {
      order: 'created_at.desc',
      limit,
      offset,
      status
    };

    // Forward other filters (labels, content_type)
    for (const [key, val] of url.searchParams.entries()) {
      if (!['limit', 'offset', 'status'].includes(key)) {
        params[key] = val;
      }
    }

    const entries = await db.select('entries', params, userToken);
    return json(entries);
  }

  // ── POST /entries ─────────────────────────────────────────────────────────
  if (request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400);
    }

    const { content, content_type = 'text', source, file_url, file_key, family_id, sharing_scope } = body;
    if (!content) return json({ error: '`content` is required' }, 400);

    // Insert into Supabase (primary)
    // user_id will be set by Supabase auth.uid() if RLS/Default value is set,
    // but we can also pass it if we have it. 
    // Usually, we let Supabase handle the user context via userToken.
    const entry = await db.insert('entries', {
      content,
      content_type,
      source:        source ?? null,
      file_url:      file_url ?? null,
      file_key:      file_key ?? null,
      family_id:     family_id ?? null,
      sharing_scope: sharing_scope ?? 'family',
      status:        'active',
      ai_status:     'pending',
    }, userToken);

    // Async: trigger AI classification (non-blocking)
    ctx.waitUntil(triggerAiClassification(entry.id, env));

    return json(entry, 201);
  }

  // ── DELETE /entries/:id ───────────────────────────────────────────────────
  if (request.method === 'DELETE' && id) {
    // Soft delete: update status instead of physical delete
    await db.update('entries', id, { 
      status: 'trashed',
      trashed_at: new Date().toISOString()
    }, userToken);

    return json({ trashed: true, id });
  }

  return json({ error: 'Method not allowed' }, 405);
}

/** Fire-and-forget: call /process internally via Worker self-call */
async function triggerAiClassification(entryId, env) {
  try {
    await fetch(`${env.WORKER_SELF_URL ?? 'http://localhost'}/process/${entryId}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ trigger: 'auto' }),
    });
  } catch (e) {
    // Non-blocking: log and move on
    console.warn('[entries] async AI trigger failed:', e.message);
  }
}
