/**
 * List Drag & Drop — Variable and section drag-drop, multi-select,
 * and copy-to-catalogue logic.
 *
 * Extracted from variable-list.js for maintainability.
 */

import { el } from '../../core/dom.js';
import state from '../../core/state.js';
import {
  createVariable, updateVariable, updateSection,
} from '../../services/variables.js';
import { showConfirmDialog } from '../../core/dialog.js';
import { selectedVarIds, lastClickedVarId, setLastClickedVarId } from './list-state.js';

// ─── Multi-select helpers ───────────────────────────────────────────────

/**
 * Handle shift+click (range) or ctrl/cmd+click (toggle) multi-selection.
 */
export function handleMultiSelect(variable, e) {
  const id = String(variable.id);

  if (e.ctrlKey || e.metaKey) {
    if (lastClickedVarId) {
      const allCards = [...document.querySelectorAll('.var-card[data-var-id]')];
      const ids = allCards.map(c => c.getAttribute('data-var-id'));
      const startIdx = ids.indexOf(lastClickedVarId);
      const endIdx = ids.indexOf(id);
      if (startIdx >= 0 && endIdx >= 0) {
        const lo = Math.min(startIdx, endIdx);
        const hi = Math.max(startIdx, endIdx);
        if (!e.shiftKey) selectedVarIds.clear();
        for (let i = lo; i <= hi; i++) {
          const card = allCards[i];
          if (!card.closest('[data-readonly]')) selectedVarIds.add(ids[i]);
        }
      }
    } else {
      selectedVarIds.add(id);
    }
  } else {
    if (selectedVarIds.has(id)) {
      selectedVarIds.delete(id);
    } else {
      selectedVarIds.add(id);
    }
  }

  setLastClickedVarId(id);

  document.querySelectorAll('.var-card[data-var-id]').forEach(card => {
    const cardId = card.getAttribute('data-var-id');
    card.classList.toggle('var-card-selected', selectedVarIds.has(cardId));
  });
}

/** Escape key clears multi-selection. */
export function handleSelectionKeydown(e) {
  if (e.key === 'Escape' && selectedVarIds.size > 0) {
    clearMultiSelect();
  }
}

/** Clear multi-selection. */
export function clearMultiSelect() {
  selectedVarIds.clear();
  setLastClickedVarId(null);
  document.querySelectorAll('.var-card-selected').forEach(c => c.classList.remove('var-card-selected'));
}

// ─── Drag ID extraction ─────────────────────────────────────────────────

/** Extract dragged variable IDs from a drop event (multi or single). */
export function extractDraggedIds(e) {
  const multiData = e.dataTransfer.getData('application/x-docgen-var-ids');
  if (multiData) {
    try { return JSON.parse(multiData); } catch { /* fall through */ }
  }
  const single = e.dataTransfer.getData('application/x-docgen-var-id');
  return single ? [single] : [];
}

// ─── Variable drop zones ────────────────────────────────────────────────

export function makeDropZone(container, catalogueId, sectionId) {
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-docgen-cookbook-id') ? 'copy' : 'move';
    container.classList.add('var-drop-target');
  });
  container.addEventListener('dragleave', (e) => {
    if (!container.contains(e.relatedTarget)) {
      container.classList.remove('var-drop-target');
    }
  });
  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    container.classList.remove('var-drop-target');

    const cookbookId = e.dataTransfer.getData('application/x-docgen-cookbook-id');
    if (cookbookId) {
      const allVars = state.get('variables') || [];
      const srcVar = allVars.find(v => String(v.id) === cookbookId);
      if (!srcVar) return;
      await copyToCatalogue(srcVar, catalogueId, sectionId);
      return;
    }

    const varIds = extractDraggedIds(e);
    if (varIds.length === 0) return;

    const allVars = state.get('variables') || [];
    const allSections = state.get('sections') || [];
    const lockedVars = varIds.filter(vid => {
      const v = allVars.find(x => String(x.id) === vid);
      if (!v || !v.sectionId) return false;
      const s = allSections.find(x => x.id === v.sectionId);
      return s && s.locked && s.id !== sectionId;
    });
    if (lockedVars.length > 0) {
      const names = lockedVars.map(vid => allVars.find(x => String(x.id) === vid)?.name).filter(Boolean);
      showConfirmDialog(
        `Move out of locked section?`,
        `${names.length} dataset${names.length > 1 ? 's are' : ' is'} in a locked section. Moving will remove protection.`,
        async () => { await performMultiDrop(varIds, catalogueId, sectionId, container); },
        { confirmLabel: 'Move' }
      );
      return;
    }

    await performMultiDrop(varIds, catalogueId, sectionId, container);
  });
}

