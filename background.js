/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * background.js — Service worker
 * Relays captured network requests from content scripts to the side panel
 * via chrome.storage.session, and manages side panel lifecycle.
 */

'use strict';

const SESSION_REQUESTS_KEY = 'ri_requests';
const SESSION_SETTINGS_KEY = 'ri_settings';
const MAX_REQUESTS         = 500;

// ── Message handling ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RI_REQUEST') {
    handleCapturedRequest(message.payload, sender.tab);
    return false;
  }

  if (message.type === 'RI_OPEN_SIDE_PANEL') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) chrome.sidePanel.open({ tabId: tab.id });
    });
    return false;
  }

  if (message.type === 'RI_CLOSE_SIDE_PANEL') {
    // Side panel closed via its own UI — no programmatic close API exists;
    // the side panel calls window.close() on itself instead.
    return false;
  }

  if (message.type === 'RI_CLEAR_REQUESTS') {
    chrome.storage.session.remove(SESSION_REQUESTS_KEY);
    return false;
  }
});

// ── Request storage ───────────────────────────────────────────────────────────

export async function handleCapturedRequest(payload, tab) {
  if (!tab) return;

  const stored = await chrome.storage.session.get(SESSION_REQUESTS_KEY);
  const requests = stored[SESSION_REQUESTS_KEY] ?? [];

  const tabHostname = tab.url ? new URL(tab.url).hostname : '';
  let reqHostname = '';
  try { reqHostname = new URL(payload.url).hostname; } catch (_) {}

  const entry = {
    ...payload,
    tabId:      tab.id,
    firstParty: reqHostname === tabHostname,
  };

  requests.push(entry);
  if (requests.length > MAX_REQUESTS) requests.splice(0, requests.length - MAX_REQUESTS);

  chrome.storage.session.set({ [SESSION_REQUESTS_KEY]: requests });
}

// ── Side panel: open automatically when enabled ───────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const stored = await chrome.storage.local.get('ri_settings');
  const settings = stored['ri_settings'] ?? {};
  if (settings.sidePanelEnabled) {
    chrome.sidePanel.open({ tabId });
  }
});
