/**
 * Kymacache PWA — app.js
 * Vanilla JS, ES modules, no build step required
 */

// ── Config ────────────────────────────────────────────────────────────────────
const API_BASE = location.hostname === 'localhost' || location.hostname === '127.0.0.1'
  ? 'http://localhost:8787'
  : 'https://kymacache-worker.ahmad-kymacache.workers.dev';
const SUPABASE_URL = 'https://yinziopqhxzyaagvuefi.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inlpbnppb3BxaHh6eWFhZ3Z1ZWZpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc0NzA4NzksImV4cCI6MjA5MzA0Njg3OX0.OMuj7yz8xaJ8-Yf5KcqJhHWcyJheG5-G3S55UPzAYhA';

let supabase = null;

// ── State ─────────────────────────────────────────────────────────────────────
let user = null;
let currentTab = 'text';
let currentFilter = { status: 'active', type: null, label: null };
let currentView = 'list';   // 'list' | 'grid'
let feedOffset = 0;
let isFeedLoading = false;
let searchDebounceId = null;
let allLabels = new Set();

// ── DOM refs ──────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// ── Init ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  console.log('[init] App loading...');
  
  // Wait up to 5s for Supabase CDN script
  let retries = 0;
  while (!window.supabase && retries < 50) {
    await new Promise(r => setTimeout(r, 100));
    retries++;
  }

  if (window.supabase) {
    console.log('[init] Supabase script found.');
    supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  } else {
    console.error('[init] Supabase script NOT found after 5s.');
    alert('Critical: Supabase library failed to load. Check your internet or ad-blocker.');
  }

  initAuth();
  bindSidebar();
  bindSearch();
  bindCapture();
  bindViewToggle();
  bindLoadMore();
  registerServiceWorker();

  // Initial load happens after auth check
});

// ── Auth ──────────────────────────────────────────────────────────────────────
async function initAuth() {
  if (!supabase) return;

  const { data: { session } } = await supabase.auth.getSession();
  updateUser(session?.user);

  supabase.auth.onAuthStateChange((_event, session) => {
    updateUser(session?.user);
  });

  $('auth-form').addEventListener('submit', handleAuthSubmit);
  $('auth-toggle-link').addEventListener('click', e => {
    e.preventDefault();
    console.log('[auth] Toggle clicked');
    const title = $('auth-title');
    const submit = $('auth-submit');
    if (submit.textContent === 'Sign In') {
      title.textContent = 'Create account';
      submit.textContent = 'Sign Up';
      $('auth-toggle-link').textContent = 'Sign In';
    } else {
      title.textContent = 'Welcome back';
      submit.textContent = 'Sign In';
      $('auth-toggle-link').textContent = 'Sign Up';
    }
  });

  $('google-auth-btn').addEventListener('click', () => {
    console.log('[auth] Google clicked');
    supabase.auth.signInWithOAuth({ provider: 'google' });
  });

  $('user-profile').addEventListener('click', async () => {
    if (confirm('Sign out?')) await supabase.auth.signOut();
  });
}

function updateUser(newUser) {
  user = newUser;
  if (!user) {
    $('auth-overlay').classList.remove('hidden');
    // $('app').classList.add('blurred'); // Disabled for visibility
  } else {
    $('auth-overlay').classList.add('hidden');
    $('app').classList.remove('blurred');
    $('user-avatar').textContent = user.email[0].toUpperCase();
    loadFeed(true);
  }
}

async function handleAuthSubmit(e) {
  e.preventDefault();
  const email = $('auth-email').value;
  const password = $('auth-password').value;
  const isSignUp = $('auth-submit').textContent === 'Sign Up';

  console.log('[auth] Submitting...', { email, isSignUp });

  if (!supabase) {
    toast('Supabase not initialized. Check your URL/Key.', 'error');
    return;
  }

  try {
    const { error, data } = isSignUp
      ? await supabase.auth.signUp({ email, password })
      : await supabase.auth.signInWithPassword({ email, password });

    if (error) throw error;
    console.log('[auth] Success:', data);
    if (isSignUp) toast('Check your email for confirmation!', 'success');
  } catch (err) {
    console.error('[auth] Error:', err);
    toast(err.message, 'error');
  }
}

