/**
 * Background Tagging Operation
 * 
 * This is triggered by a Cloudflare Cron (scheduled) event.
 * It finds entries that are untagged, stale, or failed tagging,
 * and pushes them back into the processing pipeline.
 */

import { makeSupabase } from '../lib/supabase.js';

export async function handleScheduled(event, env, ctx) {
  const db = makeSupabase(env);
  
  // 1. Find entries needing tagging
  // - tagging_status = 'pending'
  // - OR tagging_status = 'failed' and attempts < 5
  // - OR category is image/document and tags are empty (stale)
  // For simplicity, we'll start with 'pending' and 'failed'
  
  const entries = await db.select('entries', {
    or: '(tagging_status.eq.pending,tagging_status.eq.failed)',
    tagging_attempts: 'lt.5',
    limit: 10 // Process in small batches per cron run
  });

  if (entries.length === 0) {
    console.log('[tagging] No entries needing tagging.');
    return;
  }

  console.log(`[tagging] Found ${entries.length} entries to process.`);

  for (const entry of entries) {
    // Trigger /process/:id for each
    // We use a self-call to the worker's own process endpoint
    const processUrl = `${env.WORKER_SELF_URL || 'http://localhost'}/process/${entry.id}`;
    
    ctx.waitUntil((async () => {
      try {
        const res = await fetch(processUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger: 'cron' })
        });
        if (!res.ok) console.warn(`[tagging] Failed to trigger process for ${entry.id}: ${res.status}`);
      } catch (err) {
        console.error(`[tagging] Error triggering process for ${entry.id}:`, err.message);
      }
    })());
  }
}
