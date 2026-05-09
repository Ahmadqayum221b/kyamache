/**
 * Thin Supabase REST client (no SDK — pure fetch for Worker compatibility)
 */
export class SupabaseClient {
  constructor(url, serviceKey) {
    this.base = url.replace(/\/$/, '');
    this.key  = serviceKey;
  }

  _headers(extra = {}, userToken = null) {
    // FIX: apikey is always the service key (identifies the project).
    // Authorization uses the user token (for RLS) or falls back to service key.
    const auth = userToken ? `Bearer ${userToken}` : `Bearer ${this.key}`;
    const apikey = this.key; 

    return {
      'apikey':        apikey,
      'Authorization': auth,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...extra,
    };
  }

  /** SELECT with optional query string filters */
  async select(table, params = {}, userToken = null, userId = null) {
    const q = new URLSearchParams();
    if (userId) q.append('user_id', `eq.${userId}`);
    
    Object.entries(params).forEach(([k, v]) => {
      q.append(k, v);
    });
    
    const qs = q.toString();
    const finalUrl = `${this.base}/rest/v1/${table}?${qs}`;
    console.log(`[supabase] GET ${finalUrl}`);
    const res = await fetch(finalUrl, {
      headers: this._headers({}, userToken),
    });
    if (!res.ok) throw new Error(`Supabase select failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    console.log(`[supabase] Returned ${data.length} rows`);
    return data;
  }

  /** SELECT single row by id */
  async selectOne(table, id, userToken = null) {
    const rows = await this.select(table, { id: `eq.${id}`, limit: 1 }, userToken);
    return rows[0] ?? null;
  }

  /** INSERT a row, return created row */
  async insert(table, data, userToken = null) {
    const res = await fetch(`${this.base}/rest/v1/${table}`, {
      method: 'POST',
      headers: this._headers({}, userToken),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase insert failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] : rows;
  }

  /** UPSERT a row (using on_conflict or resolution=merge-duplicates) */
  async upsert(table, data, userToken = null) {
    const res = await fetch(`${this.base}/rest/v1/${table}`, {
      method: 'POST',
      headers: this._headers({ 
        'Prefer': 'return=representation,resolution=merge-duplicates' 
      }, userToken),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase upsert failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] : rows;
  }

  /** PATCH (partial update) by id */
  async update(table, id, data, userToken = null) {
    return this.patch(table, `id=eq.${id}`, data, userToken);
  }

  /** NEW: Flexible PATCH with raw filter string */
  async patch(table, filter, data, userToken = null) {
    const res = await fetch(`${this.base}/rest/v1/${table}?${filter}`, {
      method: 'PATCH',
      headers: this._headers({}, userToken),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase patch failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] : rows;
  }

  /** DELETE by id */
  async delete(table, id, userToken = null) {
    const res = await fetch(`${this.base}/rest/v1/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: this._headers({ Prefer: 'return=minimal' }, userToken),
    });
    if (!res.ok) throw new Error(`Supabase delete failed: ${res.status} ${await res.text()}`);
    return true;
  }

  /** NEW: Atomic budget increment via RPC (Fixes race condition) */
  async rpcIncrement(day, userToken = null) {
    const res = await fetch(`${this.base}/rest/v1/rpc/increment_daily_budget`, {
      method: 'POST',
      headers: this._headers({ 'Prefer': '' }, userToken),
      body: JSON.stringify({ p_day: day }),
    });
    if (!res.ok) throw new Error(`Supabase rpcIncrement failed: ${res.status} ${await res.text()}`);
    return true; // RPC returns void/json depending on def, we just need OK
  }

  /** UPDATED: Secure full-text + label search (Fixes injection) */
  async search(table, query, labels = [], userToken = null, userId = null) {
    const params = new URLSearchParams({
      order: 'created_at.desc',
      limit: '50',
      status: 'eq.active'
    });

    if (userId) params.append('user_id', `eq.${userId}`);

    if (query) {
      // Security fix: Sanitize query for PostgREST operators
      const safeQuery = query.replace(/[()[\],.]/g, ' ').trim();
      // Native PostgREST FTS using the generated tsvector (configured in schema)
      // Usually used as: ?column=fts(language).query
      // In our schema, we have a GIN index on to_tsvector('english', ...)
      // We can use the 'fts' operator if we define a generated column or use a raw expression.
      // For simplicity in this thin client, we'll use 'content' for fts if applicable.
      // Actually, PostgREST supports: ?col=fts.query
      params.append('content', `fts.${safeQuery}`);
    }

    if (labels && labels.length > 0) {
      // Security fix: Only allow alphanumeric labels
      const safeLabels = labels
        .map(l => l.replace(/[^a-zA-Z0-9_-]/g, ''))
        .filter(Boolean);
      
      if (safeLabels.length > 0) {
        params.append('ai_labels', `cs.{${safeLabels.join(',')}}`);
      }
    }

    const res = await fetch(`${this.base}/rest/v1/${table}?${params.toString()}`, {
      headers: this._headers({}, userToken),
    });
    if (!res.ok) throw new Error(`Supabase search failed: ${res.status} ${await res.text()}`);
    return res.json();
  }
}

/** NEW: Factory to instantiate from Worker env */
export function makeSupabase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment');
  }
  return new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}
