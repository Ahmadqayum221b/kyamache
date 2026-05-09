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
import { json } from '../lib/response.js';


function extractId(url) {
  const parts = url.pathname.split('/');
  return parts[2] || null;  // /entries/:id
}

export async function handleEntries(request, env, ctx, url, user) {
  const db  = makeSupabase(env);
  const id  = extractId(url);
  const authHeader = request.headers.get('Authorization');
  const userToken  = authHeader.split(' ')[1]; // Verified by index.js

  // ── GET /entries/:id ────────────────────────────────────────────────────
  if (request.method === 'GET' && id) {
    // If it's a public request (no user), check is_public
    const entry = await db.selectOne('entries', id);
    if (!entry) return json({ error: 'Entry not found' }, 404, request, env);

    if (entry.user_id !== user?.id) {
       if (!entry.is_public) return json({ error: 'Unauthorized' }, 401, request, env);
    }
    
    return json(entry, 200, request, env);
  }

  // ── GET /entries ─────────────────────────────────────────────────────────
  if (request.method === 'GET') {
    const limit  = Math.min(Number(url.searchParams.get('limit')  ?? 20), 100);
    const offset = Number(url.searchParams.get('offset') ?? 0);
    let status = url.searchParams.get('status') ?? 'active';
    if (!status.includes('.')) status = `eq.${status}`;

    const params = {
      order: 'created_at.desc',
      limit,
      offset,
      status
    };

    // Whitelist query params (Task 8)
    const ALLOWED_FILTERS = ['is_starred', 'content_type', 'ai_labels', 'source', 'family_id'];
    for (const [key, val] of url.searchParams.entries()) {
      if (ALLOWED_FILTERS.includes(key)) {
        params[key] = val;
      }
    }

    // Fetch entries where user_id matches OR is null (legacy/public)
    const entries = await db.select('entries', { 
      ...params,
      order: 'is_pinned.desc,created_at.desc' // PINNING Support
    }, null, user.id); 
    
    return json(entries, 200, request, env);
  }

  // ── POST /entries ─────────────────────────────────────────────────────────
  if (request.method === 'POST') {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, request, env);
    }

    const { content, content_type = 'text', source, file_url, file_key, family_id, sharing_scope } = body;
    if (!content) return json({ error: '`content` is required' }, 400, request, env);

    // Insert into Supabase (primary)
    // user_id will be set by Supabase auth.uid() if RLS/Default value is set,
    // but we can also pass it if we have it. 
    // Usually, we let Supabase handle the user context via userToken.
    const entry = await db.insert('entries', {
      user_id:       user.id,
      content,
      content_type,
      source:        source ?? null,
      file_url:      file_url ?? null,
      file_key:      file_key ?? null,
      family_id:     family_id ?? null,
      sharing_scope: sharing_scope ?? 'family',
      status:        'active',
      ai_status:     'pending',
      collection_id: collection_id ?? null,
    });

    if (!entry) throw new Error('Failed to create entry in Supabase');

    // Async: trigger AI classification (non-blocking)
    ctx.waitUntil(triggerAiClassification(entry.id, env));

    return json(entry, 201, request, env);
  }

  // ── PATCH /entries/:id ───────────────────────────────────────────────────
  if (request.method === 'PATCH' && id) {
    const body = await request.json().catch(() => ({}));
    
    // Verify ownership
    const existing = await db.selectOne('entries', id);
    if (!existing || existing.user_id !== user.id) return json({ error: 'Unauthorized' }, 401, request, env);

    // Whitelist allowed update fields
    const allowed = ['content', 'ai_summary', 'ai_labels', 'is_pinned', 'is_starred', 'status', 'collection_id', 'is_public'];
    const updateData = {};
    for (const key of allowed) {
      if (key in body) updateData[key] = body[key];
    }

    const updated = await db.update('entries', id, updateData);
    return json(updated, 200, request, env);
  }

  // ── POST /entries/bulk ──────────────────────────────────────────────────
  if (request.method === 'POST' && path === '/entries/bulk') {
    const { ids, updates } = await request.json().catch(() => ({}));
    if (!Array.isArray(ids) || !ids.length) return json({ error: 'ids array required' }, 400, request, env);

    // Filter allowed updates
    const allowed = ['is_pinned', 'is_starred', 'status', 'collection_id'];
    const updateData = {};
    for (const key of allowed) {
      if (key in updates) updateData[key] = updates[key];
    }

    // Use RPC or multiple updates? Since we bypass RLS, we can use a single DELETE/UPDATE with in filter
    const res = await fetch(`${db.base}/rest/v1/entries?id=in.(${ids.join(',')})&user_id=eq.${user.id}`, {
      method: 'PATCH',
      headers: db._headers({ Prefer: 'return=minimal' }),
      body: JSON.stringify(updateData),
    });

    return json({ updated: true, count: ids.length }, 200, request, env);
  }

  // ── DELETE /entries/:id ───────────────────────────────────────────────────
  if (request.method === 'DELETE' && id) {
    // Verify ownership before update (since we bypass RLS)
    const existing = await db.selectOne('entries', id);
    if (!existing || existing.user_id !== user.id) return json({ error: 'Unauthorized' }, 401, request, env);

    await db.update('entries', id, { 
      status: 'trashed',
      trashed_at: new Date().toISOString()
    });

    return json({ trashed: true, id }, 200, request, env);
  }

  return json({ error: 'Method not allowed' }, 405, request, env);
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
