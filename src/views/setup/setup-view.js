/**
 * Setup View — Guided Setup Wizard
 *
 * Circular progress ring with percentage in center + step list beside it.
 *   0%   → Intro text shown inside ring
 *   25%  → Instance connected
 *   50%  → Ticket selected
 *   75%  → Starting object chosen
 *   100% → AI configured (optional)
 *
 * Step labels listed to the right of the ring. Clicking a label
 * navigates to that step's card (if unlocked).
 */

import { el, qs, clear } from '../../core/dom.js';
import { iconEl, icon } from '../../components/icon.js';
import state from '../../core/state.js';
import {
  getSetting, setSetting, deleteSetting,
  getInstance,
} from '../../core/storage.js';
import { hideSplash } from '../../components/splash.js';
import { createConnectionCard, initInstances } from './connection-card.js';
import { createTicketCard } from './ticket-card.js';
import { createStartingObjectCard } from './starting-object-card.js';
import { createAiSettingsCard } from './ai-settings-card.js';
import {
  storeManualTicketToken,
  tryAsRefreshToken,
  exchangeTicketCode,
  testTicketToken,
  testAdminCredentials,
  authorizeTicket,
} from '../../services/auth.js';
import { ticketFetch, adminFetch } from '../../services/api.js';
import { renderDiagnosticSteps, STEP_ICONS } from '../../components/diagnostic-steps.js';
import { buildAuthForm } from '../../components/auth-form.js';
import { showExportDialog, showImportDialog, showImportToast, setSetupExportCallbacks } from './setup-export.js';

const STEPS = [
  { id: 'connection', label: 'Instance', icon: 'link', tip: 'Connect to your Tacton CPQ instance' },
  { id: 'ticket', label: 'Ticket', icon: 'file', tip: 'Select an active ticket to work with' },
  { id: 'starting-object', label: 'Object', icon: 'target', tip: 'Choose the root object for document generation' },
  { id: 'ai', label: 'AI', icon: 'chip', optional: true, tip: 'Configure AI-assisted document generation' },
];

// SVG ring geometry
const RING_SIZE = 110;
const RING_STROKE = 8;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRC = 2 * Math.PI * RING_RADIUS;

let activeStep = 'connection';
let lockWasReady = false;
let progressCollapsed = true;

/** Shared auth form instance for locked summary re-auth */
let lockedAuthForm = null;

/** Guard: true while handleLockedDiagnostics is running (prevents re-render mid-flight) */
let _diagnosticsRunning = false;

// Collapse state for locked summary sections (in-memory)
const summaryCollapseState = {};

/**
 * Config lock schema — single source of truth for snapshot keys.
 * Each entry maps a snapshot field to the state path it reads/writes.
 * `fallback` is used when the saved value is missing.
 */
const CONFIG_SCHEMA = [
  { key: 'instanceId',  state: 'connection.instanceId',  fallback: null },
  { key: 'url',         state: 'connection.url',         fallback: '' },
  { key: 'ticketId',    state: 'tickets.selected',       fallback: null },
  { key: 'tokenMap',    state: 'tickets.tokenMap',       fallback: {} },
  { key: 'objectType',  state: 'startingObject.type',    fallback: null },
  { key: 'aiKeyValid',  state: 'ai.apiKeyValid',         fallback: false },
];

/** Build a snapshot object from current state using CONFIG_SCHEMA */
function buildConfigSnapshot() {
  const snap = {};
  for (const { key, state: path, fallback } of CONFIG_SCHEMA) {
    snap[key] = state.get(path) ?? fallback;
  }
  return snap;
}

/** Restore state from a saved snapshot using CONFIG_SCHEMA */
function applyConfigSnapshot(saved) {
  const updates = { 'config.locked': true };
  for (const { key, state: path, fallback } of CONFIG_SCHEMA) {
    updates[path] = saved[key] ?? fallback;
  }
  // Derived state not in schema.
  // Status is 'restoring' — the real 'connected' comes after the
  // auto-connect health check in connection-card re-tests credentials.
  updates['connection.status'] = 'restoring';
  updates['startingObject.name'] = saved.objectType ?? null;
  return updates;
}