/** Drop one or more variables into a catalogue/section. */
export async function performMultiDrop(varIds, catalogueId, sectionId, container) {
  const cards = container ? [...container.querySelectorAll('.var-card[data-var-id]')] : [];
  let nextOrder = cards.length;

  const movedSet = new Set(varIds);

  for (const vid of varIds) {
    await updateVariable(vid, {
      catalogueId,
      sectionId,
      order: nextOrder++,
    });
  }

  const variables = state.get('variables') || [];
  const siblings = variables
    .filter(v => v.catalogueId === catalogueId && v.sectionId === sectionId && !movedSet.has(String(v.id)))
    .sort((a, b) => (a.order || 0) - (b.order || 0));
  let idx = 0;
  for (const sib of siblings) {
    await updateVariable(sib.id, { order: idx });
    idx++;
  }

  clearMultiSelect();
}

// ─── Section drag & drop reorder ────────────────────────────────────────

export function makeSectionDropZone(body, catalogueId) {
  let _dropIndicator = null;

  body.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-docgen-sec-id')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';

    const secGroups = [...body.querySelectorAll('.sec-group[data-sec-id]')];
    if (secGroups.length === 0) return;

    if (_dropIndicator) _dropIndicator.remove();
    _dropIndicator = el('div', { class: 'sec-drop-indicator' });

    let insertBefore = null;
    for (const sg of secGroups) {
      const rect = sg.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        insertBefore = sg;
        break;
      }
    }

    if (insertBefore) {
      body.insertBefore(_dropIndicator, insertBefore);
    } else {
      const lastSec = secGroups[secGroups.length - 1];
      if (lastSec.nextSibling) {
        body.insertBefore(_dropIndicator, lastSec.nextSibling);
      } else {
        body.appendChild(_dropIndicator);
      }
    }
  });

  body.addEventListener('dragleave', (e) => {
    if (!body.contains(e.relatedTarget)) {
      if (_dropIndicator) { _dropIndicator.remove(); _dropIndicator = null; }
    }
  });

  body.addEventListener('drop', async (e) => {
    if (_dropIndicator) { _dropIndicator.remove(); _dropIndicator = null; }

    const secId = e.dataTransfer.getData('application/x-docgen-sec-id');
    if (!secId) return;
    e.preventDefault();
    e.stopPropagation();

    const secGroups = [...body.querySelectorAll('.sec-group[data-sec-id]')];
    let newOrder = 0;
    for (const sg of secGroups) {
      if (sg.dataset.secId === secId) continue;
      const rect = sg.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) break;
      newOrder++;
    }

    await updateSection(secId, { order: newOrder });

    const allSections = state.get('sections') || [];
    const siblings = allSections
      .filter(s => s.catalogueId === catalogueId && s.id !== secId)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    let idx = 0;
    for (const sib of siblings) {
      if (idx === newOrder) idx++;
      await updateSection(sib.id, { order: idx });
      idx++;
    }
  });
}

// ─── Copy helpers ───────────────────────────────────────────────────────

/** Copy a read-only variable to the user's own catalogue. */
export async function copyToOwn(variable) {
  const catalogues = (state.get('catalogues') || []).filter(c => !c.readonly);
  let targetCatId = null;

  if (catalogues.length > 0) {
    targetCatId = catalogues[0].id;
  } else {
    const { createCatalogue } = await import('../../services/variables.js');
    const newCat = await createCatalogue({
      name: 'My Data',
      description: 'Your custom data definitions',
      scope: 'ticket',
    });
    targetCatId = newCat.id;
  }

  const existing = (state.get('variables') || []).filter(v => !v.readonly);
  let name = variable.name;
  if (existing.find(v => v.name === name)) {
    name = `${name}_copy`;
  }

  await createVariable({
    purpose: variable.purpose || 'block',
    type: variable.type || 'bom',
    name,
    description: variable.description || '',
    source: variable.source || '',
    filters: variable.filters ? JSON.parse(JSON.stringify(variable.filters)) : [],
    filterLogic: variable.filterLogic || 'or',
    transforms: variable.transforms ? JSON.parse(JSON.stringify(variable.transforms)) : [],
    catchAll: variable.catchAll || false,
    catalogueId: targetCatId,
    sectionId: null,
  });
}

/** Copy a read-only variable into a specific catalogue (+ optional section). */
export async function copyToCatalogue(variable, catalogueId, sectionId) {
  const existing = (state.get('variables') || []).filter(v => !v.readonly);
  let name = variable.name;
  if (existing.find(v => v.name === name)) {
    name = `${name}_copy`;
  }

  await createVariable({
    purpose: variable.purpose || 'block',
    type: variable.type || 'bom',
    name,
    description: variable.description || '',
    source: variable.source || '',
    filters: variable.filters ? JSON.parse(JSON.stringify(variable.filters)) : [],
    filterLogic: variable.filterLogic || 'or',
    transforms: variable.transforms ? JSON.parse(JSON.stringify(variable.transforms)) : [],
    catchAll: variable.catchAll || false,
    catalogueId,
    sectionId: sectionId || null,
  });
}
