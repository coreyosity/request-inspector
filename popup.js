/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * popup.js — Request Inspector
 * Handles URL parsing, query-parameter table management, live preview,
 * and navigation via chrome.tabs.update.
 *
 * State is persisted to chrome.storage.local, keyed by origin + pathname
 * (i.e. the URL before query parameters), so unapplied edits survive
 * between popup opens on the same page.
 */

'use strict';

// ── State ──────────────────────────────────────────────────────────────────────

/** @type {{ id: number, enabled: boolean, key: string, value: string }[]} */
let params = [];
let nextId = 0;
let originalUrl = '';
let storageKey  = '';   // origin + pathname — used as the chrome.storage.local key

// ── DOM refs ───────────────────────────────────────────────────────────────────

const originDisplay = document.getElementById('origin-display');
const pathInput     = document.getElementById('path-input');
const paramsList    = document.getElementById('params-list');
const paramsEmpty   = document.getElementById('params-empty');
const urlPreview    = document.getElementById('url-preview');
const addParamBtn   = document.getElementById('add-param-btn');
const applyBtn      = document.getElementById('apply-btn');
const resetBtn      = document.getElementById('reset-btn');

// ── Storage helpers ────────────────────────────────────────────────────────────

/**
 * Persist the current working state under the page's base URL key.
 * Saved shape: { path: string, params: SerializedParam[] }
 */
function saveState() {
  if (!storageKey) return;
  const state = {
    path: pathInput.value,
    params: params.map(({ enabled, key, value }) => ({ enabled, key, value })),
  };
  chrome.storage.local.set({ [storageKey]: state });
}

/**
 * Load previously saved state for the current page.
 * @returns {Promise<{ path: string, params: SerializedParam[] } | null>}
 */
async function loadState() {
  if (!storageKey) return null;
  const result = await chrome.storage.local.get(storageKey);
  return result[storageKey] ?? null;
}

/** Remove the saved state for the current page. */
function clearState() {
  if (!storageKey) return;
  chrome.storage.local.remove(storageKey);
}

// ── Init ───────────────────────────────────────────────────────────────────────

async function init() {
  params = [];
  nextId = 0;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) {
    showPreviewError('Cannot inspect this page.');
    return;
  }

  originalUrl = tab.url;
  let parsed;
  try {
    parsed = new URL(tab.url);
  } catch {
    showPreviewError('Invalid URL.');
    return;
  }

  storageKey = parsed.origin + parsed.pathname;
  originDisplay.value = parsed.origin;

  // Attempt to restore a previously saved draft for this page.
  const saved = await loadState();

  if (saved) {
    pathInput.value = saved.path;
    saved.params.forEach(({ enabled, key, value }) => {
      params.push({ id: nextId++, enabled, key, value });
    });
  } else {
    pathInput.value = parsed.pathname;
    parsed.searchParams.forEach((value, key) => {
      params.push({ id: nextId++, enabled: true, key, value });
    });
  }

  renderParamRows();
  updatePreview();
}

// ── Param row rendering ────────────────────────────────────────────────────────

function renderParamRows() {
  paramsList.querySelectorAll('.param-row').forEach(el => el.remove());
  paramsEmpty.style.display = params.length === 0 ? 'block' : 'none';
  params.forEach(param => paramsList.appendChild(buildParamRow(param)));
}

/**
 * Build a single parameter row element and wire up its events.
 * @param {{ id: number, enabled: boolean, key: string, value: string }} param
 * @returns {HTMLDivElement}
 */
