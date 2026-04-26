import { describe, it, expect, beforeAll } from 'vitest';

// sidepanel.js executes DOM queries and event bindings at module level, so we
// must provide the required HTML before the module is evaluated. We use a
// dynamic import inside beforeAll to control the load order.

let filterRequests;

beforeAll(async () => {
  // Provide the minimal DOM that sidepanel.js touches at load time.
  document.body.innerHTML = `
    <div id="view-monitor" class="view active">
      <button id="btn-record"></button>
      <button id="btn-clear"></button>
      <label><input type="checkbox" id="filter-first-party" checked /></label>
      <label><input type="checkbox" id="filter-json" checked /></label>
      <input  id="filter-url" type="text" />
      <div id="request-list"></div>
      <div id="monitor-empty"></div>
      <span id="status-count"></span>
      <span id="status-filtered"></span>
    </div>
    <div id="view-detail" class="view hidden">
      <button id="btn-back-detail"></button>
      <span id="detail-title"></span>
      <span id="detail-method-badge"></span>
      <span id="detail-url"></span>
      <div  id="detail-meta"></div>
      <div  id="detail-req-headers"></div>
      <div  id="detail-resp-headers"></div>
      <pre  id="detail-req-body"></pre>
      <pre  id="detail-resp-body"></pre>
      <button id="btn-replay"></button>
      <button id="btn-to-inspector"></button>
    </div>
    <div id="view-replay" class="view hidden">
      <button   id="btn-back-replay"></button>
      <button   id="btn-send"></button>
      <select   id="replay-method"></select>
      <input    id="replay-url" type="text" />
      <div      id="replay-headers-list"></div>
      <div      id="replay-params-list"></div>
      <textarea id="replay-body"></textarea>
      <pre      id="replay-resp-body"></pre>
      <span     id="replay-resp-meta"></span>
    </div>
  `;

  // Ensure chrome mocks are wired up before the module body runs
  // (loadRequestsForTab is called at the bottom of sidepanel.js).
  chrome.tabs.query.mockResolvedValue([{ id: 1, url: 'https://example.com/' }]);
  chrome.storage.session.get.mockResolvedValue({});

  const mod    = await import('../sidepanel.js');
  filterRequests = mod.filterRequests;
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeRequest(overrides = {}) {
  return {
    id:          'req-1',
    method:      'GET',
    url:         'https://example.com/api/items',
    status:      200,
    contentType: 'application/json',
    firstParty:  true,
    pending:     false,
    duration:    50,
    ...overrides,
  };
}

const defaultFilters = {
  firstParty: true,
  json:       true,
  method:     '',
  url:        '',
};

// ── tests ─────────────────────────────────────────────────────────────────────

describe('filterRequests', () => {

  // ── firstParty filter ───────────────────────────────────────────────────────

  describe('firstParty filter', () => {
    it('keeps first-party requests when filter is on', () => {
      const req = makeRequest({ firstParty: true });
      expect(filterRequests([req], defaultFilters)).toHaveLength(1);
    });

    it('drops third-party requests when filter is on', () => {
      const req = makeRequest({ firstParty: false });
      expect(filterRequests([req], defaultFilters)).toHaveLength(0);
    });

    it('keeps third-party requests when filter is off', () => {
      const req = makeRequest({ firstParty: false });
      expect(filterRequests([req], { ...defaultFilters, firstParty: false })).toHaveLength(1);
    });
  });

  // ── JSON filter ─────────────────────────────────────────────────────────────

  describe('JSON filter', () => {
    it('keeps requests with application/json content type', () => {
      const req = makeRequest({ contentType: 'application/json; charset=utf-8' });
      expect(filterRequests([req], defaultFilters)).toHaveLength(1);
    });

    it('drops requests with non-JSON content types', () => {
      const req = makeRequest({ contentType: 'text/html' });
      expect(filterRequests([req], defaultFilters)).toHaveLength(0);
    });

    it('drops requests with null content type', () => {
      const req = makeRequest({ contentType: null });
      expect(filterRequests([req], defaultFilters)).toHaveLength(0);
    });

    it('keeps pending requests regardless of content type (response not yet received)', () => {
      const req = makeRequest({ pending: true, contentType: null, status: null });
      expect(filterRequests([req], defaultFilters)).toHaveLength(1);
    });

    it('keeps all content types when JSON filter is off', () => {
      const req = makeRequest({ contentType: 'text/plain' });
      expect(filterRequests([req], { ...defaultFilters, json: false })).toHaveLength(1);
    });
  });

  // ── method filter ───────────────────────────────────────────────────────────

  describe('method filter', () => {
    it('keeps requests matching the selected method', () => {
      const req = makeRequest({ method: 'POST' });
      expect(filterRequests([req], { ...defaultFilters, method: 'POST' })).toHaveLength(1);
    });

    it('drops requests not matching the selected method', () => {
      const req = makeRequest({ method: 'GET' });
      expect(filterRequests([req], { ...defaultFilters, method: 'POST' })).toHaveLength(0);
    });

    it('keeps all methods when method filter is empty string', () => {
      const reqs = [
        makeRequest({ method: 'GET' }),
        makeRequest({ method: 'POST',   id: 'r2' }),
        makeRequest({ method: 'DELETE', id: 'r3' }),
      ];
      expect(filterRequests(reqs, { ...defaultFilters, method: '' })).toHaveLength(3);
    });
  });

  // ── URL filter ──────────────────────────────────────────────────────────────

  describe('URL filter', () => {
    it('keeps requests whose URL contains the search string', () => {
      const req = makeRequest({ url: 'https://example.com/api/recommendations' });
      expect(filterRequests([req], { ...defaultFilters, url: '/api/recommendations' })).toHaveLength(1);
    });

    it('drops requests whose URL does not contain the search string', () => {
      const req = makeRequest({ url: 'https://example.com/api/items' });
      expect(filterRequests([req], { ...defaultFilters, url: '/api/orders' })).toHaveLength(0);
    });

    it('is case-insensitive', () => {
      const req = makeRequest({ url: 'https://example.com/API/Items' });
      expect(filterRequests([req], { ...defaultFilters, url: '/api/items' })).toHaveLength(1);
    });

    it('keeps all requests when URL filter is empty string', () => {
      const reqs = [
        makeRequest({ url: 'https://example.com/a', id: 'r1' }),
        makeRequest({ url: 'https://example.com/b', id: 'r2' }),
      ];
      expect(filterRequests(reqs, { ...defaultFilters, url: '' })).toHaveLength(2);
    });
  });

  // ── combined filters ────────────────────────────────────────────────────────

  describe('combined filters', () => {
    it('applies all active filters simultaneously', () => {
      const requests = [
        makeRequest({ id: 'a', method: 'POST', firstParty: true,  contentType: 'application/json', url: 'https://example.com/api/cart' }),
        makeRequest({ id: 'b', method: 'GET',  firstParty: true,  contentType: 'application/json', url: 'https://example.com/api/cart' }),
        makeRequest({ id: 'c', method: 'POST', firstParty: false, contentType: 'application/json', url: 'https://example.com/api/cart' }),
        makeRequest({ id: 'd', method: 'POST', firstParty: true,  contentType: 'text/html',        url: 'https://example.com/api/cart' }),
        makeRequest({ id: 'e', method: 'POST', firstParty: true,  contentType: 'application/json', url: 'https://example.com/health'   }),
      ];

      const result = filterRequests(requests, {
        firstParty: true,
        json:       true,
        method:     'POST',
        url:        '/api/cart',
      });

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('a');
    });

    it('returns all requests when all filters are at their permissive defaults', () => {
      const requests = [
        makeRequest({ id: 'r1', firstParty: false, contentType: 'text/html',        method: 'DELETE' }),
        makeRequest({ id: 'r2', firstParty: true,  contentType: 'application/json', method: 'GET'    }),
      ];

      const result = filterRequests(requests, {
        firstParty: false,
        json:       false,
        method:     '',
        url:        '',
      });

      expect(result).toHaveLength(2);
    });

    it('returns an empty array when no requests match', () => {
      const requests = [makeRequest({ firstParty: false })];
      expect(filterRequests(requests, defaultFilters)).toHaveLength(0);
    });

    it('returns an empty array when given an empty input list', () => {
      expect(filterRequests([], defaultFilters)).toHaveLength(0);
    });
  });
});
