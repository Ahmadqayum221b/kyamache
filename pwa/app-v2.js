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
         <button class="card-btn star-btn ${entry.is_starred ? 'active' : ''}" onclick="toggleStar('${entry.id}', ${!entry.is_starred})">★</button>
         <button class="card-btn" onclick="openEditModal('${entry.id}')">Edit</button>
         <button class="card-btn" onclick="copyShareLink('${entry.id}')">Share</button>
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
      selectedEntries.clear();
      updateBulkUI();
      loadFeed(true);
    } catch (err) { toast('Bulk action failed', 'error'); }
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
window.copyShareLink = copyShareLink;
window.openNewCollectionModal = openNewCollectionModal;
