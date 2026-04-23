/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * inspector.js — InspectorController
 * Owns the Inspector tab: URL parsing, params state, live preview,
 * and tab navigation via chrome.tabs.update.
 */

'use strict';

export class InspectorController {
  /** @param {import('./storage.js').StorageService} storage */
  constructor(storage) {
    this._storage = storage;

    /** @type {{ id: number, enabled: boolean, key: string, value: string }[]} */
    this._params    = [];
    this._nextId    = 0;
    this._originUrl = '';

    // DOM refs
    this._originDisplay = document.getElementById('origin-display');
    this._pathInput     = document.getElementById('path-input');
    this._paramsList    = document.getElementById('params-list');
    this._paramsEmpty   = document.getElementById('params-empty');
    this._urlPreview    = document.getElementById('url-preview');
    this._addParamBtn   = document.getElementById('add-param-btn');
    this._applyBtn      = document.getElementById('apply-btn');
    this._resetBtn      = document.getElementById('reset-btn');

    this._bindEvents();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async init() {
    this._params = [];
    this._nextId = 0;

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) {
      this._showPreviewError('Cannot inspect this page.');
      return;
    }

    this._originUrl = tab.url;
    let parsed;
    try {
      parsed = new URL(tab.url);
    } catch {
      this._showPreviewError('Invalid URL.');
      return;
    }

    this._storage.setKey(parsed.origin + parsed.pathname);
    this._originDisplay.value = parsed.origin;

    const saved = await this._storage.loadState();
    if (saved) {
      this._pathInput.value = saved.path;
      saved.params.forEach(({ enabled, key, value, source = 'default' }) => {
        this._params.push({ id: this._nextId++, enabled, key, value, source });
      });
    } else {
      this._pathInput.value = parsed.pathname;
      parsed.searchParams.forEach((value, key) => {
        this._params.push({ id: this._nextId++, enabled: true, key, value, source: 'default' });
      });
    }

    this._renderParamRows();
    this._updatePreview();
  }

  /**
   * Return a serialised (id-free) snapshot of the current params.
   * Used by ProfilesController when saving a profile.
   * @returns {{ enabled: boolean, key: string, value: string }[]}
   */
  getParams() {
    return this._params.map(({ enabled, key, value }) => ({ enabled, key, value }));
  }

