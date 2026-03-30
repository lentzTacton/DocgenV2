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

    // Right: hamburger menu
    el('div', { class: 'header-right' }, [
      createHamburgerMenu(),
    ]),
  ]);
}

// ─── Hamburger Menu ───────────────────────────────────────────────────

function createHamburgerMenu() {
  const menuBtn = el('button', {
    class: 'hamburger-btn',
    id: 'hamburger-btn',
    title: 'Menu',
    onclick: (e) => { e.stopPropagation(); toggleHamburgerMenu(); },
  });
  menuBtn.innerHTML = icon('menu', 18);
  return menuBtn;
}

function toggleHamburgerMenu() {
  const existing = qs('#hamburger-dropdown');
  if (existing) { existing.remove(); return; }
  showHamburgerMenu();
}

function showHamburgerMenu() {
  const btn = qs('#hamburger-btn');
  if (!btn) return;

  // Track which group is expanded
  let expandedGroup = null;

  function buildMenu() {
    clear(dropdown);

    // ── Section: Import & Export ──
    dropdown.appendChild(el('div', { class: 'hb-section-label' }, 'Import & Export'));

    // Connection — expandable
    const connItem = el('button', {
      class: `hb-menu-item hb-expandable ${expandedGroup === 'connection' ? 'hb-expanded' : ''}`,
      onclick: (e) => { e.stopPropagation(); expandedGroup = expandedGroup === 'connection' ? null : 'connection'; buildMenu(); },
    }, [
      el('span', { class: 'icon', html: icon('link', 14) }),
      el('span', {}, 'Connection'),
      el('span', { class: 'hb-chevron icon', html: icon(expandedGroup === 'connection' ? 'chevronDown' : 'chevronRight', 10) }),
    ]);
    dropdown.appendChild(connItem);

    if (expandedGroup === 'connection') {
      dropdown.appendChild(el('button', { class: 'hb-sub-item', onclick: () => { closeHamburgerMenu(); state.set('menu.action', 'connection-export'); } }, [
        el('span', { class: 'icon', html: icon('upload', 12) }),
        'Export',
      ]));
      dropdown.appendChild(el('button', { class: 'hb-sub-item', onclick: () => { closeHamburgerMenu(); state.set('menu.action', 'connection-import'); } }, [
        el('span', { class: 'icon', html: icon('download', 12) }),
        'Import',
      ]));
    }

    // Data — expandable
    const dataItem = el('button', {
      class: `hb-menu-item hb-expandable ${expandedGroup === 'data' ? 'hb-expanded' : ''}`,
      onclick: (e) => { e.stopPropagation(); expandedGroup = expandedGroup === 'data' ? null : 'data'; buildMenu(); },
    }, [
      el('span', { class: 'icon', html: icon('database', 14) }),
      el('span', {}, 'Data'),
      el('span', { class: 'hb-chevron icon', html: icon(expandedGroup === 'data' ? 'chevronDown' : 'chevronRight', 10) }),
    ]);
    dropdown.appendChild(dataItem);

    if (expandedGroup === 'data') {
      dropdown.appendChild(el('button', { class: 'hb-sub-item', onclick: () => { closeHamburgerMenu(); state.set('menu.action', 'data-export'); } }, [
        el('span', { class: 'icon', html: icon('upload', 12) }),
        'Export',
      ]));
      dropdown.appendChild(el('button', { class: 'hb-sub-item', onclick: () => { closeHamburgerMenu(); state.set('menu.action', 'data-import'); } }, [
        el('span', { class: 'icon', html: icon('download', 12) }),
        'Import',
      ]));
    }
  }

  const dropdown = el('div', { class: 'hamburger-dropdown', id: 'hamburger-dropdown' });
  buildMenu();

  // Position below the header-right area
  const taskpane = qs('.taskpane');
  (taskpane || document.body).appendChild(dropdown);

  // Close on click outside
  const closeOnOutside = (e) => {
    if (!dropdown.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      closeHamburgerMenu();
      document.removeEventListener('click', closeOnOutside);
    }
  };
  setTimeout(() => document.addEventListener('click', closeOnOutside), 0);
}

function closeHamburgerMenu() {
  const dd = qs('#hamburger-dropdown');
  if (dd) dd.remove();
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
