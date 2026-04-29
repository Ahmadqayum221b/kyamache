var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-YA7c98/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// .wrangler/tmp/bundle-YA7c98/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// src/lib/supabase.js
var SupabaseClient = class {
  constructor(url, serviceKey) {
    this.base = url.replace(/\/$/, "");
    this.key = serviceKey;
  }
  _headers(extra = {}, userToken = null) {
    return {
      "apikey": this.key,
      "Authorization": `Bearer ${userToken || this.key}`,
      "Content-Type": "application/json",
      "Prefer": "return=representation",
      ...extra
    };
  }
  /** SELECT with optional query string filters */
  async select(table, params = {}, userToken = null) {
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${this.base}/rest/v1/${table}?${qs}`, {
      headers: this._headers({}, userToken)
    });
    if (!res.ok)
      throw new Error(`Supabase select failed: ${res.status} ${await res.text()}`);
    return res.json();
  }
  /** SELECT single row by id */
  async selectOne(table, id, userToken = null) {
    const rows = await this.select(table, { id: `eq.${id}`, limit: 1 }, userToken);
    return rows[0] ?? null;
  }
  /** INSERT a row, return created row */
  async insert(table, data, userToken = null) {
    const res = await fetch(`${this.base}/rest/v1/${table}`, {
      method: "POST",
      headers: this._headers({}, userToken),
      body: JSON.stringify(data)
    });
    if (!res.ok)
      throw new Error(`Supabase insert failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] : rows;
  }
  /** PATCH (partial update) by id */
  async update(table, id, data, userToken = null) {
    const res = await fetch(`${this.base}/rest/v1/${table}?id=eq.${id}`, {
      method: "PATCH",
      headers: this._headers({}, userToken),
      body: JSON.stringify(data)
    });
    if (!res.ok)
      throw new Error(`Supabase update failed: ${res.status} ${await res.text()}`);
    const rows = await res.json();
    return Array.isArray(rows) ? rows[0] : rows;
  }
  /** DELETE by id */
  async delete(table, id, userToken = null) {
    const res = await fetch(`${this.base}/rest/v1/${table}?id=eq.${id}`, {
      method: "DELETE",
      headers: this._headers({ Prefer: "return=minimal" }, userToken)
    });
    if (!res.ok)
      throw new Error(`Supabase delete failed: ${res.status} ${await res.text()}`);
    return true;
  }
  /** Full-text + label search */
  async search(table, query, labels = [], userToken = null) {
    const params = {
      order: "created_at.desc",
      limit: 50,
      status: "eq.active"
    };
    if (query) {
      params["or"] = `(content.ilike.*${query}*,ai_summary.ilike.*${query}*)`;
    }
    if (labels.length > 0) {
      params["ai_labels"] = `cs.{${labels.join(",")}}`;
    }
    return this.select(table, params, userToken);
  }
};
__name(SupabaseClient, "SupabaseClient");
function makeSupabase(env) {
  return new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
}
__name(makeSupabase, "makeSupabase");