function buildParamRow(param) {
  const row = document.createElement('div');
  row.className = 'param-row' + (param.enabled ? '' : ' disabled');
  row.dataset.id = param.id;

  // ── Toggle ──
  const toggleWrapper = document.createElement('div');
  toggleWrapper.className = 'toggle-wrapper';

  const label = document.createElement('label');
  label.className = 'toggle';
  label.title = param.enabled ? 'Disable parameter' : 'Enable parameter';

  const checkbox = document.createElement('input');
  checkbox.type    = 'checkbox';
  checkbox.checked = param.enabled;
  checkbox.addEventListener('change', () => {
    param.enabled = checkbox.checked;
    row.classList.toggle('disabled', !param.enabled);
    label.title = param.enabled ? 'Disable parameter' : 'Enable parameter';
    updatePreview();
    saveState();
  });

  const track = document.createElement('span');
  track.className = 'toggle-track';

  label.append(checkbox, track);
  toggleWrapper.appendChild(label);

  // ── Key input ──
  const keyInput = document.createElement('input');
  keyInput.type        = 'text';
  keyInput.className   = 'param-key';
  keyInput.value       = param.key;
  keyInput.placeholder = 'key';
  keyInput.spellcheck  = false;
  keyInput.addEventListener('input', () => {
    param.key = keyInput.value;
    updatePreview();
    saveState();
  });

  // ── Value input ──
  const valueInput = document.createElement('input');
  valueInput.type        = 'text';
  valueInput.className   = 'param-value';
  valueInput.value       = param.value;
  valueInput.placeholder = 'value';
  valueInput.spellcheck  = false;
  valueInput.addEventListener('input', () => {
    param.value = valueInput.value;
    updatePreview();
    saveState();
  });

  // ── Delete button ──
  const deleteBtn = document.createElement('button');
  deleteBtn.className   = 'btn-delete';
  deleteBtn.title       = 'Remove parameter';
  deleteBtn.textContent = '×';
  deleteBtn.addEventListener('click', () => {
    params = params.filter(p => p.id !== param.id);
    row.remove();
    paramsEmpty.style.display = params.length === 0 ? 'block' : 'none';
    updatePreview();
    saveState();
  });

  row.append(toggleWrapper, keyInput, valueInput, deleteBtn);
  return row;
}

// ── Live preview ───────────────────────────────────────────────────────────────

function buildUrl() {
  let origin;
  try {
    origin = new URL(originalUrl).origin;
  } catch {
    return null;
  }

  const path    = pathInput.value || '/';
  const enabled = params.filter(p => p.enabled && p.key.trim() !== '');

  const search = enabled.length
    ? '?' + enabled.map(p =>
        encodeURIComponent(p.key) + (p.value !== '' ? '=' + encodeURIComponent(p.value) : '')
      ).join('&')
    : '';

  return origin + path + search;
}

function updatePreview() {
  const url = buildUrl();
  if (!url) {
    showPreviewError('Cannot build URL.');
    return;
  }

  urlPreview.classList.remove('error');

  let parsed;
  try { parsed = new URL(url); } catch { showPreviewError(url); return; }

  const origin = span('preview-origin', escHtml(parsed.origin));
  const path   = span('preview-path',   escHtml(parsed.pathname));

  if (!parsed.search) {
    urlPreview.innerHTML = origin + path;
    return;
  }

  const sep   = span('preview-sep', '?');
  const pairs = [...parsed.searchParams.entries()].map(([k, v], i) => {
    const amp = i > 0 ? span('preview-amp', '&amp;') : '';
    return amp + span('preview-key', escHtml(k)) +
      span('preview-sep', '=') + span('preview-value', escHtml(v));
  }).join('');

  urlPreview.innerHTML = origin + path + sep + pairs;
}

function showPreviewError(msg) {
  urlPreview.classList.add('error');
  urlPreview.textContent = msg;
}

function span(cls, content) {
  return `<span class="${cls}">${content}</span>`;
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Controls ───────────────────────────────────────────────────────────────────

addParamBtn.addEventListener('click', () => {
  const param = { id: nextId++, enabled: true, key: '', value: '' };
  params.push(param);
  paramsEmpty.style.display = 'none';
  const row = buildParamRow(param);
  paramsList.appendChild(row);
  row.querySelector('.param-key').focus();
  updatePreview();
  saveState();
});

applyBtn.addEventListener('click', async () => {
  const url = buildUrl();
  if (!url) return;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  await chrome.tabs.update(tab.id, { url });
  window.close();
});

resetBtn.addEventListener('click', () => {
  clearState();
  init();
});

pathInput.addEventListener('input', () => {
  updatePreview();
  saveState();
});

// ── Bootstrap ──────────────────────────────────────────────────────────────────

init();
