/**
 * Offline Capture Wizard — Guided 5-step flow to capture API data for offline use.
 *
 * Steps:
 *   1. Source — confirm instance + ticket (must be connected)
 *   2. Discover — show object types with checkboxes + record counts
 *   3. Options — BOM, CP, descriptions toggles
 *   4. Capture — progress bar with per-item status
 *   5. Summary — review, name, save & export
 */

import { el, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import { createOverlay, createDialogCard } from '../../core/dialog.js';
import {
  discoverObjectTypes, fetchRecordCountsProgressive,
  hasBomData, hasCpData,
  runCapture, saveCapture,
} from '../../services/offline/offline-capture.js';
import { initInstances } from '../setup/connection-card.js';
import {
  exportPackageAsJson, estimatePackageSize, countRecords, generatePackageName,
} from '../../services/offline/offline-storage.js';

// ─── State ──────────────────────────────────────────────────────────────

let overlay = null;
let card = null;
let body = null;
let currentStep = 1;

// Wizard data
let discoveredObjects = [];
let selectedObjects = new Set();
let optBom = true;
let optCp = true;
let optDescriptions = true;
let captureResult = null;  // { data, errors }
let savedPackage = null;
let packageName = '';

// ─── Public entry ───────────────────────────────────────────────────────

export function openOfflineWizard() {
  currentStep = 1;
  discoveredObjects = [];
  selectedObjects = new Set();
  optBom = true;
  optCp = true;
  optDescriptions = true;
  captureResult = null;
  savedPackage = null;
  packageName = generatePackageName(
    state.get('connection.url') || '',
    state.get('tickets.selected') || ''
  );

  overlay = createOverlay({ id: 'offline-wizard-overlay', dismissOnClick: false });
  card = createDialogCard([], { maxWidth: '520px' });
  card.style.maxHeight = '80vh';
  card.style.display = 'flex';
  card.style.flexDirection = 'column';
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  renderStep();
}

function close() {
  if (overlay) overlay.remove();
  overlay = null;
}

// ─── Step router ────────────────────────────────────────────────────────

function renderStep() {
  clear(card);

  // Header
  card.appendChild(el('div', { class: 'off-wiz-header' }, [
    el('span', { class: 'icon', style: { color: 'var(--tacton-blue)' }, html: icon('download', 18) }),
    el('span', { class: 'off-wiz-title' }, 'Offline Capture'),
    el('span', { class: 'off-wiz-step-badge' }, `Step ${currentStep} of 5`),
    el('button', { class: 'off-wiz-close', onclick: close, html: icon('x', 14) }),
  ]));

  // Step progress bar
  const progress = el('div', { class: 'off-wiz-progress' });
  for (let i = 1; i <= 5; i++) {
    progress.appendChild(el('div', {
      class: `off-wiz-progress-dot ${i < currentStep ? 'off-wiz-dot-done' : ''} ${i === currentStep ? 'off-wiz-dot-active' : ''}`,
    }));
    if (i < 5) progress.appendChild(el('div', { class: `off-wiz-progress-line ${i < currentStep ? 'off-wiz-line-done' : ''}` }));
  }
  card.appendChild(progress);

  // Body (scrollable)
  body = el('div', { class: 'off-wiz-body' });
  card.appendChild(body);

  switch (currentStep) {
    case 1: renderStep1(); break;
    case 2: renderStep2(); break;
    case 3: renderStep3(); break;
    case 4: renderStep4(); break;
    case 5: renderStep5(); break;
  }
}

// ─── Step 1: Source ─────────────────────────────────────────────────────

function renderStep1() {
  const url = state.get('connection.url') || '—';
  const instanceId = state.get('connection.instanceId');
  const ticketId = state.get('tickets.selected');
  const tickets = state.get('tickets.list') || [];
  const ticket = tickets.find(t => t.id === ticketId);
  const connected = state.get('connection.status') === 'connected';
  const startObj = state.get('startingObject.type') || '—';

  body.appendChild(el('div', { class: 'off-wiz-section-title' }, 'Capture Source'));
  body.appendChild(el('div', { class: 'off-wiz-desc' },
    'Capture data from the currently connected instance for offline document generation.'
  ));

  const infoTable = el('div', { class: 'off-wiz-info-table' });
  infoTable.appendChild(infoRow('Instance', url, connected ? 'check' : 'warning'));
  infoTable.appendChild(infoRow('Ticket', ticketId ? `${ticketId}${ticket?.summary ? ' — ' + ticket.summary : ''}` : '— none —', ticketId ? 'check' : 'warning'));
  infoTable.appendChild(infoRow('Starting Object', startObj, startObj !== '—' ? 'check' : 'info'));
  body.appendChild(infoTable);

  if (!connected || !ticketId) {
    body.appendChild(el('div', { class: 'off-wiz-warning' }, [
      el('span', { html: icon('warning', 14) }),
      'You must be connected with a ticket selected to capture offline data.',
    ]));
  }

  // Actions
  card.appendChild(el('div', { class: 'off-wiz-actions' }, [
    el('button', { class: 'btn btn-outline btn-sm', onclick: close }, 'Cancel'),
    el('button', {
      class: 'btn btn-primary btn-sm',
      disabled: (!connected || !ticketId) ? 'disabled' : undefined,
      onclick: () => { currentStep = 2; renderStep(); },
    }, 'Next'),
  ]));
}

// ─── Step 2: Discover ───────────────────────────────────────────────────

async function renderStep2() {
  body.appendChild(el('div', { class: 'off-wiz-section-title' }, 'Select Data to Capture'));
  body.appendChild(el('div', { class: 'off-wiz-desc' }, 'Choose which object types to include in the offline package.'));

  const listWrap = el('div', { class: 'off-wiz-obj-list' });
  body.appendChild(listWrap);

  // Loading spinner — shown while fetching the model
  const loadingEl = el('div', { class: 'off-wiz-loading' }, [
    el('span', { class: 'off-wiz-spinner' }),
    el('span', {}, 'Fetching object model…'),
  ]);
  listWrap.appendChild(loadingEl);

  // Actions
  const actions = el('div', { class: 'off-wiz-actions' });
  const backBtn = el('button', { class: 'btn btn-outline btn-sm', onclick: () => { step2Abort?.abort(); currentStep = 1; renderStep(); } }, 'Back');
  const nextBtn = el('button', { class: 'btn btn-primary btn-sm', disabled: 'disabled', onclick: () => { step2Abort?.abort(); currentStep = 3; renderStep(); } }, 'Next');
  actions.append(backBtn, nextBtn);
  card.appendChild(actions);

  // 1) Fetch model (fast — just object types + attributes, no records)
  try {
    discoveredObjects = await discoverObjectTypes();
  } catch (e) {
    clear(listWrap);
    listWrap.appendChild(el('div', { class: 'off-wiz-error' }, `Discovery failed: ${e.message}`));
    return;
  }

  // 2) Show list immediately — record counts show as spinners
  clear(listWrap);

  const countLabel = el('span', { class: 'off-wiz-select-count' }, `${selectedObjects.size} selected`);
  const selectBar = el('div', { class: 'off-wiz-select-bar' }, [
    el('button', { class: 'btn btn-outline btn-xs', onclick: () => { discoveredObjects.forEach(o => selectedObjects.add(o.name)); updateRows(); } }, 'Select all'),
    el('button', { class: 'btn btn-outline btn-xs', onclick: () => { selectedObjects.clear(); updateRows(); } }, 'Select none'),
    countLabel,
  ]);
  listWrap.appendChild(selectBar);

  const objContainer = el('div', { class: 'off-wiz-obj-container' });
  listWrap.appendChild(objContainer);

  // Map of object name → badge element (for progressive count updates)
  const badgeMap = new Map();

  // Build rows
  for (const obj of discoveredObjects) {
    const checked = selectedObjects.has(obj.name);
    const cb = el('input', { type: 'checkbox' });
    if (checked) cb.checked = true;

    const row = el('div', { class: `off-wiz-obj-row ${checked ? 'off-wiz-obj-checked' : ''}` });

    cb.addEventListener('change', () => {
      if (cb.checked) selectedObjects.add(obj.name);
      else selectedObjects.delete(obj.name);
      row.classList.toggle('off-wiz-obj-checked', cb.checked);
      countLabel.textContent = `${selectedObjects.size} selected`;
      nextBtn.disabled = selectedObjects.size === 0 ? 'disabled' : undefined;
    });

    row.addEventListener('click', (e) => {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event('change'));
    });

    // Record count badge — starts as a mini spinner
    const badge = el('span', { class: 'off-wiz-obj-count' });
    badge.innerHTML = '<span class="off-wiz-badge-spinner"></span>';
    badgeMap.set(obj.name, { badge, cb, row });

    row.append(
      cb,
      el('span', { class: 'off-wiz-obj-name' }, obj.name),
      el('span', { class: 'off-wiz-obj-meta' }, `${obj.attributeCount} attrs`),
      badge,
    );
    objContainer.appendChild(row);
  }

  // Enable Next immediately — user can proceed without waiting for counts
  nextBtn.disabled = undefined;

  function updateRows() {
    for (const obj of discoveredObjects) {
      const entry = badgeMap.get(obj.name);
      if (!entry) continue;
      entry.row.classList.toggle('off-wiz-obj-checked', selectedObjects.has(obj.name));
      entry.cb.checked = selectedObjects.has(obj.name);
    }
    countLabel.textContent = `${selectedObjects.size} selected`;
    nextBtn.disabled = selectedObjects.size === 0 ? 'disabled' : undefined;
  }

  // 3) Progressively fetch record counts (batches of 3, 8s timeout each)
  step2Abort = new AbortController();

  await fetchRecordCountsProgressive(discoveredObjects, (name, count) => {
    const entry = badgeMap.get(name);
    if (!entry) return;

    // Update badge
    entry.badge.textContent = `${count}`;
    if (count > 0) {
      entry.badge.classList.add('off-wiz-has-data');
      // Auto-select objects that have data
      if (!selectedObjects.has(name)) {
        selectedObjects.add(name);
        entry.cb.checked = true;
        entry.row.classList.add('off-wiz-obj-checked');
        countLabel.textContent = `${selectedObjects.size} selected`;
      }
    }
  }, step2Abort.signal);
}