// src/lib/b2.js
var B2_API = "https://api.backblazeb2.com";
var B2Client = class {
  constructor(keyId, appKey, bucketId, bucketName) {
    this.keyId = keyId;
    this.appKey = appKey;
    this.bucketId = bucketId;
    this.bucketName = bucketName;
    this._auth = null;
  }
  /** Authorize account, cache credentials */
  async authorize() {
    if (this._auth && this._auth.expiresAt > Date.now())
      return this._auth;
    const creds = btoa(`${this.keyId}:${this.appKey}`);
    const res = await fetch(`${B2_API}/b2api/v3/b2_authorize_account`, {
      headers: { Authorization: `Basic ${creds}` }
    });
    if (!res.ok)
      throw new Error(`B2 auth failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    this._auth = {
      apiUrl: data.apiInfo.storageApi.apiUrl,
      downloadUrl: data.apiInfo.storageApi.downloadUrl,
      authToken: data.authorizationToken,
      expiresAt: Date.now() + 23 * 60 * 60 * 1e3
      // tokens last ~24h
    };
    return this._auth;
  }
  /** Get upload URL + auth token for a single upload */
  async getUploadUrl() {
    const auth = await this.authorize();
    const res = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_upload_url`, {
      method: "POST",
      headers: {
        Authorization: auth.authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ bucketId: this.bucketId })
    });
    if (!res.ok)
      throw new Error(`B2 get_upload_url failed: ${await res.text()}`);
    return res.json();
  }
  /**
   * Upload a file to B2
   * @param {string}      key       object key / path in bucket
   * @param {ArrayBuffer} buffer    file bytes
   * @param {string}      mimeType  e.g. 'image/jpeg'
   * @returns {{ fileId, fileName, contentLength, publicUrl }}
   */
  async upload(key, buffer, mimeType = "application/octet-stream") {
    const uploadInfo = await this.getUploadUrl();
    const auth = await this.authorize();
    const hashBuffer = await crypto.subtle.digest("SHA-1", buffer);
    const sha1 = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
    const res = await fetch(uploadInfo.uploadUrl, {
      method: "POST",
      headers: {
        Authorization: uploadInfo.authorizationToken,
        "X-Bz-File-Name": encodeURIComponent(key),
        "Content-Type": mimeType,
        "Content-Length": buffer.byteLength,
        "X-Bz-Content-Sha1": sha1
      },
      body: buffer
    });
    if (!res.ok)
      throw new Error(`B2 upload failed: ${await res.text()}`);
    const data = await res.json();
    return {
      fileId: data.fileId,
      fileName: data.fileName,
      publicUrl: `${auth.downloadUrl}/file/${this.bucketName}/${key}`
    };
  }
  /**
   * Generate a time-limited download authorization URL (for private buckets)
   */
  async getDownloadUrl(key, validDurationSeconds = 3600) {
    const auth = await this.authorize();
    const res = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_download_authorization`, {
      method: "POST",
      headers: {
        Authorization: auth.authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        bucketId: this.bucketId,
        fileNamePrefix: key,
        validDurationInSeconds: validDurationSeconds
      })
    });
    if (!res.ok)
      throw new Error(`B2 download_auth failed: ${await res.text()}`);
    const data = await res.json();
    return `${auth.downloadUrl}/file/${this.bucketName}/${key}?Authorization=${data.authorizationToken}`;
  }
  /** Delete a file */
  async deleteFile(fileId, fileName) {
    const auth = await this.authorize();
    const res = await fetch(`${auth.apiUrl}/b2api/v3/b2_delete_file_version`, {
      method: "POST",
      headers: {
        Authorization: auth.authToken,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ fileId, fileName })
    });
    if (!res.ok)
      throw new Error(`B2 delete failed: ${await res.text()}`);
    return true;
  }
};
__name(B2Client, "B2Client");
function makeB2(env) {
  return new B2Client(
    env.B2_KEY_ID,
    env.B2_APP_KEY,
    env.B2_BUCKET_ID,
    env.B2_BUCKET_NAME
  );
}
__name(makeB2, "makeB2");

// src/lib/kv.js
var PREFIX = "entry:";
async function kvSet(kv, entry, ttlSeconds = 3600) {
  await kv.put(`${PREFIX}${entry.id}`, JSON.stringify(entry), {
    expirationTtl: ttlSeconds
  });
}
__name(kvSet, "kvSet");
async function kvDelete(kv, id) {
  await kv.delete(`${PREFIX}${id}`);
}
__name(kvDelete, "kvDelete");

// src/routes/entries.js
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(json, "json");
function extractId(url) {
  const parts = url.pathname.split("/");
  return parts[2] || null;
}
__name(extractId, "extractId");
async function handleEntries(request, env, ctx, url) {
  const db = makeSupabase(env);
  const ttl = Number(env.KV_TTL ?? 3600);
  const id = extractId(url);
  const authHeader = request.headers.get("Authorization");
  const userToken = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  if (request.method === "GET" && id) {
    const entry = await db.selectOne("entries", id, userToken);
    if (!entry)
      return json({ error: "Entry not found" }, 404);
    return json(entry);
  }
  if (request.method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 20);
    const offset = Number(url.searchParams.get("offset") ?? 0);
    let status = url.searchParams.get("status") ?? "active";
    if (!status.includes("."))
      status = `eq.${status}`;
    const params = {
      order: "created_at.desc",
      limit,
      offset,
      status
    };
    for (const [key, val] of url.searchParams.entries()) {
      if (!["limit", "offset", "status"].includes(key)) {
        params[key] = val;
      }
    }
    const entries = await db.select("entries", params, userToken);
    return json(entries);
  }
  if (request.method === "POST") {
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "Invalid JSON body" }, 400);
    }
    const { content, content_type = "text", source, file_url, file_key, family_id, sharing_scope } = body;
    if (!content)
      return json({ error: "`content` is required" }, 400);
    const entry = await db.insert("entries", {
      content,
      content_type,
      source: source ?? null,
      file_url: file_url ?? null,
      file_key: file_key ?? null,
      family_id: family_id ?? null,
      sharing_scope: sharing_scope ?? "family",
      status: "active",
      ai_status: "pending"
    }, userToken);
    ctx.waitUntil(triggerAiClassification(entry.id, env));
    return json(entry, 201);
  }
  if (request.method === "DELETE" && id) {
    await db.update("entries", id, {
      status: "trashed",
      trashed_at: (/* @__PURE__ */ new Date()).toISOString()
    }, userToken);
    return json({ trashed: true, id });
  }
  return json({ error: "Method not allowed" }, 405);
}
__name(handleEntries, "handleEntries");
async function triggerAiClassification(entryId, env) {
  try {
    await fetch(`${env.WORKER_SELF_URL ?? "http://localhost"}/process/${entryId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ trigger: "auto" })
    });
  } catch (e) {
    console.warn("[entries] async AI trigger failed:", e.message);
  }
}
__name(triggerAiClassification, "triggerAiClassification");

