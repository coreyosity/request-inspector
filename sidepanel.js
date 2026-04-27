/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * sidepanel.js — Side panel controller
 * Manages three views: Monitor, Detail, Replay.
 * Reads captured requests from chrome.storage.session (written by background.js).
 */

'use strict';

const SESSION_KEY = 'ri_requests';
const METHODS     = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

// ── Monitor state ─────────────────────────────────────────────────────────────

let currentTabId = null;

window.addEventListener('beforeunload', () => {
  if (currentTabId !== null) {
    chrome.runtime.sendMessage({ type: 'RI_MONITOR_STATE', active: false, tabId: currentTabId })
      ?.catch(() => {});
  }
});

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  requests:    [],   // all captured requests for this tab
  filtered:    [],   // after applying active filters
  selected:    null, // request shown in Detail/Replay
  recording:   true,
  filters: {
    firstParty: true,
    json:       true,
    method:     '',
    url:        '',
  },
};

// ── View routing ──────────────────────────────────────────────────────────────

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active', v.id === id));
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('hidden', v.id !== id));
}

// ── Monitor view ──────────────────────────────────────────────────────────────

const $list        = document.getElementById('request-list');
const $empty       = document.getElementById('monitor-empty');
const $statusCount = document.getElementById('status-count');
const $statusFilt  = document.getElementById('status-filtered');
const $btnRecord   = document.getElementById('btn-record');
const $btnClear    = document.getElementById('btn-clear');
const $filterFP    = document.getElementById('filter-first-party');
const $filterJSON  = document.getElementById('filter-json');
const $filterURL   = document.getElementById('filter-url');

export function filterRequests(requests, filters) {
  const { firstParty, json, method, url } = filters;
  return requests.filter(r => {
    if (firstParty && !r.firstParty) return false;
    if (json && !(r.contentType && r.contentType.includes('application/json')) && !r.pending) return false;
    if (method && r.method !== method) return false;
    if (url && !r.url.toLowerCase().includes(url.toLowerCase())) return false;
    return true;
  });
}

function applyFilters() {
  state.filtered = filterRequests(state.requests, state.filters);
}

function renderMonitor() {
  applyFilters();

  // Remove old request rows (keep the empty placeholder)
  $list.querySelectorAll('.request-row').forEach(el => el.remove());

  const showing = state.filtered.length;
  const total   = state.requests.length;

  $empty.classList.toggle('hidden', showing > 0);

  $statusCount.textContent = `${total} request${total !== 1 ? 's' : ''}`;
  $statusFilt.textContent  = showing < total ? `· showing ${showing}` : '';

  state.filtered.forEach(req => {
    const row = buildRequestRow(req);
    $list.appendChild(row);
  });

  // Auto-scroll to bottom
  $list.scrollTop = $list.scrollHeight;
}

function buildRequestRow(req) {
  const row = document.createElement('div');
  row.className  = 'request-row';
  row.dataset.id = req.id;

  const pathDisplay = (() => {
    try { return new URL(req.url).pathname; } catch (_) { return req.url; }
  })();

  const statusClass = req.pending ? 'status-pending'
    : req.status === 0            ? 'status-error'
    : req.status < 300            ? 'status-ok'
    : req.status < 400            ? 'status-redirect'
    :                               'status-error';

  row.innerHTML = `
    <span class="method-badge method-${req.method.toLowerCase()}">${req.method}</span>
    <span class="row-path" title="${req.url}">${pathDisplay}</span>
    <span class="row-status ${statusClass}">${req.pending ? '…' : (req.status || 'ERR')}</span>
    <span class="row-duration">${req.duration != null ? `${req.duration}ms` : ''}</span>
  `;

  row.addEventListener('click', () => openDetail(req));
  return row;
}

function updateRow(req) {
  const existing = $list.querySelector(`[data-id="${req.id}"]`);
  if (!existing) return;
  const fresh = buildRequestRow(req);
  existing.replaceWith(fresh);
}

