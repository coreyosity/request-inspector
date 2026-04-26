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
  constructor(storage, { enableProfile, onProfilesChange }) {
    this._storage           = storage;
    this._enableProfile     = enableProfile;
    this._onProfilesChange  = onProfilesChange ?? null;

    /** @type {HTMLElement | null} Currently open edit panel. */
    this._activeEditPanel = null;
    /** @type {HTMLElement | null} Profile row whose panel is open. */
    this._activeEditRow   = null;

    // DOM refs
    this._createProfileBtn   = document.getElementById('create-profile-btn');
    this._createProfilePanel = document.getElementById('create-profile-panel');
    this._profilesList       = document.getElementById('profiles-list');
    this._profilesEmpty      = document.getElementById('profiles-empty');

    this._initCreatePanel();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Fetch profiles from storage and re-render the list. */
  async render() {
    this._activeEditPanel = null;
    this._activeEditRow   = null;
    this._createProfilePanel.classList.add('hidden');
    this._createProfileBtn.textContent = '+ New';
    this._profilesList.querySelectorAll('.profile-entry').forEach(el => el.remove());
    const profiles = await this._storage.readProfiles();
    const names    = Object.keys(profiles);
    this._profilesEmpty.style.display = names.length === 0 ? 'block' : 'none';
    names.forEach(name => {
      this._profilesList.appendChild(
        this._buildEntry(name, profiles[name].params, profiles[name].headers ?? [])
      );
    });
  }

  // ── Entry (row + edit panel) ─────────────────────────────────────────────────

  _buildEntry(name, params, headers) {
    const entry = document.createElement('div');
    entry.className = 'profile-entry';

    const row       = this._buildRow(name, params, headers, entry);
    const editPanel = this._buildEditPanel(name, params, headers, entry);

    entry.append(row, editPanel);
    return entry;
  }

  _buildRow(name, params, headers, entry) {
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
    loadBtn.addEventListener('click', () => this._enableProfile(name));

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
      if (this._onProfilesChange) this._onProfilesChange();
    });

    row.append(nameEl, editBtn, loadBtn, deleteBtn);
    return row;
  }

  // ── Edit panel ───────────────────────────────────────────────────────────────

  _buildEditPanel(originalName, originalParams, originalHeaders, entry) {
    // Deep-copies so Cancel truly discards changes
    let editParams   = originalParams.map((p, i) => ({ id: i, ...p }));
    let editHeaders  = originalHeaders.map((h, i) => ({ id: i, ...h }));
    let nextParamId  = editParams.length;
    let nextHeaderId = editHeaders.length;

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
        editParamsList.appendChild(this._buildEditRow(param, editParams, renderEditParams));
      });
    };

    addParamBtn.addEventListener('click', () => {
      editParams.push({ id: nextParamId++, enabled: true, key: '', value: '' });
      renderEditParams();
      editParamsList.lastElementChild?.querySelector('.param-key')?.focus();
    });

    // ── Headers sub-list ──
    const headersHeader = document.createElement('div');
    headersHeader.className = 'edit-panel-params-header';

    const headersLabel       = document.createElement('span');
    headersLabel.className   = 'edit-panel-label';
    headersLabel.textContent = 'Headers';

    const addHeaderBtn       = document.createElement('button');
    addHeaderBtn.className   = 'btn btn-secondary btn-xs';
    addHeaderBtn.textContent = '+ Add';

    headersHeader.append(headersLabel, addHeaderBtn);

    const editHeadersList = document.createElement('div');
    editHeadersList.className = 'edit-params-list';

    const renderEditHeaders = () => {
      editHeadersList.querySelectorAll('.param-row').forEach(el => el.remove());
      editHeaders.forEach(header => {
        editHeadersList.appendChild(
          this._buildEditRow(header, editHeaders, renderEditHeaders, 'header name')
        );
      });
    };

    addHeaderBtn.addEventListener('click', () => {
      editHeaders.push({ id: nextHeaderId++, enabled: true, key: '', value: '' });
      renderEditHeaders();
      editHeadersList.lastElementChild?.querySelector('.param-key')?.focus();
    });

    // ── Actions ──
    const actions = document.createElement('div');
    actions.className = 'edit-panel-actions';

    const cancelBtn       = document.createElement('button');
    cancelBtn.className   = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      editParams  = originalParams.map((p, i) => ({ id: i, ...p }));
      editHeaders = originalHeaders.map((h, i) => ({ id: i, ...h }));
      nextParamId  = editParams.length;
      nextHeaderId = editHeaders.length;
      renderEditParams();
      renderEditHeaders();
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

      const serializedParams   = editParams.map(({ enabled, key, value }) => ({ enabled, key, value }));
      const serializedHeaders  = editHeaders.map(({ enabled, key, value }) => ({ enabled, key, value }));

      if (newName !== originalName) {
        await this._storage.deleteProfile(originalName);
      }
      await this._storage.saveProfile(newName, serializedParams, serializedHeaders);
      if (this._onProfilesChange) this._onProfilesChange();
      this.render();
    });

    actions.append(cancelBtn, saveBtn);

    renderEditParams();
    renderEditHeaders();
    panel.append(nameRow, paramsHeader, editParamsList, headersHeader, editHeadersList, actions);
    return panel;
  }

  _buildEditRow(item, list, rerenderFn, keyPlaceholder = 'key') {
    const row = document.createElement('div');
    row.className = 'param-row' + (item.enabled ? '' : ' disabled');

    // Toggle
    const toggleWrapper = document.createElement('div');
    toggleWrapper.className = 'toggle-wrapper';
    const label   = document.createElement('label');
    label.className = 'toggle';
    label.title   = item.enabled ? 'Disable' : 'Enable';
    const checkbox = document.createElement('input');
    checkbox.type    = 'checkbox';
    checkbox.checked = item.enabled;
    checkbox.addEventListener('change', () => {
      item.enabled = checkbox.checked;
      row.classList.toggle('disabled', !item.enabled);
      label.title = item.enabled ? 'Disable' : 'Enable';
    });
    const track = document.createElement('span');
    track.className = 'toggle-track';
    label.append(checkbox, track);
    toggleWrapper.appendChild(label);

    // Key
    const keyInput       = document.createElement('input');
    keyInput.type        = 'text';
    keyInput.className   = 'param-key';
    keyInput.value       = item.key;
    keyInput.placeholder = keyPlaceholder;
    keyInput.spellcheck  = false;
    keyInput.addEventListener('input', () => { item.key = keyInput.value; });

    // Value
    const valueInput       = document.createElement('input');
    valueInput.type        = 'text';
    valueInput.className   = 'param-value';
    valueInput.value       = item.value;
    valueInput.placeholder = 'value';
    valueInput.spellcheck  = false;
    valueInput.addEventListener('input', () => { item.value = valueInput.value; });

    // Delete
    const deleteBtn       = document.createElement('button');
    deleteBtn.className   = 'btn-delete';
    deleteBtn.title       = 'Remove';
    deleteBtn.textContent = '×';
    deleteBtn.addEventListener('click', () => {
      const idx = list.findIndex(x => x.id === item.id);
      if (idx !== -1) list.splice(idx, 1);
      rerenderFn();
    });

    row.append(toggleWrapper, keyInput, valueInput, deleteBtn);
    return row;
  }

  // ── Create panel ─────────────────────────────────────────────────────────────

  _initCreatePanel() {
    let createParams  = [];
    let createHeaders = [];
    let nextParamId   = 0;
    let nextHeaderId  = 0;

    // ── Name field ──
    const nameLabel       = document.createElement('label');
    nameLabel.className   = 'edit-panel-label';
    nameLabel.textContent = 'Name';

    const nameInput      = document.createElement('input');
    nameInput.type       = 'text';
    nameInput.className  = 'input-editable profile-edit-name';
    nameInput.placeholder = 'Profile name…';
    nameInput.spellcheck = false;

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

    const renderParams = () => {
      editParamsList.querySelectorAll('.param-row').forEach(el => el.remove());
      createParams.forEach(p => {
        editParamsList.appendChild(this._buildEditRow(p, createParams, renderParams));
      });
    };

    addParamBtn.addEventListener('click', () => {
      createParams.push({ id: nextParamId++, enabled: true, key: '', value: '' });
      renderParams();
      editParamsList.lastElementChild?.querySelector('.param-key')?.focus();
    });

    // ── Headers sub-list ──
    const headersHeader = document.createElement('div');
    headersHeader.className = 'edit-panel-params-header';

    const headersLabel       = document.createElement('span');
    headersLabel.className   = 'edit-panel-label';
    headersLabel.textContent = 'Headers';

    const addHeaderBtn       = document.createElement('button');
    addHeaderBtn.className   = 'btn btn-secondary btn-xs';
    addHeaderBtn.textContent = '+ Add';

    headersHeader.append(headersLabel, addHeaderBtn);

    const editHeadersList = document.createElement('div');
    editHeadersList.className = 'edit-params-list';

    const renderHeaders = () => {
      editHeadersList.querySelectorAll('.param-row').forEach(el => el.remove());
      createHeaders.forEach(h => {
        editHeadersList.appendChild(
          this._buildEditRow(h, createHeaders, renderHeaders, 'header name')
        );
      });
    };

    addHeaderBtn.addEventListener('click', () => {
      createHeaders.push({ id: nextHeaderId++, enabled: true, key: '', value: '' });
      renderHeaders();
      editHeadersList.lastElementChild?.querySelector('.param-key')?.focus();
    });

    // ── Actions ──
    const actions = document.createElement('div');
    actions.className = 'edit-panel-actions';

    const cancelBtn       = document.createElement('button');
    cancelBtn.className   = 'btn btn-ghost';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      createParams  = [];
      createHeaders = [];
      nextParamId   = 0;
      nextHeaderId  = 0;
      nameInput.value = '';
      renderParams();
      renderHeaders();
      this._createProfilePanel.classList.add('hidden');
      this._createProfileBtn.textContent = '+ New';
    });

    const saveBtn       = document.createElement('button');
    saveBtn.className   = 'btn btn-primary';
    saveBtn.textContent = 'Create';
    saveBtn.addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) { nameInput.focus(); return; }
      const serializedParams  = createParams.map(({ enabled, key, value }) => ({ enabled, key, value }));
      const serializedHeaders = createHeaders.map(({ enabled, key, value }) => ({ enabled, key, value }));
      await this._storage.saveProfile(name, serializedParams, serializedHeaders);
      // Reset panel state
      createParams  = [];
      createHeaders = [];
      nextParamId   = 0;
      nextHeaderId  = 0;
      nameInput.value = '';
      renderParams();
      renderHeaders();
      this._createProfilePanel.classList.add('hidden');
      this._createProfileBtn.textContent = '+ New';
      if (this._onProfilesChange) this._onProfilesChange();
      this.render();
    });

    actions.append(cancelBtn, saveBtn);
    this._createProfilePanel.append(
      nameRow, paramsHeader, editParamsList, headersHeader, editHeadersList, actions
    );

    // Toggle button
    this._createProfileBtn.addEventListener('click', () => {
      // Close any open edit panel first
      if (this._activeEditPanel) {
        this._activeEditPanel.classList.add('hidden');
        this._activeEditRow?.classList.remove('editing');
        this._activeEditPanel = null;
        this._activeEditRow   = null;
      }
      const opening = this._createProfilePanel.classList.contains('hidden');
      this._createProfilePanel.classList.toggle('hidden', !opening);
      this._createProfileBtn.textContent = opening ? '✕ Close' : '+ New';
      if (opening) nameInput.focus();
    });
  }

}