// Abort controller for step 2 progressive fetching
let step2Abort = null;

// ─── Step 3: Options ────────────────────────────────────────────────────

async function renderStep3() {
  body.appendChild(el('div', { class: 'off-wiz-section-title' }, 'Capture Options'));
  body.appendChild(el('div', { class: 'off-wiz-desc' }, 'Additional data sources to include in the offline package.'));

  const optList = el('div', { class: 'off-wiz-opt-list' });

  // Check availability
  const [bomAvail, cpAvail] = await Promise.all([hasBomData(), hasCpData()]);

  optList.appendChild(optionToggle('BOM data', 'BOM records, fields, and source discovery', bomAvail, optBom, (v) => { optBom = v; }));
  optList.appendChild(optionToggle('Configured Products', 'CP list + attribute data', cpAvail, optCp, (v) => { optCp = v; }));
  optList.appendChild(optionToggle('Object descriptions', 'Reference graph (forward + reverse refs)', true, optDescriptions, (v) => { optDescriptions = v; }));

  body.appendChild(optList);

  // Summary of what will be captured
  body.appendChild(el('div', { class: 'off-wiz-summary-preview' }, [
    el('span', { style: { fontWeight: '600' } }, `${selectedObjects.size} object types`),
    optBom && bomAvail ? ' + BOM data' : '',
    optCp && cpAvail ? ' + Configured Products' : '',
    optDescriptions ? ' + descriptions' : '',
  ]));

  card.appendChild(el('div', { class: 'off-wiz-actions' }, [
    el('button', { class: 'btn btn-outline btn-sm', onclick: () => { currentStep = 2; renderStep(); } }, 'Back'),
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: () => { currentStep = 4; renderStep(); },
    }, 'Start Capture'),
  ]));
}