export function createSetupView(container) {
  const inner = el('div', { class: 'zone-inner' });
  container.appendChild(inner);

  // ── Progress area: ring + step list + config lock ──
  const progressArea = el('div', { class: 'setup-progress-area', id: 'setup-progress-area', style: { display: 'none' } });

  // Collapsed bar (shown when progress area is collapsed)
  const progressCollapsedBar = el('div', {
    class: 'progress-collapsed-bar',
    id: 'progress-collapsed-bar',
  }, [
    el('span', { class: 'icon', style: { color: 'var(--tacton-blue)' }, html: icon('link', 14) }),
    el('span', { class: 'progress-bar-pct', id: 'progress-bar-pct' }, '0%'),
    el('span', { class: 'progress-bar-badge-label', id: 'progress-bar-badge-label' }),
    el('div', { class: 'progress-bar-dots', id: 'progress-bar-dots' }),
    el('button', {
      class: 'progress-bar-lock-btn',
      id: 'progress-bar-lock-btn',
      disabled: true,
      title: 'Lock configuration',
      onclick: (e) => { e.stopPropagation(); handleConfigLock(); },
    }, [
      el('span', { class: 'icon', id: 'progress-bar-lock-icon', html: icon('lock', 12) }),
      el('span', { id: 'progress-bar-lock-label' }),
    ]),
  ]);
  progressCollapsedBar.addEventListener('click', () => toggleProgressArea());

  // — Config lock (left of ring, icon + label stacked) —
  const configLockLabel = el('span', {
    class: 'config-lock-label',
    id: 'config-lock-label',
  }, 'Lock');

  const configLock = el('button', {
    class: 'config-lock-btn config-lock-disabled',
    id: 'config-lock-btn',
    disabled: true,
    onclick: handleConfigLock,
  });
  configLock.innerHTML = `${icon('lock', 18)}`;

  const configLockWrap = el('div', {
    class: 'config-lock-wrap',
    id: 'config-lock-wrap',
  }, [configLock, configLockLabel]);

  // — Guide trail (animated dots between lock and ring) —
  const guideTrail = el('div', {
    class: 'lock-guide-trail',
    id: 'lock-guide-trail',
    style: { display: 'none' },
  });
  guideTrail.innerHTML = '<span></span><span></span><span></span>';

  // Lock wrap contains: lock button + label + guide trail (trail floats right)
  configLockWrap.appendChild(guideTrail);

  progressArea.appendChild(configLockWrap);

  // — Circular ring (SVG) —
  const ringWrap = el('div', { class: 'progress-ring-wrap' });
  const C = RING_SIZE / 2;
  ringWrap.innerHTML = `
    <svg class="progress-ring-svg" width="${RING_SIZE}" height="${RING_SIZE}" viewBox="0 0 ${RING_SIZE} ${RING_SIZE}">
      <circle class="progress-ring-bg"
        cx="${C}" cy="${C}" r="${RING_RADIUS}"
        stroke-width="${RING_STROKE}" fill="none" />
      <circle class="progress-ring-fill" id="progress-ring-fill"
        cx="${C}" cy="${C}" r="${RING_RADIUS}"
        stroke="#0071c8"
        stroke-width="${RING_STROKE}" fill="none"
        stroke-linecap="round"
        stroke-dasharray="${RING_CIRC}"
        stroke-dashoffset="${RING_CIRC}"
        transform="rotate(-90 ${C} ${C})" />
    </svg>
    <div class="progress-ring-center" id="progress-ring-center">
      <span class="progress-ring-pct" id="progress-ring-pct">0%</span>
      <span class="progress-ring-sub">COMPLETE</span>
    </div>
  `;
  progressArea.appendChild(ringWrap);

  // — Step list —
  const stepList = el('div', { class: 'setup-step-list' });
  STEPS.forEach((step, i) => {
    const num = String(i + 1);
    const row = el('div', {
      class: 'step-list-row' + (step.optional ? ' step-list-optional' : ''),
      id: `marker-${step.id}`,
      onclick: () => handleStepClick(step.id),
    }, [
      el('span', { class: 'step-list-icon', id: `step-icon-${step.id}`, html: icon(step.icon, 14) }),
      el('span', { class: 'step-list-label' }, step.label),
      step.optional
        ? el('span', { class: 'step-list-tag' }, 'Optional')
        : null,
    ].filter(Boolean));
    stepList.appendChild(row);
  });
  progressArea.appendChild(stepList);

  // Collapse toggle — always visible button
  const collapseBtn = el('button', {
    class: 'progress-collapse-btn',
    id: 'progress-collapse-btn',
    title: 'Collapse status',
    onclick: (e) => { e.stopPropagation(); toggleProgressArea(); },
  }, [el('span', { class: 'icon', html: icon('chevronUp', 10) }), 'Hide']);
  progressArea.appendChild(collapseBtn);

  inner.appendChild(progressCollapsedBar);
  inner.appendChild(progressArea);

  // ── Locked summary (shown when config is locked) ──
  const summaryWrap = el('div', {
    class: 'config-summary',
    id: 'config-summary',
    style: { display: 'none' },
  });
  inner.appendChild(summaryWrap);

  // ── Card wrappers (one per step) ──
  const connWrap = el('div', { class: 'setup-step-card', id: 'step-connection' });
  const ticketWrap = el('div', { class: 'setup-step-card step-locked', id: 'step-ticket' });
  const objectWrap = el('div', { class: 'setup-step-card step-locked', id: 'step-starting-object' });
  const aiWrap = el('div', { class: 'setup-step-card step-collapsed', id: 'step-ai' });

  inner.appendChild(connWrap);
  inner.appendChild(ticketWrap);
  inner.appendChild(objectWrap);
  inner.appendChild(aiWrap);

  // ── Create cards inside their wrappers ──
  createConnectionCard(connWrap);
  createTicketCard(ticketWrap);
  createStartingObjectCard(objectWrap);
  createAiSettingsCard(aiWrap);

  // ── Add collapsed status bars to each step ──
  addCollapsedBar(connWrap, 'connection');
  addCollapsedBar(ticketWrap, 'ticket');
  addCollapsedBar(objectWrap, 'starting-object');
  addCollapsedBar(aiWrap, 'ai');

  // ── Add Proceed buttons to each step ──
  addProceedButton(connWrap,   'connection',      'ticket');
  addProceedButton(ticketWrap, 'ticket',          'starting-object');
  addProceedButton(objectWrap, 'starting-object', 'ai');
  // AI is the last step — no proceed button

  // ── Set initial state ──
  setActiveStep('connection');
  refreshProgressBar(); // Populate collapsed bar on first render

  // ── Listen for completion events to advance steps ──

  state.on('connection.status', (status) => {
    // Skip step transitions while config is locked (summary is shown)
    if (state.get('config.locked')) return;

    if (status === 'connected') {
      unlockStep('ticket');
    } else if (status !== 'restoring') {
      // Instance disconnected or changed — re-lock downstream steps
      lockStep('ticket');
      lockStep('starting-object');
      if (activeStep !== 'connection') {
        setActiveStep('connection');
      }
    }
    refreshCollapsedBars();
    refreshProgressBar();
  });

  state.on('tickets.selected', (ticketId) => {
    if (ticketId) {
      unlockStep('starting-object');
    } else {
      lockStep('starting-object');
      if (activeStep === 'starting-object') {
        setActiveStep('ticket');
      }
    }
    refreshCollapsedBars();
    refreshProgressBar();
  });

  state.on('startingObject.type', () => {
    updateStepperState();
    refreshCollapsedBars();
    refreshProgressBar();
  });

  state.on('config.locked', () => {
    updateStepperState();
    refreshProgressBar();
  });

  state.on('ai.apiKeyValid', () => {
    updateStepperState();
    refreshProgressBar();
  });

  // ── Hamburger menu actions (connection import/export) ──
  state.on('menu.action', (action) => {
    if (action === 'connection-export') showExportDialog();
    if (action === 'connection-import') showImportDialog();
    // Clear the action so it can fire again
    if (action) setTimeout(() => state.set('menu.action', null), 0);
  });

  // Re-render locked summary when ticket token health check completes
  // (but NOT when diagnostics panel is driving the update itself)
  // If the token is missing/invalid during a locked boot, break the lock
  // so the user is sent back to setup to re-authorize.
  state.on('tickets.tokenHealth', (health) => {
    if (state.get('config.locked') && !_diagnosticsRunning) {
      if (health && (health.status === 'none' || health.status === 'error')) {
        console.warn('[boot] Ticket token validation failed — breaking lock');
        state.batch({
          'config.locked': false,
          'startingObject.type': null,
          'startingObject.name': null,
          'startingObject.id': null,
        });
        deleteSetting('config-locked');
        hideLockedSummary();
        setActiveStep('ticket');
        updateStepperState();
        refreshProgressBar();
        return;
      }
      renderLockedSummaryContent();
    }
  });

  // Wire up export/import module callbacks
  setSetupExportCallbacks({ refreshCollapsedBars, refreshProgressBar, updateStepperState });

  // Restore locked config from persistent storage on page reload
  loadLockedConfig();
}

