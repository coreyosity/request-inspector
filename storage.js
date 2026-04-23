/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * storage.js — StorageService
 * All chrome.storage.local I/O in one place. No DOM dependencies.
 */

'use strict';

const PROFILES_KEY = 'ri_profiles';

export class StorageService {
  /** @param {string} [key] origin+pathname of the current page */
  constructor(key = '') {
    this._key = key;
  }

  /** Update the draft key when the active page is known. */
  setKey(key) {
    this._key = key;
  }

  // ── Draft state ─────────────────────────────────────────────────────────────

  /**
   * Persist the current working state for this page.
   * @param {string} path
   * @param {{ enabled: boolean, key: string, value: string }[]} params
   */
  saveState(path, params) {
    if (!this._key) return;
    chrome.storage.local.set({
      [this._key]: { path, params },
    });
  }

  /**
   * @returns {Promise<{ path: string, params: Array } | null>}
   */
  async loadState() {
    if (!this._key) return null;
    const result = await chrome.storage.local.get(this._key);
    return result[this._key] ?? null;
  }

  clearState() {
    if (!this._key) return;
    chrome.storage.local.remove(this._key);
  }

  // ── Profiles ─────────────────────────────────────────────────────────────────

  /** @returns {Promise<Record<string, { params: Array }>>} */
  async readProfiles() {
    const result = await chrome.storage.local.get(PROFILES_KEY);
    return result[PROFILES_KEY] ?? {};
  }

  /**
   * @param {string} name
   * @param {{ enabled: boolean, key: string, value: string }[]} params
   */
  async saveProfile(name, params) {
    const profiles = await this.readProfiles();
    profiles[name] = { params };
    chrome.storage.local.set({ [PROFILES_KEY]: profiles });
  }

  /** @param {string} name */
  async deleteProfile(name) {
    const profiles = await this.readProfiles();
    delete profiles[name];
    chrome.storage.local.set({ [PROFILES_KEY]: profiles });
  }

  // ── Headers ──────────────────────────────────────────────────────────────────

  /** @param {{ enabled: boolean, key: string, value: string }[]} headers */
  saveHeaders(headers) {
    if (!this._key) return;
    chrome.storage.local.set({ [`${this._key}__h`]: headers });
  }

  /** @returns {Promise<{ enabled: boolean, key: string, value: string }[] | null>} */
  async loadHeaders() {
    if (!this._key) return null;
    const result = await chrome.storage.local.get(`${this._key}__h`);
    return result[`${this._key}__h`] ?? null;
  }
}
