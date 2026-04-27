/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * relay.js — ISOLATED world content script
 * Bridges window.postMessage events from the MAIN world interceptor to the
 * background service worker via chrome.runtime.sendMessage.
 */

'use strict';

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== 'RI_INTERCEPTED') return;

  try {
    chrome.runtime.sendMessage({
      type:    'RI_REQUEST',
      payload: event.data.payload,
    }).catch(() => {
      // Background may be inactive — silently discard.
    });
  } catch (_) {
    // Extension context invalidated (e.g. after reload) — silently discard.
  }
});
