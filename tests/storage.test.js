import { describe, it, expect, beforeEach } from 'vitest';
import { StorageService } from '../storage.js';

const PROFILES_KEY       = 'ri_profiles';
const ENABLED_PROFILE_KEY = 'ri_enabled_profile';

describe('StorageService', () => {
  let storage;

  beforeEach(() => {
    storage = new StorageService();
  });

  // ── loadEnabledProfile ──────────────────────────────────────────────────────

  describe('loadEnabledProfile', () => {
    it('returns null when no profile has been persisted', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({});
      expect(await storage.loadEnabledProfile()).toBeNull();
    });

    it('returns the stored profile name', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ [ENABLED_PROFILE_KEY]: 'My Profile' });
      expect(await storage.loadEnabledProfile()).toBe('My Profile');
    });

    it('reads from the correct storage key', async () => {
      await storage.loadEnabledProfile();
      expect(chrome.storage.local.get).toHaveBeenCalledWith(ENABLED_PROFILE_KEY);
    });
  });

  // ── saveEnabledProfile ──────────────────────────────────────────────────────

  describe('saveEnabledProfile', () => {
    it('stores the profile name under the correct key', () => {
      storage.saveEnabledProfile('Production');
      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [ENABLED_PROFILE_KEY]: 'Production',
      });
    });

    it('removes the key when passed null', () => {
      storage.saveEnabledProfile(null);
      expect(chrome.storage.local.remove).toHaveBeenCalledWith(ENABLED_PROFILE_KEY);
      expect(chrome.storage.local.set).not.toHaveBeenCalled();
    });
  });

  // ── readProfiles ────────────────────────────────────────────────────────────

  describe('readProfiles', () => {
    it('returns an empty object when no profiles are stored', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({});
      expect(await storage.readProfiles()).toEqual({});
    });

    it('returns all stored profiles', async () => {
      const profiles = {
        Dev:  { params: [{ enabled: true, key: 'debug', value: '1' }], headers: [] },
        Prod: { params: [], headers: [] },
      };
      chrome.storage.local.get.mockResolvedValueOnce({ [PROFILES_KEY]: profiles });
      expect(await storage.readProfiles()).toEqual(profiles);
    });

    it('reads from the correct storage key', async () => {
      await storage.readProfiles();
      expect(chrome.storage.local.get).toHaveBeenCalledWith(PROFILES_KEY);
    });
  });

  // ── saveProfile ─────────────────────────────────────────────────────────────

  describe('saveProfile', () => {
    it('saves a new profile with params and an empty headers default', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({});
      const params = [{ enabled: true, key: 'env', value: 'staging' }];

      await storage.saveProfile('Staging', params);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [PROFILES_KEY]: { Staging: { params, headers: [] } },
      });
    });

    it('saves a profile with explicit headers', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({});
      const headers = [{ enabled: true, key: 'Authorization', value: 'Bearer tok' }];

      await storage.saveProfile('Auth', [], headers);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [PROFILES_KEY]: { Auth: { params: [], headers } },
      });
    });

    it('merges with existing profiles without clobbering them', async () => {
      const existing = { Existing: { params: [], headers: [] } };
      chrome.storage.local.get.mockResolvedValueOnce({ [PROFILES_KEY]: existing });

      await storage.saveProfile('New', []);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [PROFILES_KEY]: {
          Existing: { params: [], headers: [] },
          New:      { params: [], headers: [] },
        },
      });
    });

    it('overwrites an existing profile of the same name', async () => {
      const existing = { Alpha: { params: [{ enabled: true, key: 'old', value: 'v' }], headers: [] } };
      chrome.storage.local.get.mockResolvedValueOnce({ [PROFILES_KEY]: existing });
      const updated = [{ enabled: true, key: 'new', value: 'v2' }];

      await storage.saveProfile('Alpha', updated);

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [PROFILES_KEY]: { Alpha: { params: updated, headers: [] } },
      });
    });
  });

  // ── deleteProfile ───────────────────────────────────────────────────────────

  describe('deleteProfile', () => {
    it('removes the named profile while keeping others', async () => {
      const profiles = {
        Keep:   { params: [], headers: [] },
        Remove: { params: [], headers: [] },
      };
      chrome.storage.local.get.mockResolvedValueOnce({ [PROFILES_KEY]: profiles });

      await storage.deleteProfile('Remove');

      expect(chrome.storage.local.set).toHaveBeenCalledWith({
        [PROFILES_KEY]: { Keep: { params: [], headers: [] } },
      });
    });

    it('is a no-op when the profile does not exist', async () => {
      chrome.storage.local.get.mockResolvedValueOnce({ [PROFILES_KEY]: {} });
      await expect(storage.deleteProfile('ghost')).resolves.toBeUndefined();
      expect(chrome.storage.local.set).toHaveBeenCalledWith({ [PROFILES_KEY]: {} });
    });
  });
});
