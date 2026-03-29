import state from './state.js';
import { el, qs, clear } from './dom.js';
import { createTabs } from '../components/tabs.js';
import { createSplash, hideSplash, showSplash } from '../components/splash.js';
import { icon, iconEl } from '../components/icon.js';
import { createSetupView } from '../views/setup/setup-view.js';
import { createDataView } from '../views/data/data-view.js';
import { createBuilderView } from '../views/builder/builder-view.js';
import { createPreviewView } from '../views/preview/preview-view.js';
import { loadAiSettings, clearAllDataRecords, getSetting, setSetting } from './storage.js';
import { startSelectionListener } from '../services/word-api.js';
import { initSelectionPanel } from '../views/data/selection-panel.js';

function createHeader() {
  return el('div', { class: 'header' }, [
    // Left: Tacton logo
    el('div', { class: 'header-left' }, [
      el('img', {
        class: 'header-logo-img',
        src: 'assets/icons/tacton-logo.svg',
        alt: 'Tacton',
      }),
    ]),

    // Center: Mode toggle (Manual / AI Assisted)
    el('div', { class: 'header-center' }, [
      el('div', { class: 'mode-toggle', id: 'mode-toggle' }, [
        el('button', {
          class: 'mode-btn is-active',
          id: 'btn-mode-manual',
          title: 'Manual expression builder',
          onclick: () => switchMode('manual'),
        }, 'Manual'),
        el('button', {
          class: 'mode-btn',
          id: 'btn-mode-assisted',
          title: 'AI-powered assistant',
          onclick: () => switchMode('assisted'),
        }, [
          el('span', { class: 'mode-ai-badge' }, 'AI'),
          ' Assisted',
        ]),
      ]),
    ]),

    // Right: DocGen Plugin badge
    el('div', { class: 'header-right' }, [
      el('span', { class: 'header-badge' }, 'DocGen Plugin'),
    ]),
  ]);
}

function switchMode(mode) {
  // Only allow switching if toggle is enabled
  const toggle = qs('#mode-toggle');
  if (toggle.classList.contains('mode-toggle-disabled')) return;

  state.set('ai.mode', mode);
  qs('#btn-mode-manual').classList.toggle('is-active', mode === 'manual');
  qs('#btn-mode-assisted').classList.toggle('is-active', mode === 'assisted');
}

function updateModeToggleState() {
  const toggle = qs('#mode-toggle');
  if (!toggle) return;

  const hasValidKey = state.get('ai.apiKeyValid');
  const isConnected = state.get('connection.status') === 'connected';

  if (hasValidKey && isConnected) {
    toggle.classList.remove('mode-toggle-disabled');
    toggle.removeAttribute('data-tooltip');
  } else {
    toggle.classList.add('mode-toggle-disabled');
    toggle.setAttribute('data-tooltip', 'AI API key needed');
    // Force back to manual if toggle becomes disabled
    if (state.get('ai.mode') === 'assisted') {
      switchMode('manual');
    }
  }
}

export async function initApp() {
  // ── One-time data reset (remove this block after it has run once) ──
  const resetDone = await getSetting('_uuid_reset_v2');
  if (!resetDone) {
    console.log('[app] One-time data reset: clearing old records for UUID migration…');
    await clearAllDataRecords();
    await setSetting('_uuid_reset_v2', { doneAt: Date.now() });
    console.log('[app] Reset complete — cookbook will re-seed with UUID IDs.');
  }
  // ── End one-time reset ──

  const appContainer = qs('#app');

  // Main app wrapper (header + tabs + zones) — hidden until splash dismissed
  const mainApp = el('div', { id: 'main-app', style: { display: 'none' } }, [
    createHeader(),
    createTabs(),
    el('div', { id: 'zone-container', class: 'zone-container' }, [
      el('div', { class: 'zone', id: 'zone-setup' }),
      el('div', { class: 'zone', id: 'zone-data' }),
      el('div', { class: 'zone', id: 'zone-builder' }),
      el('div', { class: 'zone', id: 'zone-preview' }),
    ]),
  ]);

  // Taskpane: splash + main app
  const taskpane = el('div', { class: 'taskpane' }, [
    createSplash(),
    mainApp,
  ]);

  appContainer.appendChild(taskpane);

  // Populate views
  createSetupView(qs('#zone-setup'));
  createDataView(qs('#zone-data'));
  createBuilderView(qs('#zone-builder'));
  createPreviewView(qs('#zone-preview'));

  // Subscribe to zone changes
  state.on('activeZone', (zone) => {
    const zones = document.querySelectorAll('.zone');
    zones.forEach(z => z.classList.remove('active'));
    const activeZone = qs(`#zone-${zone}`);
    if (activeZone) {
      activeZone.classList.add('active');
    }
  });

  // Activate initial zone (state default is 'setup' so set() won't fire the listener)
  const initialZone = state.get('activeZone') || 'setup';
  const activeZone = qs(`#zone-${initialZone}`);
  if (activeZone) activeZone.classList.add('active');

  // Subscribe to connection status changes — update toggle state
  state.on('connection.status', () => {
    updateModeToggleState();
  });

  // Subscribe to AI key validation — update toggle state
  state.on('ai.apiKeyValid', () => {
    updateModeToggleState();
  });

  // Load saved AI settings and apply
  loadAiSettings().then(settings => {
    if (settings.apiKey) {
      state.batch({
        'ai.apiKey': settings.apiKey,
        'ai.model': settings.model || 'claude-sonnet-4-5-20250514',
        'ai.maxTokens': settings.maxTokens || 2048,
        'ai.apiKeyValid': true,
      });
    }
    updateModeToggleState();
  });

  // Initial toggle state
  updateModeToggleState();

  // Selection panel + Word listener
  initSelectionPanel();
  startSelectionListener();
}
