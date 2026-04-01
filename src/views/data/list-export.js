/**
 * Data Export / Import — catalogue export dialog and JSON import trigger.
 *
 * Extracted from variable-list.js to reduce file size.
 * Entry points:
 *   showDataExportDialog(catalogues, variables, sections, selectedVarIds)
 *   triggerImport()
 */

import { el, qs } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import {
  exportCatalogue, downloadJson, importCatalogue, readJsonFile,
} from '../../services/catalogue-io.js';

// ─── Data Export Dialog ─────────────────────────────────────────────────

/**
 * Show export dialog with scope options:
 *   - All datasets (all user catalogues)
 *   - Selected datasets (multi-select)
 *   - Per catalogue
 *
 * @param {Array} catalogues
 * @param {Array} variables
 * @param {Array} sections
 * @param {Set}   selectedVarIds — set of currently selected variable IDs
 */
export function showDataExportDialog(catalogues, variables, sections, selectedVarIds) {
  const existing = qs('#data-export-dialog');
  if (existing) existing.remove();

  const userCats = catalogues;
  const hasSelection = selectedVarIds.size > 0;

  // Build scope options
  const scopeOptions = [];

  // (1) All user catalogues
  scopeOptions.push({
    key: 'all',
    label: `All datasets (${variables.length})`,
    checked: !hasSelection,
  });

  // (2) Selected datasets (only if multi-select active)
  if (hasSelection) {
    scopeOptions.push({
      key: 'selected',
      label: `Selected datasets (${selectedVarIds.size})`,
      checked: true,
    });
  }

  // (3) Individual catalogues
  for (const cat of userCats) {
    const catVars = variables.filter(v => v.catalogueId === cat.id);
    scopeOptions.push({
      key: `cat-${cat.id}`,
      label: `${cat.name} (${catVars.length})`,
      checked: false,
      catId: cat.id,
    });
  }

  let selectedScope = scopeOptions.find(o => o.checked)?.key || 'all';

  const radioRows = scopeOptions.map(opt => {
    const radio = el('input', {
      type: 'radio',
      name: 'data-export-scope',
      value: opt.key,
      checked: opt.checked || false,
    });
    radio.addEventListener('change', () => { selectedScope = opt.key; });
    return el('label', { class: 'export-option-row' }, [
      radio,
      el('span', {}, opt.label),
    ]);
  });

  const dialog = el('div', { class: 'config-dialog-overlay', id: 'data-export-dialog' }, [
    el('div', { class: 'config-dialog' }, [
      el('div', { class: 'config-dialog-header' }, [
        el('span', { class: 'icon', html: icon('upload', 18) }),
        el('span', {}, 'Export Data'),
      ]),
      el('div', { class: 'config-dialog-body' }, [
        el('div', { class: 'config-dialog-hint' }, 'Choose what to include in the export file.'),
        el('div', { class: 'export-options' }, radioRows),
      ]),
      el('div', { class: 'config-dialog-actions' }, [
        el('button', { class: 'btn btn-secondary', onclick: () => dialog.remove() }, 'Cancel'),
        el('button', { class: 'btn btn-primary', onclick: () => {
          doDataExport(selectedScope, userCats, variables, sections, selectedVarIds);
          dialog.remove();
        }}, 'Export'),
      ]),
    ]),
  ]);

  (qs('.taskpane') || document.body).appendChild(dialog);
}

/** Execute data export based on scope */
function doDataExport(scope, catalogues, variables, sections, selectedVarIds) {
  let data;
  let filename;

  if (scope === 'all') {
    // Export all user catalogues
    data = exportCatalogue(null);
    filename = `data-all-${new Date().toISOString().slice(0, 10)}.json`;
  } else if (scope === 'selected') {
    // Export only selected variables — build a virtual catalogue
    const selectedVars = variables.filter(v => selectedVarIds.has(v.id));
    // Group by catalogue for proper structure
    const catIds = [...new Set(selectedVars.map(v => v.catalogueId).filter(Boolean))];
    const allCats = state.get('catalogues') || [];
    const allSections = state.get('sections') || [];

    const exportCats = catIds.map(catId => {
      const cat = allCats.find(c => c.id === catId);
      if (!cat) return null;
      const catVars = selectedVars.filter(v => v.catalogueId === catId);
      const catSectionIds = [...new Set(catVars.map(v => v.sectionId).filter(Boolean))];
      const catSecs = allSections.filter(s => catSectionIds.includes(s.id));
      const secById = {};
      catSecs.forEach(s => { secById[s.id] = s.name; });

      return {
        version: 1,
        exportedAt: new Date().toISOString(),
        catalogue: { name: cat.name, description: cat.description || '', scope: cat.scope || 'ticket', tags: cat.tags || [] },
        sections: catSecs.map(s => ({ name: s.name, description: s.description || '', tags: s.tags || [], order: s.order || 0 })),
        variables: catVars.map(v => ({
          name: v.name, purpose: v.purpose || 'block', type: v.type || 'bom',
          description: v.description || '', source: v.source || '',
          filters: v.filters || [], filterLogic: v.filterLogic || 'or',
          transforms: v.transforms || [], catchAll: v.catchAll || false,
          excludeVars: v.excludeVars || [], instanceMode: v.instanceMode || 'all',
          sectionName: v.sectionId ? (secById[v.sectionId] || null) : null,
          order: v.order || 0,
        })),
      };
    }).filter(Boolean);

    data = { version: 1, exportedAt: new Date().toISOString(), catalogues: exportCats };
    filename = `data-selected-${selectedVarIds.size}-${new Date().toISOString().slice(0, 10)}.json`;
  } else if (scope.startsWith('cat-')) {
    // Export a single catalogue
    const catId = scope.replace('cat-', '');
    // catalogueId could be string or number — use find with coercion
    const cat = catalogues.find(c => String(c.id) === catId);
    if (cat) {
      data = exportCatalogue(cat.id);
      filename = `data-${cat.name.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.json`;
    } else {
      data = exportCatalogue(null);
      filename = `data-export-${new Date().toISOString().slice(0, 10)}.json`;
    }
  }

  if (data) downloadJson(data, filename);
}

// ─── Import trigger ─────────────────────────────────────────────────────

/**
 * Trigger a file-picker for JSON import.
 */
export function triggerImport() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    if (!input.files || input.files.length === 0) return;
    try {
      const data = await readJsonFile(input.files[0]);
      const results = await importCatalogue(data);
      const total = results.reduce((s, r) => s + r.variableCount, 0);
      alert(`Imported ${results.length} catalogue(s) with ${total} dataset(s).`);
    } catch (e) {
      alert('Import failed: ' + e.message);
    }
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}
