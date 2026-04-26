import { describe, it, expect, beforeEach, vi } from 'vitest';

// Import the interceptor once — the IIFE executes immediately, patching
// window.fetch and XMLHttpRequest.prototype. These patches persist for all
// tests in this file (module is only evaluated once per worker).
import '../interceptor.js';

const MSG_TYPE = 'RI_INTERCEPTED';

function captureMessages() {
  const messages = [];
  vi.spyOn(window, 'postMessage').mockImplementation((data) => {
    if (data?.type === MSG_TYPE) messages.push(data.payload);
  });
  return messages;
}

describe('interceptor', () => {

  // ── fetch wrapper ───────────────────────────────────────────────────────────

  describe('fetch wrapper', () => {
    it('wraps window.fetch so it is no longer the original vi.fn()', () => {
      // After the IIFE ran, window.fetch is the wrapper, not the underlying vi.fn().
      expect(window.fetch).not.toBe(global.__fetchMock);
    });

    it('posts a pending message before the request resolves', async () => {
      const messages = captureMessages();
      let resolveResponse;
      global.__fetchMock.mockReturnValueOnce(new Promise(r => { resolveResponse = r; }));

      const fetchPromise = window.fetch('https://example.com/api/items');

      // The pending message is posted synchronously before await
      expect(messages).toHaveLength(1);
      expect(messages[0].pending).toBe(true);
      expect(messages[0].url).toBe('https://example.com/api/items');
      expect(messages[0].status).toBeNull();

      resolveResponse({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: () => ({ text: async () => '{}' }),
      });
      await fetchPromise;
    });

    it('posts a completion message with status and headers after the response', async () => {
      const messages = captureMessages();
      global.__fetchMock.mockResolvedValueOnce({
        status: 201,
        headers: new Headers({ 'content-type': 'application/json', 'x-trace': 'abc' }),
        clone: () => ({ text: async () => '{"created":true}' }),
      });

      await window.fetch('https://example.com/api/items', { method: 'POST' });

      const completion = messages.find(m => !m.pending);
      expect(completion).toBeDefined();
      expect(completion.status).toBe(201);
      expect(completion.method).toBe('POST');
      expect(completion.responseHeaders['content-type']).toBe('application/json');
      expect(completion.responseHeaders['x-trace']).toBe('abc');
    });

    it('captures the response body for JSON content types', async () => {
      const messages = captureMessages();
      global.__fetchMock.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        clone: () => ({ text: async () => '{"items":[1,2,3]}' }),
      });

      await window.fetch('https://example.com/api/items');

      const completion = messages.find(m => !m.pending);
      expect(completion.responseBody).toBe('{"items":[1,2,3]}');
    });

    it('does not capture the response body for non-JSON content types', async () => {
      const messages = captureMessages();
      global.__fetchMock.mockResolvedValueOnce({
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        clone: () => ({ text: async () => '<html>...</html>' }),
      });

      await window.fetch('https://example.com/page');

      const completion = messages.find(m => !m.pending);
      expect(completion.responseBody).toBeNull();
    });

    it('posts an error message when the underlying fetch rejects', async () => {
      const messages = captureMessages();
      global.__fetchMock.mockRejectedValueOnce(new Error('Network failure'));

      await expect(window.fetch('https://example.com/api')).rejects.toThrow('Network failure');

      const errMsg = messages.find(m => !m.pending);
      expect(errMsg).toBeDefined();
      expect(errMsg.status).toBe(0);
      expect(errMsg.error).toBe('Network failure');
    });

    it('captures request headers passed to fetch', async () => {
      const messages = captureMessages();
      global.__fetchMock.mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        clone: () => ({ text: async () => '' }),
      });

      await window.fetch('https://example.com/api', {
        headers: { Authorization: 'Bearer tok', 'X-App': 'test' },
      });

      const completion = messages.find(m => !m.pending);
      expect(completion.requestHeaders['Authorization']).toBe('Bearer tok');
      expect(completion.requestHeaders['X-App']).toBe('test');
    });

    it('captures the string request body', async () => {
      const messages = captureMessages();
      global.__fetchMock.mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        clone: () => ({ text: async () => '' }),
      });

      await window.fetch('https://example.com/api', {
        method: 'POST',
        body:   '{"foo":"bar"}',
      });

      const completion = messages.find(m => !m.pending);
      expect(completion.requestBody).toBe('{"foo":"bar"}');
    });

    it('assigns the same id to both the pending and completion messages', async () => {
      const messages = captureMessages();
      global.__fetchMock.mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
        clone: () => ({ text: async () => '' }),
      });

      await window.fetch('https://example.com/api');

      expect(messages).toHaveLength(2);
      expect(messages[0].id).toBe(messages[1].id);
    });
  });

  // ── XMLHttpRequest wrapper ──────────────────────────────────────────────────

  describe('XMLHttpRequest wrapper', () => {
    it('captures the method and URL on open()', () => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://example.com/api/items');
      expect(xhr._ri_method).toBe('GET');
      expect(xhr._ri_url).toBe('https://example.com/api/items');
    });

    it('normalises method to uppercase', () => {
      const xhr = new XMLHttpRequest();
      xhr.open('post', 'https://example.com/api/items');
      expect(xhr._ri_method).toBe('POST');
    });

    it('captures request headers set via setRequestHeader()', () => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://example.com/api');
      xhr.setRequestHeader('Authorization', 'Bearer tok');
      xhr.setRequestHeader('X-App', 'test');
      expect(xhr._ri_headers['Authorization']).toBe('Bearer tok');
      expect(xhr._ri_headers['X-App']).toBe('test');
    });

    it('posts a pending message on send()', () => {
      const messages = captureMessages();
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'https://example.com/api/items');
      xhr.send();

      const pending = messages.find(m => m.pending === true);
      expect(pending).toBeDefined();
      expect(pending.method).toBe('GET');
      expect(pending.url).toBe('https://example.com/api/items');
    });

    it('assigns unique ids across multiple XHR instances', () => {
      const messages = captureMessages();

      const xhr1 = new XMLHttpRequest();
      xhr1.open('GET', 'https://example.com/a');
      xhr1.send();

      const xhr2 = new XMLHttpRequest();
      xhr2.open('GET', 'https://example.com/b');
      xhr2.send();

      const ids = messages.map(m => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });
});
