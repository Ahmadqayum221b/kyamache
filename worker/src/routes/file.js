/**
 * /file route
 * POST   /file             → upload file to B2, return { file_url, file_key, file_id }
 * GET    /file/:key/signed → return a time-limited signed download URL
 */

import { makeB2 } from '../lib/b2.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

const ALLOWED_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/markdown',
  'application/octet-stream',
]);

export async function handleFile(request, env, ctx, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['file', key?, 'signed'?]
  const b2    = makeB2(env);

  // ── GET /file/:key/signed ────────────────────────────────────────────────
  if (request.method === 'GET') {
    const key = decodeURIComponent(parts.slice(1, -1).join('/'));
    if (!key) return json({ error: 'Missing file key' }, 400);

    const signedUrl = await b2.getDownloadUrl(key, 3600);
    return json({ signed_url: signedUrl, expires_in: 3600 });
  }

  // ── POST /file ────────────────────────────────────────────────────────────
  if (request.method === 'POST') {
    const maxBytes = Number(env.MAX_FILE_SIZE ?? 10 * 1024 * 1024);

    // Expect multipart/form-data
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return json({ error: 'Expected multipart/form-data' }, 400);
    }

    const file = formData.get('file');
    if (!file || typeof file === 'string') {
      return json({ error: 'Form field `file` is missing or not a file' }, 400);
    }

    // Validate size
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      return json({ error: `File too large. Max ${maxBytes} bytes.` }, 413);
    }

    // Validate MIME type (allow override via field)
    const mimeType = formData.get('mime_type') ?? file.type ?? 'application/octet-stream';
    if (!ALLOWED_TYPES.has(mimeType) && !mimeType.startsWith('image/')) {
      return json({ error: `Unsupported file type: ${mimeType}` }, 415);
    }

    // Build a unique key: uploads/<year>/<month>/<uuid>/<filename>
    const now    = new Date();
    const folder = `uploads/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}`;
    const uid    = crypto.randomUUID();
    const name   = (file.name ?? 'file').replace(/[^a-zA-Z0-9._-]/g, '_');
    const key    = `${folder}/${uid}/${name}`;

    const result = await b2.upload(key, buffer, mimeType);

    return json({
      file_url:  result.publicUrl,
      file_key:  key,
      file_id:   result.fileId,
      mime_type: mimeType,
      size:      buffer.byteLength,
    }, 201);
  }

  return json({ error: 'Method not allowed' }, 405);
}
