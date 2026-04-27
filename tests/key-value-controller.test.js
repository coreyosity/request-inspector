import { describe, it, expect, vi } from 'vitest';
import { KeyValueController } from '../key-value-controller.js';

function makeCtrl() {
  return new KeyValueController();
}

function makeItem(overrides = {}) {
  return { id: 0, enabled: true, key: 'k', value: 'v', ...overrides };
}

describe('KeyValueController', () => {

  // ── Initial state ──────────────────────────────────────────────────────────

  describe('initial state', () => {
    it('sets _nextId to 0', () => {
      expect(makeCtrl()._nextId).toBe(0);
    });

    it('sets _enabledProfile to null', () => {
      expect(makeCtrl()._enabledProfile).toBeNull();
    });
  });

  // ── _buildItemRow ──────────────────────────────────────────────────────────

  describe('_buildItemRow', () => {

    // ── Structure ────────────────────────────────────────────────────────────

    it('returns a .param-row element with data-id matching item.id', () => {
      const row = makeCtrl()._buildItemRow(makeItem({ id: 7 }));
      expect(row.classList.contains('param-row')).toBe(true);
      expect(row.dataset.id).toBe('7');
    });

    it('adds the disabled class when item.enabled is false', () => {
      const row = makeCtrl()._buildItemRow(makeItem({ enabled: false }));
      expect(row.classList.contains('disabled')).toBe(true);
    });

    it('does not add the disabled class when item.enabled is true', () => {
      const row = makeCtrl()._buildItemRow(makeItem({ enabled: true }));
      expect(row.classList.contains('disabled')).toBe(false);
    });

    it('appends extraClass alongside param-row', () => {
      const row = makeCtrl()._buildItemRow(makeItem(), { extraClass: 'source-default' });
      expect(row.classList.contains('param-row')).toBe(true);
      expect(row.classList.contains('source-default')).toBe(true);
    });

    it('does not add a spurious extra class when extraClass is omitted', () => {
      const row = makeCtrl()._buildItemRow(makeItem());
      expect(row.className.trim()).toBe('param-row');
    });

    // ── Toggle ───────────────────────────────────────────────────────────────

    it('toggle checkbox reflects item.enabled', () => {
      const row = makeCtrl()._buildItemRow(makeItem({ enabled: false }));
      expect(row.querySelector('input[type="checkbox"]').checked).toBe(false);
    });

    it('toggle mutates item.enabled and updates the disabled class', () => {
      const item = makeItem({ enabled: true });
      const row  = makeCtrl()._buildItemRow(item);
      const cb   = row.querySelector('input[type="checkbox"]');

      cb.checked = false;
      cb.dispatchEvent(new Event('change'));

      expect(item.enabled).toBe(false);
      expect(row.classList.contains('disabled')).toBe(true);
    });

    it('toggle calls onToggle with the new enabled value', () => {
      const onToggle = vi.fn();
      const row = makeCtrl()._buildItemRow(makeItem({ enabled: true }), { onToggle });
      const cb  = row.querySelector('input[type="checkbox"]');

      cb.checked = false;
      cb.dispatchEvent(new Event('change'));

      expect(onToggle).toHaveBeenCalledOnce();
      expect(onToggle).toHaveBeenCalledWith(false);
    });

    it('toggle label title uses noun and reflects current enabled state', () => {
      const item  = makeItem({ enabled: true });
      const row   = makeCtrl()._buildItemRow(item, { noun: 'parameter' });
      const label = row.querySelector('label.toggle');

      expect(label.title).toBe('Disable parameter');

      const cb = row.querySelector('input[type="checkbox"]');
      cb.checked = false;
      cb.dispatchEvent(new Event('change'));

      expect(label.title).toBe('Enable parameter');
    });

    // ── Key input ────────────────────────────────────────────────────────────

    it('key input carries the item key value and placeholder', () => {
      const row = makeCtrl()._buildItemRow(makeItem({ key: 'myKey' }), { keyPlaceholder: 'header name' });
      const ki  = row.querySelector('.param-key');
      expect(ki.value).toBe('myKey');
      expect(ki.placeholder).toBe('header name');
    });

    it('key input is not readOnly by default', () => {
      expect(makeCtrl()._buildItemRow(makeItem()).querySelector('.param-key').readOnly).toBe(false);
    });

    it('key input event mutates item.key and calls onKeyChange', () => {
      const onKeyChange = vi.fn();
      const item = makeItem({ key: 'old' });
      const row  = makeCtrl()._buildItemRow(item, { onKeyChange });
      const ki   = row.querySelector('.param-key');

      ki.value = 'new';
      ki.dispatchEvent(new Event('input'));

      expect(item.key).toBe('new');
      expect(onKeyChange).toHaveBeenCalledOnce();
    });

    // ── Value input ──────────────────────────────────────────────────────────

    it('value input carries the item value', () => {
      const row = makeCtrl()._buildItemRow(makeItem({ value: 'hello' }));
      expect(row.querySelector('.param-value').value).toBe('hello');
    });

    it('value input event mutates item.value and calls onValueChange', () => {
      const onValueChange = vi.fn();
      const item = makeItem({ value: 'old' });
      const row  = makeCtrl()._buildItemRow(item, { onValueChange });
      const vi_  = row.querySelector('.param-value');

      vi_.value = 'updated';
      vi_.dispatchEvent(new Event('input'));

      expect(item.value).toBe('updated');
      expect(onValueChange).toHaveBeenCalledOnce();
    });

    // ── Delete button ─────────────────────────────────────────────────────────

    it('renders a delete button when onDelete is provided', () => {
      const row = makeCtrl()._buildItemRow(makeItem(), { onDelete: vi.fn() });
      expect(row.querySelector('.btn-delete')).toBeTruthy();
    });

    it('delete button title uses noun', () => {
      const row = makeCtrl()._buildItemRow(makeItem(), { noun: 'header', onDelete: vi.fn() });
      expect(row.querySelector('.btn-delete').title).toBe('Remove header');
    });

    it('delete removes the row from the DOM before calling onDelete', () => {
      const onDelete = vi.fn();
      const row      = makeCtrl()._buildItemRow(makeItem(), { onDelete });
      const container = document.createElement('div');
      container.appendChild(row);

      row.querySelector('.btn-delete').click();

      expect(container.contains(row)).toBe(false);
      expect(onDelete).toHaveBeenCalledOnce();
    });

    it('renders a spacer div when onDelete is not provided', () => {
      const row = makeCtrl()._buildItemRow(makeItem());
      expect(row.querySelector('.btn-delete')).toBeNull();
      expect(row.lastElementChild.tagName).toBe('DIV');
    });

    // ── readOnly mode ────────────────────────────────────────────────────────

    it('readOnly: key and value inputs have readOnly=true', () => {
      const row = makeCtrl()._buildItemRow(makeItem(), { readOnly: true });
      expect(row.querySelector('.param-key').readOnly).toBe(true);
      expect(row.querySelector('.param-value').readOnly).toBe(true);
    });

    it('readOnly: no delete button even when onDelete is provided', () => {
      const row = makeCtrl()._buildItemRow(makeItem(), { readOnly: true, onDelete: vi.fn() });
      expect(row.querySelector('.btn-delete')).toBeNull();
    });

    it('readOnly: spacer div is rendered in the delete column', () => {
      const row = makeCtrl()._buildItemRow(makeItem(), { readOnly: true });
      expect(row.lastElementChild.tagName).toBe('DIV');
    });

    it('readOnly: key input events do not call onKeyChange', () => {
      const onKeyChange = vi.fn();
      const row = makeCtrl()._buildItemRow(makeItem(), { readOnly: true, onKeyChange });
      const ki  = row.querySelector('.param-key');

      ki.value = 'changed';
      ki.dispatchEvent(new Event('input'));

      expect(onKeyChange).not.toHaveBeenCalled();
    });

    it('readOnly: value input events do not call onValueChange', () => {
      const onValueChange = vi.fn();
      const row = makeCtrl()._buildItemRow(makeItem(), { readOnly: true, onValueChange });
      const vi_ = row.querySelector('.param-value');

      vi_.value = 'changed';
      vi_.dispatchEvent(new Event('input'));

      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  // ── _buildGroupLabel ───────────────────────────────────────────────────────

  describe('_buildGroupLabel', () => {
    it('returns a div with params-source-header and the given typeClass', () => {
      const label = makeCtrl()._buildGroupLabel('My Group', 'source-custom');
      expect(label.tagName).toBe('DIV');
      expect(label.classList.contains('params-source-header')).toBe(true);
      expect(label.classList.contains('source-custom')).toBe(true);
    });

    it('defaults typeClass to source-profile', () => {
      const label = makeCtrl()._buildGroupLabel('Dev');
      expect(label.classList.contains('source-profile')).toBe(true);
    });

    it('contains a .params-source-name span with the display name', () => {
      const label  = makeCtrl()._buildGroupLabel('Staging');
      const nameEl = label.querySelector('.params-source-name');
      expect(nameEl).toBeTruthy();
      expect(nameEl.textContent).toBe('Staging');
    });

    it('contains a .params-source-line span', () => {
      expect(makeCtrl()._buildGroupLabel('x').querySelector('.params-source-line')).toBeTruthy();
    });

    it('allows additional children to be appended after construction', () => {
      const label  = makeCtrl()._buildGroupLabel('Dev');
      const toggle = document.createElement('label');
      label.appendChild(toggle);
      expect(label.lastElementChild).toBe(toggle);
    });
  });

  // ── _buildProfileGroupWrapper ──────────────────────────────────────────────

  describe('_buildProfileGroupWrapper', () => {
    it('returns a div with class profile-group', () => {
      const w = makeCtrl()._buildProfileGroupWrapper('Dev', true);
      expect(w.tagName).toBe('DIV');
      expect(w.classList.contains('profile-group')).toBe(true);
    });

    it('does not add inactive class when isActive is true', () => {
      expect(makeCtrl()._buildProfileGroupWrapper('Dev', true).classList.contains('inactive')).toBe(false);
    });

    it('adds inactive class when isActive is false', () => {
      expect(makeCtrl()._buildProfileGroupWrapper('Dev', false).classList.contains('inactive')).toBe(true);
    });
  });
});
