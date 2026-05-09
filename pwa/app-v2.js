/**
 * Kymacache PWA — app.js
 * Vanilla JS, ES modules, no build step required
 */

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'http://localhost:8787'
  : 'https://kymacache-worker.asghar78ali91.workers.dev';
const SUPABASE_URL = 'https://lnbpgnilxaaodowbetgg.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxuYnBnbmlseGFhb2Rvd2JldGdnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcyMzY0MDMsImV4cCI6MjA5MjgxMjQwM30.poQH_5Rol_dcdKVLKUa6d__YpZhQ4V4KtNmu6vGFfh8';

let supabase = null;

// ── State ─────────────────────────────────────────────────────────────────────
let user = null;
let currentTab = 'text';
let currentFilter = { status: 'active', type: null, label: null, collection: null };
let currentView = 'list';   // 'list' | 'grid'
let feedOffset = 0;
let isFeedLoading = false;
let searchDebounceId = null;
let allLabels = new Set();
let collections = [];
let selectedEntries = new Set();
let currentEditingEntry = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[init] App loading...');
  
  let retries = 0;
  while (!window.supabase && retries < 50) {
    await new Promise(r => setTimeout(r, 100));
    retries++;
  }

  if (window.supabase) {
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  }

  initAuth();
  bindSidebar();
  bindSearch();
  bindCapture();
  bindViewToggle();
  bindLoadMore();
  bindEditModal();
  bindBulkActions();
  registerServiceWorker();
});

// ── Auth ──────────────────────────────────────────────────────────────────────
async function initAuth() {
  if (!supabase) return;
  const { data: { session } } = await supabase.auth.getSession();
  updateUser(session?.user);
  supabase.auth.onAuthStateChange((_event, session) => updateUser(session?.user));

  $('auth-form').addEventListener('submit', handleAuthSubmit);
  
  $('auth-toggle-link').addEventListener('click', e => {
    e.preventDefault();
    const title = $('auth-title');
    const submit = $('auth-submit');
    const toggle = $('auth-toggle-link');
    if (submit.textContent === 'Sign In') {
      title.textContent = 'Create account';
      submit.textContent = 'Sign Up';
      toggle.textContent = 'Sign In';
    } else {
      title.textContent = 'Welcome back';
      submit.textContent = 'Sign In';
      toggle.textContent = 'Sign Up';
    }
  });

  $('google-auth-btn').addEventListener('click', () => {
    supabase.auth.signInWithOAuth({ provider: 'google' });
  });

  $('user-profile').addEventListener('click', async () => { if (confirm('Sign out?')) await supabase.auth.signOut(); });
}