// ── Detail view ───────────────────────────────────────────────────────────────

function openDetail(req) {
  state.selected = req;
  showView('view-detail');

  try {
    const u = new URL(req.url);
    document.getElementById('detail-title').textContent = u.pathname;
  } catch (_) {
    document.getElementById('detail-title').textContent = req.url;
  }

  const badge = document.getElementById('detail-method-badge');
  badge.textContent  = req.method;
  badge.className    = `method-badge method-${req.method.toLowerCase()}`;

  document.getElementById('detail-url').textContent = req.url;

  const meta = [];
  if (req.status)   meta.push(statusLabel(req.status));
  if (req.duration) meta.push(`${req.duration}ms`);
  if (req.pending)  meta.push('pending…');
  document.getElementById('detail-meta').textContent = meta.join('  ·  ');

  renderKVList('detail-req-headers',  req.requestHeaders  ?? {});
  renderKVList('detail-resp-headers', req.responseHeaders ?? {});

  renderCodeBlock('detail-req-body',  req.requestBody);
  renderCodeBlock('detail-resp-body', req.responseBody);
}

function statusLabel(code) {
  const labels = { 200:'OK',201:'Created',204:'No Content',301:'Moved',
                   302:'Found',304:'Not Modified',400:'Bad Request',
                   401:'Unauthorized',403:'Forbidden',404:'Not Found',
                   405:'Method Not Allowed',422:'Unprocessable',
                   429:'Too Many Requests',500:'Server Error',502:'Bad Gateway',
                   503:'Unavailable' };
  return `${code}${labels[code] ? ' ' + labels[code] : ''}`;
}

function renderKVList(elId, obj) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  const entries = Object.entries(obj);
  if (!entries.length) {
    el.innerHTML = '<span class="kv-empty">None</span>';
    return;
  }
  entries.forEach(([k, v]) => {
    const row = document.createElement('div');
    row.className = 'kv-row';
    row.innerHTML = `<span class="kv-key">${esc(k)}</span><span class="kv-val">${esc(v)}</span>`;
    el.appendChild(row);
  });
}

function renderCodeBlock(elId, content) {
  const el = document.getElementById(elId);
  if (!content) {
    el.textContent = '(empty)';
    el.classList.add('code-muted');
    return;
  }
  el.classList.remove('code-muted');
  try {
    el.textContent = JSON.stringify(JSON.parse(content), null, 2);
  } catch (_) {
    el.textContent = content;
  }
}

// ── Replay view ───────────────────────────────────────────────────────────────

function openReplay(req) {
  state.selected = req;
  showView('view-replay');

  // Method selector
  const $method = document.getElementById('replay-method');
  $method.innerHTML = METHODS.map(m =>
    `<option value="${m}" ${m === req.method ? 'selected' : ''}>${m}</option>`
  ).join('');

  // URL (strip query — we'll add params separately)
  let baseUrl = req.url;
  let params  = {};
  try {
    const u = new URL(req.url);
    baseUrl = `${u.origin}${u.pathname}`;
    u.searchParams.forEach((v, k) => { params[k] = v; });
  } catch (_) {}

  document.getElementById('replay-url').value = baseUrl;

  // Pre-fill editable headers
  buildEditableKVList('replay-headers-list', req.requestHeaders ?? {});

  // Pre-fill params
  buildEditableKVList('replay-params-list', params);

  // Body
  const $body = document.getElementById('replay-body');
  $body.value = req.requestBody ?? '';

  // Clear previous response
  const $resp = document.getElementById('replay-resp-body');
  $resp.textContent = 'Fire the request to see a response.';
  $resp.classList.add('replay-response-placeholder');
  document.getElementById('replay-resp-meta').textContent = '';
}

function buildEditableKVList(listId, obj) {
  const list = document.getElementById(listId);
  list.innerHTML = '';
  Object.entries(obj).forEach(([k, v]) => addEditableKVRow(list, k, v));
}

