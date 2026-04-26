import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ProfilesController } from '../profiles.js';

function setupDOM() {
  // create-profile-panel starts hidden (matches real popup.html behaviour)
  // so that selectors for the edit panel don't accidentally match it.
  document.body.innerHTML = `
    <button id="create-profile-btn">+ New</button>
    <div id="create-profile-panel" class="profile-edit-panel hidden"></div>
    <div id="profiles-list">
      <div class="params-empty" id="profiles-empty">No saved profiles</div>
    </div>
  `;
}

function makeStorage(overrides = {}) {
  return {
    readProfiles:  vi.fn().mockResolvedValue({}),
    saveProfile:   vi.fn().mockResolvedValue(undefined),
    deleteProfile: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeController(storageOverrides = {}, callbacks = {}) {
  const storage = makeStorage(storageOverrides);
  const ctrl = new ProfilesController(storage, {
    enableProfile:    callbacks.enableProfile    ?? vi.fn(),
    onProfilesChange: callbacks.onProfilesChange ?? vi.fn(),
  });
  return { ctrl, storage };
}

// Flush all pending promise microtasks (async event handler continuations).
const flush = () => new Promise(r => setTimeout(r, 0));

// Return the currently-open (non-hidden) profile edit panel.
function openEditPanel() {
  return document.querySelector('.profile-entry .profile-edit-panel:not(.hidden)');
}

describe('ProfilesController', () => {
  beforeEach(() => {
    setupDOM();
  });

  // ── constructor ──────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('initialises without getParams or getHeaders callbacks', () => {
      expect(() => makeController()).not.toThrow();
    });
  });

  // ── render ───────────────────────────────────────────────────────────────────

  describe('render', () => {
    it('shows the empty state when there are no profiles', async () => {
      const { ctrl } = makeController();
      await ctrl.render();
      expect(document.getElementById('profiles-empty').style.display).toBe('block');
    });

    it('hides the empty state when profiles exist', async () => {
      const { ctrl } = makeController({
        readProfiles: vi.fn().mockResolvedValue({
          Dev: { params: [], headers: [] },
        }),
      });
      await ctrl.render();
      expect(document.getElementById('profiles-empty').style.display).toBe('none');
    });

    it('renders one .profile-entry per profile', async () => {
      const { ctrl } = makeController({
        readProfiles: vi.fn().mockResolvedValue({
          Dev:  { params: [], headers: [] },
          Prod: { params: [], headers: [] },
        }),
      });
      await ctrl.render();
      expect(document.querySelectorAll('.profile-entry').length).toBe(2);
    });

    it('displays the profile name in its row', async () => {
      const { ctrl } = makeController({
        readProfiles: vi.fn().mockResolvedValue({
          Staging: { params: [], headers: [] },
        }),
      });
      await ctrl.render();
      expect(document.querySelector('.profile-name').textContent).toBe('Staging');
    });

    it('clears previously rendered entries on re-render', async () => {
      const readProfiles = vi.fn()
        .mockResolvedValueOnce({ Dev:  { params: [], headers: [] } })
        .mockResolvedValueOnce({ Prod: { params: [], headers: [] } });
      const { ctrl } = makeController({ readProfiles });

      await ctrl.render();
      expect(document.querySelectorAll('.profile-entry').length).toBe(1);

      await ctrl.render();
      expect(document.querySelectorAll('.profile-entry').length).toBe(1);
      expect(document.querySelector('.profile-name').textContent).toBe('Prod');
    });
  });

  // ── profile deletion ─────────────────────────────────────────────────────────

  describe('profile deletion', () => {
    async function renderOne(storageOverrides = {}, callbacks = {}) {
      const { ctrl, storage } = makeController(
        {
          readProfiles: vi.fn().mockResolvedValue({ Dev: { params: [], headers: [] } }),
          ...storageOverrides,
        },
        callbacks,
      );
      await ctrl.render();
      return { ctrl, storage };
    }

    it('calls storage.deleteProfile with the profile name', async () => {
      const { storage } = await renderOne();
      document.querySelector('.btn-delete').click();
      expect(storage.deleteProfile).toHaveBeenCalledWith('Dev');
    });

    it('removes the profile entry from the DOM after deletion', async () => {
      await renderOne();
      document.querySelector('.btn-delete').click();
      await flush();
      expect(document.querySelectorAll('.profile-entry').length).toBe(0);
    });

    it('shows the empty state after the last profile is deleted', async () => {
      await renderOne();
      document.querySelector('.btn-delete').click();
      await flush();
      expect(document.getElementById('profiles-empty').style.display).toBe('block');
    });

    it('fires onProfilesChange after deletion', async () => {
      const onProfilesChange = vi.fn();
      await renderOne({}, { onProfilesChange });
      document.querySelector('.btn-delete').click();
      await flush();
      expect(onProfilesChange).toHaveBeenCalled();
    });
  });

  // ── apply (enableProfile callback) ──────────────────────────────────────────

  describe('apply', () => {
    it('calls the enableProfile callback with the profile name', async () => {
      const enableProfile = vi.fn();
      const { ctrl } = makeController(
        { readProfiles: vi.fn().mockResolvedValue({ Dev: { params: [], headers: [] } }) },
        { enableProfile },
      );
      await ctrl.render();
      document.querySelector('.btn-apply').click();
      expect(enableProfile).toHaveBeenCalledWith('Dev');
    });
  });

  // ── profile creation via + New panel ─────────────────────────────────────────

  describe('profile creation via + New panel', () => {
    function openCreatePanel() {
      document.getElementById('create-profile-btn').click();
    }

    it('saves a new profile when Create is clicked with a valid name', async () => {
      const storage = makeStorage();
      new ProfilesController(storage, { enableProfile: vi.fn(), onProfilesChange: vi.fn() });

      openCreatePanel();
      document.querySelector('#create-profile-panel .profile-edit-name').value = 'NewProfile';
      document.querySelector('#create-profile-panel .btn-primary').click();

      expect(storage.saveProfile).toHaveBeenCalledWith('NewProfile', [], []);
    });

    it('fires onProfilesChange after creating a profile', async () => {
      const onProfilesChange = vi.fn();
      new ProfilesController(makeStorage(), { enableProfile: vi.fn(), onProfilesChange });

      openCreatePanel();
      document.querySelector('#create-profile-panel .profile-edit-name').value = 'Test';
      document.querySelector('#create-profile-panel .btn-primary').click();
      await flush();

      expect(onProfilesChange).toHaveBeenCalled();
    });

    it('does not save when the name input is empty', async () => {
      const storage = makeStorage();
      new ProfilesController(storage, { enableProfile: vi.fn(), onProfilesChange: vi.fn() });

      openCreatePanel();
      // Name input left empty
      document.querySelector('#create-profile-panel .btn-primary').click();

      expect(storage.saveProfile).not.toHaveBeenCalled();
    });

    it('includes params added in the create panel', async () => {
      const storage = makeStorage();
      new ProfilesController(storage, { enableProfile: vi.fn(), onProfilesChange: vi.fn() });

      openCreatePanel();

      // Add a param row then fill it in
      document.querySelector('#create-profile-panel .btn-secondary').click();
      const paramRow = document.querySelector('#create-profile-panel .param-row');
      paramRow.querySelector('.param-key').value = 'foo';
      paramRow.querySelector('.param-key').dispatchEvent(new Event('input'));
      paramRow.querySelector('.param-value').value = 'bar';
      paramRow.querySelector('.param-value').dispatchEvent(new Event('input'));

      document.querySelector('#create-profile-panel .profile-edit-name').value = 'WithParams';
      document.querySelector('#create-profile-panel .btn-primary').click();

      expect(storage.saveProfile).toHaveBeenCalledWith(
        'WithParams',
        [{ enabled: true, key: 'foo', value: 'bar' }],
        [],
      );
    });

    it('hides the create panel after a successful create', async () => {
      new ProfilesController(makeStorage(), { enableProfile: vi.fn(), onProfilesChange: vi.fn() });

      openCreatePanel();
      document.querySelector('#create-profile-panel .profile-edit-name').value = 'Temp';
      document.querySelector('#create-profile-panel .btn-primary').click();
      await flush();

      expect(document.getElementById('create-profile-panel').classList.contains('hidden')).toBe(true);
    });
  });

  // ── profile editing ──────────────────────────────────────────────────────────

  describe('profile editing', () => {
    async function renderForEdit(profileName = 'Dev', params = [], headers = []) {
      const storage = makeStorage({
        readProfiles: vi.fn().mockResolvedValue({
          [profileName]: { params, headers },
        }),
      });
      const ctrl = new ProfilesController(storage, {
        enableProfile:    vi.fn(),
        onProfilesChange: vi.fn(),
      });
      await ctrl.render();
      return { ctrl, storage };
    }

    it('opens the edit panel when the Edit button is clicked', async () => {
      await renderForEdit();
      document.querySelector('.btn-edit').click();
      expect(document.querySelector('.profile-entry .profile-edit-panel').classList.contains('hidden')).toBe(false);
    });

    it('saves changes with a new name', async () => {
      const { storage } = await renderForEdit('OldName');
      document.querySelector('.btn-edit').click();

      openEditPanel().querySelector('.profile-edit-name').value = 'NewName';
      openEditPanel().querySelector('.btn-primary').click();
      await flush();

      expect(storage.deleteProfile).toHaveBeenCalledWith('OldName');
      expect(storage.saveProfile).toHaveBeenCalledWith('NewName', [], []);
    });

    it('does not call deleteProfile when the name is unchanged', async () => {
      const { storage } = await renderForEdit('Dev');
      document.querySelector('.btn-edit').click();

      // Name stays 'Dev' — no change
      openEditPanel().querySelector('.btn-primary').click();
      await flush();

      expect(storage.deleteProfile).not.toHaveBeenCalled();
      expect(storage.saveProfile).toHaveBeenCalledWith('Dev', [], []);
    });

    it('fires onProfilesChange after saving changes', async () => {
      const onProfilesChange = vi.fn();
      const storage = makeStorage({
        readProfiles: vi.fn().mockResolvedValue({ Dev: { params: [], headers: [] } }),
      });
      const ctrl = new ProfilesController(storage, { enableProfile: vi.fn(), onProfilesChange });
      await ctrl.render();

      document.querySelector('.btn-edit').click();
      openEditPanel().querySelector('.btn-primary').click();
      await flush();

      expect(onProfilesChange).toHaveBeenCalled();
    });

    it('discards changes when Cancel is clicked', async () => {
      const { storage } = await renderForEdit('Dev');
      document.querySelector('.btn-edit').click();

      openEditPanel().querySelector('.profile-edit-name').value = 'ShouldNotBeSaved';
      openEditPanel().querySelector('.btn-ghost').click();

      expect(storage.saveProfile).not.toHaveBeenCalled();
      expect(document.querySelector('.profile-entry .profile-edit-panel').classList.contains('hidden')).toBe(true);
    });
  });
});
