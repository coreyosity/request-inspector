import { vi, beforeEach } from 'vitest';

global.chrome = {
  storage: {
    local: {
      get: vi.fn(),
      set: vi.fn(),
      remove: vi.fn(),
    },
  },
  tabs: {
    query: vi.fn(),
    update: vi.fn(),
  },
  declarativeNetRequest: {
    getDynamicRules: vi.fn(),
    updateDynamicRules: vi.fn(),
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  chrome.storage.local.get.mockResolvedValue({});
  chrome.storage.local.set.mockResolvedValue(undefined);
  chrome.storage.local.remove.mockResolvedValue(undefined);
  chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com/' }]);
  chrome.tabs.update.mockResolvedValue(undefined);
  chrome.declarativeNetRequest.getDynamicRules.mockResolvedValue([]);
  chrome.declarativeNetRequest.updateDynamicRules.mockResolvedValue(undefined);
});