function optionToggle(label, desc, available, value, onChange) {
  const row = el('label', { class: `off-wiz-opt-row ${!available ? 'off-wiz-opt-disabled' : ''}` }, [
    el('input', {
      type: 'checkbox',
      checked: (value && available) ? 'checked' : undefined,
      disabled: !available ? 'disabled' : undefined,
      onchange: (e) => onChange(e.target.checked),
    }),
    el('div', { class: 'off-wiz-opt-text' }, [
      el('div', { class: 'off-wiz-opt-label' }, label),
      el('div', { class: 'off-wiz-opt-desc' }, available ? desc : `${desc} (not available)`),
    ]),
  ]);
  return row;
}

// ─── Step 4: Capture ────────────────────────────────────────────────────

async function renderStep4() {
  body.appendChild(el('div', { class: 'off-wiz-section-title' }, 'Capturing Data…'));

  const progressBar = el('div', { class: 'off-wiz-capture-progress' });
  const progressFill = el('div', { class: 'off-wiz-capture-fill' });
  progressBar.appendChild(progressFill);
  body.appendChild(progressBar);

  const statusLabel = el('div', { class: 'off-wiz-capture-label' }, 'Starting…');
  body.appendChild(statusLabel);

  const logList = el('div', { class: 'off-wiz-capture-log' });
  body.appendChild(logList);

  // No back/cancel during capture — just a placeholder
  const actions = el('div', { class: 'off-wiz-actions' });
  const nextBtn = el('button', { class: 'btn btn-primary btn-sm', disabled: 'disabled' }, 'Next');
  actions.appendChild(nextBtn);
  card.appendChild(actions);

  // Track active log row so 'fetching' → 'done'/'error' replaces in-place
  let activeLogRow = null;

  // Run capture
  captureResult = await runCapture({
    objectTypes: [...selectedObjects],
    captureBom: optBom,
    captureCp: optCp,
    captureDescriptions: optDescriptions,
    onProgress: (step, total, label, status) => {
      const pct = Math.round((step / total) * 100);
      progressFill.style.width = `${pct}%`;
      statusLabel.textContent = label;

      if (status === 'fetching') {
        // Create a new "in-progress" row with spinner
        activeLogRow = el('div', { class: 'off-wiz-log-item' }, [
          el('span', { class: 'off-wiz-log-spinner' }),
          el('span', {}, label),
        ]);
        logList.appendChild(activeLogRow);
      } else {
        // Replace the active row's icon + text with final status
        const statusIcon = status === 'done' ? 'check' : 'x';
        const statusColor = status === 'done' ? 'var(--success)' : 'var(--danger)';
        if (activeLogRow) {
          activeLogRow.innerHTML = '';
          activeLogRow.append(
            el('span', { class: 'icon', style: { color: statusColor }, html: icon(statusIcon, 11) }),
            el('span', {}, label),
          );
          activeLogRow = null;
        } else {
          // Fallback: append new row if no active row
          logList.appendChild(el('div', { class: 'off-wiz-log-item' }, [
            el('span', { class: 'icon', style: { color: statusColor }, html: icon(statusIcon, 11) }),
            el('span', {}, label),
          ]));
        }
      }
      logList.scrollTop = logList.scrollHeight;
    },
  });

  // Done
  progressFill.style.width = '100%';
  const errCount = captureResult.errors.length;
  statusLabel.textContent = errCount > 0
    ? `Capture complete with ${errCount} error${errCount > 1 ? 's' : ''}`
    : 'Capture complete';

  nextBtn.disabled = undefined;
  nextBtn.onclick = () => { currentStep = 5; renderStep(); };
}