function addEditableKVRow(list, key = '', value = '') {
  const row = document.createElement('div');
  row.className = 'kv-edit-row';
  row.innerHTML = `
    <input class="kv-edit-key"   type="text" value="${esc(key)}"   placeholder="Header name"  spellcheck="false"/>
    <input class="kv-edit-value" type="text" value="${esc(value)}" placeholder="Value" spellcheck="false"/>
    <button class="kv-delete-btn" title="Remove">&#x2715;</button>
  `;
  row.querySelector('.kv-delete-btn').addEventListener('click', () => row.remove());
  list.appendChild(row);
  return row;
}

function collectKVList(listId) {
  const obj = {};
  document.querySelectorAll(`#${listId} .kv-edit-row`).forEach(row => {
    const k = row.querySelector('.kv-edit-key').value.trim();
    const v = row.querySelector('.kv-edit-value').value.trim();
    if (k) obj[k] = v;
  });
  return obj;
}

async function sendReplay() {
  const method  = document.getElementById('replay-method').value;
  const baseUrl = document.getElementById('replay-url').value.trim();
  const headers = collectKVList('replay-headers-list');
  const params  = collectKVList('replay-params-list');
  const body    = document.getElementById('replay-body').value.trim() || undefined;

  let url = baseUrl;
  const paramEntries = Object.entries(params);
  if (paramEntries.length) {
    const qs = paramEntries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
    url = `${baseUrl}?${qs}`;
  }

  const $resp     = document.getElementById('replay-resp-body');
  const $respMeta = document.getElementById('replay-resp-meta');
  $resp.textContent = 'Sending…';
  $resp.classList.add('replay-response-placeholder');
  $respMeta.textContent = '';

  const start = Date.now();
  try {
    const fetchOpts = { method, headers };
    if (body && !['GET', 'HEAD'].includes(method)) fetchOpts.body = body;

    const response = await fetch(url, fetchOpts);
    const duration = Date.now() - start;
    const text     = await response.text();

    $resp.classList.remove('replay-response-placeholder');
    $respMeta.textContent = `${statusLabel(response.status)}  ·  ${duration}ms`;

    try {
      $resp.textContent = JSON.stringify(JSON.parse(text), null, 2);
    } catch (_) {
      $resp.textContent = text || '(empty body)';
    }
  } catch (err) {
    $resp.classList.remove('replay-response-placeholder');
    $resp.textContent = `Error: ${err.message}`;
    $respMeta.textContent = `${Date.now() - start}ms`;
  }
}

// ── "Open in Inspector" handoff ───────────────────────────────────────────────

async function sendToInspector(req) {
  await chrome.storage.session.set({ ri_inspector_handoff: req });
  // User must click the extension icon to open the popup, which will pick this up.
}

// ── Storage listener — live updates from background ───────────────────────────

async function loadRequestsForTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  currentTabId = tab.id;

  // Tell the background (and relay) that monitoring is active for this tab.
  chrome.runtime.sendMessage({ type: 'RI_MONITOR_STATE', active: true, tabId: currentTabId })
    ?.catch(() => {});

  const stored = await chrome.storage.session.get(SESSION_KEY);
  const all    = stored[SESSION_KEY] ?? [];
  state.requests = all.filter(r => r.tabId === tab.id);
  renderMonitor();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !changes[SESSION_KEY]) return;
  const newVal = changes[SESSION_KEY].newValue ?? [];

  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
    if (!tab) return;
    const tabRequests = newVal.filter(r => r.tabId === tab.id);

    tabRequests.forEach(req => {
      const idx = state.requests.findIndex(r => r.id === req.id);
      if (idx === -1) {
        if (state.recording) state.requests.push(req);
      } else {
        // Update existing (pending → resolved)
        state.requests[idx] = req;
        if (state.selected && state.selected.id === req.id) {
          state.selected = req;
          // Refresh detail view if open
          const detailView = document.getElementById('view-detail');
          if (detailView.classList.contains('active')) openDetail(req);
        }
        updateRow(req);
        return;
      }
    });

    applyFilters();
    // Only re-render new rows, not the whole list
    const existingIds = new Set([...$list.querySelectorAll('.request-row')].map(el => el.dataset.id));
    state.filtered.forEach(req => {
      if (!existingIds.has(req.id)) {
        if ($empty) $empty.classList.add('hidden');
        $list.appendChild(buildRequestRow(req));
      }
    });

    const total   = state.requests.length;
    const showing = state.filtered.length;
    $statusCount.textContent = `${total} request${total !== 1 ? 's' : ''}`;
    $statusFilt.textContent  = showing < total ? `· showing ${showing}` : '';
    $list.scrollTop = $list.scrollHeight;
  });
});

