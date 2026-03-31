/**
 * Tab Bar Component
 *
 * Provides 4-zone navigation for DocGen plugin:
 * - Setup (Connect): Configuration and settings
 * - Data: Data source binding and code
 * - Builder: Template and content editing
 * - Preview: Document preview and output
 *
 * Connect tab shows a yellow ! indicator while config is unlocked,
 * switching to a green check when locked.
 *
 * Data, Builder are disabled until config is locked.
 * Preview is disabled until config is locked AND at least one
 * valid form element has been built.
 *
 * Subscribes to state.activeZone for reactive updates.
 */

import state from '../core/state.js';
import { el } from '../core/dom.js';
import { icon } from './icon.js';

const TAB_DEFINITIONS = [
  { zone: 'setup', label: 'Connect', iconName: 'link' },
  { zone: 'data', label: 'Data', iconName: 'database' },
  { zone: 'builder', label: 'Builder', iconName: 'edit' },
  { zone: 'preview', label: 'Preview', iconName: 'eye' },
];

/**
 * Create tab bar component
 * @returns {HTMLElement}
 */
export function createTabs() {
  const container = el('div', { className: 'tabs' });
  const tabElements = {};

  function createTab(tabDef) {
    const tab = el('div', {
      className: 'tab',
      'data-zone': tabDef.zone,
    });

    // Icon wrapper (relative, for indicator badge)
    const iconWrap = el('span', { className: 'tab-icon-wrap' });
    iconWrap.innerHTML = icon(tabDef.iconName, 18);

    // Status indicator (only for setup/connect tab)
    if (tabDef.zone === 'setup') {
      const indicator = el('span', {
        className: 'tab-indicator tab-indicator-warning',
        id: 'tab-connect-indicator',
      });
      indicator.innerHTML = '!';
      iconWrap.appendChild(indicator);
    }

    tab.appendChild(iconWrap);

    // Label
    const labelSpan = el('span', { className: 'tab-label' });
    labelSpan.textContent = tabDef.label;
    tab.appendChild(labelSpan);

    // Click handler — block if disabled
    tab.addEventListener('click', () => {
      if (tab.classList.contains('tab-disabled')) return;
      state.set('activeZone', tabDef.zone);
    });

    tabElements[tabDef.zone] = tab;
    return tab;
  }

  TAB_DEFINITIONS.forEach((tabDef) => {
    container.appendChild(createTab(tabDef));
  });

  // ── Active tab styling ──
  function updateActiveTab(activeZone) {
    Object.values(tabElements).forEach((tabEl) => {
      tabEl.classList.remove('active');
    });
    if (tabElements[activeZone]) {
      tabElements[activeZone].classList.add('active');
    }
  }

  // ── Tab lock/unlock state ──
  function updateTabStates() {
    const isLocked = !!state.get('config.locked');
    const hasFormElement = !!state.get('builder.hasElement');

    // Connect tab indicator
    const indicator = container.querySelector('#tab-connect-indicator');
    if (indicator) {
      indicator.classList.remove('tab-indicator-warning', 'tab-indicator-ok');
      if (isLocked) {
        indicator.classList.add('tab-indicator-ok');
        indicator.innerHTML = icon('check', 8);
      } else {
        indicator.classList.add('tab-indicator-warning');
        indicator.innerHTML = '!';
      }
    }

    // Data & Builder: disabled until locked
    ['data', 'builder'].forEach(zone => {
      const tab = tabElements[zone];
      if (!tab) return;
      if (isLocked) {
        tab.classList.remove('tab-disabled');
      } else {
        tab.classList.add('tab-disabled');
      }
    });

    // Preview: enabled when locked AND (has form element OR has variables)
    const previewTab = tabElements['preview'];
    if (previewTab) {
      const hasVariables = (state.get('variables') || []).length > 0;
      if (isLocked && (hasFormElement || hasVariables)) {
        previewTab.classList.remove('tab-disabled');
      } else {
        previewTab.classList.add('tab-disabled');
      }
    }

    // If current zone is disabled, bounce back to setup
    const currentZone = state.get('activeZone') || 'setup';
    const currentTab = tabElements[currentZone];
    if (currentTab && currentTab.classList.contains('tab-disabled')) {
      state.set('activeZone', 'setup');
    }
  }

  // ── Subscriptions ──
  state.on('activeZone', updateActiveTab);
  state.on('config.locked', updateTabStates);
  state.on('builder.hasElement', updateTabStates);
  state.on('variables', updateTabStates);

  // ── Initial state ──
  const initialZone = state.get('activeZone') || 'setup';
  updateActiveTab(initialZone);
  updateTabStates();

  return container;
}