// src/routes/search.js
function json2(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(json2, "json");
async function handleSearch(request, env, ctx, url) {
  if (request.method !== "GET") {
    return json2({ error: "Method not allowed" }, 405);
  }
  const q = url.searchParams.get("q")?.trim() ?? "";
  const labels = url.searchParams.get("labels") ? url.searchParams.get("labels").split(",").map((l) => l.trim()).filter(Boolean) : [];
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
  if (!q && labels.length === 0) {
    return json2({ error: "Provide at least one of: q, labels" }, 400);
  }
  const db = makeSupabase(env);
  const authHeader = request.headers.get("Authorization");
  const userToken = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  const results = await db.search("entries", q, labels, userToken);
  return json2({
    query: q,
    labels,
    count: results.length,
    results: results.slice(0, limit)
  });
}
__name(handleSearch, "handleSearch");

// src/routes/file.js
function json3(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(json3, "json");
var ALLOWED_TYPES = /* @__PURE__ */ new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/markdown",
  "application/octet-stream"
]);
async function handleFile(request, env, ctx, url) {
  const parts = url.pathname.split("/").filter(Boolean);
  const b2 = makeB2(env);
  if (request.method === "GET") {
    const key = decodeURIComponent(parts.slice(1, -1).join("/"));
    if (!key)
      return json3({ error: "Missing file key" }, 400);
    const signedUrl = await b2.getDownloadUrl(key, 3600);
    return json3({ signed_url: signedUrl, expires_in: 3600 });
  }
  if (request.method === "POST") {
    const maxBytes = Number(env.MAX_FILE_SIZE ?? 10 * 1024 * 1024);
    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return json3({ error: "Expected multipart/form-data" }, 400);
    }
    const file = formData.get("file");
    if (!file || typeof file === "string") {
      return json3({ error: "Form field `file` is missing or not a file" }, 400);
    }
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > maxBytes) {
      return json3({ error: `File too large. Max ${maxBytes} bytes.` }, 413);
    }
    const mimeType = formData.get("mime_type") ?? file.type ?? "application/octet-stream";
    if (!ALLOWED_TYPES.has(mimeType) && !mimeType.startsWith("image/")) {
      return json3({ error: `Unsupported file type: ${mimeType}` }, 415);
    }
    const now = /* @__PURE__ */ new Date();
    const folder = `uploads/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
    const uid = crypto.randomUUID();
    const name = (file.name ?? "file").replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `${folder}/${uid}/${name}`;
    const result = await b2.upload(key, buffer, mimeType);
    return json3({
      file_url: result.publicUrl,
      file_key: key,
      file_id: result.fileId,
      mime_type: mimeType,
      size: buffer.byteLength
    }, 201);
  }
  return json3({ error: "Method not allowed" }, 405);
}
__name(handleFile, "handleFile");

// src/lib/kimi.js
var KIMI_API = "https://api.moonshot.cn/v1/chat/completions";
var MODEL = "moonshot-v1-8k";
var SYSTEM_PROMPT = `You are a knowledge classification assistant.
Given a piece of content (text, URL, note, or file description), return ONLY valid JSON with:
{
  "summary": "1-2 sentence summary",
  "labels":  ["label1", "label2"],   // 2-5 short tags, lowercase, singular
  "content_type": "text|url|image|document|code|recipe|quote|task|idea",
  "language": "en",
  "sentiment": "neutral|positive|negative",
  "topics": ["topic1"],
  "entities": ["named entities if any"],
  "reading_time_seconds": 30
}
No prose, no markdown fences. Raw JSON only.`;
async function classifyWithKimi(content, apiKey) {
  const truncated = content.slice(0, 8e3);
  const res = await fetch(KIMI_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 512,
      temperature: 0.1,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `Classify this content:

