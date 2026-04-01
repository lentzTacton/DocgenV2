/**
 * Config Export / Import — dialogs for exporting and importing
 * DocGen configuration (credentials, ticket selection, AI settings, etc.).
 *
 * Extracted from setup-view.js to reduce file size.
 *
 * Entry points:
 *   showExportDialog()
 *   showImportDialog()
 *   showImportToast(message, type)
 *   setSetupExportCallbacks(cbs) — inject parent callbacks
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import {
  getInstance, getInstances, saveInstance,
  getToken, setToken,
  loadAiSettings, saveAiSettings,
  loadFavorites, saveFavorites,
} from '../../core/storage.js';
import { initInstances } from './connection-card.js';

// ─── Callback injection ─────────────────────────────────────────────────

let _callbacks = {
  refreshCollapsedBars: () => {},
  refreshProgressBar: () => {},
  updateStepperState: () => {},
};

/**
 * Inject callbacks that live in setup-view.js.
 * @param {{ refreshCollapsedBars: Function, refreshProgressBar: Function, updateStepperState: Function }} cbs
 */
export function setSetupExportCallbacks(cbs) {
  Object.assign(_callbacks, cbs);
}

// ─── Constants ──────────────────────────────────────────────────────────

/**
 * Export option keys — each maps to a section of the JSON.
 * `sensitive` controls whether a warning is shown.
 * `defaultOn` controls the initial checkbox state.
 */
const EXPORT_OPTIONS = [
  { key: 'adminCreds',      label: 'Admin Client ID & Secret',      defaultOn: true,  sensitive: false },
  { key: 'frontendCreds',   label: 'Frontend Client ID & Secret',   defaultOn: true,  sensitive: false },
  { key: 'ticketToken',     label: 'Ticket Token (OAuth)',           defaultOn: true,  sensitive: false },
  { key: 'ticketSelection', label: 'Ticket Selection & Favorites',  defaultOn: true,  sensitive: false },
  { key: 'startingObject',  label: 'Starting Object Config',        defaultOn: true,  sensitive: false },
  { key: 'aiKey',           label: 'AI API Key',                    defaultOn: false, sensitive: true,
    warning: 'This is a consumption-based API key. Sharing it may lead to unexpected charges. Handle with care.' },
];

// ─── Toast ──────────────────────────────────────────────────────────────