// ─── Config Lock ─────────────────────────────────────────────────────────

async function handleConfigLock() {
  const isLocked = !!state.get('config.locked');
  const newLocked = !isLocked;
  state.set('config.locked', newLocked);

  if (newLocked) {
    await setSetting('config-locked', buildConfigSnapshot());
    showLockedSummary();
  } else {
    await deleteSetting('config-locked');
    hideLockedSummary();
    setActiveStep('connection');
    // Trigger auto-connect so the connection card re-validates credentials
    // and ticket card loads tickets (connection.status may still be 'restoring')
    state.set('config.autoConnectPending', true);
  }
}

/**
 * Boot sequence for locked config — explicit, predictable, sequential.
 *
 * Replaces the old state-listener cascade:
 *   loadLockedConfig → autoConnectPending → selectInstance → handleSaveInstance
 *   → connection.status listener → handleRefreshTickets → health check
 *
 * Now:
 *   1. Restore state from saved snapshot
 *   2. Show locked summary, skip splash, switch to Data tab
 *   3. Test admin credentials directly
 *   4. Set connection.status = 'connected'
 *      (this triggers the ticket-card listener which sequentially:
 *       loads tickets → checks tokens → runs health check)
 *
 * State listeners remain for user-initiated actions (manual connect,
 * ticket select, unlock). Only the boot path is explicit.
 */
async function loadLockedConfig() {
  const saved = await getSetting('config-locked');
  if (!saved) return;

  // ── Step 1: Restore state ──
  state.batch(applyConfigSnapshot(saved));

  // ── Step 2: UI setup ──
  showLockedSummary();
  updateStepperState();
  hideSplash();
  state.set('activeZone', 'data');

  // ── Step 3: Test admin credentials ──
  const instanceId = saved.instanceId;
  if (!instanceId) return;

  const instance = await getInstance(instanceId);
  if (!instance) return;

  // Uses Dexie-persisted admin token when available (no fresh grant)
  const test = await testAdminCredentials(instance);

  if (!test.ok) {
    console.warn('[boot] Admin credentials failed — breaking lock:', test.error);
    state.batch({
      'config.locked': false,
      'connection.instanceId': instanceId,
      'connection.url': saved.url || '',
      'connection.status': 'error',
      'connection.error': test.error,
      'startingObject.type': null,
      'startingObject.name': null,
      'startingObject.id': null,
    });
    await deleteSetting('config-locked');
    hideLockedSummary();
    setActiveStep('connection');
    updateStepperState();
    refreshProgressBar();
    return;
  }

  // ── Step 4: Set connected ──
  // The ticket-card's connection.status listener handles the rest:
  //   await handleRefreshTickets()  →  checkAllTokens()
  //   await runTicketTokenHealthCheck(preSelected)
  // These are properly serialized (see ticket-card.js guards).
  state.batch({
    'connection.instanceId': instanceId,
    'connection.url': saved.url || '',
    'connection.status': 'connected',
    'connection.error': null,
  });
}


function showLockedSummary() {
  // Hide all step cards
  STEPS.forEach(s => {
    const wrap = qs(`#step-${s.id}`);
    if (wrap) wrap.style.display = 'none';
  });

  const summaryEl = qs('#config-summary');
  if (!summaryEl) return;
  summaryEl.style.display = '';

  renderLockedSummaryContent();
}

