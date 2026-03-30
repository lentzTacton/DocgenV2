/**
 * Connection Card — Instance Management
 *
 * Manages Tacton CPQ instance connections:
 *   - Inline instance list with star favorites (like ticket card)
 *   - Instance URL + name input
 *   - Admin credentials (client ID + secret)
 *   - Optional frontend credentials (for ticket-scoped tokens)
 *   - Save / Load / Delete instances
 *   - Test connection button
 *   - Auto-selects first favorite on load
 *
 * Wired to state.connection.* and Dexie instance storage.
 */

import { el, qs, clear, show, hide } from '../../core/dom.js';
import { iconEl, icon } from '../../components/icon.js';
import { renderDiagnosticSteps } from '../../components/diagnostic-steps.js';
import state from '../../core/state.js';
import {
  getInstances,
  saveInstance,
  deleteInstance,
  getInstance,
  loadFavorites,
  saveFavorites,
  getSetting,
} from '../../core/storage.js';
import { testAdminCredentials, clearAdminTokenCache } from '../../services/auth.js';

let instanceFavs = new Set();
let allInstances = [];

// Track whether a test has passed (even before saving)
let testPassed = false;

// Local test results per instance (does NOT write to state)
// Map<instanceId, 'ok' | 'error'>
const testResultMap = new Map();

// Currently selected instance ID (from the list)
let selectedInstanceId = null;

// Credential tab state
let activeCredsTab = 'admin';

// Validation steps shown in the tooltip (admin connection)
let validationSteps = [
  { label: 'Instance URL', detail: 'Not configured', status: 'skip' },
  { label: 'Admin Credentials', detail: 'Not configured', status: 'skip' },
  { label: 'Frontend Credentials', detail: 'Not configured (optional)', status: 'skip' },
  { label: 'Admin Token', detail: 'Not tested', status: 'skip' },
];


/**
 * Create the connection management card.
 * @param {HTMLElement} container - Parent element to append into
 */
