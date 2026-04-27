/**
 * MIT License
 * Copyright (c) 2026 Corey
 * See LICENSE file for full text.
 *
 * key-value-controller.js — KeyValueController
 * Shared base class for InspectorController and HeadersController.
 * Holds the common state (_nextId, _enabledProfile) and the DOM building
 * methods that both sub-tabs use: item rows, group labels, and profile-group
 * wrappers. Application-layer logic (URL building, declarativeNetRequest,
 * storage reads) stays in the respective subclasses.
 */

'use strict';

export class KeyValueController {
  constructor() {
    this._nextId         = 0;
    this._enabledProfile = null;
  }

  // ── Row building ─────────────────────────────────────────────────────────────

  /**
   * Build a key/value item row (toggle · key input · value input · delete).
   *
   * The item object is mutated in-place when the key or value inputs change.
   * When a delete button is present, the row is removed from the DOM before
   * onDelete() fires so callers only need to clean up array/state.
   *
   * @param {{ id: number, enabled: boolean, key: string, value: string }} item
   * @param {{
   *   noun?:         string,   — used in toggle title and delete title
   *   keyPlaceholder?: string,
   *   extraClass?:   string,   — appended to "param-row …"
   *   readOnly?:     boolean,  — disables inputs and omits delete button
   *   onToggle?:     (enabled: boolean) => void,
   *   onKeyChange?:  () => void,
   *   onValueChange?: () => void,
   *   onDelete?:     () => void,  — only called when !readOnly
   * }} [opts]
   * @returns {HTMLDivElement}
   */
  _buildItemRow(item, {
    noun           = 'item',
    keyPlaceholder = 'key',
    extraClass     = '',
    readOnly       = false,
    onToggle,
    onKeyChange,
    onValueChange,
    onDelete,
  } = {}) {
    const row = document.createElement('div');
    row.className  = `param-row${extraClass ? ' ' + extraClass : ''}${item.enabled ? '' : ' disabled'}`;
    row.dataset.id = item.id;

    // ── Toggle ──
    const toggleWrapper     = document.createElement('div');
    toggleWrapper.className = 'toggle-wrapper';
    const label             = document.createElement('label');
    label.className         = 'toggle';
    label.title             = item.enabled ? `Disable ${noun}` : `Enable ${noun}`;
    const checkbox          = document.createElement('input');
    checkbox.type           = 'checkbox';
    checkbox.checked        = item.enabled;
    checkbox.addEventListener('change', () => {
      item.enabled = checkbox.checked;
      row.classList.toggle('disabled', !item.enabled);
      label.title = item.enabled ? `Disable ${noun}` : `Enable ${noun}`;
      if (onToggle) onToggle(item.enabled);
    });
    const track     = document.createElement('span');
    track.className = 'toggle-track';
    label.append(checkbox, track);
    toggleWrapper.appendChild(label);

    // ── Key input ──
    const keyInput       = document.createElement('input');
    keyInput.type        = 'text';
    keyInput.className   = 'param-key';
    keyInput.value       = item.key;
    keyInput.placeholder = keyPlaceholder;
    keyInput.spellcheck  = false;
    keyInput.readOnly    = readOnly;
    if (!readOnly) {
      keyInput.addEventListener('input', () => {
        item.key = keyInput.value;
        if (onKeyChange) onKeyChange();
      });
    }

    // ── Value input ──
    const valueInput       = document.createElement('input');
    valueInput.type        = 'text';
    valueInput.className   = 'param-value';
    valueInput.value       = item.value;
    valueInput.placeholder = 'value';
    valueInput.spellcheck  = false;
    valueInput.readOnly    = readOnly;
    if (!readOnly) {
      valueInput.addEventListener('input', () => {
        item.value = valueInput.value;
        if (onValueChange) onValueChange();
      });
    }

    // ── Delete button or alignment spacer ──
    if (onDelete && !readOnly) {
      const deleteBtn       = document.createElement('button');
      deleteBtn.className   = 'btn-delete';
      deleteBtn.title       = `Remove ${noun}`;
      deleteBtn.textContent = '×';
      deleteBtn.addEventListener('click', () => {
        row.remove();
        onDelete();
      });
      row.append(toggleWrapper, keyInput, valueInput, deleteBtn);
    } else {
      row.append(toggleWrapper, keyInput, valueInput, document.createElement('div'));
    }

    return row;
  }

  // ── Group helpers ────────────────────────────────────────────────────────────

  /**
   * Build a .params-source-header div containing the group name and a
   * decorative line. Both InspectorController (via _buildGroupHeader) and
   * HeadersController (directly) extend this label with their own controls.
   *
   * @param {string} displayName
   * @param {string} [typeClass]  CSS modifier, e.g. 'source-profile'
   * @returns {HTMLDivElement}
   */
  _buildGroupLabel(displayName, typeClass = 'source-profile') {
    const header     = document.createElement('div');
    header.className = `params-source-header ${typeClass}`;

    const nameEl       = document.createElement('span');
    nameEl.className   = 'params-source-name';
    nameEl.textContent = displayName;

    const line     = document.createElement('span');
    line.className = 'params-source-line';

    header.append(nameEl, line);
    return header;
  }

  /**
   * Build a .profile-group wrapper div with the correct active/inactive class.
   *
   * @param {string}  profileName
   * @param {boolean} isActive
   * @returns {HTMLDivElement}
   */
  _buildProfileGroupWrapper(profileName, isActive) {
    const wrapper     = document.createElement('div');
    wrapper.className = 'profile-group' + (isActive ? '' : ' inactive');
    return wrapper;
  }
}
