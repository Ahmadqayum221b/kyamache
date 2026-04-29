/**
 * /family routes
 * GET  /family/members → list members of current user's family
 * POST /family/invite  → invite a new member
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

export async function handleFamily(request, env, ctx, url) {
  const db  = makeSupabase(env);
  const authHeader = request.headers.get('Authorization');
  const userToken  = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!userToken) return json({ error: 'Unauthorized' }, 401);

  // ── GET /family/members ──────────────────────────────────────────────────
  if (request.method === 'GET' && url.pathname === '/family/members') {
    // We can use RPC or a view, but for now we'll query family_members
    // RLS will handle filtering by the user's family
    const members = await db.select('family_members', {
      order: 'created_at.asc'
    }, userToken);
    return json(members);
  }

  // ── POST /family/invite ──────────────────────────────────────────────────
  if (request.method === 'POST' && url.pathname === '/family/invite') {
    const { email, role = 'member' } = await request.json();
    if (!email) return json({ error: 'Email required' }, 400);

    // Get current user's family_id
    const userMemberships = await db.select('family_members', { limit: 1 }, userToken);
    if (!userMemberships.length) return json({ error: 'User has no family' }, 403);
    
    const family_id = userMemberships[0].family_id;

    // Create invitation
    const invitation = await db.insert('invitations', {
      family_id,
      email,
      role,
      token: crypto.randomUUID(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    }, userToken);

    // In a real app, send an email here. For now, just return it.
    return json({ invited: true, invitation });
  }

  return json({ error: 'Not found' }, 404);
}