export function createConnectionCard(container) {
  // ── Instance list (like ticket list) ──
  const instanceList = el('div', { class: 'instance-list', id: 'instance-list' }, [
    el('div', { class: 'empty-state' }, 'No saved instances'),
  ]);

  const addInstanceBtn = el('button', {
    class: 'icon-btn',
    id: 'new-instance-btn',
    title: 'Add instance',
    html: icon('plus', 16),
    onclick: handleNewInstance,
  });

  const instanceHeader = el('div', { class: 'section-header-row' }, [
    el('span', { class: 'field-label', style: { margin: '0' } }, 'Instances'),
    addInstanceBtn,
  ]);

  // ── Form fields (hidden until an instance is selected or "New" is clicked) ──
  const formSection = el('div', {
    id: 'instance-form-section',
    style: { display: 'none' },
  });

  const nameInput = el('input', {
    class: 'input',
    id: 'conn-name',
    type: 'text',
    placeholder: 'Auto-generated from URL if empty',
  });

  const urlInput = el('input', {
    class: 'input',
    id: 'conn-url',
    type: 'url',
    placeholder: 'https://mycompany.cpq.cloud.tacton.com',
    oninput: updateButtonStates,
  });

  // ── Credentials tabs (Admin / Frontend) — 4 real inputs, show/hide pairs ──
  const tabAdmin = el('button', {
    class: 'creds-tab creds-tab-active',
    id: 'creds-tab-admin',
    onclick: () => switchCredsTab('admin'),
  });
  tabAdmin.innerHTML = `Admin <span class="field-required">*</span>`;

  const tabFrontend = el('button', {
    class: 'creds-tab',
    id: 'creds-tab-frontend',
    onclick: () => switchCredsTab('frontend'),
  }, 'Frontend');

  const credsHint = el('div', {
    class: 'field-hint',
    id: 'creds-hint',
  }, 'Instance-level credentials (client_credentials grant)');

  const credsTabs = el('div', { class: 'creds-tab-bar' }, [tabAdmin, tabFrontend]);

  // Admin fields (visible by default)
  const adminIdInput = el('input', {
    class: 'input', id: 'conn-admin-id', type: 'text',
    placeholder: 'Client ID', oninput: updateButtonStates,
  });
  const adminSecretInput = el('input', {
    class: 'input', id: 'conn-admin-secret', type: 'password',
    placeholder: 'Client Secret', oninput: updateButtonStates,
  });
  const adminFields = el('div', { id: 'creds-admin-fields' }, [
    adminIdInput, el('div', { style: { height: '8px' } }), adminSecretInput,
  ]);

  // Frontend fields (hidden by default)
  const frontendIdInput = el('input', {
    class: 'input', id: 'conn-frontend-id', type: 'text',
    placeholder: 'Client ID',
  });
  const frontendSecretInput = el('input', {
    class: 'input', id: 'conn-frontend-secret', type: 'password',
    placeholder: 'Client Secret',
  });
  const frontendFields = el('div', { id: 'creds-frontend-fields', style: { display: 'none' } }, [
    frontendIdInput, el('div', { style: { height: '8px' } }), frontendSecretInput,
  ]);

  const credsSection = el('div', { class: 'creds-section', style: { marginTop: '12px' } }, [
    credsTabs,
    credsHint,
    adminFields,
    frontendFields,
  ]);

  // ── Status indicator (errors/warnings only — success updates the badge) ──
  const statusMsg = el('div', {
    class: 'status-message',
    id: 'conn-status',
    style: { display: 'none' },
  });

  // ── Action buttons (start disabled) ──
  const testBtn = el('button', {
    class: 'btn btn-secondary',
    id: 'conn-test-btn',
    onclick: handleTestConnection,
    disabled: true,
  }, 'Test Connection');

  const saveBtn = el('button', {
    class: 'btn btn-primary',
    id: 'conn-save-btn',
    onclick: handleSaveInstance,
    disabled: true,
  }, 'Save & Connect');

  const actions = el('div', { class: 'card-actions' }, [testBtn, saveBtn]);

  // Assemble form
  formSection.append(
    el('div', { class: 'field-label', style: { marginTop: '12px' } }, 'Instance Name'),
    nameInput,
    el('div', { class: 'field-label', style: { marginTop: '12px' } }, [
      'Instance URL ',
      el('span', { class: 'field-required' }, '*'),
    ]),
    urlInput,
    credsSection,
    statusMsg,
    actions,
  );

  // ── Assemble card ──
  const card = el('div', { class: 'card', id: 'connection-card' }, [
    el('div', { class: 'card-header' }, [
      el('div', { class: 'card-header-left' }, [
        iconEl('link', 20),
        el('div', {}, [
          el('div', { class: 'card-title' }, 'Instance'),
          el('div', { class: 'card-subtitle' }, 'Connect to a Tacton CPQ instance'),
        ]),
      ]),
      el('div', { class: 'card-header-right conn-badge-wrap', id: 'conn-badge' }),
    ]),
    el('div', { class: 'card-body' }, [
      instanceHeader,
      instanceList,
      formSection,
    ]),
  ]);

  container.appendChild(card);

  // Load saved instances and favorites on init, auto-select first favorite
  initInstances();
  updateBadge();

  // React to connection state changes
  state.on('connection.status', updateBadge);

  // Auto-connect when splash triggers reconnect via state flag
  state.on('config.autoConnectPending', async (pending) => {
    if (!pending) return;
    // Clear the flag immediately to avoid re-triggering
    state.set('config.autoConnectPending', false);

    const savedId = state.get('connection.instanceId');
    if (savedId) {
      await selectInstance(savedId, true);
    } else if (allInstances.length > 0) {
      const firstFav = allInstances.find(i => instanceFavs.has(String(i.id)));
      const autoSelect = firstFav || allInstances[0];
      if (autoSelect) await selectInstance(autoSelect.id, true);
    }

  });
}

