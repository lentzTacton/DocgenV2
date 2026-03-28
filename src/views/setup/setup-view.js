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
import { getSetting, setSetting, deleteSetting } from '../../core/storage.js';
import { createConnectionCard } from './connection-card.js';
import { createTicketCard } from './ticket-card.js';
import { createStartingObjectCard } from './starting-object-card.js';
import { createAiSettingsCard } from './ai-settings-card.js';

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
  const progressArea = el('div', { class: 'setup-progress-area' });

  // — Config lock (left of ring, icon + label stacked) —
  const configLockLabel = el('span', {
    class: 'config-lock-label',
    id: 'config-lock-label',
  }, 'Lock config');

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

  // ── Add Proceed buttons to each step ──
  addProceedButton(connWrap,   'connection',      'ticket');
  addProceedButton(ticketWrap, 'ticket',          'starting-object');
  addProceedButton(objectWrap, 'starting-object', 'ai');
  // AI is the last step — no proceed button

  // ── Set initial state ──
  setActiveStep('connection');

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
  });

  state.on('tickets.selected', (ticketId) => {
    if (ticketId) {
      unlockStep('starting-object');
      // Don't auto-advance — let the user proceed when ready
    } else {
      // Ticket deselected — re-lock starting object
      lockStep('starting-object');
      if (activeStep === 'starting-object') {
        setActiveStep('ticket');
      }
    }
  });

  state.on('startingObject.type', () => {
    updateStepperState();
  });

  state.on('config.locked', () => {
    updateStepperState();
  });

  state.on('ai.apiKeyValid', () => {
    updateStepperState();
  });

  // Re-render locked summary when ticket token health check completes
  state.on('tickets.tokenHealth', () => {
    if (state.get('config.locked')) {
      renderLockedSummaryContent();
    }
  });

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
  }
}

async function loadLockedConfig() {
  const saved = await getSetting('config-locked');
  if (!saved) return;

  // Restore all state from the saved snapshot
  state.batch(applyConfigSnapshot(saved));

  showLockedSummary();
  updateStepperState();
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
        { label: 'Ticket Token', value: tokenLabel, ok: tokenOk, hasTooltip: !!tokenHealth },
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

  const ICONS = { pass: '✓', fail: '✗', skip: '–', warn: '!' };

  for (const section of sections) {
    summaryEl.appendChild(
      el('div', { class: 'config-summary-section' }, [
        el('span', { class: 'config-summary-section-title' }, section.title),
        el('span', { class: 'config-summary-section-desc' }, section.desc),
      ])
    );

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
        const tooltip = buildTokenHealthTooltip(tokenHealth, tokenLabel, item.ok, ICONS);

        badge.addEventListener('mouseenter', () => {
          const rect = badge.getBoundingClientRect();
          tooltip.style.left = rect.left + 'px';
          tooltip.style.top = (rect.bottom + 6) + 'px';
          // Flip upward if it would overflow the viewport
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

      summaryEl.appendChild(
        el('div', { class: 'config-summary-row' }, [
          dot,
          el('span', { class: 'config-summary-label' }, item.label),
          valueEl,
        ])
      );
    }
  }
}

/** Build a detached tooltip element for ticket token health (appended to body on hover) */
function buildTokenHealthTooltip(tokenHealth, tokenLabel, isOk, ICONS) {
  const tooltip = el('div', { class: 'token-health-tooltip' });

  const tooltipHeader = el('div', { class: 'conn-tooltip-header' }, [
    el('span', { class: 'conn-tooltip-title' }, `Ticket Token (${tokenHealth.ticketId})`),
    el('span', {
      class: `conn-tooltip-badge ${isOk ? 'ok' : tokenHealth.status === 'warn' ? 'warn' : 'error'}`,
    }, tokenLabel),
  ]);
  tooltip.appendChild(tooltipHeader);

  const stepsEl = el('div', { class: 'conn-tooltip-steps' });
  for (const step of tokenHealth.steps) {
    stepsEl.appendChild(el('div', { class: 'conn-tooltip-step' }, [
      el('span', { class: `conn-tooltip-icon tt-${step.status}` }, ICONS[step.status] || '–'),
      el('div', { class: 'conn-tooltip-body' }, [
        el('div', { class: 'conn-tooltip-label' }, step.label),
        el('div', { class: 'conn-tooltip-detail' }, step.detail),
      ]),
    ]));
  }
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
    if (s.id === stepId) {
      wrap.classList.add('step-active');
      wrap.classList.remove('step-collapsed');
    } else {
      wrap.classList.remove('step-active');
      if (!wrap.classList.contains('step-locked')) {
        wrap.classList.add('step-collapsed');
      }
    }
  });

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
    wrap.classList.remove('step-active', 'step-collapsed');
    wrap.classList.add('step-locked');
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

  // Update center text — shows 110% when AI is configured
  const pctEl = qs('#progress-ring-pct');
  if (pctEl) pctEl.textContent = pct + '%';

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
      if (lockLabel) lockLabel.textContent = 'Lock config';
    } else {
      lockWasReady = false;
      lockBtn.classList.add('config-lock-disabled');
      lockBtn.innerHTML = `${icon('lock', 18)}`;
      if (lockLabel) lockLabel.textContent = 'Lock config';
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
