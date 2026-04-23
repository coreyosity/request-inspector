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
  onApply: async (_tabId, url) => headers.applyHeaders(url),
  onReset: async ()            => headers.clearRules(),
});
const profiles  = new ProfilesController(storage, {
  getParams:     ()     => inspector.getParams(),
  enableProfile: (name) => inspector.enableProfile(name),
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

// ── Bootstrap ──────────────────────────────────────────────────────────────────

// headers.init() runs after inspector.init() so the storage key is already set.
inspector.init().then(() => headers.init());