// ─── Init ────────────────────────────────────────────────────────────────

export async function initInstances() {
  instanceFavs = await loadFavorites('instances');
  allInstances = await getInstances();
  renderInstanceList();

  // Skip auto-connect when config is locked — the boot() function in
  // setup-view handles the connect sequence explicitly and predictably.
  // initInstances still loads the list so the form is ready if the user unlocks.
  const hasLockedConfig = await getSetting('config-locked');
  if (hasLockedConfig) return;

  // Auto-select first favorite, or first instance if none favorited
  if (allInstances.length > 0) {
    const firstFav = allInstances.find(i => instanceFavs.has(String(i.id)));
    const autoSelect = firstFav || allInstances[0];
    if (autoSelect) {
      await selectInstance(autoSelect.id, true);
    }
  }
}

// ─── Handlers ───────────────────────────────────────────────────────────

function handleNewInstance() {
  selectedInstanceId = null;
  clearForm();
  showForm(true);
  const deleteBtn = qs('#conn-delete-btn');
  if (deleteBtn) deleteBtn.style.display = 'none';
  renderInstanceList();
}

async function selectInstance(id, autoConnect = false) {
  const instance = await getInstance(id);
  if (!instance) return;

  selectedInstanceId = id;

  // Populate form
  qs('#conn-name').value = instance.name || '';
  qs('#conn-url').value = instance.url || '';
  qs('#conn-admin-id').value = instance.admin?.clientId || '';
  qs('#conn-admin-secret').value = instance.admin?.clientSecret || '';
  if (qs('#conn-frontend-id')) qs('#conn-frontend-id').value = instance.frontend?.clientId || '';
  if (qs('#conn-frontend-secret')) qs('#conn-frontend-secret').value = instance.frontend?.clientSecret || '';

  // Reset to admin tab
  switchCredsTab('admin');

  showForm(true);
  updateButtonStates();

  // If switching to a different instance than the connected one, reset badge
  const isCurrentlyConnected = state.get('connection.instanceId') === id
    && state.get('connection.status') === 'connected';
  if (!isCurrentlyConnected) {
    testPassed = false;
    updateBadge();
    // Reset validation steps
    updateValidationSteps(instance, null);
  }

  renderInstanceList();

  // Auto-connect if requested (on load)
  if (autoConnect) {
    await handleSaveInstance();
  }
}

async function handleTestConnection() {
  const instance = buildInstanceFromForm();

  const btn = qs('#conn-test-btn');
  // Lock width so the button doesn't shrink when text changes
  btn.style.minWidth = `${btn.offsetWidth}px`;
  btn.textContent = 'Testing…';
  btn.disabled = true;

  // Clear any previous error
  showStatus('', '');

  // Force a fresh client_credentials grant for explicit user test
  clearAdminTokenCache(instance.url);
  const result = await testAdminCredentials(instance, { forceRefresh: true });

  btn.textContent = 'Test Connection';
  btn.disabled = false;

  updateValidationSteps(instance, result);

  if (result.ok) {
    testPassed = true;

    // Store local test result for the dot — does NOT change global connection state
    if (selectedInstanceId) {
      testResultMap.set(selectedInstanceId, 'ok');
    }

    updateBadge();
    renderInstanceList();
    showStatus('', '');
  } else {
    testPassed = false;

    if (selectedInstanceId) {
      testResultMap.set(selectedInstanceId, 'error');
    }

    updateBadge();
    renderInstanceList();
    showStatus(`Connection failed: ${result.error}`, 'error');
  }
}

