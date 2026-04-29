/**
 * /process route — async AI classification pipeline
 *
 * POST /process/:id   → classify entry with Kimi, update Supabase + KV
 *
 * This is called:
 *   1. Automatically via ctx.waitUntil() after entry creation (non-blocking)
 *   2. Manually to re-process an entry (e.g. after editing)
 *
 * The caller (the main response to the user) returns immediately.
 * This worker route does the heavy lifting in the background.
 */

import { makeSupabase }       from '../lib/supabase.js';
import { classifyWithKimi }   from '../lib/kimi.js';
import { kvSet, kvDelete }    from '../lib/kv.js';
import { makeB2 }             from '../lib/b2.js';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

export async function handleProcess(request, env, ctx, url) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const parts   = url.pathname.split('/').filter(Boolean);
  const entryId = parts[1];
  if (!entryId) return json({ error: 'Missing entry id' }, 400);

  const db = makeSupabase(env);

  // Fetch the entry
  const entry = await db.selectOne('entries', entryId);
  if (!entry) return json({ error: 'Entry not found' }, 404);

  // Mark as processing
  await db.update('entries', entryId, { 
    ai_status:      'processing',
    tagging_status: 'tagging' 
  });

  // Run async classification
  const classifyPromise = (async () => {
    try {
      // 1. Content Hashing (SHA-256)
      let contentHash = null;
      if (entry.content) {
        const msgUint8 = new TextEncoder().encode(entry.content);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        contentHash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      } else if (entry.file_url) {
        // For files, we'd ideally download and hash, but for now we might skip or do it later
      }

      // 2. Budget Check
      const today = new Date().toISOString().split('T')[0];
      const budget = await db.selectOne('daily_budget', today) || { tokens_spent: 0, cost_cents: 0 };
      const MAX_COST_CENTS = Number(env.DAILY_BUDGET_CENTS ?? 100); // Default $1.00

      if (budget.cost_cents >= MAX_COST_CENTS) {
        console.warn(`[process] budget exceeded for ${today}: ${budget.cost_cents} cents`);
        await db.update('entries', entryId, { 
          ai_status:      'failed', 
          tagging_status: 'failed',
          ai_metadata:    { ...entry.ai_metadata, error: 'Budget exceeded' }
        });
        return;
      }

      // 3. AI Classification
      const context = [
        entry.content,
        entry.source ? `[Source: ${entry.source}]` : '',
        entry.file_url ? `[Attachment: ${entry.file_url}]` : '',
      ].filter(Boolean).join('\n\n');

      const ai = await classifyWithKimi(context, env.KIMI_API_KEY);

      // Update budget (rough estimate: 1 cent per classification for now)
      await db.insert('daily_budget', { 
        day: today, 
        cost_cents: (budget.cost_cents || 0) + 1 
      }); // upsert handled by Supabase if primary key matches

      // Build and upload JSON artifact to B2
      const artifact = {
        id: entryId,
        type: entry.content_type,
        content: entry.content,
        classification: {
          summary: ai.summary ?? null,
          labels: ai.labels ?? [],
          metadata: {
            content_type:         ai.content_type,
            language:             ai.language,
            sentiment:            ai.sentiment,
            topics:               ai.topics,
            entities:             ai.entities,
            reading_time_seconds: ai.reading_time_seconds,
          }
        },
        timestamp: new Date().toISOString()
      };

      const artifactBytes = new TextEncoder().encode(JSON.stringify(artifact));
      const b2 = makeB2(env);
      const b2Result = await b2.upload(`artifacts/${entryId}.json`, artifactBytes, 'application/json');

      // 4. Update Supabase
      const updated = await db.update('entries', entryId, {
        content:        null, // Clear raw content after archiving
        content_hash:   contentHash,
        artifact_url:   b2Result.publicUrl,
        ai_summary:     ai.summary  ?? null,
        ai_labels:      ai.labels   ?? [],
        last_tagged_at: new Date().toISOString(),
        tagging_status: 'tagged',
        ai_metadata: {
          content_type:         ai.content_type,
          language:             ai.language,
          sentiment:            ai.sentiment,
          topics:               ai.topics,
          entities:             ai.entities,
          reading_time_seconds: ai.reading_time_seconds,
          b2_artifact_file_id:  b2Result.fileId,
        },
        ai_status: 'done',
      });

      // Update KV cache
      if (updated) {
        await kvSet(env.KYMACACHE_KV, updated, Number(env.KV_TTL ?? 3600));
      }

      console.log(`[process] classified entry ${entryId}: labels=${ai.labels?.join(',')}`);
    } catch (err) {
      console.error(`[process] classification failed for ${entryId}:`, err.message);
      await db.update('entries', entryId, { 
        ai_status:      'failed',
        tagging_status: 'failed',
        tagging_attempts: (entry.tagging_attempts || 0) + 1
      });
      await kvDelete(env.KYMACACHE_KV, entryId);
    }
  })();

  // Fire classification in background — don't await in the request handler
  ctx.waitUntil(classifyPromise);

  // Return immediately to the caller (non-blocking)
  return json({
    accepted: true,
    entry_id: entryId,
    message:  'AI classification queued',
  }, 202);
}
