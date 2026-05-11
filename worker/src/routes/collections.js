/**
 * /collections route
 * GET  /collections          → list user's collections
 * POST /collections          → create new collection
 * DELETE /collections/:id    → delete collection
 */

import { makeSupabase } from '../lib/supabase.js';
import { json } from '../lib/response.js';

export async function handleCollections(request, env, ctx, url, user) {
  const db = makeSupabase(env);
  const parts = url.pathname.split('/').filter(Boolean);
  const id = parts[1];
  const authHeader = request.headers.get('Authorization');
  const userToken  = authHeader?.split(' ')[1];

  // ── GET /collections ───────────────────────────────────────────────────────
  if (request.method === 'GET') {
    const data = await db.select('collections', { order: 'name.asc' }, userToken, user.id);
    return json(data, 200, request, env);
  }

  // ── POST /collections ──────────────────────────────────────────────────────
  if (request.method === 'POST') {
    const { name, description, color } = await request.json();
    if (!name) return json({ error: 'Name is required' }, 400, request, env);

    const data = await db.insert('collections', {
      user_id: user.id,
      name,
      description,
      color,
    });
    return json(data, 201, request, env);
  }

  // ── DELETE /collections/:id ────────────────────────────────────────────────
  if (request.method === 'DELETE' && id) {
    // Verify ownership
    const existing = await db.selectOne('collections', id);
    if (!existing || existing.user_id !== user.id) return json({ error: 'Unauthorized' }, 401, request, env);

    // Note: Supabase migration handles setting entry.collection_id to null on delete
    await fetch(`${db.base}/rest/v1/collections?id=eq.${id}`, {
      method: 'DELETE',
      headers: db._headers(),
    });
    return json({ deleted: true, id }, 200, request, env);
  }

  return json({ error: 'Method not allowed' }, 405, request, env);
}