async function handleSaveInstance() {
  const instance = buildInstanceFromForm();

  const btn = qs('#conn-save-btn');
  btn.style.minWidth = `${btn.offsetWidth}px`;
  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    // Normalize URL: add https:// if no protocol, strip trailing slash
    instance.url = instance.url.trim();
    if (instance.url && !/^https?:\/\//i.test(instance.url)) {
      instance.url = 'https://' + instance.url;
    }
    instance.url = instance.url.replace(/\/+$/, '');

    // Auto-generate name from URL if empty
    if (!instance.name) {
      instance.name = nameFromUrl(instance.url);
    }

    // Check if updating existing
    if (selectedInstanceId) {
      instance.id = selectedInstanceId;
    }

    const saved = await saveInstance(instance);
    selectedInstanceId = saved.id;

    // Test admin credentials — uses Dexie-persisted token when available
    // to avoid a fresh client_credentials grant that can invalidate
    // ticket-scoped tokens sharing the same OAuth clientId.
    // Only the explicit "Test Connection" button forces a fresh grant.
    const test = await testAdminCredentials(saved);

    updateValidationSteps(saved, test);

    // Check if this is a different instance than the currently connected one
    const previousInstanceId = state.get('connection.instanceId');
    const instanceChanged = previousInstanceId && previousInstanceId !== saved.id;

    if (test.ok) {
      testPassed = true;
      testResultMap.set(saved.id, 'ok');

      // Reset downstream selections when switching instances
      if (instanceChanged) {
        state.batch({
          'tickets.list': [],
          'tickets.selected': null,
          'tickets.included': [],
          'tickets.tokenMap': {},
          'startingObject.type': null,
          'startingObject.id': null,
          'startingObject.name': null,
          'startingObject.locked': false,
        });
      }

      // Update connection state
      state.batch({
        'connection.instanceId': saved.id,
        'connection.url': saved.url,
        'connection.status': 'connected',
        'connection.error': null,
      });

      showStatus('', ''); // success: badge updates via state
    } else {
      testPassed = false;
      testResultMap.set(saved.id, 'error');

      // Reset downstream selections when switching instances
      if (instanceChanged) {
        state.batch({
          'tickets.list': [],
          'tickets.selected': null,
          'tickets.included': [],
          'tickets.tokenMap': {},
          'startingObject.type': null,
          'startingObject.id': null,
          'startingObject.name': null,
          'startingObject.locked': false,
        });
      }

      state.batch({
        'connection.instanceId': saved.id,
        'connection.url': saved.url,
        'connection.status': 'error',
        'connection.error': test.error,
      });

      showStatus(`Saved, but credentials failed: ${test.error}`, 'warning');
    }

    // Update name field if auto-generated
    if (!qs('#conn-name').value.trim()) {
      qs('#conn-name').value = saved.name || '';
    }

    // Refresh instance list
    allInstances = await getInstances();
    renderInstanceList();
  } catch (e) {
    showStatus(`Save failed: ${e.message}`, 'error');
  } finally {
    btn.textContent = 'Save & Connect';
    btn.disabled = false;
  }
}

async function handleCopyInstance(id) {
  const original = await getInstance(id);
  if (!original) return;

  const copy = {
    name: (original.name || nameFromUrl(original.url)) + '/copy',
    url: original.url,
    admin: { ...original.admin },
    frontend: { ...original.frontend },
  };

  const saved = await saveInstance(copy);
  allInstances = await getInstances();
  renderInstanceList();
  await selectInstance(saved.id);
}

async function handleDeleteInstanceById(id) {
  const instance = await getInstance(id);
  if (!instance) return;

  // Show confirmation dialog
  const name = instance.name || instance.url || 'this instance';
  showDeleteConfirm(name, async () => {
    await deleteInstance(id);
    clearAdminTokenCache(instance.url);

    // Remove from favorites if present
    instanceFavs.delete(String(id));
    await saveFavorites('instances', instanceFavs);

    // If this was the active connection, disconnect
    if (state.get('connection.instanceId') === id) {
      state.batch({
        'connection.instanceId': null,
        'connection.url': '',
        'connection.status': 'disconnected',
        'connection.error': null,
      });
    }

    if (selectedInstanceId === id) {
      selectedInstanceId = null;
      clearForm();
      showForm(false);
    }

    allInstances = await getInstances();
    renderInstanceList();
    showStatus('Instance deleted', 'info');
  });
}

