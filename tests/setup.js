import { vi, beforeEach } from 'vitest';

global.chrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
    session: {
      get:    vi.fn(),
      set:    vi.fn(),
      remove: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
    },
  },
  tabs: {
    query:  vi.fn(),
    update: vi.fn(),
    onActivated: {
      addListener: vi.fn(),
    },
  },
  declarativeNetRequest: {
    getDynamicRules:    vi.fn(),
    updateDynamicRules: vi.fn(),
  },
  runtime: {
    onMessage: {
      addListener: vi.fn(),
    },
    sendMessage: vi.fn(),
  },
  sidePanel: {
    open: vi.fn(),
  },
};

// Provide a stable fetch mock reference that persists even after interceptor.js
// replaces window.fetch with its wrapper. Tests that need to control the
// underlying fetch behaviour (e.g. interceptor.test.js) use __fetchMock directly.
global.__fetchMock = vi.fn();
global.fetch       = global.__fetchMock;

beforeEach(() => {
  vi.clearAllMocks();
  chrome.storage.local.get.mockResolvedValue({});
  chrome.storage.local.set.mockResolvedValue(undefined);
  chrome.storage.local.remove.mockResolvedValue(undefined);
  chrome.storage.session.get.mockResolvedValue({});
  chrome.storage.session.set.mockResolvedValue(undefined);
  chrome.storage.session.remove.mockResolvedValue(undefined);
  chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com/' }]);
  chrome.tabs.update.mockResolvedValue(undefined);
  chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([]);
  chrome.declarativeNetRequest.updateDynamicRules.mockResolvedValue(undefined);
  chrome.runtime.sendMessage.mockResolvedValue(undefined);
  chrome.sidePanel.open.mockResolvedValue(undefined);

  // Default fetch response — also used by the interceptor wrapper internally.
  global.__fetchMock.mockResolvedValue({
    status: 200,
    headers: new Headers({ 'content-type': 'application/json' }),
    clone: () => ({ text: async () => '{"ok":true}' }),
  });
});
