/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * relay.js — ISOLATED world content script
 * Bridges window.postMessage events from the MAIN world interceptor to the
 * background service worker via chrome.runtime.sendMessage.
 *
 * Only forwards messages while the side panel is actively monitoring this tab.
 * The background service worker is the source of truth for active state and
 * pushes RI_MONITOR_STATE updates whenever the panel opens or closes.
 */

'use strict';

let active = false;

// Ask the background whether the side panel is already monitoring this tab.
// Handles the case where the page is reloaded while the panel is open.
chrome.runtime.sendMessage({ type: 'RI_GET_MONITOR_STATE' })
  .then(res => { if (res?.active) active = true; })
  .catch(() => {});

// Keep in sync as the panel opens/closes after page load.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'RI_MONITOR_STATE') active = msg.active;
});

window.addEventListener('message', (event) => {
  if (!active) return;
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