// ─── Step 5: Summary & Save ─────────────────────────────────────────────

function renderStep5() {
  body.appendChild(el('div', { class: 'off-wiz-section-title' }, 'Package Summary'));

  const data = captureResult?.data || {};
  const errors = captureResult?.errors || [];

  // Name input
  const nameInput = el('input', {
    type: 'text',
    class: 'input off-wiz-name-input',
    value: packageName,
    placeholder: 'Package name',
    oninput: (e) => { packageName = e.target.value; },
  });
  body.appendChild(el('div', { class: 'off-wiz-field' }, [
    el('label', { class: 'off-wiz-field-label' }, 'Package name'),
    nameInput,
  ]));

  // Stats table
  const statsTable = el('div', { class: 'off-wiz-stats' });
  statsTable.appendChild(statRow('Object types', `${data.selectedObjects?.length || 0}`));
  let totalRecs = 0;
  for (const recs of Object.values(data.records || {})) totalRecs += recs.length;
  statsTable.appendChild(statRow('Total records', `${totalRecs}`));
  if (data.bomRecords?.length) statsTable.appendChild(statRow('BOM records', `${data.bomRecords.length}`));
  if (data.bomFields?.length) statsTable.appendChild(statRow('BOM fields', `${data.bomFields.length}`));
  if (data.bomSources?.length) statsTable.appendChild(statRow('BOM sources', `${data.bomSources.length}`));
  if (data.configuredProducts?.length) statsTable.appendChild(statRow('Configured products', `${data.configuredProducts.length}`));
  statsTable.appendChild(statRow('Descriptions', `${Object.keys(data.descriptions || {}).length}`));

  // Size estimate
  const sizeStr = (() => {
    const json = JSON.stringify(data);
    const bytes = new Blob([json]).size;
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  })();
  statsTable.appendChild(statRow('Estimated size', sizeStr));
  body.appendChild(statsTable);

  // Errors
  if (errors.length > 0) {
    const errSection = el('div', { class: 'off-wiz-errors' }, [
      el('div', { class: 'off-wiz-err-title' }, `${errors.length} error${errors.length > 1 ? 's' : ''} during capture`),
    ]);
    for (const err of errors) {
      errSection.appendChild(el('div', { class: 'off-wiz-err-row' }, [
        el('span', { class: 'icon', style: { color: 'var(--danger)' }, html: icon('x', 11) }),
        el('code', {}, err.step),
        el('span', { style: { color: 'var(--text-tertiary)' } }, err.error),
      ]));
    }
    body.appendChild(errSection);
  }

  // Actions
  const statusMsg = el('span', { class: 'off-wiz-status' });
  card.appendChild(el('div', { class: 'off-wiz-actions' }, [
    statusMsg,
    el('button', { class: 'btn btn-outline btn-sm', onclick: () => { currentStep = 4; renderStep(); } }, 'Back'),
    el('button', {
      class: 'btn btn-outline btn-sm',
      onclick: async () => {
        if (!captureResult?.data) return;
        savedPackage = savedPackage || await doSave();
        exportPackageAsJson(savedPackage);
        statusMsg.textContent = 'Exported!';
      },
    }, [el('span', { html: icon('arrowDown', 12) }), ' Export JSON']),
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: async () => {
        savedPackage = await doSave();
        statusMsg.textContent = 'Saved!';
        statusMsg.style.color = 'var(--success)';
        // Auto-close after brief delay
        setTimeout(close, 800);
      },
    }, [el('span', { html: icon('check', 12) }), ' Save Package']),
  ]));
}

async function doSave() {
  const pkg = await saveCapture(captureResult.data, { name: packageName });
  // Refresh the instance list so the new package appears
  initInstances();
  return pkg;
}

// ─── Helpers ────────────────────────────────────────────────────────────

function infoRow(label, value, ic) {
  const color = ic === 'check' ? 'var(--success)' : ic === 'warning' ? 'var(--orange)' : 'var(--text-tertiary)';
  return el('div', { class: 'off-wiz-info-row' }, [
    el('span', { class: 'icon', style: { color }, html: icon(ic, 13) }),
    el('span', { class: 'off-wiz-info-label' }, label),
    el('span', { class: 'off-wiz-info-value' }, value),
  ]);
}

function statRow(label, value) {
  return el('div', { class: 'off-wiz-stat-row' }, [
    el('span', { class: 'off-wiz-stat-label' }, label),
    el('span', { class: 'off-wiz-stat-value' }, value),
  ]);
}
