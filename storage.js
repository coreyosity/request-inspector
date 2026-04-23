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

const PROFILES_KEY        = 'ri_profiles';
const ENABLED_PROFILE_KEY = 'ri_enabled_profile';
const SETTINGS_KEY        = 'ri_settings';

export class StorageService {

  // ── Active profile ────────────────────────────────────────────────────────────

  /** @returns {Promise<string|null>} */
  async loadEnabledProfile() {
    const result = await chrome.storage.local.get(ENABLED_PROFILE_KEY);
    return result[ENABLED_PROFILE_KEY] ?? null;
  }

  /** @param {string|null} name */
  saveEnabledProfile(name) {
    if (name === null) {
      chrome.storage.local.remove(ENABLED_PROFILE_KEY);
    } else {
      chrome.storage.local.set({ [ENABLED_PROFILE_KEY]: name });
    }
  }

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

  // ── Settings ──────────────────────────────────────────────────────────────────

  /** @returns {Promise<{ sidePanelEnabled: boolean }>} */
  async loadSettings() {
    const result = await chrome.storage.local.get(SETTINGS_KEY);
    return result[SETTINGS_KEY] ?? { sidePanelEnabled: false };
  }

  /** @param {{ sidePanelEnabled: boolean }} settings */
  saveSettings(settings) {
    chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  }
}
