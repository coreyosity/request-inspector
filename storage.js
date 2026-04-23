/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * storage.js — StorageService
 * All chrome.storage.local I/O in one place. No DOM dependencies.
 * Only profiles are persisted; per-page request state is intentionally ephemeral.
 */

'use strict';

const PROFILES_KEY = 'ri_profiles';

export class StorageService {

  // ── Profiles ─────────────────────────────────────────────────────────────────

  /** @returns {Promise<Record<string, { params: Array, headers: Array }>>} */
  async readProfiles() {
    const result = await chrome.storage.local.get(PROFILES_KEY);
    return result[PROFILES_KEY] ?? {};
  }

  /**
   * @param {string} name
   * @param {{ enabled: boolean, key: string, value: string }[]} params
   * @param {{ enabled: boolean, key: string, value: string }[]} [headers]
   */
  async saveProfile(name, params, headers = []) {
    const profiles = await this.readProfiles();
    profiles[name] = { params, headers };
    chrome.storage.local.set({ [PROFILES_KEY]: profiles });
  }

  /** @param {string} name */
  async deleteProfile(name) {
    const profiles = await this.readProfiles();
    delete profiles[name];
    chrome.storage.local.set({ [PROFILES_KEY]: profiles });
  }
}