function showDeleteConfirm(name, onConfirm) {
  const existing = qs('#delete-confirm-dialog');
  if (existing) existing.remove();

  const dialog = el('div', { class: 'config-dialog-overlay', id: 'delete-confirm-dialog' }, [
    el('div', { class: 'config-dialog' }, [
      el('div', { class: 'config-dialog-header' }, [
        el('span', { class: 'icon', html: icon('trash', 18) }),
        el('span', {}, 'Delete Connection'),
      ]),
      el('div', { class: 'config-dialog-body' }, [
        el('p', { style: { margin: '0 0 8px', fontSize: '13px', color: '#374151' } },
          `Are you sure you want to delete "${name}"?`),
        el('p', { style: { margin: '0', fontSize: '12px', color: '#6b7280' } },
          'This action cannot be undone.'),
      ]),
      el('div', { class: 'config-dialog-actions' }, [
        el('button', { class: 'btn btn-secondary', onclick: () => dialog.remove() }, 'Cancel'),
        el('button', { class: 'btn btn-danger', onclick: async () => {
          dialog.remove();
          await onConfirm();
        }}, 'Delete'),
      ]),
    ]),
  ]);

  (qs('.taskpane') || document.body).appendChild(dialog);
}

async function toggleInstanceFav(instanceId) {
  const key = String(instanceId);
  if (instanceFavs.has(key)) {
    instanceFavs.delete(key);
  } else {
    instanceFavs.add(key);
  }
  await saveFavorites('instances', instanceFavs);
  renderInstanceList();
}

// ─── Rendering ──────────────────────────────────────────────────────────