${truncated}` }
      ]
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Kimi API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content ?? "{}";
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    console.error("[kimi] JSON parse failed, raw:", text);
    return {
      summary: text.slice(0, 200),
      labels: [],
      content_type: "text",
      language: "en",
      sentiment: "neutral",
      topics: [],
      entities: [],
      reading_time_seconds: Math.ceil(content.split(/\s+/).length / 200) * 60
    };
  }
}
__name(classifyWithKimi, "classifyWithKimi");

// src/routes/process.js
function json4(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(json4, "json");
async function handleProcess(request, env, ctx, url) {
  if (request.method !== "POST") {
    return json4({ error: "Method not allowed" }, 405);
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const entryId = parts[1];
  if (!entryId)
    return json4({ error: "Missing entry id" }, 400);
  const db = makeSupabase(env);
  const entry = await db.selectOne("entries", entryId);
  if (!entry)
    return json4({ error: "Entry not found" }, 404);
  await db.update("entries", entryId, {
    ai_status: "processing",
    tagging_status: "tagging"
  });
  const classifyPromise = (async () => {
    try {
      let contentHash = null;
      if (entry.content) {
        const msgUint8 = new TextEncoder().encode(entry.content);
        const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
        contentHash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
      } else if (entry.file_url) {
      }
      const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
      const budget = await db.selectOne("daily_budget", today) || { tokens_spent: 0, cost_cents: 0 };
      const MAX_COST_CENTS = Number(env.DAILY_BUDGET_CENTS ?? 100);
      if (budget.cost_cents >= MAX_COST_CENTS) {
        console.warn(`[process] budget exceeded for ${today}: ${budget.cost_cents} cents`);
        await db.update("entries", entryId, {
          ai_status: "failed",
          tagging_status: "failed",
          ai_metadata: { ...entry.ai_metadata, error: "Budget exceeded" }
        });
        return;
      }
      const context = [
        entry.content,
        entry.source ? `[Source: ${entry.source}]` : "",
        entry.file_url ? `[Attachment: ${entry.file_url}]` : ""
      ].filter(Boolean).join("\n\n");
      const ai = await classifyWithKimi(context, env.KIMI_API_KEY);
      await db.insert("daily_budget", {
        day: today,
        cost_cents: (budget.cost_cents || 0) + 1
      });
      const artifact = {
        id: entryId,
        type: entry.content_type,
        content: entry.content,
        classification: {
          summary: ai.summary ?? null,
          labels: ai.labels ?? [],
          metadata: {
            content_type: ai.content_type,
            language: ai.language,
            sentiment: ai.sentiment,
            topics: ai.topics,
            entities: ai.entities,
            reading_time_seconds: ai.reading_time_seconds
          }
        },
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      };
      const artifactBytes = new TextEncoder().encode(JSON.stringify(artifact));
      const b2 = makeB2(env);
      const b2Result = await b2.upload(`artifacts/${entryId}.json`, artifactBytes, "application/json");
      const updated = await db.update("entries", entryId, {
        content: null,
        // Clear raw content after archiving
        content_hash: contentHash,
        artifact_url: b2Result.publicUrl,
        ai_summary: ai.summary ?? null,
        ai_labels: ai.labels ?? [],
        last_tagged_at: (/* @__PURE__ */ new Date()).toISOString(),
        tagging_status: "tagged",
        ai_metadata: {
          content_type: ai.content_type,
          language: ai.language,
          sentiment: ai.sentiment,
          topics: ai.topics,
          entities: ai.entities,
          reading_time_seconds: ai.reading_time_seconds,
          b2_artifact_file_id: b2Result.fileId
        },
        ai_status: "done"
      });
      if (updated) {
        await kvSet(env.KYMACACHE_KV, updated, Number(env.KV_TTL ?? 3600));
      }
      console.log(`[process] classified entry ${entryId}: labels=${ai.labels?.join(",")}`);
    } catch (err) {
      console.error(`[process] classification failed for ${entryId}:`, err.message);
      await db.update("entries", entryId, {
        ai_status: "failed",
        tagging_status: "failed",
        tagging_attempts: (entry.tagging_attempts || 0) + 1
      });
      await kvDelete(env.KYMACACHE_KV, entryId);
    }
  })();
  ctx.waitUntil(classifyPromise);
  return json4({
    accepted: true,
    entry_id: entryId,
    message: "AI classification queued"
  }, 202);
}
__name(handleProcess, "handleProcess");

// src/routes/broker.js
function json5(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(json5, "json");
async function handleBroker(request, env, ctx, url) {
  const b2 = makeB2(env);
  const db = makeSupabase(env);
  const path = url.pathname;
  if (path === "/upload-init" && request.method === "POST") {
    const { filename, size, mime } = await request.json();
    if (!filename || !size || !mime)
      return json5({ error: "Missing required fields" }, 400);
    const now = /* @__PURE__ */ new Date();
    const folder = `uploads/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
    const uid = crypto.randomUUID();
    const name = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
    const key = `${folder}/${uid}/${name}`;
    try {
      const uploadUrlResult = await b2.getUploadUrl();
      return json5({
        upload_url: uploadUrlResult.uploadUrl,
        upload_auth_token: uploadUrlResult.authorizationToken,
        file_key: key
      });
    } catch (err) {
      return json5({ error: "Failed to generate upload URL", detail: err.message }, 500);
    }
  }
  if (path === "/upload-complete" && request.method === "POST") {
    const { file_key, file_id, filename, size, mime } = await request.json();
    const entry = await db.insert("entries", {
      content: filename,
      content_type: mime.startsWith("image/") ? "image" : "file",
      file_url: `${env.B2_PUBLIC_URL}/${file_key}`,
      file_key,
      ai_metadata: { b2_file_id: file_id, size, direct_upload: true },
      ai_status: "pending",
      status: "active"
    });
    ctx.waitUntil(fetch(`${env.WORKER_SELF_URL || "http://localhost"}/process/${entry.id}`, {
      method: "POST",
      body: JSON.stringify({ trigger: "broker" })
    }));
    return json5(entry, 201);
  }
  return json5({ error: "Not found" }, 404);
}
__name(handleBroker, "handleBroker");

