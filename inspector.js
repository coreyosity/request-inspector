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
  /**
   * @param {import('./storage.js').StorageService} storage
   * @param {{ onApply?: (tabId: number, url: string) => Promise<void>,
   *            onReset?: () => Promise<void> }} [callbacks]
   */
  constructor(storage, { onApply, onReset, onProfileEnable, onSaveToProfile } = {}) {
    this._storage           = storage;
    this._onApply           = onApply           ?? null;
    this._onReset           = onReset           ?? null;
    this._onProfileEnable   = onProfileEnable   ?? null;
    this._onSaveToProfile   = onSaveToProfile   ?? null;

    /** @type {{ id: number, enabled: boolean, key: string, value: string, source: string }[]} */
    this._params         = [];
    this._nextId         = 0;
    this._originUrl      = '';
    /** @type {string|null} Name of the currently active profile, or null. */
    this._enabledProfile = null;

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
    this._params         = [];
    this._nextId         = 0;
    this._enabledProfile = null;

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

    this._originDisplay.value = parsed.origin;
    this._pathInput.value     = parsed.pathname;

    // Load profiles and the persisted active profile in parallel.
    const [profiles, storedProfile] = await Promise.all([
      this._storage.readProfiles(),
      this._storage.loadEnabledProfile(),
    ]);

    // Validate the stored profile still exists.
    this._enabledProfile = (storedProfile && profiles[storedProfile]) ? storedProfile : null;
    if (storedProfile && !this._enabledProfile) {
      // Profile was deleted — clear the stale key.
      this._storage.saveEnabledProfile(null);
    }

    // Keys that belong to the active profile are excluded from defaults so
    // they don't appear twice (once as default and once in the profile group).
    const activeProfileKeys = this._enabledProfile
      ? new Set(profiles[this._enabledProfile].params.map(p => p.key))
      : new Set();

    // URL params that are not part of the active profile → default section.
    parsed.searchParams.forEach((value, key) => {
      if (!activeProfileKeys.has(key)) {
        this._params.push({ id: this._nextId++, enabled: true, key, value, source: 'default' });
      }
    });

    // All profiles → their own groups.
    Object.entries(profiles).forEach(([name, { params }]) => {
      params.forEach(({ enabled, key, value }) => {
        this._params.push({ id: this._nextId++, enabled, key, value, source: name });
      });
    });

    this._renderParamRows();
    this._updatePreview();
  }

  /**
   * Return a serialised (id-free) snapshot of default + custom params only.
   * Used by ProfilesController when saving a profile snapshot.
   * @returns {{ enabled: boolean, key: string, value: string }[]}
   */
  getParams() {
    return this._params
      .filter(p => p.source === 'default' || p.source === 'custom')
      .map(({ enabled, key, value }) => ({ enabled, key, value }));
  }

  /** @returns {string|null} */
  getEnabledProfile() {
    return this._enabledProfile;
  }

  /**
   * Reload profile params from storage without resetting the rest of the
   * inspector state (path, custom params, enabled profile).
   * Called after any profile create/edit/delete in ProfilesController.
   */
  async refreshProfiles() {
    this._params = this._params.filter(
      p => p.source === 'default' || p.source === 'custom'
    );

    const profiles = await this._storage.readProfiles();
    Object.entries(profiles).forEach(([name, { params }]) => {
      params.forEach(({ enabled, key, value }) => {
        this._params.push({ id: this._nextId++, enabled, key, value, source: name });
      });
    });

    // Clear active profile if it was deleted or renamed.
    if (this._enabledProfile && !profiles[this._enabledProfile]) {
      this._enabledProfile = null;
      this._storage.saveEnabledProfile(null);
      if (this._onProfileEnable) this._onProfileEnable(null);
    }

    this._renderParamRows();
    this._updatePreview();
  }

  /**
   * Enable a profile by name (radio behaviour — disables all others).
   * Re-renders, updates the preview, saves state, and navigates the tab.
   * Called by ProfilesController when the user clicks Apply.
   * @param {string} name
   */
  enableProfile(name) {
    this._enabledProfile = name;
    this._storage.saveEnabledProfile(name);
    if (this._onProfileEnable) this._onProfileEnable(name);
    this._renderParamRows();
    this._updatePreview();

    const url = this._buildUrl();
    if (!url) return;
    chrome.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
      if (!tab?.id) return;
      if (this._onApply) await this._onApply(tab.id, url);
      chrome.tabs.update(tab.id, { url });
    });
  }

  // ── Param rows ───────────────────────────────────────────────────────────────

  _renderParamRows() {
    this._paramsList.querySelectorAll('.param-row, .params-source-header, .profile-group, .custom-group').forEach(el => el.remove());

    const totalCount = this._params.length;
    this._paramsEmpty.style.display = totalCount === 0 ? 'block' : 'none';

    // 1. URL params — no header
    this._params
      .filter(p => p.source === 'default')
      .forEach(p => this._paramsList.appendChild(this._buildParamRow(p)));

    // 2. Profile params — each profile wrapped in .profile-group; only the enabled one is active
    const groups = new Map();
    this._params
      .filter(p => p.source !== 'default' && p.source !== 'custom')
      .forEach(p => {
        if (!groups.has(p.source)) groups.set(p.source, []);
        groups.get(p.source).push(p);
      });

    groups.forEach((groupParams, profileName) => {
      const isActive = profileName === this._enabledProfile;
      const wrapper  = document.createElement('div');
      wrapper.className = 'profile-group' + (isActive ? '' : ' inactive');
      wrapper.appendChild(this._buildGroupHeader(profileName, profileName, groupParams, 'profile'));
      groupParams.forEach(p => wrapper.appendChild(this._buildParamRow(p)));
      this._paramsList.appendChild(wrapper);
    });

    // 3. Manually added params — wrapped in .custom-group with "Save as Profile" action
    const customParams = this._params.filter(p => p.source === 'custom');
    if (customParams.length > 0) {
      const customWrapper = document.createElement('div');
      customWrapper.className = 'custom-group';

      const header = this._buildGroupHeader('Custom Params', 'custom', customParams, 'custom');

      // "Save as Profile" toggle button appended to the header
      const saveToggleBtn       = document.createElement('button');
      saveToggleBtn.className   = 'btn-save-profile';
      saveToggleBtn.textContent = 'Save as Profile';

      // Inline save form (hidden by default)
      const saveRow       = document.createElement('div');
      saveRow.className   = 'save-to-profile-row hidden';
      const nameInput     = document.createElement('input');
      nameInput.type      = 'text';
      nameInput.className = 'input-editable';
      nameInput.placeholder = 'Profile name…';
      nameInput.spellcheck  = false;
      const confirmBtn       = document.createElement('button');
      confirmBtn.className   = 'btn btn-xs btn-primary';
      confirmBtn.textContent = 'Save';
      const cancelSaveBtn       = document.createElement('button');
      cancelSaveBtn.className   = 'btn btn-xs btn-ghost';
      cancelSaveBtn.textContent = '✕';
      saveRow.append(nameInput, confirmBtn, cancelSaveBtn);

      const showSaveRow = () => { saveRow.classList.remove('hidden'); nameInput.focus(); };
      const hideSaveRow = () => { saveRow.classList.add('hidden'); nameInput.value = ''; };

      saveToggleBtn.addEventListener('click', () => {
        saveRow.classList.contains('hidden') ? showSaveRow() : hideSaveRow();
      });

      confirmBtn.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        if (this._onSaveToProfile) {
          await this._onSaveToProfile(
            name,
            customParams.map(({ enabled, key, value }) => ({ enabled, key, value }))
          );
        }
        hideSaveRow();
      });

      cancelSaveBtn.addEventListener('click', hideSaveRow);

      nameInput.addEventListener('keydown', e => {
        if (e.key === 'Enter') confirmBtn.click();
        if (e.key === 'Escape') hideSaveRow();
      });

      header.appendChild(saveToggleBtn);
      customWrapper.append(header, saveRow);
      customParams.forEach(p => customWrapper.appendChild(this._buildParamRow(p)));
      this._paramsList.appendChild(customWrapper);
    }
  }

  /**
   * @param {string} displayName  Label shown in the header
   * @param {string} sourceKey    Value of param.source to filter on remove
   * @param {Array}  groupParams  The params in this group
   * @param {'custom'|'profile'} type  Controls colour variant and toggle behaviour
   */
  _buildGroupHeader(displayName, sourceKey, groupParams, type) {
    const isProfile  = type === 'profile';
    const isEnabled  = isProfile
      ? this._enabledProfile === sourceKey
      : groupParams.every(p => p.enabled);

    const header = document.createElement('div');
    header.className = `params-source-header source-${type}`;

    const nameEl       = document.createElement('span');
    nameEl.className   = 'params-source-name';
    nameEl.textContent = displayName;

    const line = document.createElement('span');
    line.className = 'params-source-line';

    // Toggle: radio-style for profiles, toggle-all for custom
    const toggleLabel     = document.createElement('label');
    toggleLabel.className = 'toggle';
    toggleLabel.title     = isEnabled
      ? (isProfile ? 'Disable profile' : 'Disable all')
      : (isProfile ? 'Enable profile'  : 'Enable all');
    const toggleCheckbox  = document.createElement('input');
    toggleCheckbox.type    = 'checkbox';
    toggleCheckbox.checked = isEnabled;

    if (isProfile) {
      toggleCheckbox.addEventListener('change', () => {
        this._enabledProfile = toggleCheckbox.checked ? sourceKey : null;
        this._storage.saveEnabledProfile(this._enabledProfile);
        if (this._onProfileEnable) this._onProfileEnable(this._enabledProfile);
        this._renderParamRows();
        this._updatePreview();
      });
    } else {
      toggleCheckbox.addEventListener('change', () => {
        groupParams.forEach(p => { p.enabled = toggleCheckbox.checked; });
        this._renderParamRows();
        this._updatePreview();
      });
    }

    const toggleTrack     = document.createElement('span');
    toggleTrack.className = 'toggle-track';
    toggleLabel.append(toggleCheckbox, toggleTrack);

    if (isProfile) {
      // Profiles are managed in the Profiles tab — no remove button here
      header.append(nameEl, line, toggleLabel);
    } else {
      // Custom group can be removed from the inspector
      const removeBtn       = document.createElement('button');
      removeBtn.className   = 'btn-delete';
      removeBtn.title       = `Remove "${displayName}"`;
      removeBtn.textContent = '×';
      removeBtn.addEventListener('click', () => {
        this._params = this._params.filter(p => p.source !== sourceKey);
        this._renderParamRows();
        this._updatePreview();
      });
      header.append(nameEl, line, toggleLabel, removeBtn);
    }

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
    const enabled = this._params.filter(p => {
      if (!p.enabled || p.key.trim() === '') return false;
      if (p.source === 'default' || p.source === 'custom') return true;
      // Profile params only contribute if this profile is currently active
      return p.source === this._enabledProfile;
    });
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

  // ── Event wiring ─────────────────────────────────────────────────────────────

  _bindEvents() {
    this._pathInput.addEventListener('input', () => {
      this._updatePreview();
    });

    this._addParamBtn.addEventListener('click', () => {
      const param = { id: this._nextId++, enabled: true, key: '', value: '', source: 'custom' };
      this._params.push(param);
      this._renderParamRows();
      this._paramsList.querySelector(`[data-id="${param.id}"]`)?.querySelector('.param-key')?.focus();
      this._updatePreview();
    });

    this._applyBtn.addEventListener('click', async () => {
      const url = this._buildUrl();
      if (!url) return;
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab?.id) return;
      if (this._onApply) await this._onApply(tab.id, url);
      await chrome.tabs.update(tab.id, { url });
      window.close();
    });

    this._resetBtn.addEventListener('click', async () => {
      if (this._onReset) await this._onReset();
      this.init();
    });

    // Sub-tab switching
    document.querySelectorAll('.subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.subtab').forEach(t => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        document.querySelectorAll('.subtab-panel').forEach(p => p.classList.add('hidden'));
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        document.getElementById(`subtab-${btn.dataset.subtab}`).classList.remove('hidden');
      });
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
