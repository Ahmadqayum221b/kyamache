/**
 * /family routes
 * GET  /family/members → list members of current user's family
 * POST /family/invite  → invite a new member
 */

import { makeSupabase } from '../lib/supabase.js';
import { json } from '../lib/response.js';

export async function handleFamily(request, env, ctx, url, user) {
  const db  = makeSupabase(env);
  const authHeader = request.headers.get('Authorization');
  const userToken  = authHeader.split(' ')[1]; // Verified by index.js

  // ── GET /family/members ──────────────────────────────────────────────────
  if (request.method === 'GET' && url.pathname === '/family/members') {
    // First, get the user's family_id using service key
    const userMemberships = await db.select('family_members', { limit: 1 }, null, user.id);
    if (!userMemberships.length) return json([], 200, request, env);
    
    const family_id = userMemberships[0].family_id;

    // Then, get all members of that family using service key
    const members = await db.select('family_members', {
      family_id: `eq.${family_id}`,
      order: 'joined_at.asc'
    });
    return json(members, 200, request, env);
  }

  // ── POST /family/invite ──────────────────────────────────────────────────
  if (request.method === 'POST' && url.pathname === '/family/invite') {
    const { email, role = 'member' } = await request.json();
    if (!email) return json({ error: 'Email required' }, 400, request, env);

    // Get current user's family_id using service key
    const userMemberships = await db.select('family_members', { limit: 1 }, null, user.id);
    if (!userMemberships.length) return json({ error: 'User has no family' }, 403, request, env);
    
    const family_id = userMemberships[0].family_id;

    // Create invitation using service key
    const invitation = await db.insert('invitations', {
      family_id,
      email,
      role,
      token: crypto.randomUUID(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    });

    // In a real app, send an email here. For now, just return it.
    return json({ invited: true, invitation }, 200, request, env);
  }

  // ── DELETE /family/members/:id ───────────────────────────────────────────
  if (request.method === 'DELETE' && url.pathname.startsWith('/family/members/')) {
    const memberId = url.pathname.split('/').pop();
    if (!memberId) return json({ error: 'Missing member id' }, 400, request, env);

    // Verify user is the owner/adult of this family before removing someone
    const userMemberships = await db.select('family_members', { limit: 1 }, null, user.id);
    if (!userMemberships.length || !['owner', 'adult'].includes(userMemberships[0].role)) {
      return json({ error: 'Unauthorized' }, 401, request, env);
    }

    // Use service key to bypass broken RLS recursion
    // Note: The table structure has (family_id, user_id) as PK, so we need a filter
    const res = await fetch(`${db.base}/rest/v1/family_members?user_id=eq.${memberId}&family_id=eq.${userMemberships[0].family_id}`, {
      method: 'DELETE',
      headers: db._headers({ Prefer: 'return=minimal' }),
    });
    
    return json({ removed: true, id: memberId }, 200, request, env);
  }

  return json({ error: 'Not found' }, 404, request, env);
}