// src/routes/family.js
function json6(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
__name(json6, "json");
async function handleFamily(request, env, ctx, url) {
  const db = makeSupabase(env);
  const authHeader = request.headers.get("Authorization");
  const userToken = authHeader?.startsWith("Bearer ") ? authHeader.split(" ")[1] : null;
  if (!userToken)
    return json6({ error: "Unauthorized" }, 401);
  if (request.method === "GET" && url.pathname === "/family/members") {
    const members = await db.select("family_members", {
      order: "created_at.asc"
    }, userToken);
    return json6(members);
  }
  if (request.method === "POST" && url.pathname === "/family/invite") {
    const { email, role = "member" } = await request.json();
    if (!email)
      return json6({ error: "Email required" }, 400);
    const userMemberships = await db.select("family_members", { limit: 1 }, userToken);
    if (!userMemberships.length)
      return json6({ error: "User has no family" }, 403);
    const family_id = userMemberships[0].family_id;
    const invitation = await db.insert("invitations", {
      family_id,
      email,
      role,
      token: crypto.randomUUID(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1e3).toISOString()
    }, userToken);
    return json6({ invited: true, invitation });
  }
  return json6({ error: "Not found" }, 404);
}
__name(handleFamily, "handleFamily");

// src/cron/tagging.js
async function handleScheduled(event, env, ctx) {
  const db = makeSupabase(env);
  const entries = await db.select("entries", {
    or: "(tagging_status.eq.pending,tagging_status.eq.failed)",
    tagging_attempts: "lt.5",
    limit: 10
    // Process in small batches per cron run
  });
  if (entries.length === 0) {
    console.log("[tagging] No entries needing tagging.");
    return;
  }
  console.log(`[tagging] Found ${entries.length} entries to process.`);
  for (const entry of entries) {
    const processUrl = `${env.WORKER_SELF_URL || "http://localhost"}/process/${entry.id}`;
    ctx.waitUntil((async () => {
      try {
        const res = await fetch(processUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ trigger: "cron" })
        });
        if (!res.ok)
          console.warn(`[tagging] Failed to trigger process for ${entry.id}: ${res.status}`);
      } catch (err) {
        console.error(`[tagging] Error triggering process for ${entry.id}:`, err.message);
      }
    })());
  }
}
__name(handleScheduled, "handleScheduled");