// ── Sidebar ───────────────────────────────────────────────────────────────────
function bindSidebar() {
  $$('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      $$('.nav-item').forEach(i => i.classList.remove('active'));
      item.classList.add('active');

      const filter = item.dataset.filter;
      const type = item.dataset.type;

      if (filter === 'active' || filter === 'starred') {
        currentFilter = { status: filter, type: null, label: null };
        $('feed-title').textContent = filter === 'starred' ? 'Starred' : 'All Entries';
      } else if (item.id === 'trash-nav-item') {
        currentFilter = { status: 'trashed', type: null, label: null };
        $('feed-title').textContent = 'Trash';
      } else if (type) {
        currentFilter = { status: 'active', type, label: null };
        $('feed-title').textContent = type.charAt(0).toUpperCase() + type.slice(1) + 's';
      }

      loadFeed(true);
      $('feed-view').classList.remove('hidden');
      $('family-admin-view').classList.add('hidden');
      if (window.innerWidth <= 768) $('.sidebar').classList.remove('open');
    });
  });

  $('family-admin-btn').addEventListener('click', () => {
    $$('.nav-item').forEach(i => i.classList.remove('active'));
    $('family-admin-btn').classList.add('active');
    $('feed-view').classList.add('hidden');
    $('family-admin-view').classList.remove('hidden');
    loadFamilyMembers();
  });

  $('compose-btn').addEventListener('click', () => {
    $('capture-overlay').classList.remove('hidden');
  });

  $('invite-member-btn').addEventListener('click', () => $('invite-overlay').classList.remove('hidden'));
  $('invite-close').addEventListener('click', () => $('invite-overlay').classList.add('hidden'));
  $('send-invite-btn').addEventListener('click', handleSendInvite);
}

async function loadFamilyMembers() {
  const list = $('member-list');
  list.innerHTML = '<div class="loading-state">Loading members…</div>';
  try {
    const members = await apiFetch('/family/members');
    list.innerHTML = '';
    members.forEach(member => {
      const el = document.createElement('div');
      el.className = 'member-item';
      el.style = 'display:flex; align-items:center; justify-content:space-between; padding:12px; border-bottom:1px solid var(--border);';
      el.innerHTML = `
        <div style="display:flex; align-items:center; gap:12px;">
          <div class="avatar">${(member.display_name || member.email)[0].toUpperCase()}</div>
          <div>
            <div style="font-weight:600">${escHtml(member.display_name || 'Pending Member')}</div>
            <div style="font-size:12px; color:var(--muted)">${escHtml(member.email)} • ${member.role}</div>
          </div>
        </div>
        ${member.role !== 'owner' ? `<button class="delete-btn" onclick="removeMember('${member.id}')">Remove</button>` : ''}
      `;
      list.appendChild(el);
    });
  } catch (err) {
    list.innerHTML = '<div class="empty-state">Error loading members.</div>';
  }
}

async function handleSendInvite() {
  const email = $('invite-email').value.trim();
  const role = $('invite-role').value;
  if (!email) return;

  try {
    await apiPost('/family/invite', { email, role });
    toast('Invitation sent!', 'success');
    $('invite-overlay').classList.add('hidden');
    $('invite-email').value = '';
  } catch (err) {
    toast(err.message, 'error');
  }
}

// ── Capture ───────────────────────────────────────────────────────────────────
function bindCapture() {
  $('capture-close').addEventListener('click', () => $('capture-overlay').classList.add('hidden'));

  $$('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.tab').forEach(t => t.classList.remove('active'));
      $$('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.querySelector(`[data-content="${tab.dataset.tab}"]`).classList.add('active');
      currentTab = tab.dataset.tab;
    });
  });

  const drop = $('file-drop');
  const input = $('file-input');
  const name = $('file-name');

  input.addEventListener('change', () => {
    const count = input.files.length;
    name.textContent = count > 1 ? `${count} files` : (input.files[0]?.name ?? '');
  });

  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('dragging'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.classList.remove('dragging');
    if (e.dataTransfer.files.length) {
      input.files = e.dataTransfer.files;
      name.textContent = input.files.length > 1 ? `${input.files.length} files` : input.files[0].name;
    }
  });

  $('capture-btn').addEventListener('click', handleCapture);
}

async function handleCapture() {
  const btn = $('capture-btn');
  btn.disabled = true;
  setStatus('Saving…');

  try {
    if (currentTab === 'file') {
      const files = Array.from($('file-input').files);
      const note = $('file-note').value.trim();
      for (const file of files) {
        const uploaded = await uploadFile(file);
        await apiPost('/entries', {
          content: note || file.name,
          content_type: file.type.startsWith('image/') ? 'image' : 'file',
          file_url: uploaded.file_url,
          file_key: uploaded.file_key,
          ai_metadata: { b2_file_id: uploaded.file_id }
        });
      }
    } else {
      const content = currentTab === 'text' ? $('text-input').value.trim() : $('url-input').value.trim();
      const type = currentTab === 'text' ? 'text' : 'url';
      if (!content) throw new Error('Empty content');
      await apiPost('/entries', { content, content_type: type });
    }

    toast('Saved!', 'success');
    clearCapture();
    $('capture-overlay').classList.add('hidden');
    loadFeed(true);
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
    setStatus('');
  }
}

function clearCapture() {
  $('text-input').value = '';
  $('url-input').value = '';
  $('url-note').value = '';
  $('file-input').value = '';
  $('file-name').textContent = '';
  $('file-note').value = '';
}

function setStatus(msg) { $('capture-status').textContent = msg; }

async function uploadFile(file) {
  const form = new FormData();
  form.append('file', file);
  form.append('mime_type', file.type);
  const res = await fetch(`${API_BASE}/file`, { method: 'POST', body: form });
  if (!res.ok) throw new Error('Upload failed');
  return res.json();
}

