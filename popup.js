/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * popup.js — Entry point
 * Instantiates all controllers, wires callbacks, and handles main tab switching.
 */

import { StorageService }      from './storage.js';
import { InspectorController } from './inspector.js';
import { HeadersController }   from './headers.js';
import { ProfilesController }  from './profiles.js';

const storage   = new StorageService();
const headers   = new HeadersController(storage);
const inspector = new InspectorController(storage, {
  onApply:          async (_tabId, url) => headers.applyHeaders(url),
  onReset:          async ()            => headers.clearRules(),
  onProfileEnable:  (name)             => headers.enableProfile(name),
  onSaveToProfile:  async (name, params) => {
    await storage.saveProfile(name, params, []);
    inspector.refreshProfiles();
    headers.refreshProfiles();
    profiles.render();
  },
});
const profiles  = new ProfilesController(storage, {
  enableProfile:    (name) => inspector.enableProfile(name),
  onProfilesChange: ()     => { inspector.refreshProfiles(); headers.refreshProfiles(); },
});

// ── Main tab switching ─────────────────────────────────────────────────────────

document.querySelectorAll('.tab').forEach(tabBtn => {
  tabBtn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));

    tabBtn.classList.add('active');
    tabBtn.setAttribute('aria-selected', 'true');
    document.getElementById(`tab-${tabBtn.dataset.tab}`).classList.remove('hidden');

    if (tabBtn.dataset.tab === 'profiles') profiles.render();
  });
});

// ── Settings ───────────────────────────────────────────────────────────────────

const $settingsBtn    = document.getElementById('settings-btn');
const $settingsPanel  = document.getElementById('settings-panel');
const $btnOpenMonitor = document.getElementById('btn-open-monitor');

$settingsBtn.addEventListener('click', () => {
  const nowHidden = $settingsPanel.classList.toggle('hidden');
  $settingsBtn.classList.toggle('active', !nowHidden);
});

$btnOpenMonitor.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'RI_OPEN_SIDE_PANEL' });
  $settingsPanel.classList.add('hidden');
  $settingsBtn.classList.remove('active');
});

// ── Side panel handoff ─────────────────────────────────────────────────────────
// When the user clicks "Open in Inspector" in the side panel, the request is
// stored in session storage. We pick it up here on popup open.

async function checkHandoff() {
  const stored = await chrome.storage.session.get('ri_inspector_handoff');
  const req    = stored['ri_inspector_handoff'];
  if (!req) return;

  await chrome.storage.session.remove('ri_inspector_handoff');
  inspector.loadFromRequest(req);
  headers.loadFromRequest(req.requestHeaders ?? {});

  // Switch to the Headers sub-tab so the user immediately sees the captured headers.
  const headersTab = document.querySelector('.subtab[data-subtab="headers"]');
  if (headersTab) headersTab.click();
}

// ── Bootstrap ──────────────────────────────────────────────────────────────────

// headers.init() runs after inspector.init() so the profiles store is ready.
inspector.init().then(() => { headers.init(); checkHandoff(); });
