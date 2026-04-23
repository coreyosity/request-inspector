/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * popup.js — Entry point
 * Instantiates StorageService, InspectorController, and ProfilesController,
 * then wires up tab switching.
 */

import { StorageService }      from './storage.js';
import { InspectorController } from './inspector.js';
import { ProfilesController }  from './profiles.js';

const storage   = new StorageService();
const inspector = new InspectorController(storage);
const profiles  = new ProfilesController(storage, {
  getParams:  ()  => inspector.getParams(),
  loadParams: (p) => inspector.loadParams(p),
});

// ── Tab switching ──────────────────────────────────────────────────────────────

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

inspector.init();