function renderInstanceList() {
  const listEl = qs('#instance-list');
  clear(listEl);

  if (!allInstances.length) {
    listEl.appendChild(el('div', { class: 'empty-state' }, 'No saved instances'));
    return;
  }

  // Sort: favorites first, then alphabetical
  const sorted = [...allInstances].sort((a, b) => {
    const aFav = instanceFavs.has(String(a.id)) ? 0 : 1;
    const bFav = instanceFavs.has(String(b.id)) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;
    return (a.name || a.url || '').localeCompare(b.name || b.url || '');
  });

  const hasFavs = sorted.some(i => instanceFavs.has(String(i.id)));
  let separatorAdded = false;

  for (const inst of sorted) {
    const isFav = instanceFavs.has(String(inst.id));
    const isSelected = inst.id === selectedInstanceId;
    const isConnected = state.get('connection.instanceId') === inst.id
      && state.get('connection.status') === 'connected';

    // Add separator between favorites and non-favorites
    if (hasFavs && !isFav && !separatorAdded) {
      listEl.appendChild(el('div', { class: 'ticket-separator' }));
      separatorAdded = true;
    }

    const starBtn = el('button', {
      class: `fav-star ${isFav ? 'fav-star-active' : ''}`,
      title: isFav ? 'Remove from favorites' : 'Add to favorites',
      html: isFav ? icon('starFilled', 14) : icon('star', 14),
      onclick: (e) => {
        e.stopPropagation();
        toggleInstanceFav(inst.id);
      },
    });

    // Connection status dot — green/red/gray
    // Priority: global connected state > local test result > gray
    const localResult = testResultMap.get(inst.id);
    const isError = state.get('connection.instanceId') === inst.id
      && state.get('connection.status') === 'error';
    const dotClass = isConnected ? 'token-ok'
      : isError ? 'token-error'
      : localResult === 'ok' ? 'token-ok'
      : localResult === 'error' ? 'token-error'
      : 'token-none';
    const dotTitle = isConnected ? 'Connected'
      : isError ? 'Connection failed'
      : localResult === 'ok' ? 'Test passed (not saved)'
      : localResult === 'error' ? 'Test failed'
      : 'Not connected';

    const statusDot = el('span', {
      class: `ticket-token-dot ${dotClass}`,
      title: dotTitle,
    });

    // Copy button
    const copyBtn = el('button', {
      class: 'row-action-btn',
      title: 'Duplicate instance',
      html: icon('copy', 14),
      onclick: (e) => {
        e.stopPropagation();
        handleCopyInstance(inst.id);
      },
    });

    // Delete (trash) button
    const trashBtn = el('button', {
      class: 'row-action-btn',
      title: 'Delete instance',
      html: icon('trash', 14),
      onclick: (e) => {
        e.stopPropagation();
        handleDeleteInstanceById(inst.id);
      },
    });

    const row = el('div', {
      class: `ticket-row ${isSelected ? 'ticket-row-selected' : ''}`,
      onclick: () => selectInstance(inst.id),
    }, [
      starBtn,
      el('div', { class: 'ticket-row-left' }, [
        el('span', { class: 'ticket-id' }, inst.name || nameFromUrl(inst.url)),
        el('span', { class: 'ticket-summary' }, truncate(inst.url, 40)),
      ]),
      el('div', { class: 'ticket-row-right' }, [
        statusDot,
        copyBtn,
        trashBtn,
      ]),
    ]);

    listEl.appendChild(row);
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

function showForm(visible) {
  const section = qs('#instance-form-section');
  if (section) section.style.display = visible ? '' : 'none';
}

function clearForm() {
  qs('#conn-name').value = '';
  qs('#conn-url').value = '';
  qs('#conn-admin-id').value = '';
  qs('#conn-admin-secret').value = '';
  if (qs('#conn-frontend-id')) qs('#conn-frontend-id').value = '';
  if (qs('#conn-frontend-secret')) qs('#conn-frontend-secret').value = '';

  switchCredsTab('admin');

  testPassed = false;
  showStatus('', '');
  updateButtonStates();
}

/**
 * Check if required fields are filled and enable/disable buttons.
 */
function updateButtonStates() {
  const url = qs('#conn-url')?.value.trim();
  const clientId = qs('#conn-admin-id')?.value.trim();
  const clientSecret = qs('#conn-admin-secret')?.value.trim();
  const ready = !!(url && clientId && clientSecret);

  const testBtn = qs('#conn-test-btn');
  const saveBtn = qs('#conn-save-btn');
  if (testBtn) testBtn.disabled = !ready;
  if (saveBtn) saveBtn.disabled = !ready;
}

function switchCredsTab(tab) {
  activeCredsTab = tab;

  // Show/hide field groups
  const adminEl = qs('#creds-admin-fields');
  const frontendEl = qs('#creds-frontend-fields');
  if (adminEl) adminEl.style.display = tab === 'admin' ? '' : 'none';
  if (frontendEl) frontendEl.style.display = tab === 'frontend' ? '' : 'none';

  // Update tab button styles
  const adminTab = qs('#creds-tab-admin');
  const frontendTab = qs('#creds-tab-frontend');
  if (adminTab) adminTab.classList.toggle('creds-tab-active', tab === 'admin');
  if (frontendTab) frontendTab.classList.toggle('creds-tab-active', tab === 'frontend');

  // Update hint
  const hint = qs('#creds-hint');
  if (hint) {
    hint.textContent = tab === 'admin'
      ? 'Instance-level credentials (client_credentials grant)'
      : 'Optional — for ticket-scoped token refresh. Falls back to admin if empty.';
  }
}

/**
 * Extract a friendly name from a URL.
 * "https://p5870d4fd-edu.earlyaccess.tactoncpq.com" → "p5870d4fd-edu"
 */
function nameFromUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return hostname.split('.')[0] || hostname;
  } catch {
    return url;
  }
}

