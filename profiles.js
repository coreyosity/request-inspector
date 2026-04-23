/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * profiles.js — ProfilesController
 * Owns the Profiles tab: list rendering, save, load, edit, and delete.
 * Communicates with the inspector via two callbacks passed at construction.
 */

'use strict';

export class ProfilesController {
  /**
   * @param {import('./storage.js').StorageService} storage
   * @param {{ getParams: () => Array, loadParams: (params: Array) => void }} inspector
   */
  constructor(storage, { getParams, applyParams }) {
    this._storage      = storage;
    this._getParams    = getParams;
    this._applyParams  = applyParams;

    /** @type {HTMLElement | null} Currently open edit panel. */
    this._activeEditPanel = null;
    /** @type {HTMLElement | null} Profile row whose panel is open. */
    this._activeEditRow   = null;

    // DOM refs
    this._profileNameInput = document.getElementById('profile-name-input');
    this._saveProfileBtn   = document.getElementById('save-profile-btn');
    this._profilesList     = document.getElementById('profiles-list');
    this._profilesEmpty    = document.getElementById('profiles-empty');

    this._bindEvents();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Fetch profiles from storage and re-render the list. */
  async render() {
    this._activeEditPanel = null;
    this._activeEditRow   = null;
    this._profilesList.querySelectorAll('.profile-entry').forEach(el => el.remove());
    const profiles = await this._storage.readProfiles();
    const names    = Object.keys(profiles);
    this._profilesEmpty.style.display = names.length === 0 ? 'block' : 'none';
    names.forEach(name => {
      this._profilesList.appendChild(this._buildEntry(name, profiles[name].params));
    });
  }

  // ── Entry (row + edit panel) ─────────────────────────────────────────────────

  _buildEntry(name, params) {
    const entry = document.createElement('div');
    entry.className = 'profile-entry';

    const row       = this._buildRow(name, params, entry);
    const editPanel = this._buildEditPanel(name, params, entry);

    entry.append(row, editPanel);
    return entry;
  }

  _buildRow(name, params, entry) {
    const row = document.createElement('div');
    row.className = 'profile-row';

    const nameEl       = document.createElement('span');
    nameEl.className   = 'profile-name';
    nameEl.textContent = name;
    nameEl.title       = name;

    const editBtn       = document.createElement('button');
    editBtn.className   = 'btn-edit';
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => {
      const editPanel = entry.querySelector('.profile-edit-panel');

      // Close any other open panel first
      if (this._activeEditPanel && this._activeEditPanel !== editPanel) {
        this._activeEditPanel.classList.add('hidden');
        this._activeEditRow?.classList.remove('editing');
      }

      const opening = editPanel.classList.contains('hidden');
      editPanel.classList.toggle('hidden', !opening);
      row.classList.toggle('editing', opening);
      this._activeEditPanel = opening ? editPanel : null;
      this._activeEditRow   = opening ? row      : null;

      if (opening) {
        editPanel.querySelector('.profile-edit-name').focus();
      }
    });

    const loadBtn       = document.createElement('button');
    loadBtn.className   = 'btn-apply';
    loadBtn.textContent = 'Apply';
    loadBtn.addEventListener('click', () => this._applyParams(name, params));

    const deleteBtn       = document.createElement('button');
    deleteBtn.className   = 'btn-delete';
    deleteBtn.title       = 'Delete profile';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', async () => {
      await this._storage.deleteProfile(name);
      entry.remove();
      const remaining = this._profilesList.querySelectorAll('.profile-entry');
      this._profilesEmpty.style.display = remaining.length === 0 ? 'block' : 'none';
      if (this._activeEditRow === row) {
        this._activeEditPanel = null;
        this._activeEditRow   = null;
      }
    });

    row.append(nameEl, editBtn, loadBtn, deleteBtn);
    return row;
  }

  // ── Edit panel ───────────────────────────────────────────────────────────────

  _buildEditPanel(originalName, originalParams, entry) {
    // Deep-copy so Cancel truly discards changes
    let editParams = originalParams.map((p, i) => ({ id: i, ...p }));
    let nextId     = editParams.length;

    const panel = document.createElement('div');
    panel.className = 'profile-edit-panel hidden';

    // ── Name field ──
    const nameLabel       = document.createElement('label');
    nameLabel.className   = 'edit-panel-label';
    nameLabel.textContent = 'Name';

    const nameInput       = document.createElement('input');
    nameInput.type        = 'text';
    nameInput.className   = 'input-editable profile-edit-name';
    nameInput.value       = originalName;
    nameInput.spellcheck  = false;

    const nameRow = document.createElement('div');
    nameRow.className = 'edit-name-row';
    nameRow.append(nameLabel, nameInput);

    // ── Params sub-list ──
    const paramsHeader = document.createElement('div');
    paramsHeader.className = 'edit-panel-params-header';

    const paramsLabel       = document.createElement('span');
    paramsLabel.className   = 'edit-panel-label';
    paramsLabel.textContent = 'Parameters';

    const addParamBtn       = document.createElement('button');
    addParamBtn.className   = 'btn btn-secondary btn-xs';
    addParamBtn.textContent = '+ Add';

    paramsHeader.append(paramsLabel, addParamBtn);

    const editParamsList = document.createElement('div');
    editParamsList.className = 'edit-params-list';

    const renderEditParams = () => {
      editParamsList.querySelectorAll('.param-row').forEach(el => el.remove());
      editParams.forEach(param => {
        editParamsList.appendChild(this._buildEditParamRow(param, editParams, renderEditParams));
      });
    };

    addParamBtn.addEventListener('click', () => {
      editParams.push({ id: nextId++, enabled: true, key: '', value: '' });
      renderEditParams();
      editParamsList.lastElementChild?.querySelector('.param-key')?.focus();
    });

    // ── Actions ──
    const actions = document.createElement('div');
    actions.className = 'edit-panel-actions';

    const cancelBtn       = document.createElement('button');
    cancelBtn.className   = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      // Restore the deep copy so re-opening shows original values
      editParams = originalParams.map((p, i) => ({ id: i, ...p }));
      nextId     = editParams.length;
      renderEditParams();
      nameInput.value = originalName;

      panel.classList.add('hidden');
      entry.querySelector('.profile-row').classList.remove('editing');
      this._activeEditPanel = null;
      this._activeEditRow   = null;
    });

    const saveBtn       = document.createElement('button');
    saveBtn.className   = 'btn btn-primary';
    saveBtn.textContent = 'Save Changes';
    saveBtn.addEventListener('click', async () => {
      const newName = nameInput.value.trim();
      if (!newName) { nameInput.focus(); return; }

      const serialized = editParams.map(({ enabled, key, value }) => ({ enabled, key, value }));

      if (newName !== originalName) {
        await this._storage.deleteProfile(originalName);
      }
      await this._storage.saveProfile(newName, serialized);
      this.render();
    });

    actions.append(cancelBtn, saveBtn);

    renderEditParams();
    panel.append(nameRow, paramsHeader, editParamsList, actions);
    return panel;
  }

  _buildEditParamRow(param, editParams, rerenderFn) {
    const row = document.createElement('div');
    row.className = 'param-row' + (param.enabled ? '' : ' disabled');

    // Toggle
    const toggleWrapper = document.createElement('div');
    toggleWrapper.className = 'toggle-wrapper';
    const label   = document.createElement('label');
    label.className = 'toggle';
    label.title   = param.enabled ? 'Disable' : 'Enable';
    const checkbox = document.createElement('input');
    checkbox.type    = 'checkbox';
    checkbox.checked = param.enabled;
    checkbox.addEventListener('change', () => {
      param.enabled = checkbox.checked;
      row.classList.toggle('disabled', !param.enabled);
      label.title = param.enabled ? 'Disable' : 'Enable';
    });
    const track = document.createElement('span');
    track.className = 'toggle-track';
    label.append(checkbox, track);
    toggleWrapper.appendChild(label);

    // Key
    const keyInput       = document.createElement('input');
    keyInput.type        = 'text';
    keyInput.className   = 'param-key';
    keyInput.value       = param.key;
    keyInput.placeholder = 'key';
    keyInput.spellcheck  = false;
    keyInput.addEventListener('input', () => { param.key = keyInput.value; });

    // Value
    const valueInput       = document.createElement('input');
    valueInput.type        = 'text';
    valueInput.className   = 'param-value';
    valueInput.value       = param.value;
    valueInput.placeholder = 'value';
    valueInput.spellcheck  = false;
    valueInput.addEventListener('input', () => { param.value = valueInput.value; });

    // Delete
    const deleteBtn       = document.createElement('button');
    deleteBtn.className   = 'btn-delete';
    deleteBtn.title       = 'Remove';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', () => {
      const idx = editParams.findIndex(p => p.id === param.id);
      if (idx !== -1) editParams.splice(idx, 1);
      rerenderFn();
    });

    row.append(toggleWrapper, keyInput, valueInput, deleteBtn);
    return row;
  }

  // ── Save new profile ─────────────────────────────────────────────────────────

  _bindEvents() {
    this._saveProfileBtn.addEventListener('click', async () => {
      const name = this._profileNameInput.value.trim();
      if (!name) { this._profileNameInput.focus(); return; }
      await this._storage.saveProfile(name, this._getParams());
      this._profileNameInput.value = '';
      this.render();
    });

    this._profileNameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._saveProfileBtn.click();
    });
  }
}