/** Flash a brief toast message at the top of the taskpane */
export function showImportToast(message, type = 'success') {
  const existing = qs('.import-toast');
  if (existing) existing.remove();
  const toast = el('div', { class: `import-toast import-toast-${type}` }, message);
  document.body.appendChild(toast);
  setTimeout(() => { toast.classList.add('import-toast-visible'); }, 10);
  setTimeout(() => {
    toast.classList.remove('import-toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Gather / Apply ─────────────────────────────────────────────────────

/** Gather all exportable data from Dexie + state */
async function gatherExportData(options) {
  const data = { _docgenExport: true, _version: 1, _exportedAt: new Date().toISOString() };

  // Always include instance URL and basic connection info
  const instanceId = state.get('connection.instanceId');
  const instance = instanceId ? await getInstance(instanceId) : null;
  data.instanceUrl = instance?.url || state.get('connection.url') || '';
  data.instanceName = instance?.name || '';

  // (a) Admin credentials
  if (options.adminCreds && instance?.admin) {
    data.adminCreds = { clientId: instance.admin.clientId, clientSecret: instance.admin.clientSecret };
  }

  // (b) Frontend credentials
  if (options.frontendCreds && instance?.frontend) {
    data.frontendCreds = { clientId: instance.frontend.clientId, clientSecret: instance.frontend.clientSecret };
  }

  // (c) Ticket token (access + refresh from Dexie)
  if (options.ticketToken) {
    const ticketId = state.get('tickets.selected');
    if (ticketId) {
      const access = await getToken(`access:${ticketId}`);
      const refresh = await getToken(`refresh:${ticketId}`);
      data.ticketToken = { ticketId, access, refresh };
    }
  }

  // (d) Ticket selection, token map & favorites
  if (options.ticketSelection) {
    data.ticketSelection = {
      selected: state.get('tickets.selected') || null,
      tokenMap: state.get('tickets.tokenMap') || {},
      favorites: [...(await loadFavorites('tickets'))],
    };
  }

  // (e) Starting object
  if (options.startingObject) {
    data.startingObject = {
      type: state.get('startingObject.type') || null,
      name: state.get('startingObject.name') || null,
      id: state.get('startingObject.id') || null,
      instanceId: state.get('startingObject.instanceId') || null,
      instanceDisplayId: state.get('startingObject.instanceDisplayId') || null,
      instanceName: state.get('startingObject.instanceName') || null,
      favorites: [...(await loadFavorites('starting-objects'))],
    };
  }

  // (f) AI settings
  if (options.aiKey) {
    const ai = await loadAiSettings();
    data.aiSettings = { apiKey: ai.apiKey, model: ai.model, maxTokens: ai.maxTokens };
  }

  return data;
}

/** Apply imported JSON data to Dexie + state */
async function applyImportData(data, options) {
  const instances = await getInstances();
  let instance = null;

  if (data.instanceUrl) {
    // Always create a new instance; add (copy) if name already taken
    let name = data.instanceName || 'Imported';
    while (instances.find(i => i.name === name)) name = `${name} (copy)`;
    instance = await saveInstance({ name, url: data.instanceUrl });
    state.batch({ 'connection.instanceId': instance.id, 'connection.url': data.instanceUrl });
  }

  // (a) Admin credentials
  if (options.adminCreds && data.adminCreds && instance) {
    instance.admin = { ...instance.admin, ...data.adminCreds };
    await saveInstance(instance);
  }

  // (b) Frontend credentials
  if (options.frontendCreds && data.frontendCreds && instance) {
    instance.frontend = { ...instance.frontend, ...data.frontendCreds };
    await saveInstance(instance);
  }

  // (c) Ticket token
  if (options.ticketToken && data.ticketToken) {
    const { ticketId, access, refresh } = data.ticketToken;
    if (ticketId && access) await setToken(`access:${ticketId}`, access);
    if (ticketId && refresh) await setToken(`refresh:${ticketId}`, refresh);
  }

  // (d) Ticket selection & favorites
  if (options.ticketSelection && data.ticketSelection) {
    const ts = data.ticketSelection;
    const updates = {};
    if (ts.selected !== undefined) updates['tickets.selected'] = ts.selected;
    if (ts.tokenMap) updates['tickets.tokenMap'] = ts.tokenMap;
    state.batch(updates);
    if (ts.favorites && ts.favorites.length) {
      await saveFavorites('tickets', new Set(ts.favorites));
    }
  }

  // (e) Starting object
  if (options.startingObject && data.startingObject) {
    const so = data.startingObject;
    state.batch({
      'startingObject.type': so.type || null,
      'startingObject.name': so.name || null,
      'startingObject.id': so.id || null,
      'startingObject.instanceId': so.instanceId || null,
      'startingObject.instanceDisplayId': so.instanceDisplayId || null,
      'startingObject.instanceName': so.instanceName || null,
    });
    if (so.favorites && so.favorites.length) {
      await saveFavorites('starting-objects', new Set(so.favorites));
    }
  }

  // (f) AI settings
  if (options.aiKey && data.aiSettings) {
    await saveAiSettings(data.aiSettings);
    state.batch({
      'ai.apiKey': data.aiSettings.apiKey,
      'ai.model': data.aiSettings.model,
      'ai.maxTokens': data.aiSettings.maxTokens,
      'ai.apiKeyValid': !!data.aiSettings.apiKey,
    });
  }
}

// ─── Export Dialog ──────────────────────────────────────────────────────

/** Show the export dialog with checkboxes */
export function showExportDialog() {
  // Remove existing dialog
  const existing = qs('#config-export-dialog');
  if (existing) existing.remove();

  const checkboxes = {};
  let aiWarningShown = false;

  const optionRows = EXPORT_OPTIONS.map(opt => {
    const cb = el('input', { type: 'checkbox', id: `export-cb-${opt.key}`, checked: opt.defaultOn });
    checkboxes[opt.key] = cb;

    // AI key checkbox triggers warning
    if (opt.sensitive) {
      cb.addEventListener('change', () => {
        if (cb.checked && !aiWarningShown) {
          aiWarningShown = true;
          showAiKeyWarning(() => { /* confirmed — keep checked */ },
                           () => { cb.checked = false; aiWarningShown = false; });
        } else if (!cb.checked) {
          aiWarningShown = false;
        }
      });
    }

    return el('label', { class: 'export-option-row' }, [
      cb,
      el('span', {}, opt.label),
    ]);
  });

  const dialog = el('div', { class: 'config-dialog-overlay', id: 'config-export-dialog' }, [
    el('div', { class: 'config-dialog' }, [
      el('div', { class: 'config-dialog-header' }, [
        el('span', { class: 'icon', html: icon('upload', 18) }),
        el('span', {}, 'Export Configuration'),
      ]),
      el('div', { class: 'config-dialog-body' }, [
        el('div', { class: 'config-dialog-hint' }, 'Select which parts of the configuration to include in the export file.'),
        el('div', { class: 'export-options' }, optionRows),
      ]),
      el('div', { class: 'config-dialog-actions' }, [
        el('button', { class: 'btn btn-secondary', onclick: () => dialog.remove() }, 'Cancel'),
        el('button', { class: 'btn btn-primary', onclick: async () => {
          const opts = {};
          for (const [key, cb] of Object.entries(checkboxes)) opts[key] = cb.checked;
          await doExport(opts);
          dialog.remove();
        }}, 'Export'),
      ]),
    ]),
  ]);

  (qs('.taskpane') || document.body).appendChild(dialog);
}

/** Perform the actual export — build JSON + trigger download */
async function doExport(options) {
  const data = await gatherExportData(options);
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const hostname = data.instanceUrl
    ? (() => { try { return new URL(data.instanceUrl).hostname.replace(/\./g, '-'); } catch { return 'config'; } })()
    : 'config';
  a.download = `docgen-${hostname}-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Show a warning dialog about sharing consumption-based AI key */
function showAiKeyWarning(onConfirm, onCancel) {
  const existing = qs('#ai-key-warning-dialog');
  if (existing) existing.remove();

  const dialog = el('div', { class: 'config-dialog-overlay', id: 'ai-key-warning-dialog' }, [
    el('div', { class: 'config-dialog config-dialog-warning' }, [
      el('div', { class: 'config-dialog-header warning-header' }, [
        el('span', { class: 'icon warning-icon', html: icon('warning', 20) }),
        el('span', {}, 'Sharing AI API Key'),
      ]),
      el('div', { class: 'config-dialog-body' }, [
        el('div', { class: 'warning-text' },
          'The Anthropic API key is consumption-based. Anyone with this key can make API calls that incur charges on the key owner\'s account. Only share with trusted team members and consider using a separate key with spending limits for shared configurations.'),
      ]),
      el('div', { class: 'config-dialog-actions' }, [
        el('button', { class: 'btn btn-secondary', onclick: () => { dialog.remove(); onCancel(); }}, 'Cancel'),
        el('button', { class: 'btn btn-warning', onclick: () => { dialog.remove(); onConfirm(); }}, 'Include AI Key'),
      ]),
    ]),
  ]);

  (qs('.taskpane') || document.body).appendChild(dialog);
}

// ─── Import Dialog ──────────────────────────────────────────────────────

/** Show the import dialog — file picker + options */
export function showImportDialog() {
  const existing = qs('#config-import-dialog');
  if (existing) existing.remove();

  let importedData = null;
  const checkboxes = {};
  let optionsContainer;

  const fileInput = el('input', {
    type: 'file',
    accept: '.json',
    style: { display: 'none' },
  });

  const fileLabel = el('div', { class: 'import-file-label', id: 'import-file-label' }, 'No file selected');

  const pickBtn = el('button', { class: 'btn btn-secondary', onclick: () => fileInput.click() }, [
    el('span', { class: 'icon', html: icon('folder', 14) }),
    'Choose File',
  ]);

  const importBtn = el('button', { class: 'btn btn-primary', disabled: true, id: 'import-apply-btn', onclick: async () => {
    if (!importedData) return;
    importBtn.disabled = true;
    importBtn.textContent = 'Importing…';
    try {
      const opts = {};
      for (const [key, cb] of Object.entries(checkboxes)) opts[key] = cb.checked;
      await applyImportData(importedData, opts);
      dialog.remove();
      await initInstances();
      _callbacks.refreshCollapsedBars();
      _callbacks.refreshProgressBar();
      _callbacks.updateStepperState();
      // Trigger re-connect if we imported credentials
      if (opts.adminCreds || opts.frontendCreds) {
        state.set('config.autoConnectPending', true);
      }
      showImportToast('Configuration imported successfully', 'success');
    } catch (err) {
      console.error('Import failed:', err);
      showImportToast(`Import failed: ${err.message}`, 'error');
      importBtn.disabled = false;
      importBtn.textContent = 'Import';
    }
  }}, 'Import');

  optionsContainer = el('div', { class: 'export-options', id: 'import-options', style: { display: 'none' } });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) return;
    fileLabel.textContent = file.name;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (!parsed._docgenExport) {
          fileLabel.textContent = 'Invalid file — not a DocGen export';
          fileLabel.classList.add('import-file-error');
          return;
        }
        fileLabel.classList.remove('import-file-error');
        importedData = parsed;
        renderImportOptions(parsed, checkboxes, optionsContainer);
        optionsContainer.style.display = '';
        importBtn.disabled = false;
      } catch {
        fileLabel.textContent = 'Invalid JSON file';
        fileLabel.classList.add('import-file-error');
        importedData = null;
        importBtn.disabled = true;
      }
    };
    reader.readAsText(file);
  });

  const dialog = el('div', { class: 'config-dialog-overlay', id: 'config-import-dialog' }, [
    el('div', { class: 'config-dialog' }, [
      el('div', { class: 'config-dialog-header' }, [
        el('span', { class: 'icon', html: icon('download', 18) }),
        el('span', {}, 'Import Configuration'),
      ]),
      el('div', { class: 'config-dialog-body' }, [
        el('div', { class: 'config-dialog-hint' }, 'Select a DocGen configuration file (.json) to import.'),
        el('div', { class: 'import-file-row' }, [pickBtn, fileLabel, fileInput]),
        optionsContainer,
      ]),
      el('div', { class: 'config-dialog-actions' }, [
        el('button', { class: 'btn btn-secondary', onclick: () => dialog.remove() }, 'Cancel'),
        importBtn,
      ]),
    ]),
  ]);

  (qs('.taskpane') || document.body).appendChild(dialog);
}

/** Render import checkboxes — disabled if data not present in file */
function renderImportOptions(data, checkboxes, container) {
  clear(container);
  // Map export keys to data presence
  const available = {
    adminCreds:      !!data.adminCreds,
    frontendCreds:   !!data.frontendCreds,
    ticketToken:     !!data.ticketToken,
    ticketSelection: !!data.ticketSelection,
    startingObject:  !!data.startingObject,
    aiKey:           !!data.aiSettings,
  };

  for (const opt of EXPORT_OPTIONS) {
    const present = available[opt.key];
    const cb = el('input', {
      type: 'checkbox',
      id: `import-cb-${opt.key}`,
      checked: present && opt.defaultOn,
      disabled: !present,
    });
    checkboxes[opt.key] = cb;

    const label = el('label', { class: `export-option-row ${present ? '' : 'option-disabled'}` }, [
      cb,
      el('span', {}, opt.label),
      !present ? el('span', { class: 'option-not-included' }, 'Not in export') : null,
    ].filter(Boolean));

    container.appendChild(label);
  }
}
