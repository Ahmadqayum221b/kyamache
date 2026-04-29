/**
 * Kymacache Cloudflare Worker
 * Routes: /entries  /search  /file  /process
 * All responses: JSON  |  CORS enabled
 */

import { handleEntries } from './routes/entries.js';
import { handleSearch }  from './routes/search.js';
import { handleFile }    from './routes/file.js';
import { handleProcess } from './routes/process.js';
import { handleBroker }  from './routes/broker.js';
import { handleFamily }  from './routes/family.js';
import { handleScheduled } from './cron/tagging.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id',
  'Access-Control-Max-Age':       '86400',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function notFound() {
  return json({ error: 'Not found' }, 404);
}

export default {
  /** HTTP Request Handler */
  async fetch(request, env, ctx) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url  = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    try {
      // Route dispatch
      if (path === '/entries' || path.startsWith('/entries/')) {
        return await handleEntries(request, env, ctx, url);
      }
      if (path === '/search') {
        return await handleSearch(request, env, ctx, url);
      }
      if (path === '/file' || path.startsWith('/file/')) {
        return await handleFile(request, env, ctx, url);
      }
      if (path === '/process' || path.startsWith('/process/')) {
        return await handleProcess(request, env, ctx, url);
      }
      if (path === '/upload-init' || path === '/upload-complete') {
        return await handleBroker(request, env, ctx, url);
      }
      if (path === '/family' || path.startsWith('/family/')) {
        return await handleFamily(request, env, ctx, url);
      }
      if (path === '/health') {
        return json({ status: 'ok', ts: Date.now(), supabase_url_set: !!env.SUPABASE_URL });
      }

      return notFound();
    } catch (err) {
      console.error('[worker] unhandled error:', err);
      return json({ error: 'Internal server error', detail: err.message }, 500);
    }
  },

  /** Cron Trigger Handler */
  async scheduled(event, env, ctx) {
    await handleScheduled(event, env, ctx);
  }
};
