import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HeadersController } from '../headers.js';

function setupDOM() {
  document.body.innerHTML = `
    <div id="headers-list"></div>
    <div id="headers-empty"></div>
    <button id="add-header-btn"></button>
  `;
}

function makeStorage(overrides = {}) {
  return {
    readProfiles: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeController(storageOverrides = {}) {
  const storage = makeStorage(storageOverrides);
  const ctrl    = new HeadersController(storage);
  return { ctrl, storage };
}

describe('HeadersController', () => {
  beforeEach(() => {
    setupDOM();
  });

  // ── getHeaders ──────────────────────────────────────────────────────────────

  describe('getHeaders', () => {
    it('returns an empty array when no manual headers have been added', () => {
      const { ctrl } = makeController();
      expect(ctrl.getHeaders()).toEqual([]);
    });

    it('returns manual headers after they are added via the button', async () => {
      const { ctrl } = makeController();
      await ctrl.init();

      document.getElementById('add-header-btn').click();
      const headers = ctrl.getHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0]).toEqual({ enabled: true, key: '', value: '' });
    });

    it('excludes profile headers from the returned list', async () => {
      const { ctrl } = makeController({
        readProfiles: vi.fn().mockResolvedValue({
          Dev: { params: [], headers: [{ enabled: true, key: 'X-Token', value: 'abc' }] },
        }),
      });
      await ctrl.init();

      // Profile headers must not bleed into getHeaders()
      expect(ctrl.getHeaders()).toEqual([]);
    });
  });

  // ── init ────────────────────────────────────────────────────────────────────

  describe('init', () => {
    it('loads profile headers from storage', async () => {
      const { ctrl } = makeController({
        readProfiles: vi.fn().mockResolvedValue({
          Dev:  { params: [], headers: [{ enabled: true,  key: 'X-Debug', value: '1'   }] },
          Prod: { params: [], headers: [{ enabled: false, key: 'X-Env',   value: 'prod' }] },
        }),
      });

      await ctrl.init();

      const profileHeaders = ctrl._profileHeaders;
      expect(profileHeaders.map(h => h.key)).toContain('X-Debug');
      expect(profileHeaders.map(h => h.key)).toContain('X-Env');
    });

    it('resets manual headers and profile headers on each call', async () => {
      const { ctrl } = makeController();
      await ctrl.init();
      document.getElementById('add-header-btn').click();

      // Second init should reset
      await ctrl.init();
      expect(ctrl.getHeaders()).toEqual([]);
    });
  });

  // ── enableProfile ───────────────────────────────────────────────────────────

  describe('enableProfile', () => {
    it('updates the active profile used for rendering', async () => {
      const { ctrl } = makeController();
      await ctrl.init();
      ctrl.enableProfile('Staging');
      expect(ctrl._enabledProfile).toBe('Staging');
    });

    it('clears the active profile when passed null', async () => {
      const { ctrl } = makeController();
      await ctrl.init();
      ctrl.enableProfile('Dev');
      ctrl.enableProfile(null);
      expect(ctrl._enabledProfile).toBeNull();
    });
  });

  // ── applyHeaders ────────────────────────────────────────────────────────────

  describe('applyHeaders', () => {
    async function initWithHeaders(manualHeaders, profiles = {}) {
      const { ctrl } = makeController({ readProfiles: vi.fn().mockResolvedValue(profiles) });
      await ctrl.init();

      // Inject manual headers directly (simulates add-header-btn + user input)
      manualHeaders.forEach(h => {
        ctrl._headers.push({ id: ctrl._nextId++, ...h });
      });

      return ctrl;
    }

    it('registers a single declarativeNetRequest rule for the page hostname', async () => {
      const ctrl = await initWithHeaders([
        { enabled: true, key: 'X-Debug', value: '1' },
      ]);

      await ctrl.applyHeaders('https://api.example.com/v1');

      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith(
        expect.objectContaining({
          addRules: [expect.objectContaining({
            condition: { urlFilter: '||api.example.com' },
            action: expect.objectContaining({
              type: 'modifyHeaders',
              requestHeaders: [{ header: 'X-Debug', operation: 'set', value: '1' }],
            }),
          })],
        }),
      );
    });

    it('removes all existing rules before adding the new one', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValueOnce([
        { id: 1 }, { id: 2 },
      ]);
      const ctrl = await initWithHeaders([{ enabled: true, key: 'X-A', value: 'a' }]);

      await ctrl.applyHeaders('https://example.com/');

      const call = chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
      expect(call.removeRuleIds).toEqual([1, 2]);
    });

    it('only removes rules (no addRules) when all headers are disabled', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValueOnce([{ id: 5 }]);
      const ctrl = await initWithHeaders([{ enabled: false, key: 'X-Skip', value: '1' }]);

      await ctrl.applyHeaders('https://example.com/');

      const call = chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
      expect(call).toEqual({ removeRuleIds: [5] });
      expect(call.addRules).toBeUndefined();
    });

    it('skips updateDynamicRules entirely when there are no rules and no enabled headers', async () => {
      const ctrl = await initWithHeaders([]);
      await ctrl.applyHeaders('https://example.com/');
      expect(chrome.declarativeNetRequest.updateDynamicRules).not.toHaveBeenCalled();
    });

    it('excludes headers with blank keys', async () => {
      const ctrl = await initWithHeaders([
        { enabled: true, key: '',     value: 'ignored' },
        { enabled: true, key: 'X-Ok', value: 'yes'     },
      ]);

      await ctrl.applyHeaders('https://example.com/');

      const call = chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0];
      expect(call.addRules[0].action.requestHeaders).toEqual([
        { header: 'X-Ok', operation: 'set', value: 'yes' },
      ]);
    });

    it('includes enabled headers from the active profile', async () => {
      const ctrl = await initWithHeaders(
        [{ enabled: true, key: 'X-Manual', value: 'm' }],
        {
          Dev: { params: [], headers: [{ enabled: true, key: 'X-Profile', value: 'p' }] },
        },
      );
      ctrl.enableProfile('Dev');

      await ctrl.applyHeaders('https://example.com/');

      const headers = chrome.declarativeNetRequest.updateDynamicRules.mock.calls[0][0]
        .addRules[0].action.requestHeaders;

      expect(headers.map(h => h.header)).toContain('X-Manual');
      expect(headers.map(h => h.header)).toContain('X-Profile');
    });

    it('excludes profile headers when no profile is active', async () => {
      const ctrl = await initWithHeaders(
        [],
        { Dev: { params: [], headers: [{ enabled: true, key: 'X-Secret', value: 's' }] } },
      );
      // No enableProfile() call — _enabledProfile stays null

      await ctrl.applyHeaders('https://example.com/');

      expect(chrome.declarativeNetRequest.updateDynamicRules).not.toHaveBeenCalled();
    });
  });

  // ── clearRules ──────────────────────────────────────────────────────────────

  describe('clearRules', () => {
    it('removes all dynamic rules registered by the extension', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValueOnce([
        { id: 1 }, { id: 3 },
      ]);
      const { ctrl } = makeController();

      await ctrl.clearRules();

      expect(chrome.declarativeNetRequest.updateDynamicRules).toHaveBeenCalledWith({
        removeRuleIds: [1, 3],
      });
    });

    it('skips updateDynamicRules when there are no rules to remove', async () => {
      chrome.declarativeNetRequest.getDynamicRules.mockResolvedValueOnce([]);
      const { ctrl } = makeController();

      await ctrl.clearRules();

      expect(chrome.declarativeNetRequest.updateDynamicRules).not.toHaveBeenCalled();
    });
  });

  // ── refreshProfiles ─────────────────────────────────────────────────────────

  describe('refreshProfiles', () => {
    it('reloads profile headers without touching manual headers', async () => {
      const readProfiles = vi.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({
          Prod: { params: [], headers: [{ enabled: true, key: 'X-Env', value: 'prod' }] },
        });

      const { ctrl } = makeController({ readProfiles });
      await ctrl.init();

      // Add a manual header before refresh
      ctrl._headers.push({ id: ctrl._nextId++, enabled: true, key: 'X-Custom', value: 'c' });

      await ctrl.refreshProfiles();

      expect(ctrl.getHeaders().map(h => h.key)).toContain('X-Custom');
      expect(ctrl._profileHeaders.map(h => h.key)).toContain('X-Env');
    });
  });

  // ── loadFromRequest ─────────────────────────────────────────────────────────

  describe('loadFromRequest', () => {
    it('populates manual headers from the captured request headers', () => {
      const { ctrl } = makeController();
      ctrl.loadFromRequest({
        'Authorization': 'Bearer tok123',
        'X-Request-Id':  'abc-456',
      });

      const headers = ctrl.getHeaders();
      expect(headers).toContainEqual(expect.objectContaining({ key: 'Authorization', value: 'Bearer tok123', enabled: true }));
      expect(headers).toContainEqual(expect.objectContaining({ key: 'X-Request-Id',  value: 'abc-456',       enabled: true }));
    });

    it('replaces any previously loaded manual headers', async () => {
      const { ctrl } = makeController();
      await ctrl.init();
      document.getElementById('add-header-btn').click(); // adds one empty manual header

      ctrl.loadFromRequest({ 'X-New': 'value' });

      const headers = ctrl.getHeaders();
      expect(headers).toHaveLength(1);
      expect(headers[0].key).toBe('X-New');
    });

    it('results in an empty list when passed an empty object', () => {
      const { ctrl } = makeController();
      ctrl.loadFromRequest({});
      expect(ctrl.getHeaders()).toHaveLength(0);
    });

    it('does not affect existing profile headers', async () => {
      const { ctrl } = makeController({
        readProfiles: vi.fn().mockResolvedValue({
          Dev: { params: [], headers: [{ enabled: true, key: 'X-Profile', value: 'dev' }] },
        }),
      });
      await ctrl.init();

      ctrl.loadFromRequest({ 'Authorization': 'Bearer xyz' });

      expect(ctrl._profileHeaders.map(h => h.key)).toContain('X-Profile');
    });

    it('marks all loaded headers as enabled by default', () => {
      const { ctrl } = makeController();
      ctrl.loadFromRequest({ 'Content-Type': 'application/json', 'Accept': '*/*' });

      ctrl.getHeaders().forEach(h => expect(h.enabled).toBe(true));
    });
  });
});
