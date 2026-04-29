/**
 * Kymacache Service Worker
 * - Caches app shell for offline
 * - Handles share-target POST
 * - Background sync for offline captures
 */

const CACHE_NAME  = 'kymacache-v2';
const SHELL_FILES = ['/', '/index.html', '/app-v2.js', '/styles.css', '/manifest.json'];

// ── Install: cache app shell ─────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ───────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for API, cache-first for shell ──────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // API calls: network only, no caching
  if (url.pathname.startsWith('/api/') || url.hostname !== self.location.hostname) {
    return; // let the browser handle it
  }

  // Share target POST — intercept and forward to main page
  if (url.pathname === '/share-target' && event.request.method === 'POST') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }

  // App shell: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => {
      return cached ?? fetch(event.request).then(response => {
        if (response.ok) {
          caches.open(CACHE_NAME).then(c => c.put(event.request, response.clone()));
        }
        return response;
      });
    }).catch(() => caches.match('/index.html'))
  );
});

// ── Background Sync ───────────────────────────────────────────────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-pending-captures') {
    event.waitUntil(syncPendingCaptures());
  }
});

async function syncPendingCaptures() {
  // Read pending captures from IndexedDB (written by app.js when offline)
  const db      = await openIDB();
  const pending = await getAllPending(db);

  const API = self.registration.scope.replace(/\/$/, '') + '/api';

  for (const item of pending) {
    try {
      const res = await fetch(`${API}/entries`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(item.payload),
      });
      if (res.ok) {
        await deletePending(db, item.id);
      }
    } catch {
      break; // still offline, stop trying
    }
  }
}

// ── Share Target ──────────────────────────────────────────────────────────────
async function handleShareTarget(request) {
  const formData = await request.formData();
  const title    = formData.get('title') ?? '';
  const text     = formData.get('text')  ?? '';
  const url      = formData.get('url')   ?? '';
  const file     = formData.get('file');

  // Store shared data in IDB so the main page can pick it up
  const db = await openIDB();
  await addPending(db, {
    content:      [title, text, url].filter(Boolean).join('\n'),
    content_type: url ? 'url' : file ? 'file' : 'text',
    source:       'share-target',
    _file:        file ? { name: file.name, type: file.type, size: file.size } : null,
  });

  // Redirect to home — the app will pick up pending item on load
  return Response.redirect('/?shared=1', 303);
}

// ── IndexedDB helpers ─────────────────────────────────────────────────────────
function openIDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kymacache', 1);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('pending')) {
        db.createObjectStore('pending', { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = () => reject(req.error);
  });
}

function addPending(db, payload) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('pending', 'readwrite');
    const req = tx.objectStore('pending').add({ payload });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function getAllPending(db) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('pending', 'readonly');
    const req = tx.objectStore('pending').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

function deletePending(db, id) {
  return new Promise((resolve, reject) => {
    const tx  = db.transaction('pending', 'readwrite');
    const req = tx.objectStore('pending').delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  });
}