/** Build / rebuild the locked summary content (called on show + token health updates) */
function renderLockedSummaryContent() {
  // Remove any orphaned token health tooltips from body before rebuilding
  document.querySelectorAll('.token-health-tooltip').forEach(t => t.remove());

  const summaryEl = qs('#config-summary');
  if (!summaryEl) return;

  // Capture open/closed state before clearing DOM
  const existingReauth = qs('#locked-reauth-section');
  const reauthWasOpen = existingReauth && existingReauth.style.display !== 'none';
  const existingDiagBody = qs('#locked-test-body');
  const diagnosticsWasOpen = existingDiagBody ? existingDiagBody.style.display !== 'none' : false;

  clear(summaryEl);

  const url = state.get('connection.url') || '';
  const hostname = url ? (() => { try { return new URL(url).hostname; } catch { return url; } })() : '—';
  const ticketId = state.get('tickets.selected') || '—';
  const objectType = state.get('startingObject.type') || '—';
  const hasAi = !!state.get('ai.apiKeyValid');
  const tokenHealth = state.get('tickets.tokenHealth');

  // Derive ticket token display
  let tokenLabel = 'Pending…';
  let tokenOk = false;
  if (tokenHealth && tokenHealth.ticketId === state.get('tickets.selected')) {
    const s = tokenHealth.status;
    tokenOk = s === 'ok';
    tokenLabel = s === 'ok' ? 'Valid'
      : s === 'warn' ? 'Partial'
      : s === 'expired' ? 'Expired'
      : s === 'none' ? 'No token'
      : 'Error';
  }

  const sections = [
    {
      title: 'Connection',
      desc: 'Tacton CPQ instance used for data access',
      items: [
        { label: 'Instance', value: hostname, ok: true },
      ],
    },
    {
      title: 'Data Source',
      desc: 'Ticket and object providing document data',
      items: [
        { label: 'Ticket', value: ticketId, ok: true },
        { label: 'Object', value: objectType, ok: true },
        { label: 'Ticket Token', value: tokenLabel, ok: tokenOk, hasTooltip: !!tokenHealth, isToken: true },
      ],
    },
    {
      title: 'AI Assistance',
      desc: 'Optional AI-powered document generation',
      items: [
        { label: 'AI', value: hasAi ? 'Configured' : 'Not set', ok: hasAi },
      ],
    },
  ];

  for (const section of sections) {
    const secKey = `summary-${section.title}`;
    const collapsed = summaryCollapseState[secKey] === true;

    // All items OK?
    const allOk = section.items.every(i => i.ok);
    const statusDot = el('span', {
      class: `config-summary-dot ${allOk ? 'dot-ok' : 'dot-muted'}`,
      style: { marginLeft: 'auto', flexShrink: '0' },
    });

    const header = el('div', {
      class: 'config-summary-section config-summary-section-toggle',
      onclick: () => {
        summaryCollapseState[secKey] = !summaryCollapseState[secKey];
        renderLockedSummaryContent();
      },
    }, [
      el('span', {
        class: 'icon config-summary-chevron',
        html: icon(collapsed ? 'chevronRight' : 'chevronDown', 12),
      }),
      el('div', { style: { flex: '1' } }, [
        el('span', { class: 'config-summary-section-title' }, section.title),
        el('span', { class: 'config-summary-section-desc' }, section.desc),
      ]),
      statusDot,
    ]);
    summaryEl.appendChild(header);

    if (collapsed) continue;

    for (const item of section.items) {
      const dot = el('span', {
        class: `config-summary-dot ${item.ok ? 'dot-ok' : 'dot-muted'}`,
      });

      // Value element — either plain text or a badge with hover tooltip
      let valueEl;
      if (item.hasTooltip && tokenHealth?.steps) {
        const badgeClass = item.ok ? 'token-health-ok' : 'token-health-warn';
        const badge = el('span', {
          class: `config-summary-token-badge ${badgeClass}`,
        }, item.value);

        // Build tooltip (appended to body to escape overflow:hidden parents)
        const tooltip = buildTokenHealthTooltip(tokenHealth, tokenLabel, item.ok);

        badge.addEventListener('mouseenter', () => {
          const rect = badge.getBoundingClientRect();
          tooltip.style.left = rect.left + 'px';
          tooltip.style.top = (rect.bottom + 6) + 'px';
          document.body.appendChild(tooltip);
          tooltip.classList.add('is-visible');
          const ttRect = tooltip.getBoundingClientRect();
          if (ttRect.bottom > window.innerHeight - 8) {
            tooltip.style.top = (rect.top - ttRect.height - 6) + 'px';
          }
        });
        badge.addEventListener('mouseleave', () => {
          tooltip.classList.remove('is-visible');
          if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
        });

        valueEl = el('span', { class: 'config-summary-token-wrap' }, [badge]);
      } else {
        valueEl = el('span', { class: 'config-summary-value' }, item.value);
      }

      const row = el('div', { class: 'config-summary-row' }, [
        dot,
        el('span', { class: 'config-summary-label' }, item.label),
        valueEl,
      ]);

      // Add re-authorize link on the token row
      if (item.isToken && ticketId !== '—') {
        const reauthLink = el('button', {
          class: 'locked-reauth-link',
          onclick: () => toggleLockedReauth(),
        }, tokenOk ? 'Re-authorize' : 'Authorize');
        row.appendChild(reauthLink);
      }

      summaryEl.appendChild(row);
    }
  }

  // ── Inline re-auth section (using shared auth form) ──
  if (ticketId !== '—') {
    lockedAuthForm = buildAuthForm({
      idPrefix: 'locked-reauth',
      title: `Authorize ${ticketId}`,
      onSubmit: () => handleLockedReauth(ticketId),
      onCancel: () => toggleLockedReauth(),
      showRefreshToken: true,
    });

    // Restore open/closed state
    if (reauthWasOpen) lockedAuthForm.show();

    summaryEl.appendChild(lockedAuthForm.section);
  }

  // ── Diagnostics section — collapsible (using shared diagnostic steps) ──
  const testStepsContainer = el('div', {
    class: 'conn-tooltip-steps',
    id: 'locked-test-steps',
  });

  // Show previous results if we have token health data
  if (tokenHealth?.steps) {
    renderDiagnosticSteps(testStepsContainer, tokenHealth.steps);
  }

  const testBtn = el('button', {
    class: 'btn btn-sm btn-ghost locked-test-btn',
    id: 'locked-test-btn',
    html: `${icon('refresh', 12)} Run`,
    onclick: (e) => { e.stopPropagation(); handleLockedDiagnostics(ticketId); },
  });

  const testBody = el('div', {
    id: 'locked-test-body',
    style: { display: diagnosticsWasOpen ? '' : 'none' },
  }, [testStepsContainer]);

  const chevron = el('span', {
    class: `locked-test-chevron ${diagnosticsWasOpen ? 'open' : ''}`,
    id: 'locked-test-chevron',
  }, '›');

  const testHeader = el('div', {
    class: 'locked-test-header',
    onclick: () => toggleLockedDiagnostics(),
  }, [
    chevron,
    el('span', { class: 'locked-test-title' }, 'Diagnostics'),
    testBtn,
  ]);

  const testSection = el('div', {
    class: 'locked-test-section',
    id: 'locked-test-section',
  }, [testHeader, testBody]);

  summaryEl.appendChild(testSection);
}

