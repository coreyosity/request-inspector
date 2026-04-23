/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * headers.js — HeadersController
 * Manages the Headers sub-tab: manual request headers plus profile headers.
 * Manual headers are persisted via StorageService. Profile headers are always
 * loaded fresh from the profiles store and are read-only in the inspector.
 * The active profile is synced from InspectorController via enableProfile().
 */

'use strict';

export class HeadersController {
  /** @param {import('./storage.js').StorageService} storage */
  constructor(storage) {
    this._storage = storage;

    /** @type {{ id: number, enabled: boolean, key: string, value: string }[]} */
    this._headers = [];
    /** @type {{ id: number, enabled: boolean, key: string, value: string, source: string }[]} */
    this._profileHeaders = [];
    this._nextId         = 0;
    /** @type {string|null} */
    this._enabledProfile = null;

    // DOM refs
    this._headersList  = document.getElementById('headers-list');
    this._headersEmpty = document.getElementById('headers-empty');
    this._addHeaderBtn = document.getElementById('add-header-btn');

    this._bindEvents();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /**
   * Load manual headers from storage and all profile headers fresh.
   * @param {string|null} enabledProfile  The currently active profile (from inspector).
   */
  async init() {
    this._headers        = [];
    this._profileHeaders = [];
    this._nextId         = 0;
    this._enabledProfile = null;

    const profiles = await this._storage.readProfiles();
    Object.entries(profiles).forEach(([name, { headers = [] }]) => {
      headers.forEach(({ enabled, key, value }) => {
        this._profileHeaders.push({ id: this._nextId++, enabled, key, value, source: name });
      });
    });

    this._renderRows();
  }

  /**
   * Returns manual headers only (used when saving a profile snapshot).
   * @returns {{ enabled: boolean, key: string, value: string }[]}
   */
  getHeaders() {
    return this._headers.map(({ enabled, key, value }) => ({ enabled, key, value }));
  }

  /**
   * Update the active profile and re-render.
   * Called by InspectorController whenever _enabledProfile changes.
   * @param {string|null} name
   */
  enableProfile(name) {
    this._enabledProfile = name;
    this._renderRows();
  }

  /**
   * Pre-populate manual headers from a request captured by the side panel.
   * Replaces current manual headers with those from the captured request.
   * @param {Record<string, string>} requestHeaders
   */
  loadFromRequest(requestHeaders) {
    this._headers = [];
    Object.entries(requestHeaders ?? {}).forEach(([key, value]) => {
      this._headers.push({ id: this._nextId++, enabled: true, key, value });
    });
    this._renderRows();
  }

  /**
   * Reload profile headers from storage without resetting manual headers or
   * the active profile. Called after any profile create/edit/delete.
   */
  async refreshProfiles() {
    this._profileHeaders = [];
    const profiles = await this._storage.readProfiles();
    Object.entries(profiles).forEach(([name, { headers = [] }]) => {
      headers.forEach(({ enabled, key, value }) => {
        this._profileHeaders.push({ id: this._nextId++, enabled, key, value, source: name });
      });
    });
    this._renderRows();
  }

  /**
   * Register dynamic declarativeNetRequest rules for all enabled headers
   * (manual + active profile), scoped to the current page's hostname.
   * @param {string} originUrl  The full origin URL of the active tab.
   */
  async applyHeaders(originUrl) {
    try {
      const existing  = await chrome.declarativeNetRequest.getDynamicRules();
      const removeIds = existing.map(r => r.id);

      const manualEnabled  = this._headers.filter(h => h.enabled && h.key.trim() !== '');
      const profileEnabled = this._enabledProfile
        ? this._profileHeaders.filter(h =>
            h.source === this._enabledProfile && h.enabled && h.key.trim() !== '')
        : [];
      const allEnabled = [...manualEnabled, ...profileEnabled];

      if (allEnabled.length === 0) {
        if (removeIds.length) {
          await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds });
        }
        return;
      }

      const hostname = new URL(originUrl).hostname;
      const rule = {
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: allEnabled.map(h => ({
            header:    h.key,
            operation: 'set',
            value:     h.value,
          })),
        },
        condition: { urlFilter: `||${hostname}` },
      };

      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: removeIds,
        addRules: [rule],
      });
    } catch (err) {
      console.warn('Request Inspector: could not apply headers —', err.message);
    }
  }

  /** Remove all dynamic rules registered by this extension. */
  async clearRules() {
    try {
      const existing  = await chrome.declarativeNetRequest.getDynamicRules();
      const removeIds = existing.map(r => r.id);
      if (removeIds.length) {
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: removeIds });
      }
    } catch (err) {
      console.warn('Request Inspector: could not clear header rules —', err.message);
    }
  }

  // ── Row rendering ────────────────────────────────────────────────────────────

  _renderRows() {
    this._headersList
      .querySelectorAll('.param-row, .params-source-header, .profile-group')
      .forEach(el => el.remove());

    const total = this._headers.length + this._profileHeaders.length;
    this._headersEmpty.style.display = total === 0 ? 'block' : 'none';

    // Manual headers
    this._headers.forEach(h => this._headersList.appendChild(this._buildRow(h)));

    // Profile header groups — grouped by profile name, wrapped in .profile-group
    const groups = new Map();
    this._profileHeaders.forEach(h => {
      if (!groups.has(h.source)) groups.set(h.source, []);
      groups.get(h.source).push(h);
    });

    groups.forEach((groupHeaders, profileName) => {
      const isActive = profileName === this._enabledProfile;
      const wrapper  = document.createElement('div');
      wrapper.className = 'profile-group' + (isActive ? '' : ' inactive');

      // Group label — no toggle here; the profile on/off lives in the params tab
      const groupLabel     = document.createElement('div');
      groupLabel.className = 'params-source-header source-profile';
      const nameEl         = document.createElement('span');
      nameEl.className     = 'params-source-name';
      nameEl.textContent   = profileName;
      const line           = document.createElement('span');
      line.className       = 'params-source-line';
      groupLabel.append(nameEl, line);

      wrapper.appendChild(groupLabel);
      groupHeaders.forEach(h => wrapper.appendChild(this._buildProfileHeaderRow(h)));
      this._headersList.appendChild(wrapper);
    });
  }

  /** Editable manual header row. */
  _buildRow(header) {
    const row       = document.createElement('div');
    row.className   = 'param-row' + (header.enabled ? '' : ' disabled');
    row.dataset.id  = header.id;

    // Toggle
    const toggleWrapper     = document.createElement('div');
    toggleWrapper.className = 'toggle-wrapper';
    const label             = document.createElement('label');
    label.className         = 'toggle';
    label.title             = header.enabled ? 'Disable header' : 'Enable header';
    const checkbox          = document.createElement('input');
    checkbox.type           = 'checkbox';
    checkbox.checked        = header.enabled;
    checkbox.addEventListener('change', () => {
      header.enabled = checkbox.checked;
      row.classList.toggle('disabled', !header.enabled);
      label.title = header.enabled ? 'Disable header' : 'Enable header';
    });
    const track     = document.createElement('span');
    track.className = 'toggle-track';
    label.append(checkbox, track);
    toggleWrapper.appendChild(label);

    // Key (header name)
    const keyInput       = document.createElement('input');
    keyInput.type        = 'text';
    keyInput.className   = 'param-key';
    keyInput.value       = header.key;
    keyInput.placeholder = 'header name';
    keyInput.spellcheck  = false;
    keyInput.addEventListener('input', () => {
      header.key = keyInput.value;
    });

    // Value
    const valueInput       = document.createElement('input');
    valueInput.type        = 'text';
    valueInput.className   = 'param-value';
    valueInput.value       = header.value;
    valueInput.placeholder = 'value';
    valueInput.spellcheck  = false;
    valueInput.addEventListener('input', () => {
      header.value = valueInput.value;
    });

    // Delete
    const deleteBtn       = document.createElement('button');
    deleteBtn.className   = 'btn-delete';
    deleteBtn.title       = 'Remove header';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', () => {
      this._headers = this._headers.filter(h => h.id !== header.id);
      row.remove();
      const total = this._headers.length + this._profileHeaders.length;
      this._headersEmpty.style.display = total === 0 ? 'block' : 'none';
    });

    row.append(toggleWrapper, keyInput, valueInput, deleteBtn);
    return row;
  }

  /**
   * Read-only profile header row (toggle is ephemeral — not persisted).
   * Key and value come from the profile definition and are not editable here.
   */
  _buildProfileHeaderRow(header) {
    const row       = document.createElement('div');
    row.className   = 'param-row source-profile' + (header.enabled ? '' : ' disabled');
    row.dataset.id  = header.id;

    // Toggle (ephemeral — not saved back to profile)
    const toggleWrapper     = document.createElement('div');
    toggleWrapper.className = 'toggle-wrapper';
    const label             = document.createElement('label');
    label.className         = 'toggle';
    label.title             = header.enabled ? 'Disable header' : 'Enable header';
    const checkbox          = document.createElement('input');
    checkbox.type           = 'checkbox';
    checkbox.checked        = header.enabled;
    checkbox.addEventListener('change', () => {
      header.enabled = checkbox.checked;
      row.classList.toggle('disabled', !header.enabled);
      label.title = header.enabled ? 'Disable header' : 'Enable header';
    });
    const track     = document.createElement('span');
    track.className = 'toggle-track';
    label.append(checkbox, track);
    toggleWrapper.appendChild(label);

    // Key (read-only — edit via profile editor)
    const keyInput       = document.createElement('input');
    keyInput.type        = 'text';
    keyInput.className   = 'param-key';
    keyInput.value       = header.key;
    keyInput.placeholder = 'header name';
    keyInput.readOnly    = true;

    // Value (read-only)
    const valueInput       = document.createElement('input');
    valueInput.type        = 'text';
    valueInput.className   = 'param-value';
    valueInput.value       = header.value;
    valueInput.placeholder = 'value';
    valueInput.readOnly    = true;

    // Spacer keeps grid columns aligned (no delete on profile headers)
    const spacer = document.createElement('div');

    row.append(toggleWrapper, keyInput, valueInput, spacer);
    return row;
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────

  _bindEvents() {
    this._addHeaderBtn.addEventListener('click', () => {
      const header = { id: this._nextId++, enabled: true, key: '', value: '' };
      this._headers.push(header);
      this._headersEmpty.style.display = 'none';
      const row = this._buildRow(header);
      // Insert before any profile groups so manual headers stay at the top
      const firstGroup = this._headersList.querySelector('.profile-group');
      if (firstGroup) {
        this._headersList.insertBefore(row, firstGroup);
      } else {
        this._headersList.appendChild(row);
      }
      row.querySelector('.param-key').focus();
    });
  }
}