function updateUser(newUser) {
  user = newUser;
  if (!user) {
    $('auth-overlay').classList.remove('hidden');
  } else {
    console.log('[auth] Logged in as:', user.id, user.email);
    $('auth-overlay').classList.add('hidden');
    $('user-avatar').textContent = user.email[0].toUpperCase();
    loadFeed(true);
    loadCollections();
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = $('auth-email').value;
  const password = $('auth-password').value;
  const isSignUp = $('auth-submit').textContent === 'Sign Up';

  try {
    const { error, data } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    if (error) throw error;
    if (isSignUp) toast('Check your email for confirmation!', 'success');
  } catch (err) { 
    toast(err.message, 'error'); 
  }
}

// ── Sidebar & Collections ──────────────────────────────────────────────────────
function bindSidebar() {
  $$('.nav-item[data-filter], .nav-item[data-type]').forEach(item => {
    item.addEventListener('click', () => {
      $$('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
      const filter = item.dataset.filter;
      const type = item.dataset.type;

      currentFilter = { status: filter || 'active', type: type || null, label: null, collection: null };
      if (item.id === 'trash-nav-item') currentFilter.status = 'trashed';
      
      $('feed-title').textContent = item.querySelector('span').textContent;
      loadFeed(true);
      showView('feed-view');
    });
  });

  $('new-collection-btn').onclick = openNewCollectionModal;
  $('family-admin-btn').onclick = () => showView('family-admin-view');
  $('compose-btn').onclick = () => $('capture-overlay').classList.remove('hidden');
}

async function loadCollections() {
  try {
    collections = await apiFetch('/collections');
    renderCollectionNav();
  } catch (err) { console.error('Failed to load collections', err); }
}

function renderCollectionNav() {
  const list = $('collections-list');
  list.innerHTML = '';
  collections.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'nav-item';
    btn.innerHTML = `<span class="col-dot" style="background:${c.color}"></span><span>${escHtml(c.name)}</span>`;
    btn.onclick = () => {
      $$('.nav-item').forEach(i => i.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = { status: 'active', type: null, label: null, collection: c.id };
      $('feed-title').textContent = c.name;
      loadFeed(true);
    };
    list.appendChild(btn);
  });
}

function openNewCollectionModal() {
  const name = prompt('Collection Name:');
  if (!name) return;
  apiPost('/collections', { name }).then(() => loadCollections());
}

function showView(id) {
  $$('.feed-container').forEach(c => c.classList.add('hidden'));
  $(id).classList.remove('hidden');
}

// ── Feed & Cards ──────────────────────────────────────────────────────────────
async function loadFeed(reset = false) {
  if (isFeedLoading || !user) return;
  isFeedLoading = true;
  if (reset) { feedOffset = 0; $('entries-list').innerHTML = '<div class="loading">Loading…</div>'; }

  try {
    let path = `/entries?limit=20&offset=${feedOffset}&status=eq.${currentFilter.status}`;
    if (currentFilter.status === 'starred') path = `/entries?limit=20&offset=${feedOffset}&status=eq.active&is_starred=eq.true`;
    if (currentFilter.type) path += `&content_type=eq.${currentFilter.type}`;
    if (currentFilter.label) path += `&ai_labels=cs.{${currentFilter.label}}`;
    if (currentFilter.collection) path += `&collection_id=eq.${currentFilter.collection}`;
    if (currentFilter.status === 'active' && !currentFilter.collection && !currentFilter.label) path += `&order=is_pinned.desc,created_at.desc`;

    const data = await apiFetch(path);
    if (reset) $('entries-list').innerHTML = '';
    if (data.length === 0 && reset) {
      $('entries-list').innerHTML = '<div class="empty-state">No entries found.</div>';
    } else {
      data.forEach(entry => appendEntryCard(entry));
      feedOffset += data.length;
      $('load-more').classList.toggle('hidden', data.length < 20);
    }
  } catch (err) { toast('Error loading feed', 'error'); }
  finally { isFeedLoading = false; }
}

function appendEntryCard(entry) {
  const card = document.createElement('div');
  card.className = `entry-card ${entry.is_pinned ? 'pinned' : ''}`;
  card.dataset.id = entry.id;

  const labels = (entry.ai_labels || []).map(l => `<span class="entry-label">${escHtml(l)}</span>`).join('');
  
  card.innerHTML = `
    <div class="card-select-overlay"><input type="checkbox" class="entry-select"></div>
    <div class="card-header">
       ${entry.is_pinned ? '<span class="pin-badge">Pinned</span>' : ''}
       <div class="card-actions">
         <button class="card-btn star-btn ${entry.is_starred ? 'active' : ''}" onclick="toggleStar('${entry.id}', ${!entry.is_starred})" title="Star">
           <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
         </button>
         <button class="card-btn" onclick="openEditModal('${entry.id}')" title="Edit">
           <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
         </button>
         <button class="card-btn" onclick="copyShareLink('${entry.id}')" title="Share">
           <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
         </button>
         <button class="card-btn danger-hover" onclick="deleteEntry('${entry.id}')" title="Move to Trash">
           <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
         </button>
       </div>
    </div>
    <div class="entry-content">${escHtml(entry.content || entry.ai_summary || '[No content]')}</div>
    <div class="entry-footer">
      <div class="entry-labels">${labels}</div>
      <div class="entry-time">${formatRelative(entry.created_at)}</div>
    </div>
  `;

  // Selection logic for bulk actions
  const checkbox = card.querySelector('.entry-select');
  checkbox.onclick = (e) => {
    e.stopPropagation();
    if (checkbox.checked) selectedEntries.add(entry.id);
    else selectedEntries.delete(entry.id);
    updateBulkUI();
  };

  $('entries-list').appendChild(card);
}

// ── Features: Edit, Pin, Star ─────────────────────────────────────────────────
async function toggleStar(id, state) {
  try {
    await apiFetch(`/entries/${id}`, { method: 'PATCH', body: JSON.stringify({ is_starred: state }) });
    loadFeed(true);
  } catch (err) { toast('Failed to star', 'error'); }
}

async function deleteEntry(id) {
  if (!confirm('Move this entry to trash?')) return;
  try {
    await apiFetch(`/entries/${id}`, { method: 'DELETE' });
    toast('Entry moved to trash', 'success');
    loadFeed(true);
  } catch (err) { toast('Delete failed', 'error'); }
}

function bindEditModal() {
  $('save-edit-btn').onclick = async () => {
    const id = currentEditingEntry.id;
    const body = {
      content: $('edit-text').value,
      is_pinned: $('edit-pinned').checked,
      is_public: $('edit-public').checked
    };
    try {
      await apiFetch(`/entries/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
      $('edit-modal').classList.add('hidden');
      toast('Updated!', 'success');
      loadFeed(true);
    } catch (err) { toast('Update failed', 'error'); }
  };
}

async function openEditModal(id) {
  currentEditingEntry = await apiFetch(`/entries/${id}`);
  $('edit-text').value = currentEditingEntry.content || '';
  $('edit-pinned').checked = currentEditingEntry.is_pinned;
  $('edit-public').checked = currentEditingEntry.is_public;
  $('edit-modal').classList.remove('hidden');
}

function copyShareLink(id) {
  const link = `${location.origin}/entries/${id}`; // Worker handles public access
  navigator.clipboard.writeText(link).then(() => toast('Link copied!', 'success'));
}

// ── Features: Bulk Actions ────────────────────────────────────────────────────
function bindBulkActions() {
  $('bulk-delete').onclick = async () => {
    if (!confirm(`Delete ${selectedEntries.size} items?`)) return;
    try {
      await apiPost('/entries/bulk', { ids: Array.from(selectedEntries), updates: { status: 'trashed' } });
      toast('Entries moved to trash', 'success');
      selectedEntries.clear();
      updateBulkUI();
      loadFeed(true);
    } catch (err) {
      console.warn('Bulk delete failed, falling back to individual:', err);
      let failed = 0;
      for (const id of selectedEntries) {
        try {
          await apiFetch(`/entries/${id}`, { method: 'DELETE' });
        } catch (e) { failed++; console.error('Failed to delete', id, e); }
      }
      if (failed < selectedEntries.size) {
        toast(`Action completed${failed ? ` (${failed} failed)` : ''}`, failed ? 'warning' : 'success');
        selectedEntries.clear();
        updateBulkUI();
        loadFeed(true);
      } else {
        toast('Bulk action failed', 'error');
      }
    }
  };
  $('bulk-cancel').onclick = () => {
    selectedEntries.clear();
    $$('.entry-select').forEach(c => c.checked = false);
    updateBulkUI();
  };
}

function updateBulkUI() {
  const show = selectedEntries.size > 0;
  $('bulk-toolbar').classList.toggle('hidden', !show);
  $('selected-count').textContent = `${selectedEntries.size} selected`;
}

// ── Capture ───────────────────────────────────────────────────────────────────
function bindCapture() {
  $('capture-close').onclick = () => $('capture-overlay').classList.add('hidden');
  $('capture-btn').onclick = handleCapture;
  // (Simplified tab logic here or keep existing)
}

async function handleCapture() {
  const content = $('text-input').value.trim();
  if (!content) return;
  try {
    await apiPost('/entries', { content, content_type: 'text' });
    $('capture-overlay').classList.add('hidden');
    $('text-input').value = '';
    loadFeed(true);
  } catch (err) { toast('Save failed', 'error'); }
}

// ── API Helpers ────────────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const session = await supabase?.auth.getSession();
  const token = session?.data?.session?.access_token;
  if (!token) console.warn('[api] No auth token found for', path);
  
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });
  if (!res.ok) throw new Error('API failed');
  return res.json();
}

async function apiPost(path, data) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(data) });
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('toast-container').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

function escHtml(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatRelative(iso) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return m + 'm';
  if (m < 1440) return Math.floor(m / 60) + 'h';
  return Math.floor(m / 1440) + 'd';
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');
}

window.$ = $; // for inline onclicks
window.openEditModal = openEditModal;
window.toggleStar = toggleStar;
window.deleteEntry = deleteEntry;
window.copyShareLink = copyShareLink;
window.openNewCollectionModal = openNewCollectionModal;

// ── Search ────────────────────────────────────────────────────────────────────
function bindSearch() {
  const input = $('search-input');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(searchDebounceId);
    const q = input.value.trim();
    if (!q) { $('search-results').classList.add('hidden'); return; }
    searchDebounceId = setTimeout(async () => {
      try {
        const data = await apiFetch(`/search?q=${encodeURIComponent(q)}&limit=5`);
        renderSearchResults(data.results || []);
      } catch { renderSearchResults([]); }
    }, 300);
  });
}

function renderSearchResults(results) {
  const el = $('search-results');
  el.innerHTML = '';
  el.classList.toggle('hidden', results.length === 0);
  results.forEach(entry => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.style = 'padding:10px; border-bottom:1px solid var(--border); cursor:pointer; font-size:13px;';
    item.innerHTML = `<div class="sr-content">${escHtml(entry.content || entry.ai_summary)}</div>`;
    item.onclick = () => {
      el.classList.add('hidden');
      openEditModal(entry.id);
    };
    el.appendChild(item);
  });
}

function bindViewToggle() {
  const btn = $('view-toggle');
  if (!btn) return;
  btn.onclick = () => {
    currentView = currentView === 'list' ? 'grid' : 'list';
    $('entries-list').className = `entries-list ${currentView}-view`;
    btn.innerHTML = currentView === 'list' 
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>';
  };
}

function bindLoadMore() {
  const btn = $('load-more');
  if (!btn) return;
  btn.onclick = () => loadFeed();
}