// ── Collapsible sections ──────────────────────────────────────────────────────

document.querySelectorAll('.collapsible').forEach(header => {
  header.addEventListener('click', (e) => {
    if (e.target.closest('.sp-add-btn')) return; // don't collapse when clicking Add
    const target  = document.getElementById(header.dataset.target);
    const chevron = header.querySelector('.chevron');
    const open    = !target.classList.contains('collapsed');
    target.classList.toggle('collapsed', open);
    if (chevron) chevron.classList.toggle('collapsed', open);
  });
});

// ── "+ Add" buttons in replay ─────────────────────────────────────────────────

document.querySelectorAll('.sp-add-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const bodyId = btn.dataset.list;
    const listId = bodyId === 'replay-headers-body' ? 'replay-headers-list' : 'replay-params-list';
    const list   = document.getElementById(listId);
    const row    = addEditableKVRow(list);
    row.querySelector('.kv-edit-key').focus();
  });
});

// ── Method pills ──────────────────────────────────────────────────────────────

document.querySelectorAll('.method-pill').forEach(pill => {
  pill.addEventListener('click', () => {
    document.querySelectorAll('.method-pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    state.filters.method = pill.dataset.method;
    renderMonitor();
  });
});

// ── Filter events ─────────────────────────────────────────────────────────────

$filterFP.addEventListener('change', () => {
  state.filters.firstParty = $filterFP.checked;
  renderMonitor();
});

$filterJSON.addEventListener('change', () => {
  state.filters.json = $filterJSON.checked;
  renderMonitor();
});

$filterURL.addEventListener('input', () => {
  state.filters.url = $filterURL.value;
  renderMonitor();
});

// ── Record / clear ────────────────────────────────────────────────────────────

$btnRecord.addEventListener('click', () => {
  state.recording = !state.recording;
  $btnRecord.classList.toggle('recording', state.recording);
  $btnRecord.title     = state.recording ? 'Pause recording' : 'Resume recording';
  $btnRecord.innerHTML = state.recording ? '&#9646;&#9646;' : '&#9654;';
});

$btnClear.addEventListener('click', () => {
  state.requests = [];
  state.filtered = [];
  $list.querySelectorAll('.request-row').forEach(el => el.remove());
  $empty.classList.remove('hidden');
  $statusCount.textContent = '0 requests';
  $statusFilt.textContent  = '';
  chrome.runtime.sendMessage({ type: 'RI_CLEAR_REQUESTS' }).catch(() => {});
});

// ── Back buttons ──────────────────────────────────────────────────────────────

document.getElementById('btn-back-detail').addEventListener('click', () => showView('view-monitor'));
document.getElementById('btn-back-replay').addEventListener('click', () => openDetail(state.selected));

// ── Detail actions ────────────────────────────────────────────────────────────

document.getElementById('btn-replay').addEventListener('click', () => {
  if (state.selected) openReplay(state.selected);
});

document.getElementById('btn-to-inspector').addEventListener('click', async () => {
  if (state.selected) await sendToInspector(state.selected);
});

// ── Replay send ───────────────────────────────────────────────────────────────

document.getElementById('btn-send').addEventListener('click', sendReplay);

// ── Utility ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────

loadRequestsForTab();
