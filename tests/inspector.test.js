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

  // ── onSaveToProfile ─────────────────────────────────────────────────────────

  describe('onSaveToProfile', () => {
    async function setupWithCustomParam(callbacks = {}, storageOverrides = {}) {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/?default=1' }]);
      const { ctrl } = makeController(
        { readProfiles: vi.fn().mockResolvedValue({}), ...storageOverrides },
        callbacks,
      );
      await ctrl.init();
      document.getElementById('add-param-btn').click();
      // Fill in key/value on the new custom param row
      const row      = document.querySelector('.param-row.source-custom');
      const keyInput = row.querySelector('.param-key');
      const valInput = row.querySelector('.param-value');
      keyInput.value = 'myKey';
      keyInput.dispatchEvent(new Event('input'));
      valInput.value = 'myVal';
      valInput.dispatchEvent(new Event('input'));
      return ctrl;
    }

    it('invokes the callback with the profile name and serialised custom params', async () => {
      const onSaveToProfile = vi.fn().mockResolvedValue(undefined);
      await setupWithCustomParam({ onSaveToProfile });

      const nameInput  = document.querySelector('.save-to-profile-row input');
      const confirmBtn = document.querySelector('.save-to-profile-row .btn-primary');
      nameInput.value  = 'MyProfile';
      confirmBtn.click();

      expect(onSaveToProfile).toHaveBeenCalledOnce();
      expect(onSaveToProfile).toHaveBeenCalledWith('MyProfile', [
        { enabled: true, key: 'myKey', value: 'myVal' },
      ]);
    });

    it('does not include default params in the save payload', async () => {
      const onSaveToProfile = vi.fn().mockResolvedValue(undefined);
      await setupWithCustomParam({ onSaveToProfile });

      const nameInput  = document.querySelector('.save-to-profile-row input');
      const confirmBtn = document.querySelector('.save-to-profile-row .btn-primary');
      nameInput.value  = 'Test';
      confirmBtn.click();

      const [, params] = onSaveToProfile.mock.calls[0];
      expect(params.every(p => p.key !== 'default')).toBe(true);
    });

    it('does not include profile params in the save payload', async () => {
      const onSaveToProfile = vi.fn().mockResolvedValue(undefined);
      await setupWithCustomParam({ onSaveToProfile }, {
        readProfiles: vi.fn().mockResolvedValue({
          Dev: { params: [{ enabled: true, key: 'envKey', value: 'dev' }], headers: [] },
        }),
      });

      const nameInput  = document.querySelector('.save-to-profile-row input');
      const confirmBtn = document.querySelector('.save-to-profile-row .btn-primary');
      nameInput.value  = 'Snapshot';
      confirmBtn.click();

      const [, params] = onSaveToProfile.mock.calls[0];
      expect(params.every(p => p.key !== 'envKey')).toBe(true);
    });

    it('does not invoke the callback when the profile name is empty', async () => {
      const onSaveToProfile = vi.fn().mockResolvedValue(undefined);
      await setupWithCustomParam({ onSaveToProfile });

      // Leave nameInput empty
      document.querySelector('.save-to-profile-row .btn-primary').click();

      expect(onSaveToProfile).not.toHaveBeenCalled();
    });

    it('does not throw when onSaveToProfile is not provided', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const { ctrl } = makeController({ readProfiles: vi.fn().mockResolvedValue({}) });
      await ctrl.init();
      document.getElementById('add-param-btn').click();

      const nameInput  = document.querySelector('.save-to-profile-row input');
      const confirmBtn = document.querySelector('.save-to-profile-row .btn-primary');
      nameInput.value  = 'Anything';
      expect(() => confirmBtn.click()).not.toThrow();
    });

    it('hides the save form and clears the name input after a successful save', async () => {
      const onSaveToProfile = vi.fn().mockResolvedValue(undefined);
      await setupWithCustomParam({ onSaveToProfile });

      const nameInput  = document.querySelector('.save-to-profile-row input');
      const confirmBtn = document.querySelector('.save-to-profile-row .btn-primary');
      nameInput.value  = 'Profile';
      confirmBtn.click();
      await Promise.resolve(); // let the async handler's continuation run

      const saveRow = document.querySelector('.save-to-profile-row');
      expect(saveRow.classList.contains('hidden')).toBe(true);
      expect(nameInput.value).toBe('');
    });
  });

  // ── custom params DOM structure ─────────────────────────────────────────────

  describe('custom params DOM structure', () => {
    it('wraps custom params in a .custom-group with a source-custom header', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const { ctrl } = makeController();
      await ctrl.init();

      document.getElementById('add-param-btn').click();

      const customGroup = document.querySelector('.custom-group');
      expect(customGroup).toBeTruthy();
      expect(customGroup.querySelector('.params-source-header.source-custom')).toBeTruthy();
    });

    it('does not render a .custom-group when no custom params exist', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/?foo=1' }]);
      const { ctrl } = makeController();
      await ctrl.init();

      expect(document.querySelector('.custom-group')).toBeNull();
    });

    it('removes the .custom-group wrapper when the last custom param is deleted', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const { ctrl } = makeController();
      await ctrl.init();

      document.getElementById('add-param-btn').click();
      expect(document.querySelector('.custom-group')).toBeTruthy();

      document.querySelector('.param-row.source-custom .btn-delete').click();

      expect(document.querySelector('.custom-group')).toBeNull();
    });

    it('keeps the .custom-group when more than one custom param exists after deletion', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const { ctrl } = makeController();
      await ctrl.init();

      document.getElementById('add-param-btn').click();
      document.getElementById('add-param-btn').click();

      document.querySelector('.param-row.source-custom .btn-delete').click();

      expect(document.querySelector('.custom-group')).toBeTruthy();
    });

    it('save-to-profile-row is hidden by default', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const { ctrl } = makeController();
      await ctrl.init();

      document.getElementById('add-param-btn').click();

      expect(document.querySelector('.save-to-profile-row').classList.contains('hidden')).toBe(true);
    });

    it('save-to-profile-row becomes visible after clicking the Save as Profile button', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const { ctrl } = makeController();
      await ctrl.init();

      document.getElementById('add-param-btn').click();
      document.querySelector('.btn-save-profile').click();

      expect(document.querySelector('.save-to-profile-row').classList.contains('hidden')).toBe(false);
    });

    it('save-to-profile-row hides again when the cancel button is clicked', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const { ctrl } = makeController();
      await ctrl.init();

      document.getElementById('add-param-btn').click();
      document.querySelector('.btn-save-profile').click();
      document.querySelector('.save-to-profile-row .btn-ghost').click();

      expect(document.querySelector('.save-to-profile-row').classList.contains('hidden')).toBe(true);
    });

    it('places .custom-group after .profile-group elements in the DOM', async () => {
      chrome.tabs.query.mockResolvedValueOnce([{ id: 1, url: 'https://example.com/' }]);
      const { ctrl } = makeController({
        readProfiles: vi.fn().mockResolvedValue({
          Dev: { params: [{ enabled: true, key: 'env', value: 'dev' }], headers: [] },
        }),
      });
      await ctrl.init();

      document.getElementById('add-param-btn').click();

      const children   = [...document.getElementById('params-list').children];
      const profileIdx = children.findIndex(el => el.classList.contains('profile-group'));
      const customIdx  = children.findIndex(el => el.classList.contains('custom-group'));

      expect(profileIdx).toBeGreaterThanOrEqual(0);
      expect(customIdx).toBeGreaterThan(profileIdx);
    });
  });
});