function buildInstanceFromForm() {
  const name = qs('#conn-name').value.trim();
  const url = qs('#conn-url').value.trim();
  return {
    name: name || nameFromUrl(url),
    url,
    admin: {
      clientId: qs('#conn-admin-id').value.trim(),
      clientSecret: qs('#conn-admin-secret').value.trim(),
    },
    frontend: {
      clientId: qs('#conn-frontend-id')?.value.trim() || '',
      clientSecret: qs('#conn-frontend-secret')?.value.trim() || '',
    },
  };
}

function showStatus(msg, type) {
  const statusEl = qs('#conn-status');

  if (!msg) {
    // Clear bottom message, reset badge to state-driven
    if (statusEl) statusEl.style.display = 'none';
    updateBadge();
    return;
  }

  if (type === 'success') {
    // Success: no text, just update the badge chip
    if (statusEl) statusEl.style.display = 'none';
    updateBadge();
  } else {
    // Error/warning/info: show at the bottom
    if (statusEl) {
      statusEl.style.display = '';
      statusEl.textContent = msg;
      statusEl.className = `status-message status-${type}`;
    }
  }
}

function updateBadge() {
  const badge = qs('#conn-badge');
  if (!badge) return;

  const status = state.get('connection.status');
  clear(badge);

  let badgeClass, badgeText;
  if (status === 'connected' || testPassed) {
    badgeClass = 'badge badge-success';
    badgeText = 'Connected';
  } else if (status === 'error') {
    badgeClass = 'badge badge-danger';
    badgeText = 'Error';
  } else {
    badgeClass = 'badge badge-warning';
    badgeText = 'Not connected';
  }

  const badgeSpan = el('span', { class: badgeClass }, badgeText);
  badge.appendChild(badgeSpan);

  // Only show tooltip after a test or connection has been attempted
  const hasAdminInfo = validationSteps.some(s => s.status !== 'skip');
  if (!hasAdminInfo) return;

  // Build tooltip
  const tooltip = el('div', { class: 'conn-tooltip' });
  // Admin connection section
  const adminBadge = (status === 'connected' || testPassed) ? 'ok' : status === 'error' ? 'error' : 'warn';
  const adminLabel = (status === 'connected' || testPassed) ? 'All Good' : status === 'error' ? 'Error' : 'Pending';

  const header = el('div', { class: 'conn-tooltip-header' }, [
    el('span', { class: 'conn-tooltip-title' }, 'Admin Connection'),
    el('span', { class: `conn-tooltip-badge ${adminBadge}` }, adminLabel),
  ]);
  tooltip.appendChild(header);

  const stepsEl = el('div', { class: 'conn-tooltip-steps' });
  renderDiagnosticSteps(stepsEl, validationSteps);
  tooltip.appendChild(stepsEl);

  badge.appendChild(tooltip);
}

/**
 * Update the validation steps based on current form + test results.
 */
function updateValidationSteps(instance, testResult) {
  validationSteps = [
    {
      label: 'Instance URL',
      detail: instance?.url ? truncate(instance.url, 40) : 'Not configured',
      status: instance?.url ? 'pass' : 'skip',
    },
    {
      label: 'Admin Credentials',
      detail: instance?.admin?.clientId
        ? `Client ID: ${truncate(instance.admin.clientId, 16)}`
        : 'Not configured',
      status: instance?.admin?.clientId && instance?.admin?.clientSecret ? 'pass' : 'skip',
    },
    {
      label: 'Frontend Credentials',
      detail: instance?.frontend?.clientId
        ? `Client ID: ${truncate(instance.frontend.clientId, 16)}`
        : 'Not configured (using admin)',
      status: instance?.frontend?.clientId ? 'pass' : 'skip',
    },
    {
      label: 'Admin Token',
      detail: testResult
        ? (testResult.ok ? 'Token acquired successfully' : `Failed: ${truncate(testResult.error || 'Unknown', 30)}`)
        : 'Not tested',
      status: testResult ? (testResult.ok ? 'pass' : 'fail') : 'skip',
    },
  ];
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}
