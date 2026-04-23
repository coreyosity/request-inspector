/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * headers.js — HeadersController
 * Manages the Headers sub-tab: a list of request headers the user wants to
 * inject. Persists state to chrome.storage.local (via StorageService) and
 * applies rules via chrome.declarativeNetRequest.updateDynamicRules.
 */

'use strict';

export class HeadersController {
  /** @param {import('./storage.js').StorageService} storage */
  constructor(storage) {
    this._storage = storage;

    /** @type {{ id: number, enabled: boolean, key: string, value: string }[]} */
    this._headers = [];
    this._nextId  = 0;

    // DOM refs
    this._headersList  = document.getElementById('headers-list');
    this._headersEmpty = document.getElementById('headers-empty');
    this._addHeaderBtn = document.getElementById('add-header-btn');

    this._bindEvents();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  async init() {
    this._headers = [];
    this._nextId  = 0;
    const saved = await this._storage.loadHeaders();
    if (saved) {
      saved.forEach(({ enabled, key, value }) => {
        this._headers.push({ id: this._nextId++, enabled, key, value });
      });
    }
    this._renderRows();
  }

  /**
   * Register dynamic declarativeNetRequest rules for all enabled headers,
   * scoped to the current page's hostname.
   * @param {string} originUrl  The full origin URL of the active tab.
   */
  async applyHeaders(originUrl) {
    try {
      const existing   = await chrome.declarativeNetRequest.getDynamicRules();
      const removeIds  = existing.map(r => r.id);
      const enabled    = this._headers.filter(h => h.enabled && h.key.trim() !== '');

      if (enabled.length === 0) {
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
          requestHeaders: enabled.map(h => ({
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
    this._headersList.querySelectorAll('.param-row').forEach(el => el.remove());
    this._headersEmpty.style.display = this._headers.length === 0 ? 'block' : 'none';
    this._headers.forEach(h => this._headersList.appendChild(this._buildRow(h)));
  }

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
      this._saveHeaders();
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
      this._saveHeaders();
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
      this._saveHeaders();
    });

    // Delete
    const deleteBtn       = document.createElement('button');
    deleteBtn.className   = 'btn-delete';
    deleteBtn.title       = 'Remove header';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', () => {
      this._headers = this._headers.filter(h => h.id !== header.id);
      row.remove();
      this._headersEmpty.style.display = this._headers.length === 0 ? 'block' : 'none';
      this._saveHeaders();
    });

    row.append(toggleWrapper, keyInput, valueInput, deleteBtn);
    return row;
  }

  // ── Storage ──────────────────────────────────────────────────────────────────

  _saveHeaders() {
    this._storage.saveHeaders(
      this._headers.map(({ enabled, key, value }) => ({ enabled, key, value }))
    );
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────

  _bindEvents() {
    this._addHeaderBtn.addEventListener('click', () => {
      const header = { id: this._nextId++, enabled: true, key: '', value: '' };
      this._headers.push(header);
      this._headersEmpty.style.display = 'none';
      const row = this._buildRow(header);
      this._headersList.appendChild(row);
      row.querySelector('.param-key').focus();
      this._saveHeaders();
    });
  }
}