  /**
   * Merge a profile's params into the current state.
   * Existing keys are overridden; new keys are appended.
   * Params already present but absent from the profile are left untouched.
   * Called by ProfilesController when the user clicks Apply.
   * @param {string} profileName
   * @param {{ enabled: boolean, key: string, value: string }[]} serialized
   */
  applyParams(profileName, serialized) {
    serialized.forEach(({ key, value, enabled }) => {
      const existing = this._params.find(p => p.key === key);
      if (existing) {
        existing.value   = value;
        existing.enabled = enabled;
        existing.source  = profileName;
      } else {
        this._params.push({ id: this._nextId++, key, value, enabled, source: profileName });
      }
    });
    this._renderParamRows();
    this._updatePreview();
    this._saveState();

    const url = this._buildUrl();
    if (!url) return;
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      if (tab?.id) chrome.tabs.update(tab.id, { url });
    });
  }

  // ── Param rows ───────────────────────────────────────────────────────────────

  _renderParamRows() {
    this._paramsList.querySelectorAll('.param-row, .params-source-header').forEach(el => el.remove());
    this._paramsEmpty.style.display = this._params.length === 0 ? 'block' : 'none';

    // 1. URL params — no header
    this._params
      .filter(p => p.source === 'default')
      .forEach(p => this._paramsList.appendChild(this._buildParamRow(p)));

    // 2. Manually added params — "Custom Params" header
    const customParams = this._params.filter(p => p.source === 'custom');
    if (customParams.length > 0) {
      this._paramsList.appendChild(this._buildGroupHeader('Custom Params', 'custom', customParams, 'custom'));
      customParams.forEach(p => this._paramsList.appendChild(this._buildParamRow(p)));
    }

    // 3. Profile params — grouped by profile name
    const groups = new Map();
    this._params
      .filter(p => p.source !== 'default' && p.source !== 'custom')
      .forEach(p => {
        if (!groups.has(p.source)) groups.set(p.source, []);
        groups.get(p.source).push(p);
      });

    groups.forEach((groupParams, profileName) => {
      this._paramsList.appendChild(this._buildGroupHeader(profileName, profileName, groupParams, 'profile'));
      groupParams.forEach(p => this._paramsList.appendChild(this._buildParamRow(p)));
    });
  }

  /**
   * @param {string} displayName  Label shown in the header
   * @param {string} sourceKey    Value of param.source to filter on remove
   * @param {Array}  groupParams  The params in this group
   * @param {'custom'|'profile'} type  Controls colour variant
   */
  _buildGroupHeader(displayName, sourceKey, groupParams, type) {
    const allEnabled = groupParams.every(p => p.enabled);

    const header = document.createElement('div');
    header.className = `params-source-header source-${type}`;

    const nameEl       = document.createElement('span');
    nameEl.className   = 'params-source-name';
    nameEl.textContent = displayName;

    const line = document.createElement('span');
    line.className = 'params-source-line';

    // Toggle all on/off
    const toggleLabel     = document.createElement('label');
    toggleLabel.className = 'toggle';
    toggleLabel.title     = allEnabled ? 'Disable all' : 'Enable all';
    const toggleCheckbox  = document.createElement('input');
    toggleCheckbox.type    = 'checkbox';
    toggleCheckbox.checked = allEnabled;
    toggleCheckbox.addEventListener('change', () => {
      groupParams.forEach(p => { p.enabled = toggleCheckbox.checked; });
      this._renderParamRows();
      this._updatePreview();
      this._saveState();
    });
    const toggleTrack     = document.createElement('span');
    toggleTrack.className = 'toggle-track';
    toggleLabel.append(toggleCheckbox, toggleTrack);

    // Remove entire group
    const removeBtn       = document.createElement('button');
    removeBtn.className   = 'btn-delete';
    removeBtn.title       = `Remove "${displayName}"`;
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      this._params = this._params.filter(p => p.source !== sourceKey);
      this._renderParamRows();
      this._updatePreview();
      this._saveState();
    });

    header.append(nameEl, line, toggleLabel, removeBtn);
    return header;
  }

  _buildParamRow(param) {
    const row = document.createElement('div');
    const sourceClass = param.source === 'default' ? 'source-default'
                      : param.source === 'custom'  ? 'source-custom'
                      : 'source-profile';
    row.className  = `param-row ${sourceClass}` + (param.enabled ? '' : ' disabled');
    row.dataset.id = param.id;

    // Toggle
    const toggleWrapper = document.createElement('div');
    toggleWrapper.className = 'toggle-wrapper';
    const label   = document.createElement('label');
    label.className = 'toggle';
    label.title   = param.enabled ? 'Disable parameter' : 'Enable parameter';
    const checkbox = document.createElement('input');
    checkbox.type    = 'checkbox';
    checkbox.checked = param.enabled;
    checkbox.addEventListener('change', () => {
      param.enabled = checkbox.checked;
      row.classList.toggle('disabled', !param.enabled);
      label.title = param.enabled ? 'Disable parameter' : 'Enable parameter';
      this._updatePreview();
      this._saveState();
    });
    const track = document.createElement('span');
    track.className = 'toggle-track';
    label.append(checkbox, track);
    toggleWrapper.appendChild(label);

    // Key
    const keyInput       = document.createElement('input');
    keyInput.type        = 'text';
    keyInput.className   = 'param-key';
    keyInput.value       = param.key;
    keyInput.placeholder = 'key';
    keyInput.spellcheck  = false;
    keyInput.addEventListener('input', () => {
      param.key = keyInput.value;
      this._updatePreview();
      this._saveState();
    });

    // Value
    const valueInput       = document.createElement('input');
    valueInput.type        = 'text';
    valueInput.className   = 'param-value';
    valueInput.value       = param.value;
    valueInput.placeholder = 'value';
    valueInput.spellcheck  = false;
    valueInput.addEventListener('input', () => {
      param.value = valueInput.value;
      this._updatePreview();
      this._saveState();
    });

    // Delete
    const deleteBtn       = document.createElement('button');
    deleteBtn.className   = 'btn-delete';
    deleteBtn.title       = 'Remove parameter';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', () => {
      this._params = this._params.filter(p => p.id !== param.id);
      row.remove();
      this._paramsEmpty.style.display = this._params.length === 0 ? 'block' : 'none';
      this._updatePreview();
      this._saveState();
    });

    row.append(toggleWrapper, keyInput, valueInput, deleteBtn);
    return row;
  }

  // ── URL building & preview ───────────────────────────────────────────────────

  _buildUrl() {
    let origin;
    try {
      origin = new URL(this._originUrl).origin;
    } catch {
      return null;
    }

    const path    = this._pathInput.value || '/';
    const enabled = this._params.filter(p => p.enabled && p.key.trim() !== '');
    const search  = enabled.length
      ? '?' + enabled.map(p =>
          encodeURIComponent(p.key) + (p.value !== '' ? '=' + encodeURIComponent(p.value) : '')
        ).join('&')
      : '';

    return origin + path + search;
  }

  _updatePreview() {
    const url = this._buildUrl();
    if (!url) { this._showPreviewError('Cannot build URL.'); return; }

    this._urlPreview.classList.remove('error');

    let parsed;
    try { parsed = new URL(url); } catch { this._showPreviewError(url); return; }

    const origin = _span('preview-origin', _esc(parsed.origin));
    const path   = _span('preview-path',   _esc(parsed.pathname));

    if (!parsed.search) {
      this._urlPreview.innerHTML = origin + path;
      return;
    }

    const sep   = _span('preview-sep', '?');
    const pairs = [...parsed.searchParams.entries()].map(([k, v], i) => {
      const amp = i > 0 ? _span('preview-amp', '&amp;') : '';
      return amp + _span('preview-key', _esc(k)) + _span('preview-sep', '=') + _span('preview-value', _esc(v));
    }).join('');

    this._urlPreview.innerHTML = origin + path + sep + pairs;
  }

  _showPreviewError(msg) {
    this._urlPreview.classList.add('error');
    this._urlPreview.textContent = msg;
  }

  // ── Storage delegation ───────────────────────────────────────────────────────

  _saveState() {
    const params = this._params.map(({ enabled, key, value, source }) => ({ enabled, key, value, source }));
    this._storage.saveState(this._pathInput.value, params);
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────

  _bindEvents() {
    this._pathInput.addEventListener('input', () => {
      this._updatePreview();
      this._saveState();
    });

    this._addParamBtn.addEventListener('click', () => {
      const param = { id: this._nextId++, enabled: true, key: '', value: '', source: 'custom' };
      this._params.push(param);
      this._paramsEmpty.style.display = 'none';
      const row = this._buildParamRow(param);
      this._paramsList.appendChild(row);
      row.querySelector('.param-key').focus();
      this._updatePreview();
      this._saveState();
    });

    this._applyBtn.addEventListener('click', async () => {
      const url = this._buildUrl();
      if (!url) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      await chrome.tabs.update(tab.id, { url });
      window.close();
    });

    this._resetBtn.addEventListener('click', () => {
      this._storage.clearState();
      this.init();
    });
  }
}

// ── Module-level helpers (no DOM, no state) ──────────────────────────────────

function _span(cls, content) {
  return `<span class="${cls}">${content}</span>`;
}

function _esc(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
