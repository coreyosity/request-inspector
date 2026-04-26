import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handleCapturedRequest } from '../background.js';

const SESSION_KEY   = 'ri_requests';
const MAX_REQUESTS  = 500;

function makeTab(overrides = {}) {
  return { id: 1, url: 'https://example.com/page', ...overrides };
}

function makePayload(overrides = {}) {
  return {
    id:              'req-001',
    url:             'https://example.com/api/data',
    method:          'GET',
    requestHeaders:  {},
    requestBody:     null,
    status:          200,
    responseHeaders: { 'content-type': 'application/json' },
    responseBody:    '{"ok":true}',
    duration:        42,
    contentType:     'application/json',
    timestamp:       Date.now(),
    pending:         false,
    ...overrides,
  };
}

describe('handleCapturedRequest', () => {

  // ── firstParty classification ───────────────────────────────────────────────

  describe('firstParty classification', () => {
    it('marks a request as first-party when hostnames match', async () => {
      chrome.storage.session.get.mockResolvedValueOnce({});
      const tab     = makeTab({ url: 'https://example.com/' });
      const payload = makePayload({ url: 'https://example.com/api/items' });

      await handleCapturedRequest(payload, tab);

      const [stored] = chrome.storage.session.set.mock.calls[0];
      expect(stored[SESSION_KEY][0].firstParty).toBe(true);
    });

    it('marks a request as third-party when hostnames differ', async () => {
      chrome.storage.session.get.mockResolvedValueOnce({});
      const tab     = makeTab({ url: 'https://myapp.com/' });
      const payload = makePayload({ url: 'https://analytics.io/track' });

      await handleCapturedRequest(payload, tab);

      const [stored] = chrome.storage.session.set.mock.calls[0];
      expect(stored[SESSION_KEY][0].firstParty).toBe(false);
    });

    it('marks as third-party when tab URL is not parseable', async () => {
      chrome.storage.session.get.mockResolvedValueOnce({});
      const tab     = makeTab({ url: 'chrome://newtab/' });
      const payload = makePayload({ url: 'https://example.com/api' });

      await handleCapturedRequest(payload, tab);

      const [stored] = chrome.storage.session.set.mock.calls[0];
      expect(stored[SESSION_KEY][0].firstParty).toBe(false);
    });

    it('marks as third-party when request URL is malformed', async () => {
      chrome.storage.session.get.mockResolvedValueOnce({});
      const tab     = makeTab({ url: 'https://example.com/' });
      const payload = makePayload({ url: 'not-a-url' });

      await handleCapturedRequest(payload, tab);

      const [stored] = chrome.storage.session.set.mock.calls[0];
      expect(stored[SESSION_KEY][0].firstParty).toBe(false);
    });
  });

  // ── storage behaviour ───────────────────────────────────────────────────────

  describe('storage behaviour', () => {
    it('appends the enriched entry to an existing list', async () => {
      const existing = [makePayload({ id: 'old-001' })];
      chrome.storage.session.get.mockResolvedValueOnce({ [SESSION_KEY]: existing });

      await handleCapturedRequest(makePayload({ id: 'new-002' }), makeTab());

      const [stored] = chrome.storage.session.set.mock.calls[0];
      expect(stored[SESSION_KEY]).toHaveLength(2);
      expect(stored[SESSION_KEY][1].id).toBe('new-002');
    });

    it('creates a new list when session storage is empty', async () => {
      chrome.storage.session.get.mockResolvedValueOnce({});

      await handleCapturedRequest(makePayload(), makeTab());

      const [stored] = chrome.storage.session.set.mock.calls[0];
      expect(stored[SESSION_KEY]).toHaveLength(1);
    });

    it('stores the original payload fields on the entry', async () => {
      chrome.storage.session.get.mockResolvedValueOnce({});
      const payload = makePayload({
        url:         'https://example.com/api/users',
        method:      'POST',
        status:      201,
        contentType: 'application/json',
      });

      await handleCapturedRequest(payload, makeTab());

      const [stored] = chrome.storage.session.set.mock.calls[0];
      const entry    = stored[SESSION_KEY][0];
      expect(entry.url).toBe('https://example.com/api/users');
      expect(entry.method).toBe('POST');
      expect(entry.status).toBe(201);
      expect(entry.contentType).toBe('application/json');
    });

    it('stamps the entry with the tab id', async () => {
      chrome.storage.session.get.mockResolvedValueOnce({});

      await handleCapturedRequest(makePayload(), makeTab({ id: 42 }));

      const [stored] = chrome.storage.session.set.mock.calls[0];
      expect(stored[SESSION_KEY][0].tabId).toBe(42);
    });

    it(`trims the list to ${MAX_REQUESTS} entries when the cap is exceeded`, async () => {
      const huge = Array.from({ length: MAX_REQUESTS }, (_, i) =>
        makePayload({ id: `old-${i}` }),
      );
      chrome.storage.session.get.mockResolvedValueOnce({ [SESSION_KEY]: huge });

      await handleCapturedRequest(makePayload({ id: 'newest' }), makeTab());

      const [stored] = chrome.storage.session.set.mock.calls[0];
      expect(stored[SESSION_KEY]).toHaveLength(MAX_REQUESTS);
      expect(stored[SESSION_KEY].at(-1).id).toBe('newest');
    });
  });

  // ── guard conditions ────────────────────────────────────────────────────────

  describe('guard conditions', () => {
    it('returns without writing to storage when tab is null', async () => {
      await handleCapturedRequest(makePayload(), null);
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });

    it('returns without writing to storage when tab is undefined', async () => {
      await handleCapturedRequest(makePayload(), undefined);
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });
  });
});