// ── Feed ──────────────────────────────────────────────────────────────────────
async function loadFeed(reset = false) {
  if (isFeedLoading || !user) return;
  isFeedLoading = true;

  if (reset) {
    feedOffset = 0;
    $('entries-list').innerHTML = '<div class="loading-state">Loading…</div>';
  }

  try {
    let url = `/entries?limit=20&offset=${feedOffset}`;
    if (currentFilter.status === 'starred') {
      url += `&is_starred=eq.true&status=eq.active`;
    } else {
      url += `&status=eq.${currentFilter.status}`;
    }
    
    if (currentFilter.type) url += `&content_type=eq.${currentFilter.type}`;
    if (currentFilter.label) url += `&ai_labels=cs.{${currentFilter.label}}`;

    const data = await apiFetch(url);
    if (reset) $('entries-list').innerHTML = '';

    if (data.length === 0 && reset) {
      $('entries-list').innerHTML = '<div class="empty-state">No entries found.</div>';
    } else {
      data.forEach(entry => appendEntryCard(entry));
      feedOffset += data.length;
      $('load-more').classList.toggle('hidden', data.length < 20);
    }
    renderLabelNav(data);
  } catch (err) {
    console.error(err);
    $('entries-list').innerHTML = '<div class="empty-state">Error loading feed.</div>';
  } finally {
    isFeedLoading = false;
  }
}

function renderLabelNav(entries) {
  entries.forEach(e => (e.ai_labels || []).forEach(l => allLabels.add(l)));
  const list = $('label-nav-list');
  list.innerHTML = '';
  [...allLabels].sort().forEach(label => {
    const btn = document.createElement('button');
    btn.className = `nav-item${currentFilter.label === label ? ' active' : ''}`;
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><line x1="7" y1="7" x2="7.01" y2="7"/></svg><span>${label}</span>`;
    btn.onclick = () => {
      currentFilter.label = currentFilter.label === label ? null : label;
      loadFeed(true);
    };
    list.appendChild(btn);
  });
}

function appendEntryCard(entry) {
  $('entries-list').appendChild(buildEntryCard(entry));
}

function buildEntryCard(entry) {
  const card = document.createElement('div');
  card.className = 'entry-card';
  card.dataset.id = entry.id;

  const thumb = (entry.file_url && entry.content_type === 'image')
    ? `<img class="entry-file-thumb" src="${escHtml(entry.file_url)}" alt="" loading="lazy">`
    : '';

  const labels = (entry.ai_labels || []).map(l => `<span class="entry-label">${escHtml(l)}</span>`).join('');
  const summary = entry.ai_summary ? `<div class="entry-summary">${escHtml(entry.ai_summary)}</div>` : '';
  const content = entry.content || '[No text content]';

  card.innerHTML = `
    ${thumb}
    <div class="entry-main">
      <div class="entry-content">${escHtml(content)}</div>
      ${summary}
      <div class="entry-footer">
        <div class="entry-labels">${labels}</div>
        <div class="entry-time">${formatRelative(entry.created_at)}</div>
      </div>
    </div>
  `;

  card.onclick = () => {
    // Open detail view (TBD)
    console.log('Open entry', entry.id);
  };

  return card;
}

// ── Search ────────────────────────────────────────────────────────────────────
function bindSearch() {
  const input = $('search-input');
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
    item.innerHTML = `<div class="sr-content">${escHtml(entry.content || entry.ai_summary)}</div>`;
    item.onclick = () => {
      el.classList.add('hidden');
      document.querySelector(`[data-id="${entry.id}"]`)?.scrollIntoView({ behavior: 'smooth' });
    };
    el.appendChild(item);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function bindViewToggle() {
  const btn = $('view-toggle');
  const updateIcon = () => {
    btn.innerHTML = currentView === 'list'
      ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`;
  };
  updateIcon();
  btn.onclick = () => {
    currentView = currentView === 'list' ? 'grid' : 'list';
    $('entries-list').className = `entries-list ${currentView}-view`;
    updateIcon();
  };
}

function bindLoadMore() { $('load-more').onclick = () => loadFeed(); }

async function apiFetch(path) {
  const session = await supabase?.auth.getSession();
  const token = session?.data?.session?.access_token;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { 'Authorization': `Bearer ${token}` } : {}
  });
  if (!res.ok) throw new Error('Fetch failed');
  return res.json();
}

async function apiPost(path, data) {
  const session = await supabase?.auth.getSession();
  const token = session?.data?.session?.access_token;
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': token ? `Bearer ${token}` : ''
    },
    body: JSON.stringify(data)
  });
  if (!res.ok) throw new Error('Post failed');
  return res.json();
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
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

async function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    // Unregister all workers to clear cache issues during dev
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (let registration of registrations) {
      await registration.unregister();
    }
    console.log('[sw] Unregistered for dev cleanup');
    // Optional: Re-register if desired, but for now let's keep it clean
    // navigator.serviceWorker.register('/sw.js').catch(() => { });
  }
}
