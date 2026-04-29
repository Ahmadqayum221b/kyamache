/**
 * Thin Supabase REST client (no SDK — pure fetch for Worker compatibility)
 */
export class SupabaseClient {
  constructor(url, serviceKey) {
    this.base = url.replace(/\/$/, '');
    this.key  = serviceKey;
  }

  _headers(extra = {}) {
    return {
      'apikey':        this.key,
      'Authorization': `Bearer ${this.key}`,  // Always service role — Worker handles auth
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
      ...extra,
    };
  }

  /** SELECT with optional query string filters */
  async select(table, params = {}) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${this.base}/rest/v1/${table}?${qs}`, {
      headers: this._headers(),
    });
    if (!res.ok) throw new Error(`Supabase select failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

  /** SELECT single row by id */
  async selectOne(table, id) {
    const rows = await this.select(table, { id: `eq.${id}`, limit: 1 });
    return rows[0] ?? null;
  }

  /** INSERT a row, return created row */
  async insert(table, data) {
    const res = await fetch(`${this.base}/rest/v1/${table}`, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase insert failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] : rows;
  }

  /** PATCH (partial update) by id */
  async update(table, id, data) {
    const res = await fetch(`${this.base}/rest/v1/${table}?id=eq.${id}`, {
      method: 'PATCH',
      headers: this._headers(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase update failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] : rows;
  }

  /** DELETE by id */
  async delete(table, id) {
    const res = await fetch(`${this.base}/rest/v1/${table}?id=eq.${id}`, {
      method: 'DELETE',
      headers: this._headers({ Prefer: 'return=minimal' }),
    });
    if (!res.ok) throw new Error(`Supabase delete failed: ${res.status} ${await res.text()}`);
    return true;
  }

  /** Full-text + label search */
  async search(table, query, labels = []) {
    const params = { 
      order: 'created_at.desc', 
      limit: 50,
      status: 'eq.active'
    };

    if (query) {
      params['or'] = `(content.ilike.*${query}*,ai_summary.ilike.*${query}*)`;
    }
    if (labels.length > 0) {
      params['ai_labels'] = `cs.{${labels.join(',')}}`;
    }

    return this.select(table, params);
  }
}

export function makeSupabase(env) {
  return new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}
