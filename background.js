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

// Tab IDs whose side panel is currently open. Persisted to session storage so
// it survives service-worker restarts while the panel stays open.
const monitorActiveTabs = new Set();

async function loadMonitorTabs() {
  const stored = await chrome.storage.session.get('ri_monitor_tabs')?.catch(() => null);
  (stored?.['ri_monitor_tabs'] ?? []).forEach(id => monitorActiveTabs.add(id));
}
loadMonitorTabs();

async function setMonitorActive(tabId, active) {
  if (active) monitorActiveTabs.add(tabId);
  else        monitorActiveTabs.delete(tabId);
  chrome.storage.session.set({ 'ri_monitor_tabs': [...monitorActiveTabs] });
  // Push the new state to the content script so the relay gate updates.
  chrome.tabs.sendMessage(tabId, { type: 'RI_MONITOR_STATE', active }).catch(() => {});
}

// ── Message handling ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'RI_REQUEST') {
    // Only process requests when the side panel is actively monitoring this tab.
    if (monitorActiveTabs.has(sender.tab?.id)) {
      handleCapturedRequest(message.payload, sender.tab);
    }
    return false;
  }

  if (message.type === 'RI_MONITOR_STATE') {
    setMonitorActive(message.tabId, message.active);
    return false;
  }

  if (message.type === 'RI_GET_MONITOR_STATE') {
    sendResponse({ active: monitorActiveTabs.has(sender.tab?.id) });
    return true;
  }

  if (message.type === 'RI_OPEN_SIDE_PANEL') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab) chrome.sidePanel.open({ tabId: tab.id });
    });
    return false;
  }

  if (message.type === 'RI_CLEAR_REQUESTS') {
    chrome.storage.session.remove(SESSION_REQUESTS_KEY);
    return false;
  }
});

// Clean up when a tab is closed.
chrome.tabs.onRemoved.addListener((tabId) => {
  if (monitorActiveTabs.has(tabId)) setMonitorActive(tabId, false);
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
