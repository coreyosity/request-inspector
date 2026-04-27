/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * interceptor.js — MAIN world content script
 * Wraps window.fetch and XMLHttpRequest to capture request/response data,
 * then posts structured messages to the ISOLATED world relay via window.postMessage.
 * Runs at document_start so no page requests are missed.
 */

(function () {
  'use strict';

  const MSG_TYPE = 'RI_INTERCEPTED';

  function uid() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function headersToObject(headers) {
    const obj = {};
    if (!headers) return obj;
    if (headers instanceof Headers) {
      headers.forEach((v, k) => { obj[k] = v; });
    } else if (typeof headers === 'object') {
      Object.assign(obj, headers);
    }
    return obj;
  }

  function post(payload) {
    window.postMessage({ type: MSG_TYPE, payload }, '*');
  }

  // ── fetch wrapper ─────────────────────────────────────────────────────────────

  const _fetch = window.fetch.bind(window);
  window.fetch = async function (input, init = {}) {
    const id        = uid();
    const startTime = Date.now();

    const url     = input instanceof Request ? input.url : String(input);
    const method  = (init.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const reqHeaders = headersToObject(init.headers ?? (input instanceof Request ? input.headers : null));

    let requestBody = null;
    try {
      if (init.body != null) {
        requestBody = typeof init.body === 'string' ? init.body : '[non-text body]';
      } else if (input instanceof Request && input.bodyUsed === false) {
        // body already consumed — skip
      }
    } catch (_) {}

    // Post the "pending" entry immediately so Monitor shows it in-flight
    post({ id, url, method, requestHeaders: reqHeaders, requestBody, status: null,
           responseHeaders: {}, responseBody: null, duration: null,
           contentType: null, timestamp: startTime, pending: true });

    let response;
    try {
      response = await _fetch(input, init);
    } catch (err) {
      post({ id, url, method, requestHeaders: reqHeaders, requestBody,
             status: 0, responseHeaders: {}, responseBody: null,
             duration: Date.now() - startTime, contentType: null,
             timestamp: startTime, pending: false, error: err.message });
      throw err;
    }

    const duration = Date.now() - startTime;
    const respHeaders = headersToObject(response.headers);
    const contentType = response.headers.get('content-type') ?? null;

    // Clone so we don't consume the body for the caller
    let responseBody = null;
    try {
      const clone = response.clone();
      if (contentType && contentType.includes('application/json')) {
        responseBody = await clone.text();
      }
    } catch (_) {}

    post({ id, url, method, requestHeaders: reqHeaders, requestBody,
           status: response.status, responseHeaders: respHeaders,
           responseBody, duration, contentType, timestamp: startTime, pending: false });

    return response;
  };

  // ── XMLHttpRequest wrapper ────────────────────────────────────────────────────

  const _XHROpen = XMLHttpRequest.prototype.open;
  const _XHRSend = XMLHttpRequest.prototype.send;
  const _XHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._ri_id        = uid();
    this._ri_method    = method.toUpperCase();
    this._ri_url       = String(url);
    this._ri_headers   = {};
    this._ri_startTime = null;
    return _XHROpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    if (this._ri_headers) this._ri_headers[name] = value;
    return _XHRSetHeader.call(this, name, value);
  };

  XMLHttpRequest.prototype.send = function (body) {
    if (!this._ri_url) return _XHRSend.call(this, body);

    this._ri_startTime = Date.now();
    const id        = this._ri_id;
    const url       = this._ri_url;
    const method    = this._ri_method;
    const reqHeaders = { ...this._ri_headers };

    let requestBody = null;
    try {
      if (body != null) requestBody = typeof body === 'string' ? body : '[non-text body]';
    } catch (_) {}

    post({ id, url, method, requestHeaders: reqHeaders, requestBody,
           status: null, responseHeaders: {}, responseBody: null,
           duration: null, contentType: null, timestamp: this._ri_startTime, pending: true });

    this.addEventListener('loadend', () => {
      const duration = Date.now() - this._ri_startTime;
      const respHeaders = {};
      try {
        this.getAllResponseHeaders().split('\r\n').forEach(line => {
          const idx = line.indexOf(': ');
          if (idx > 0) respHeaders[line.slice(0, idx)] = line.slice(idx + 2);
        });
      } catch (_) {}

      const contentType = this.getResponseHeader('content-type') ?? null;
      let responseBody = null;
      try {
        if (contentType && contentType.includes('application/json')) {
          responseBody = this.responseText;
        }
      } catch (_) {}

      post({ id, url, method, requestHeaders: reqHeaders, requestBody,
             status: this.status, responseHeaders: respHeaders, responseBody,
             duration, contentType, timestamp: this._ri_startTime, pending: false,
             error: this.status === 0 ? 'Network error' : undefined });
    });

    return _XHRSend.call(this, body);
  };
})();
