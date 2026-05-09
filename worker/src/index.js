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
import { handleCollections } from './routes/collections.js';
import { handleScheduled } from './cron/tagging.js';
import { getUser } from './lib/auth.js';

import { json } from './lib/response.js';

function notFound(request, env) {
  return json({ error: 'Not found' }, 404, request, env);
}

export default {
  /** HTTP Request Handler */
  async fetch(request, env, ctx) {
    // Preflight
    if (request.method === 'OPTIONS') {
      return json(null, 204, request, env);
    }

    const url  = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    try {
      // 1. Authenticate (Task: Generalized JWT Verification)
      // Exclude public routes like /health and /process (internal)
      let user = null;
      // Exclude public routes and individual entry GETs (for sharing)
      const isEntryGet = path.startsWith('/entries/') && request.method === 'GET' && path.split('/').length === 3;
      const isPublic = path === '/health' || path.startsWith('/process') || isEntryGet;
      
      if (!isPublic) {
        user = await getUser(request, env);
        if (!user) return json({ error: 'Unauthorized' }, 401, request, env);
      }

      // 2. Route dispatch
      if (path === '/entries' || path.startsWith('/entries/')) {
        return await handleEntries(request, env, ctx, url, user);
      }
      if (path === '/search') {
        return await handleSearch(request, env, ctx, url, user);
      }
      if (path === '/file' || path.startsWith('/file/')) {
        return await handleFile(request, env, ctx, url, user);
      }
      if (path === '/process' || path.startsWith('/process/')) {
        return await handleProcess(request, env, ctx, url); // /process is internal/async
      }
      if (path === '/upload-init' || path === '/upload-complete') {
        return await handleBroker(request, env, ctx, url, user);
      }
      if (path === '/family' || path.startsWith('/family/')) {
        return await handleFamily(request, env, ctx, url, user);
      }
      if (path === '/collections' || path.startsWith('/collections/')) {
        return await handleCollections(request, env, ctx, url, user);
      }
      if (path === '/health') {
        return json({ status: 'ok', ts: Date.now(), supabase_url_set: !!env.SUPABASE_URL }, 200, request, env);
      }

      return notFound(request, env);
    } catch (err) {
      console.error('[worker] unhandled error:', err);
      return json({ error: 'Internal server error', detail: err.message }, 500, request, env);
    }
  },

  /** Cron Trigger Handler */
  async scheduled(event, env, ctx) {
    await handleScheduled(event, env, ctx);
  }
};
