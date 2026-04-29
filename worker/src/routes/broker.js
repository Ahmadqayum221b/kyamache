/**
 * Service Broker Route
 * 
 * POST /upload-init     → generate pre-signed B2 upload URL
 * POST /upload-complete → notify worker of finished direct upload
 */

import { makeB2 }       from '../lib/b2.js';
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

export async function handleBroker(request, env, ctx, url) {
  const b2 = makeB2(env);
  const db = makeSupabase(env);
  const path = url.pathname;

  // ── POST /upload-init ──────────────────────────────────────────────────────
  if (path === '/upload-init' && request.method === 'POST') {
    const { filename, size, mime } = await request.json();
    if (!filename || !size || !mime) return json({ error: 'Missing required fields' }, 400);

    // Build unique key
    const now    = new Date();
    const folder = `uploads/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    const uid    = crypto.randomUUID();
    const name   = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key    = `${folder}/${uid}/${name}`;

    try {
      // In a real implementation, we'd call B2's b2_get_upload_url
      // For this worker, makeB2 might need to be extended to support pre-signed URLs
      // Since b2_get_upload_url returns a specific upload URL and token for the worker,
      // direct browser-to-B2 usually requires b2_get_upload_url on the worker side.
      
      const uploadUrlResult = await b2.getUploadUrl();
      
      return json({
        upload_url: uploadUrlResult.uploadUrl,
        upload_auth_token: uploadUrlResult.authorizationToken,
        file_key: key,
      });
    } catch (err) {
      return json({ error: 'Failed to generate upload URL', detail: err.message }, 500);
    }
  }

  // ── POST /upload-complete ──────────────────────────────────────────────────
  if (path === '/upload-complete' && request.method === 'POST') {
    const { file_key, file_id, filename, size, mime } = await request.json();
    
    // Create the entry in Supabase
    const entry = await db.insert('entries', {
      content:      filename,
      content_type: mime.startsWith('image/') ? 'image' : 'file',
      file_url:     `${env.B2_PUBLIC_URL}/${file_key}`,
      file_key:     file_key,
      ai_metadata:  { b2_file_id: file_id, size, direct_upload: true },
      ai_status:    'pending',
      status:       'active'
    });

    // Trigger processing
    ctx.waitUntil(fetch(`${env.WORKER_SELF_URL || 'http://localhost'}/process/${entry.id}`, {
      method: 'POST',
      body: JSON.stringify({ trigger: 'broker' })
    }));

    return json(entry, 201);
  }

  return json({ error: 'Not found' }, 404);
}
