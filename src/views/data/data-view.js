/**
 * Data View — Zone orchestrator for the Data Catalogue.
 *
 * Two sub-views (wizard handles both create and edit):
 *   - list:   Variable cards + coverage bar (default)
 *   - detail: Edit existing variable (wizard pre-filled)
 *   - new:    Create new variable (wizard empty)
 */

import { el, qs, clear } from '../../core/dom.js';
import { iconEl, icon } from '../../components/icon.js';
import state from '../../core/state.js';
import { loadVariables, loadCatalogues, loadSections } from '../../services/variables.js';
import { seedCookbook } from '../../services/cookbook-seed.js';
import { renderVariableList } from './variable-list.js';
import { renderVariableWizard } from './variable-wizard.js';

let container = null;

export function createDataView(parent) {
  container = el('div', { class: 'zone-inner', id: 'data-zone' });
  parent.appendChild(container);

  // Listen for view changes
  state.on('dataView', () => render());
  state.on('variables', () => {
    if (state.get('dataView') === 'list') render();
  });
  state.on('catalogues', () => {
    if (state.get('dataView') === 'list') render();
  });
  state.on('sections', () => {
    if (state.get('dataView') === 'list') render();
  });
  state.on('config.locked', () => render());

  // Initial load — seed cookbook on first run, then load everything
  Promise.all([loadVariables(), loadCatalogues(), loadSections()])
    .then(() => seedCookbook())
    .then(() => Promise.all([loadCatalogues(), loadSections(), loadVariables()]))
    .then(() => render());
}

function render() {
  clear(container);
  const view = state.get('dataView') || 'list';

  switch (view) {
    case 'detail': {
      // Edit mode — find the variable and pass it to the wizard
      const varId = state.get('activeVariable');
      const variables = state.get('variables') || [];
      const existing = variables.find(v => v.id === varId);
      if (!existing) { state.set('dataView', 'list'); return; }
      renderVariableWizard(container, existing);
      break;
    }
    case 'new':
      renderVariableWizard(container);
      break;
    case 'list':
    default:
      renderVariableList(container);
      break;
  }
}