// src/index.js
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-User-Id",
  "Access-Control-Max-Age": "86400"
};
function json7(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}
__name(json7, "json");
function notFound() {
  return json7({ error: "Not found" }, 404);
}
__name(notFound, "notFound");
var src_default = {
  /** HTTP Request Handler */
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "") || "/";
    try {
      if (path === "/entries" || path.startsWith("/entries/")) {
        return await handleEntries(request, env, ctx, url);
      }
      if (path === "/search") {
        return await handleSearch(request, env, ctx, url);
      }
      if (path === "/file" || path.startsWith("/file/")) {
        return await handleFile(request, env, ctx, url);
      }
      if (path === "/process" || path.startsWith("/process/")) {
        return await handleProcess(request, env, ctx, url);
      }
      if (path === "/upload-init" || path === "/upload-complete") {
        return await handleBroker(request, env, ctx, url);
      }
      if (path === "/family" || path.startsWith("/family/")) {
        return await handleFamily(request, env, ctx, url);
      }
      if (path === "/health") {
        return json7({ status: "ok", ts: Date.now(), supabase_url_set: !!env.SUPABASE_URL });
      }
      return notFound();
    } catch (err) {
      console.error("[worker] unhandled error:", err);
      return json7({ error: "Internal server error", detail: err.message }, 500);
    }
  },
  /** Cron Trigger Handler */
  async scheduled(event, env, ctx) {
    await handleScheduled(event, env, ctx);
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-YA7c98/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-YA7c98/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