/* renderLockedTestSteps — removed, now using shared renderDiagnosticSteps() */

/**
 * Run full diagnostics: instance-level admin creds test + ticket token health.
 * Results displayed inline on the locked summary — no need to unlock.
 */
async function handleLockedDiagnostics(ticketId) {
  const btn = qs('#locked-test-btn');
  const container = qs('#locked-test-steps');
  if (!container) return;

  _diagnosticsRunning = true;
  if (btn) { btn.disabled = true; btn.innerHTML = `${icon('refresh', 12)} Testing…`; }
  clear(container);

  const instanceId = state.get('connection.instanceId');
  const instance = await getInstance(instanceId);

  if (!instance) {
    renderDiagnosticSteps(container, [
      { label: 'Instance', status: 'fail', detail: 'Not found in storage' },
    ]);
    if (btn) { btn.disabled = false; btn.innerHTML = `${icon('refresh', 12)} Run Diagnostics`; }
    return;
  }

  // ── Instance-level diagnostics ──

  // Step 1: Test admin token (show checking state)
  renderDiagnosticSteps(container, [
    { label: 'Admin Credentials', status: 'checking', detail: 'Testing…' },
  ]);

  const adminResult = await testAdminCredentials(instance);
  // Replace checking step with result
  clear(container);
  const allSteps = [{
    label: 'Admin Credentials',
    status: adminResult.ok ? 'pass' : 'fail',
    detail: adminResult.ok ? 'Valid' : adminResult.error,
  }];
  renderDiagnosticSteps(container, allSteps);

  // Step 2: Test ticket list fetch (append checking state)
  renderDiagnosticSteps(container, [
    { label: 'Ticket List API', status: 'checking', detail: 'Testing…' },
  ]);

  let ticketListOk = false;
  try {
    const res = await adminFetch(instance, '/api/ticket/list');
    ticketListOk = res.ok;
    allSteps.push({
      label: 'Ticket List API',
      status: res.ok ? 'pass' : 'fail',
      detail: res.ok ? `OK (${res.body.length}b)` : `HTTP ${res.status}`,
    });
  } catch (e) {
    allSteps.push({
      label: 'Ticket List API',
      status: 'fail',
      detail: e.message,
    });
  }

  // Re-render with completed steps
  clear(container);
  renderDiagnosticSteps(container, allSteps);

  // ── Ticket-level diagnostics ──
  if (ticketId && ticketId !== '—') {
    // Separator
    container.appendChild(el('div', { class: 'conn-tooltip-step', style: { padding: '2px 0' } }, [
      el('span', {
        style: { fontSize: '10px', fontWeight: '700', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.3px' },
      }, `Ticket: ${ticketId}`),
    ]));

    // Show checking placeholder
    renderDiagnosticSteps(container, [
      { label: 'Token Health Check', status: 'checking', detail: 'Running 5-step check…' },
    ]);

    try {
      const result = await testTicketToken(instance, ticketId);

      // Remove the checking placeholder (last child) and render actual steps
      const lastChild = container.lastElementChild;
      if (lastChild) lastChild.remove();

      renderDiagnosticSteps(container, result.steps);

      // Update state so badge refreshes
      state.set('tickets.tokenHealth', {
        status: result.status,
        steps: result.steps,
        ticketId,
      });
    } catch (e) {
      // Remove checking placeholder and show error
      const lastChild = container.lastElementChild;
      if (lastChild) lastChild.remove();

      renderDiagnosticSteps(container, [
        { label: 'Token Health Check', status: 'fail', detail: e.message },
      ]);
    }
  }

  _diagnosticsRunning = false;
  if (btn) { btn.disabled = false; btn.innerHTML = `${icon('refresh', 12)} Run Diagnostics`; }
}

/** Toggle the inline re-auth section visibility */
function toggleLockedReauth() {
  if (!lockedAuthForm) return;
  if (lockedAuthForm.isVisible()) {
    lockedAuthForm.hide();
  } else {
    lockedAuthForm.clearInputs();
    lockedAuthForm.showStatus('', '');
    lockedAuthForm.show();
    lockedAuthForm.focusAccess();
  }
}

/** Toggle the diagnostics section visibility */
function toggleLockedDiagnostics() {
  const body = qs('#locked-test-body');
  const chevron = qs('#locked-test-chevron');
  if (!body) return;
  const isVisible = body.style.display !== 'none';
  body.style.display = isVisible ? 'none' : '';
  if (chevron) chevron.classList.toggle('open', !isVisible);
}

/**
 * Handle token submission from the locked summary re-auth.
 * Same 3-tier logic as ticket-card (access token → refresh token → auth code).
 * Locked to the specified ticket — cannot change which ticket.
 */
async function handleLockedReauth(ticketId) {
  if (!lockedAuthForm) return;

  const accessToken = lockedAuthForm.getAccessValue();
  const refreshToken = lockedAuthForm.getRefreshValue();

  if (!accessToken && !refreshToken) {
    lockedAuthForm.showStatus('Please enter an access or refresh token', 'error');
    return;
  }

  const instanceId = state.get('connection.instanceId');
  const instance = await getInstance(instanceId);
  if (!instance) {
    lockedAuthForm.showStatus('No instance connected', 'error');
    return;
  }

  lockedAuthForm.setSubmitLoading(true);
  lockedAuthForm.showStatus('', '');

  // ── Use shared authorization flow (validates before storing) ──
  const result = await authorizeTicket(instance, ticketId, accessToken, refreshToken);

  lockedAuthForm.setSubmitLoading(false);

  if (result.ok) {
    lockedAuthForm.clearInputs();
    lockedAuthForm.showStatus(`Authorized via ${result.method}`, 'success');

    // Re-run token health check — this updates the badge and re-renders the summary
    try {
      const health = await testTicketToken(instance, ticketId);
      state.set('tickets.tokenHealth', {
        status: health.status,
        steps: health.steps,
        ticketId,
      });
    } catch (e) {
      state.set('tickets.tokenHealth', {
        status: 'error',
        steps: [{ label: 'Token Test', status: 'fail', detail: e.message }],
        ticketId,
      });
    }
  } else {
    lockedAuthForm.showStatus(result.error, 'error');
  }
}

/** Build a detached tooltip element for ticket token health (appended to body on hover) */
function buildTokenHealthTooltip(tokenHealth, tokenLabel, isOk) {
  const tooltip = el('div', { class: 'token-health-tooltip' });

  const tooltipHeader = el('div', { class: 'conn-tooltip-header' }, [
    el('span', { class: 'conn-tooltip-title' }, `Ticket Token (${tokenHealth.ticketId})`),
    el('span', {
      class: `conn-tooltip-badge ${isOk ? 'ok' : tokenHealth.status === 'warn' ? 'warn' : 'error'}`,
    }, tokenLabel),
  ]);
  tooltip.appendChild(tooltipHeader);

  const stepsEl = el('div', { class: 'conn-tooltip-steps' });
  renderDiagnosticSteps(stepsEl, tokenHealth.steps);
  tooltip.appendChild(stepsEl);

  return tooltip;
}

function hideLockedSummary() {
  // Remove any orphaned token health tooltips from body
  document.querySelectorAll('.token-health-tooltip').forEach(t => t.remove());

  const summaryEl = qs('#config-summary');
  if (summaryEl) {
    summaryEl.style.display = 'none';
    clear(summaryEl);
  }

  // Show all step cards again
  STEPS.forEach(s => {
    const wrap = qs(`#step-${s.id}`);
    if (wrap) wrap.style.display = '';
  });
}

// ─── Helpers ─────────────────────────────────────────────────────────────

// ─── Progress area collapse ─────────────────────────────────────────

function toggleProgressArea() {
  progressCollapsed = !progressCollapsed;
  const area = qs('#setup-progress-area');
  const bar = qs('#progress-collapsed-bar');
  if (area) area.style.display = progressCollapsed ? 'none' : '';
  if (bar) bar.style.display = progressCollapsed ? '' : 'none';
  if (progressCollapsed) refreshProgressBar();
}

/** Refresh the collapsed progress bar content with current step status. */
function refreshProgressBar() {
  const pctEl = qs('#progress-bar-pct');
  const dotsEl = qs('#progress-bar-dots');
  const badgeEl = qs('#progress-bar-badge-label');
  const lockBtn = qs('#progress-bar-lock-btn');
  if (!pctEl || !dotsEl) return;

  // Calculate percentage
  const connected = state.get('connection.status') === 'connected' || state.get('connection.status') === 'restoring';
  const hasTicket = !!state.get('tickets.selected');
  const hasObject = !!state.get('startingObject.type');
  const hasAi = !!state.get('ai.apiKeyValid');
  const steps = [connected, hasTicket, hasObject]; // AI is optional
  const done = steps.filter(Boolean).length + (hasAi ? 1 : 0);
  const pct = Math.round((done / 4) * 100);
  pctEl.textContent = `${pct}%`;

  // Hide badge — percentage is sufficient
  if (badgeEl) badgeEl.style.display = 'none';

  // Lock button + bar styling
  const isLocked = !!state.get('config.locked');
  const allRequired = connected && hasTicket && hasObject;
  if (lockBtn) {
    lockBtn.disabled = !allRequired && !isLocked;
    lockBtn.classList.toggle('lock-btn-ready', allRequired || isLocked);
    lockBtn.classList.toggle('lock-btn-locked', isLocked);
    lockBtn.title = isLocked ? 'Unlock configuration' : allRequired ? 'Lock configuration' : 'Complete all steps to lock';
    const iconEl = qs('#progress-bar-lock-icon');
    const labelEl = qs('#progress-bar-lock-label');
    if (iconEl) iconEl.innerHTML = icon(isLocked ? 'unlock' : 'lock', 12);
    if (labelEl) labelEl.textContent = isLocked ? 'Unlock' : 'Lock';
  }

  // Toggle locked appearance on the entire bar
  const barEl = qs('#progress-collapsed-bar');
  if (barEl) barEl.classList.toggle('progress-bar-locked', isLocked);

  // Build step indicators with checkmarks
  clear(dotsEl);
  const stepInfo = [
    { label: 'Instance', ok: connected, stepId: 'connection' },
    { label: 'Ticket', ok: hasTicket, stepId: 'ticket' },
    { label: 'Object', ok: hasObject, stepId: 'starting-object' },
    { label: 'AI', ok: hasAi, optional: true, stepId: 'ai' },
  ];
  for (const s of stepInfo) {
    const indicator = s.ok
      ? el('span', { class: 'progress-bar-check-icon ok', html: icon('check', 12) })
      : el('span', { class: 'progress-bar-check-icon muted' }, '–');
    const stepEl = el('span', {
      class: `progress-bar-step ${isLocked ? '' : 'progress-bar-step-clickable'}`,
      onclick: isLocked ? null : (e) => {
        e.stopPropagation();
        setActiveStep(s.stepId);
      },
    }, [
      indicator,
      el('span', { class: `progress-bar-step-label ${s.ok ? 'step-label-ok' : ''}` }, s.label),
    ]);
    dotsEl.appendChild(stepEl);
  }
}

/**
 * Add a collapsed status bar to a step card wrapper.
 * When the step is collapsed (not active, not locked), this bar shows
 * instead of the full card.
 */
function addCollapsedBar(wrap, stepId) {
  const step = STEPS.find(s => s.id === stepId);
  if (!step) return;

  const bar = el('div', {
    class: 'step-collapsed-bar',
    id: `step-bar-${stepId}`,
    onclick: () => setActiveStep(stepId),
  }, [
    el('span', { class: 'icon step-bar-icon', html: icon(step.icon, 14) }),
    el('span', { class: 'step-bar-label' }, step.label),
    el('span', { class: 'step-bar-value', id: `step-bar-val-${stepId}` }),
    el('span', { class: 'step-bar-badge', id: `step-bar-badge-${stepId}` }),
    el('span', { class: 'icon step-bar-chevron', html: icon('chevronDown', 12) }),
  ]);

  wrap.appendChild(bar);
}

/** Refresh the value/badge shown on each collapsed bar. */
function refreshCollapsedBars() {
  // Connection
  const connStatus = state.get('connection.status');
  const connUrl = state.get('connection.url') || '';
  const connHostname = connUrl ? (() => { try { return new URL(connUrl).hostname; } catch { return connUrl; } })() : '—';
  setBarContent('connection', connHostname,
    connStatus === 'connected' ? 'CONNECTED' : connStatus === 'restoring' ? 'RESTORING' : '',
    connStatus === 'connected');

  // Ticket
  const ticketId = state.get('tickets.selected');
  setBarContent('ticket', ticketId || '—',
    ticketId ? 'SELECTED' : '',
    !!ticketId);

  // Starting Object
  const objType = state.get('startingObject.type');
  setBarContent('starting-object', objType || '—',
    objType ? 'SET' : '',
    !!objType);

  // AI
  const hasAi = !!state.get('ai.apiKeyValid');
  setBarContent('ai', hasAi ? 'Configured' : 'Not set',
    hasAi ? 'READY' : 'OPTIONAL',
    hasAi);
}

function setBarContent(stepId, value, badgeText, isOk) {
  const valEl = qs(`#step-bar-val-${stepId}`);
  const badgeEl = qs(`#step-bar-badge-${stepId}`);
  if (valEl) valEl.textContent = value;
  if (badgeEl) {
    badgeEl.textContent = badgeText;
    badgeEl.className = `step-bar-badge ${isOk ? 'step-bar-badge-ok' : 'step-bar-badge-muted'}`;
  }
}

function handleStepClick(stepId) {
  const marker = qs(`#marker-${stepId}`);
  if (!marker || marker.classList.contains('marker-locked')) return;
  setActiveStep(stepId);
}

function setActiveStep(stepId) {
  activeStep = stepId;

  STEPS.forEach(s => {
    const wrap = qs(`#step-${s.id}`);
    if (!wrap) return;
    const card = wrap.querySelector('.card');
    const bar = wrap.querySelector('.step-collapsed-bar');

    if (s.id === stepId) {
      wrap.classList.add('step-active');
      wrap.classList.remove('step-collapsed');
      if (card) card.style.display = '';
      if (bar) bar.style.display = 'none';
    } else {
      wrap.classList.remove('step-active');
      wrap.classList.add('step-collapsed');
      if (card) card.style.display = 'none';
      if (bar) bar.style.display = '';
    }
  });

  refreshCollapsedBars();
  updateStepperState();
}

function unlockStep(stepId) {
  const wrap = qs(`#step-${stepId}`);
  if (wrap) {
    wrap.classList.remove('step-locked');
    wrap.classList.add('step-collapsed');
  }
  updateStepperState();
}

function lockStep(stepId) {
  const wrap = qs(`#step-${stepId}`);
  if (wrap) {
    wrap.classList.remove('step-active');
    wrap.classList.add('step-locked', 'step-collapsed');
    const card = wrap.querySelector('.card');
    const bar = wrap.querySelector('.step-collapsed-bar');
    if (card) card.style.display = 'none';
    if (bar) bar.style.display = '';
  }
  updateStepperState();
}

/**
 * Add a full-width "Proceed →" bar at the bottom of the step card.
 * Appended to the .card element inside the wrapper.
 */
function addProceedButton(wrap, currentStepId, nextStepId) {
  const nextStep = STEPS.find(s => s.id === nextStepId);
  const nextLabel = nextStep ? nextStep.label : 'Next';

  const row = el('div', {
    class: 'proceed-row',
    id: `proceed-${currentStepId}`,
  });

  const btn = el('button', {
    class: 'proceed-link',
    disabled: true,
    onclick: () => {
      unlockStep(nextStepId);
      setActiveStep(nextStepId);
    },
  });
  btn.innerHTML = `Next: ${nextLabel} ${icon('chevronRight', 14)}`;
  row.appendChild(btn);

  // Append to the card element
  const card = wrap.querySelector('.card');
  if (card) {
    card.appendChild(row);
  } else {
    wrap.appendChild(row);
  }
}

/** Is connection live or being restored from snapshot? */
function isConnectedOrRestoring() {
  const s = state.get('connection.status');
  return s === 'connected' || s === 'restoring';
}

/**
 * Enable/disable proceed buttons based on step completion.
 */
function updateProceedButtons() {
  const isConnected = isConnectedOrRestoring();
  const hasTicket = !!state.get('tickets.selected');
  const hasObject = !!state.get('startingObject.type');

  const pairs = [
    ['#proceed-connection', isConnected],
    ['#proceed-ticket', hasTicket],
    ['#proceed-starting-object', hasObject],
  ];

  for (const [sel, ready] of pairs) {
    const row = qs(sel);
    if (!row) continue;
    const btn = row.querySelector('.proceed-link');
    if (btn) btn.disabled = !ready;
  }
}

function updateStepperState() {
  const isConnected = isConnectedOrRestoring();
  const hasTicket = !!state.get('tickets.selected');
  const hasObject = !!state.get('startingObject.type');
  const hasAiKey = !!state.get('ai.apiKeyValid');
  const isLocked = !!state.get('config.locked');

  // Count completed core steps (3 required = 100%)
  // AI is a bonus that pushes to 110%
  const CORE_STEPS = 3;
  let coreCompleted = 0;
  if (isConnected) coreCompleted++;
  if (hasTicket) coreCompleted++;
  if (hasObject) coreCompleted++;

  const corePct = Math.round((coreCompleted / CORE_STEPS) * 100);
  const pct = corePct + (hasAiKey ? 10 : 0);

  // Update ring fill — cap visual fill at 100% of the circle
  const ringFill = qs('#progress-ring-fill');
  if (ringFill) {
    const visualPct = Math.min(pct, 100);
    const offset = RING_CIRC - (RING_CIRC * visualPct / 100);
    ringFill.style.strokeDashoffset = offset;
  }

  // Update center text — cap display at 100%
  const pctEl = qs('#progress-ring-pct');
  if (pctEl) pctEl.textContent = Math.min(pct, 100) + '%';

  // Update center: show intro at 0%, percentage otherwise
  const centerEl = qs('#progress-ring-center');
  if (centerEl) {
    if (coreCompleted === 0) {
      centerEl.classList.add('ring-intro');
    } else {
      centerEl.classList.remove('ring-intro');
    }
  }

  // Update step list markers
  STEPS.forEach(step => {
    const marker = qs(`#marker-${step.id}`);
    const iconWrap = qs(`#step-icon-${step.id}`);
    if (!marker) return;

    marker.classList.remove('marker-active', 'marker-complete', 'marker-locked');

    let isComplete = false;
    let isLocked = false;

    if (step.id === 'connection') {
      isComplete = isConnected;
    } else if (step.id === 'ticket') {
      isComplete = hasTicket;
      isLocked = !isConnected;
    } else if (step.id === 'starting-object') {
      isComplete = !!hasObject;
      isLocked = !hasTicket;
    } else if (step.id === 'ai') {
      isComplete = hasAiKey;
    }

    // When config is locked, all completed steps are green, no blue active highlight
    const configLocked = !!state.get('config.locked');

    if (isComplete) {
      marker.classList.add('marker-complete');
    }

    if (configLocked) {
      // Locked: completed → green, optional uncompleted → muted, nothing active
      if (!isComplete && step.optional) {
        marker.classList.add('marker-locked');
      }
    } else if (step.id === activeStep && !isLocked) {
      // Active step gets blue highlight even if also complete
      marker.classList.add('marker-active');
    } else if (isLocked && !isComplete) {
      marker.classList.add('marker-locked');
    }

    // Swap icon to checkmark when complete
    if (iconWrap) {
      iconWrap.innerHTML = isComplete ? icon('check', 14) : icon(step.icon, 14);
    }
  });

  // ── Config lock button + label state ──
  const lockBtn = qs('#config-lock-btn');
  const lockLabel = qs('#config-lock-label');
  const lockWrap = qs('#config-lock-wrap');
  if (lockBtn) {
    const canLock = corePct >= 100;
    lockBtn.disabled = !canLock && !isLocked;

    lockBtn.classList.remove('config-lock-disabled', 'config-lock-ready', 'config-lock-active');
    if (lockWrap) lockWrap.classList.remove('config-lock-wrap-active');

    if (isLocked) {
      lockWasReady = false; // Reset so pulse re-triggers on unlock
      lockBtn.classList.add('config-lock-active');
      lockBtn.innerHTML = `${icon('lock', 18)}`;
      if (lockLabel) lockLabel.textContent = 'Locked';
      if (lockWrap) lockWrap.classList.add('config-lock-wrap-active');
    } else if (canLock) {
      // Re-trigger pulse animation when first becoming ready
      if (!lockWasReady) {
        lockBtn.style.animation = 'none';
        lockBtn.offsetHeight; // force reflow
        lockBtn.style.animation = '';
        lockWasReady = true;
      }
      lockBtn.classList.add('config-lock-ready');
      lockBtn.innerHTML = `${icon('unlock', 18)}`;
      if (lockLabel) lockLabel.textContent = 'Lock';
    } else {
      lockWasReady = false;
      lockBtn.classList.add('config-lock-disabled');
      lockBtn.innerHTML = `${icon('lock', 18)}`;
      if (lockLabel) lockLabel.textContent = 'Lock';
    }
  }

  // ── Guide trail: show animated dots between lock and ring at 100% ──
  const guideTrail = qs('#lock-guide-trail');
  if (guideTrail) {
    const canLock = corePct >= 100;
    guideTrail.style.display = (canLock && !isLocked) ? '' : 'none';
  }

  updateProceedButtons();
}
