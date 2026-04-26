import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectorController } from '../inspector.js';
import { StorageService } from '../storage.js';

// Minimal DOM required by InspectorController's constructor.
function setupDOM() {
  document.body.innerHTML = `
    <input id="origin-display" />
    <input id="path-input" />
    <div id="params-list"></div>
    <div id="params-empty"></div>
    <div id="url-preview"></div>
    <button id="add-param-btn"></button>
    <button id="apply-btn"></button>
    <button id="reset-btn"></button>
  `;
}

function makeStorage(overrides = {}) {
  return {
    readProfiles:       vi.fn().mockResolvedValue({}),
    loadEnabledProfile: vi.fn().mockResolvedValue(null),
    saveEnabledProfile: vi.fn(),
    saveProfile:        vi.fn().mockResolvedValue(undefined),
    deleteProfile:      vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeController(storageOverrides = {}, callbacks = {}) {
  const storage = makeStorage(storageOverrides);
  const ctrl    = new InspectorController(storage, callbacks);
  return { ctrl, storage };
}

describe('InspectorController', () => {
  beforeEach(() => {
    setupDOM();
  });

  // ── getEnabledProfile ───────────────────────────────────────────────────────

  describe('getEnabledProfile', () => {
    it('returns null before init', () => {
      const { ctrl } = makeController();
      expect(ctrl.getEnabledProfile()).toBeNull();
    });

    it('returns null when stored profile no longer exists in profiles', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const { ctrl } = makeController({
        loadEnabledProfile: vi.fn().mockResolvedValue('Gone'),
        readProfiles:       vi.fn().mockResolvedValue({}),
      });

      await ctrl.init();
      expect(ctrl.getEnabledProfile()).toBeNull();
    });

    it('returns the profile name when the stored profile still exists', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const { ctrl } = makeController({
        loadEnabledProfile: vi.fn().mockResolvedValue('Dev'),
        readProfiles:       vi.fn().mockResolvedValue({ Dev: { params: [], headers: [] } }),
      });

      await ctrl.init();
      expect(ctrl.getEnabledProfile()).toBe('Dev');
    });
  });

  // ── init ────────────────────────────────────────────────────────────────────

  describe('init', () => {
    it('parses origin and path from the active tab URL', async () => {
      chrome.tabs.query.mockResolvedValueOnce([
        { id: 1, url: 'https://api.example.com/v2/items?page=1' },
      ]);
      const { ctrl } = makeController();
      await ctrl.init();

      expect(document.getElementById('origin-display').value).toBe('https://api.example.com');
      expect(document.getElementById('path-input').value).toBe('/v2/items');
    });

    it('loads query params from the URL into the default params list', async () => {
      chrome.tabs.query.mockResolvedValueOnce([
        { id: 1, url: 'https://example.com/?foo=1&bar=2' },
      ]);
      const { ctrl } = makeController();
      await ctrl.init();

      const params = ctrl.getParams();
      expect(params).toEqual([
        { enabled: true, key: 'foo', value: '1' },
        { enabled: true, key: 'bar', value: '2' },
      ]);
    });

    it('excludes active-profile param keys from the default params to avoid duplication', async () => {
      chrome.tabs.query.mockResolvedValueOnce([
        { id: 1, url: 'https://example.com/?shared=x&other=y' },
      ]);
      const { ctrl } = makeController({
        loadEnabledProfile: vi.fn().mockResolvedValue('Dev'),
        readProfiles: vi.fn().mockResolvedValue({
          Dev: { params: [{ enabled: true, key: 'shared', value: 'override' }], headers: [] },
        }),
      });

      await ctrl.init();

      // 'shared' comes from the profile group, not default
      const defaultParams = ctrl.getParams();
      expect(defaultParams.map(p => p.key)).not.toContain('shared');
      expect(defaultParams.map(p => p.key)).toContain('other');
    });

    it('shows an error preview when the tab has no URL', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1 }]);
      const { ctrl } = makeController();
      await ctrl.init();

      const preview = document.getElementById('url-preview');
      expect(preview.classList.contains('error')).toBe(true);
    });

    it('clears a stale enabled-profile key when the profile was deleted', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const saveEnabledProfile = vi.fn();
      const { ctrl } = makeController({
        loadEnabledProfile: vi.fn().mockResolvedValue('Deleted'),
        readProfiles:       vi.fn().mockResolvedValue({}),
        saveEnabledProfile,
      });

      await ctrl.init();
      expect(saveEnabledProfile).toHaveBeenCalledWith(null);
    });
  });

  // ── getParams ───────────────────────────────────────────────────────────────

  describe('getParams', () => {
    it('returns only default and custom params, not profile params', async () => {
      chrome.tabs.query.mockResolvedValueOnce([
        { id: 1, url: 'https://example.com/?url_param=1' },
      ]);
      const { ctrl } = makeController({
        readProfiles: vi.fn().mockResolvedValue({
          MyProfile: { params: [{ enabled: true, key: 'profile_param', value: '2' }], headers: [] },
        }),
      });

      await ctrl.init();
      const params = ctrl.getParams();

      expect(params.map(p => p.key)).toContain('url_param');
      expect(params.map(p => p.key)).not.toContain('profile_param');
    });

    it('returns custom params added after init', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const { ctrl } = makeController();
      await ctrl.init();

      // Simulate clicking "+ Add Param"
      document.getElementById('add-param-btn').click();
      const params = ctrl.getParams();
      expect(params.length).toBe(1);
      expect(params[0]).toMatchObject({ enabled: true, key: '', value: '' });
    });
  });

  // ── _buildUrl ───────────────────────────────────────────────────────────────

  describe('_buildUrl', () => {
    function setupCtrl(originUrl, path, params, enabledProfile = null) {
      const { ctrl } = makeController();
      ctrl._originUrl = originUrl;
      ctrl._pathInput.value = path;
      ctrl._params = params;
      ctrl._enabledProfile = enabledProfile;
      return ctrl;
    }

    it('builds a basic URL with origin, path, and query params', () => {
      const ctrl = setupCtrl('https://example.com', '/search', [
        { id: 0, enabled: true, key: 'q', value: 'hello', source: 'default' },
        { id: 1, enabled: true, key: 'lang', value: 'en',    source: 'default' },
      ]);
      expect(ctrl._buildUrl()).toBe('https://example.com/search?q=hello&lang=en');
    });

    it('omits disabled params', () => {
      const ctrl = setupCtrl('https://example.com', '/', [
        { id: 0, enabled: true,  key: 'a', value: '1', source: 'default' },
        { id: 1, enabled: false, key: 'b', value: '2', source: 'default' },
      ]);
      expect(ctrl._buildUrl()).toBe('https://example.com/?a=1');
    });

    it('omits params whose key is blank or whitespace-only', () => {
      const ctrl = setupCtrl('https://example.com', '/', [
        { id: 0, enabled: true, key: '',    value: 'x', source: 'default' },
        { id: 1, enabled: true, key: '   ', value: 'y', source: 'default' },
        { id: 2, enabled: true, key: 'ok',  value: 'z', source: 'default' },
      ]);
      expect(ctrl._buildUrl()).toBe('https://example.com/?ok=z');
    });

    it('omits profile params when no profile is active', () => {
      const ctrl = setupCtrl('https://example.com', '/', [
        { id: 0, enabled: true, key: 'manual', value: '1', source: 'default' },
        { id: 1, enabled: true, key: 'secret', value: '2', source: 'Dev' },
      ], null);
      expect(ctrl._buildUrl()).toBe('https://example.com/?manual=1');
    });

    it('includes profile params only from the active profile', () => {
      const ctrl = setupCtrl('https://example.com', '/', [
        { id: 0, enabled: true, key: 'a', value: '1', source: 'Dev' },
        { id: 1, enabled: true, key: 'b', value: '2', source: 'Prod' },
      ], 'Dev');
      const url = ctrl._buildUrl();
      expect(url).toContain('a=1');
      expect(url).not.toContain('b=2');
    });

    it('URL-encodes special characters in keys and values', () => {
      const ctrl = setupCtrl('https://example.com', '/', [
        { id: 0, enabled: true, key: 'q', value: 'hello world', source: 'default' },
        { id: 1, enabled: true, key: 'r', value: 'a&b=c',       source: 'default' },
      ]);
      const url = ctrl._buildUrl();
      expect(url).toContain('q=hello%20world');
      expect(url).toContain('r=a%26b%3Dc');
    });

    it('omits the query string entirely when all params are disabled', () => {
      const ctrl = setupCtrl('https://example.com', '/page', [
        { id: 0, enabled: false, key: 'x', value: '1', source: 'default' },
      ]);
      expect(ctrl._buildUrl()).toBe('https://example.com/page');
    });

    it('uses / as the path when the path input is empty', () => {
      const ctrl = setupCtrl('https://example.com', '', []);
      expect(ctrl._buildUrl()).toBe('https://example.com/');
    });

    it('returns null when the origin URL is invalid', () => {
      const ctrl = setupCtrl('not-a-url', '/', []);
      expect(ctrl._buildUrl()).toBeNull();
    });

    it('emits a value-less param when value is empty string', () => {
      const ctrl = setupCtrl('https://example.com', '/', [
        { id: 0, enabled: true, key: 'flag', value: '', source: 'default' },
      ]);
      expect(ctrl._buildUrl()).toBe('https://example.com/?flag');
    });
  });

  // ── enableProfile ───────────────────────────────────────────────────────────

  describe('enableProfile', () => {
    it('persists the newly enabled profile name', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com/' }]);
      const saveEnabledProfile = vi.fn();
      const { ctrl } = makeController(
        { saveEnabledProfile, readProfiles: vi.fn().mockResolvedValue({}) },
      );
      await ctrl.init();

      ctrl.enableProfile('Prod');
      expect(saveEnabledProfile).toHaveBeenCalledWith('Prod');
      expect(ctrl.getEnabledProfile()).toBe('Prod');
    });

    it('fires the onProfileEnable callback with the profile name', async () => {
      chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com/' }]);
      const onProfileEnable = vi.fn();
      const { ctrl } = makeController(
        { readProfiles: vi.fn().mockResolvedValue({}) },
        { onProfileEnable },
      );
      await ctrl.init();

      ctrl.enableProfile('Staging');
      expect(onProfileEnable).toHaveBeenCalledWith('Staging');
    });
  });

  // ── refreshProfiles ─────────────────────────────────────────────────────────

  describe('refreshProfiles', () => {
    it('removes stale profile params and reloads from storage', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const readProfiles = vi.fn()
        .mockResolvedValueOnce({ Old: { params: [{ enabled: true, key: 'x', value: '1' }], headers: [] } })
        .mockResolvedValueOnce({ New: { params: [{ enabled: true, key: 'y', value: '2' }], headers: [] } });

      const { ctrl } = makeController({ readProfiles });
      await ctrl.init();

      // After refresh, Old profile params should be gone and New should appear
      await ctrl.refreshProfiles();

      const sources = ctrl._params.map(p => p.source);
      expect(sources).not.toContain('Old');
      expect(sources).toContain('New');
    });

    it('clears the active profile and notifies if it was deleted', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const onProfileEnable = vi.fn();
      const saveEnabledProfile = vi.fn();
      const readProfiles = vi.fn()
        .mockResolvedValueOnce({ Dev: { params: [], headers: [] } })
        .mockResolvedValueOnce({});

      const { ctrl } = makeController(
        { readProfiles, saveEnabledProfile,
          loadEnabledProfile: vi.fn().mockResolvedValue('Dev') },
        { onProfileEnable },
      );
      await ctrl.init();

      // Simulate the profile being deleted externally
      await ctrl.refreshProfiles();

      expect(ctrl.getEnabledProfile()).toBeNull();
      expect(saveEnabledProfile).toHaveBeenCalledWith(null);
      expect(onProfileEnable).toHaveBeenCalledWith(null);
    });
  });
});
