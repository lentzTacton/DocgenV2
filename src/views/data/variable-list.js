/**
 * Variable List — Catalogue > Section > Variable hierarchy.
 *
 * Structure:
 *   Data Catalogues (instance / ticket / shared)
 *     └─ Sections (collapsible, named, with description + tags)
 *         └─ Datasets (cards)
 *
 * Sub-modules (extracted for maintainability):
 *   list-state.js    — shared constants, mutable UI state, tooltip delegate
 *   list-menus.js    — catalogue / section / move-to context menus
 *   list-dialogs.js  — force-delete dialogs, inline editing overlays
 *   list-dragdrop.js — variable & section drag-drop, multi-select, copy helpers
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import {
  createVariable, removeVariable,
  canDeleteVariable, validateDataSet, getDependents,
  forceRemoveVariable, buildDocSearchExpressions,
} from '../../services/variables.js';
import {
  isConnected, getBomSources, getBomFields, fetchBomRecords,
  fetchModel, getConfiguredProductList, fetchConfiguredProductData,
  indexConfigAttributes,
} from '../../services/data-api.js';
import { showDataExportDialog, triggerImport } from './list-export.js';
import {
  handleInsertIntoDoc, handleInsertSectionIntoDoc,
  buildSectionExpression, buildInsertExpression, buildBlockInsertVariants,
  batchSyncCheck, getLastDocumentChange, revertLastDocumentChange,
} from '../../services/word-api.js';
import { wizState } from './wizard-state.js';
import { showConfirmDialog } from '../../core/dialog.js';

// ─── Extracted sub-modules ──────────────────────────────────────────────

import {
  TYPE_CONFIG, SCOPE_CONFIG,
  isCollapsed, toggleCollapse, setExpandAll, getExpandAll,
  getShowExpr, setShowExpr,
  getShowAllDocs, setShowAllDocs,
  searchQuery, setSearchQuery, activeTagFilters,
  selectedVarIds,
  setRerenderFn,
  isInScope,
  getVarSyncStatus, setSyncStatus, syncStatus,
} from './list-state.js';
import {
  getActiveDocument, getAllDocuments, setActiveDocument,
  getDocumentByTag, isDocBarOpen, toggleDocBar,
  getScopeMode, setScopeMode,
  generateDocId, writeDocumentTag, createDocumentRecord,
} from '../../services/document-identity.js';
import { showCatalogueMenu, showSectionMenu, showMoveMenu } from './list-menus.js';
import { showForceDeleteDialog, showNewCatalogueInline, showNewSectionInline } from './list-dialogs.js';
import {
  handleMultiSelect, handleSelectionKeydown, clearMultiSelect,
  makeDropZone, extractDraggedIds, performMultiDrop,
  makeSectionDropZone,
  copyToOwn, copyToCatalogue,
} from './list-dragdrop.js';

// ─── Local validation state (not needed by sub-modules) ─────────────────

let validationCtx = {
  bomSources: [], bomFields: [], bomRecords: [],
  modelObjects: [], configAttrPaths: new Set(),
};
let validationCtxLoaded = false;
const validationResults = {};

// ─── View bar state (expand / show-expr toggle bar) ───────────────────
let _viewBarOpen = false;
function isViewBarOpen() { return _viewBarOpen; }
function toggleViewBar() { _viewBarOpen = !_viewBarOpen; }

async function ensureValidationCtx() {
  if (validationCtxLoaded || !isConnected()) return;
  try {
    const model = await fetchModel();
    validationCtx = {
      bomSources: [],
      bomFields: [],
      bomRecords: [],
      modelObjects: model || [],
      configAttrPaths: new Set(),
    };

    validationCtxLoaded = true;

    const variables = state.get('variables') || [];
    if (variables.some(v => v.type === 'bom')) {
      loadBomValidationInBackground();
    }
    if (variables.some(v => v.source && v.source.includes('getConfigurationAttribute('))) {
      loadConfigAttrPathsInBackground();
    }
  } catch (e) { console.warn('[validation] Failed to load context:', e); }
}

async function loadBomValidationInBackground() {
  try {
    const [sources, fields, records] = await Promise.all([
      getBomSources(), getBomFields(), fetchBomRecords(),
    ]);
    validationCtx.bomSources = sources || [];
    validationCtx.bomFields = fields || [];
    validationCtx.bomRecords = records || [];
    rerender();
  } catch (e) { console.warn('[validation] BOM data load failed:', e); }
}

async function loadConfigAttrPathsInBackground() {
  try {
    const cpList = await getConfiguredProductList();
    if (!cpList || cpList.length === 0) return;
    const allPaths = new Set();
    for (const cp of cpList) {
      const tree = await fetchConfiguredProductData(cp.id);
      if (!tree) continue;
      const index = indexConfigAttributes(tree);
      for (const entry of index) {
        allPaths.add(entry.path);
      }
    }
    validationCtx.configAttrPaths = allPaths;
    console.log(`[validation] Loaded ${allPaths.size} config attribute paths from ${cpList.length} CPs`);
    rerender();
  } catch (e) { console.warn('[validation] Config attr path load failed:', e); }
}

// ── Hamburger menu actions (data import/export) ──
state.on('menu.action', (action) => {
  if (action === 'data-export') {
    const catalogues = state.get('catalogues') || [];
    const variables = state.get('variables') || [];
    const sections = state.get('sections') || [];
    showDataExportDialog(catalogues, variables, sections, selectedVarIds);
  }
  if (action === 'data-import') {
    triggerImport();
  }
});

// ─── Main render ────────────────────────────────────────────────────────

export function renderVariableList(container) {
  document.removeEventListener('keydown', handleSelectionKeydown);
  document.addEventListener('keydown', handleSelectionKeydown);

  container.addEventListener('click', (e) => {
    if (selectedVarIds.size > 0 && !e.target.closest('.var-card')) {
      clearMultiSelect();
    }
  });

  const variables = state.get('variables') || [];
  const catalogues = state.get('catalogues') || [];
  const sections = state.get('sections') || [];
  const locked = state.get('config.locked');

  if (!validationCtxLoaded) ensureValidationCtx();

  for (const v of variables) {
    validationResults[v.id] = validateDataSet(v, validationCtx);
  }
  state.set('validationResults', { ...validationResults });

  if (!locked) {
    container.appendChild(
      el('div', { class: 'callout callout-info' }, [
        el('span', { class: 'icon', html: icon('info', 14) }),
        el('div', { class: 'callout-text' },
          'Complete Setup to enable live BOM data. You can still define datasets now.'
        ),
      ])
    );
  }

  container.appendChild(
    el('div', { class: 'data-section-head' }, [
      el('div', { class: 'data-section-left' }, [
        el('span', { class: 'icon', style: { color: 'var(--tacton-blue)' }, html: icon('database', 15) }),
        el('span', { style: { fontWeight: '700', fontSize: '13px' } }, 'Data'),
      ]),
    ])
  );

  const allTags = collectAllTags(catalogues, sections);
  container.appendChild(renderSearchFilter(allTags, container));

  const ownedCats = catalogues.filter(c => !c.readonly);
  const ownedVars = variables.filter(v => !v.readonly);
  if (ownedCats.length === 0 && ownedVars.length === 0) {
    container.appendChild(
      el('div', { class: 'data-empty' }, [
        el('div', { class: 'data-empty-icon', html: icon('folder', 36) }),
        el('button', {
          class: 'sec-add-btn data-empty-add-btn',
          onclick: () => showNewCatalogueInline(container),
        }, [el('span', { class: 'icon', html: icon('plus', 12) }), 'Add catalogue']),
      ])
    );
  }

  const q = searchQuery.toLowerCase().trim();
  const hasFilter = q || activeTagFilters.size > 0;

  function matchesCatalogueTags(cat) {
    if (activeTagFilters.size === 0) return true;
    const catTags = cat.tags || [];
    return [...activeTagFilters].some(t => catTags.includes(t));
  }

  function matchesCatalogue(cat) {
    if (!hasFilter) return true;
    if (!matchesCatalogueTags(cat)) return false;
    if (q && !cat.name.toLowerCase().includes(q) && !(cat.description || '').toLowerCase().includes(q)) return false;
    return true;
  }

  function matchesVariable(v) {
    if (!q) return true;
    return v.name.toLowerCase().includes(q)
      || (v.expression || '').toLowerCase().includes(q)
      || (v.source || '').toLowerCase().includes(q);
  }

  const scopeMode = getScopeMode();
  const userCats = catalogues.filter(c => !c.readonly);
  const readonlyCats = catalogues.filter(c => c.readonly);

  /** Render a single catalogue with scope-awareness. */
  function renderScopedCatalogue(cat, catSections, catVars) {
    const inScope = isInScope(cat);

    // Mode A (filter): skip out-of-scope entirely
    if (scopeMode === 'filter' && !inScope) return;

    const el_ = renderCatalogue(cat, catSections, catVars);

    // Mode B (badge): dim out-of-scope
    if (scopeMode === 'badge' && !inScope) {
      el_.classList.add('cat-out-of-scope');
    }

    container.appendChild(el_);
  }

  /** Render all catalogues in a list, respecting scope. */
  function renderCatList(cats) {
    for (const cat of cats) {
      if (activeTagFilters.size > 0 && !matchesCatalogueTags(cat)) continue;
      const catSections = sections.filter(s => s.catalogueId === cat.id);
      let catVars = variables.filter(v => v.catalogueId === cat.id);
      if (hasFilter) catVars = catVars.filter(matchesVariable);
      if (!matchesCatalogue(cat) && catVars.length === 0) continue;
      renderScopedCatalogue(cat, catSections, catVars);
    }
  }

  // Mode C (grouped): render under scope group headers
  if (scopeMode === 'grouped') {
    const scopeOrder = ['shared', 'document', 'ticket', 'instance'];
    for (const scopeKey of scopeOrder) {
      const sc = SCOPE_CONFIG[scopeKey];
      const scopeUserCats = userCats.filter(c => (c.scope || 'ticket') === scopeKey);
      const scopeReadonlyCats = readonlyCats.filter(c => (c.scope || 'ticket') === scopeKey);
      if (scopeUserCats.length === 0 && scopeReadonlyCats.length === 0) continue;

      // Scope group header
      container.appendChild(el('div', { class: 'scope-group-header' }, [
        el('span', { class: 'icon', style: { color: sc.color }, html: icon(sc.icon, 12) }),
        el('span', { style: { color: sc.color } }, sc.label),
      ]));

      renderCatList(scopeUserCats);
      renderCatList(scopeReadonlyCats);
    }
  } else {
    // Modes A & B: flat list (filtering/dimming handled in renderScopedCatalogue)
    renderCatList(userCats);

    let unassigned = variables.filter(v => !v.catalogueId);
    if (hasFilter) unassigned = unassigned.filter(matchesVariable);
    if (unassigned.length > 0) {
      container.appendChild(renderUnassigned(unassigned));
    }

    renderCatList(readonlyCats);
  }

  // Unassigned block (also in grouped mode, at the end)
  if (scopeMode === 'grouped') {
    let unassigned = variables.filter(v => !v.catalogueId);
    if (hasFilter) unassigned = unassigned.filter(matchesVariable);
    if (unassigned.length > 0) {
      container.appendChild(renderUnassigned(unassigned));
    }
  }

  container.appendChild(
    el('div', { class: 'multiselect-hint' }, [
      el('span', {}, 'Shift'),
      ' select  ',
      el('span', {}, 'Ctrl'),
      ' range',
    ])
  );
}

// ─── Unassigned block ───────────────────────────────────────────────────

function renderUnassigned(variables) {
  const unKey = 'cat-unassigned';
  const collapsed = isCollapsed(unKey);
  const frag = el('div', { class: 'cat-group' });

  frag.appendChild(el('div', { class: 'cat-header cat-header-muted' }, [
    el('button', {
      class: 'cat-collapse-btn',
      onclick: () => { toggleCollapse(unKey); rerender(); },
      html: icon(collapsed ? 'chevronRight' : 'chevronDown', 12),
    }),
    el('span', { class: 'icon', style: { color: 'var(--text-tertiary)' }, html: icon('list', 14) }),
    el('div', { class: 'cat-title' }, 'Unassigned'),
    el('span', { class: 'badge badge-muted', style: { marginLeft: 'auto' } }, `${variables.length}`),
  ]));

  if (!collapsed) {
    const cardList = el('div', { class: 'var-card-list', style: { marginLeft: '16px' } });
    variables.forEach(v => cardList.appendChild(renderVarCard(v)));
    makeDropZone(cardList, null, null);
    frag.appendChild(cardList);
  }

  return frag;
}

// ─── Catalogue rendering ────────────────────────────────────────────────

function renderCatalogue(catalogue, sections, variables) {
  const sc = SCOPE_CONFIG[catalogue.scope] || SCOPE_CONFIG.ticket;
  const catKey = `cat-${catalogue.id}`;
  const collapsed = isCollapsed(catKey);
  const isReadonly = !!catalogue.readonly;

  const frag = el('div', { class: 'cat-group' });

  const scopeLabel = isReadonly ? 'LOCKED' : sc.label.toUpperCase();
  const scopeColor = isReadonly ? '#ABB4BD' : sc.color;

  const headerChildren = [
    el('button', {
      class: 'cat-collapse-btn',
      onclick: (e) => { e.stopPropagation(); toggleCollapse(catKey); rerender(); },
      html: icon(collapsed ? 'chevronRight' : 'chevronDown', 12),
    }),
    el('div', { class: 'cat-type-col' }, [
      el('span', { class: 'icon', style: { color: scopeColor }, html: icon(collapsed ? 'folder' : 'folderOpen', 16) }),
      el('span', { class: 'cat-scope-label', style: { color: scopeColor } }, scopeLabel),
    ]),
    el('div', { class: 'cat-info' }, [
      el('div', { class: 'cat-title-row' }, [
        el('span', { class: 'cat-title' }, catalogue.name),
        ...((catalogue.tags || []).map(t => el('span', { class: 'cat-tag' }, t))),
      ]),
      catalogue.description
        ? el('div', { class: 'cat-desc' }, catalogue.description)
        : null,
    ].filter(Boolean)),
  ];

  const rightGroup = el('div', { class: 'cat-header-right' });
  rightGroup.appendChild(
    el('span', { class: 'badge badge-muted cat-count-badge' }, `${variables.length}`)
  );
  rightGroup.appendChild(
    el('button', {
      class: 'cat-action-btn',
      onclick: (e) => { e.stopPropagation(); showCatalogueMenu(catalogue, e.currentTarget); },
      html: icon('moreHorizontal', 14),
    })
  );
  headerChildren.push(rightGroup);

  const catHeader = el('div', {
    class: `cat-header ${isReadonly ? 'cat-header-readonly' : ''}`,
    onclick: () => { toggleCollapse(catKey); rerender(); },
    style: { cursor: 'pointer' },
  }, headerChildren);

  if (!isReadonly) {
    catHeader.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-docgen-sec-id')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      catHeader.classList.add('sec-header-drop-target');
    });
    catHeader.addEventListener('dragleave', (e) => {
      if (!catHeader.contains(e.relatedTarget)) {
        catHeader.classList.remove('sec-header-drop-target');
      }
    });
    catHeader.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      catHeader.classList.remove('sec-header-drop-target');

      const cookbookId = e.dataTransfer.getData('application/x-docgen-cookbook-id');
      if (cookbookId) {
        const allVars = state.get('variables') || [];
        const srcVar = allVars.find(v => String(v.id) === cookbookId);
        if (srcVar) await copyToCatalogue(srcVar, catalogue.id, null);
        return;
      }

      const varIds = extractDraggedIds(e);
      if (varIds.length === 0) return;
      await performMultiDrop(varIds, catalogue.id, null, null);
    });
  }

  frag.appendChild(catHeader);

  if (collapsed) return frag;

  const body = el('div', { class: 'cat-body' });

  for (const section of sections) {
    const secVars = variables.filter(v => String(v.sectionId) === String(section.id));
    body.appendChild(renderSection(section, secVars, catalogue));
  }

  if (!isReadonly) {
    makeSectionDropZone(body, catalogue.id);
  }

  const looseCatVars = variables.filter(v => !v.sectionId);
  if (looseCatVars.length > 0 || !isReadonly) {
    const cardList = el('div', { class: 'var-card-list cat-loose-vars' });
    looseCatVars.forEach(v => cardList.appendChild(renderVarCard(v, isReadonly)));
    if (!isReadonly) makeDropZone(cardList, catalogue.id, null);
    body.appendChild(cardList);
  }

  const looseCatCount = variables.filter(v => !v.sectionId).length;
  const isEmpty = sections.length === 0 && looseCatCount === 0;
  if (!isReadonly && isEmpty) {
    body.appendChild(
      el('div', { class: 'cat-empty-actions' }, [
        el('button', {
          class: 'sec-add-btn',
          onclick: () => {
            wizState.catalogueId = catalogue.id;
            wizState.sectionId = null;
            state.set('dataView', 'new');
          },
        }, [el('span', { class: 'icon', html: icon('plus', 10) }), 'Add dataset']),
        el('button', {
          class: 'sec-add-btn',
          onclick: () => showNewSectionInline(body, catalogue.id),
        }, [el('span', { class: 'icon', html: icon('plus', 10) }), 'Add section']),
      ])
    );
  }
  if (!isReadonly && !isEmpty) {
    body.appendChild(
      el('div', { class: 'cat-footer-actions' }, [
        el('button', {
          class: 'sec-add-btn',
          onclick: () => showNewSectionInline(body, catalogue.id),
        }, [el('span', { class: 'icon', html: icon('plus', 10) }), 'Add section']),
      ])
    );
  }

  frag.appendChild(body);
  return frag;
}

// ─── Section rendering ──────────────────────────────────────────────────

function renderSection(section, variables, catalogue) {
  const secKey = `sec-${section.id}`;
  const collapsed = isCollapsed(secKey);
  const isCatReadonly = !!catalogue.readonly;
  const isLocked = !!section.locked;
  const isReadonly = isCatReadonly || isLocked;

  const frag = el('div', {
    class: `sec-group${isLocked ? ' sec-group-locked' : ''}`,
    'data-sec-id': String(section.id),
    draggable: isCatReadonly ? undefined : 'true',
  });

  if (!isCatReadonly) {
    let _dragFromHandle = false;
    frag.addEventListener('mousedown', (e) => {
      _dragFromHandle = !!e.target.closest('.sec-drag-handle');
    });
    frag.addEventListener('dragstart', (e) => {
      if (e.target.closest('.var-card')) return;
      if (!_dragFromHandle) { e.preventDefault(); return; }
      e.dataTransfer.setData('application/x-docgen-sec-id', String(section.id));
      e.dataTransfer.setData('text/plain', buildSectionExpression(variables));
      e.dataTransfer.effectAllowed = 'copyMove';
      frag.classList.add('sec-group-dragging');
    });
    frag.addEventListener('dragend', () => {
      _dragFromHandle = false;
      frag.classList.remove('sec-group-dragging');
      document.querySelectorAll('.sec-drop-indicator').forEach(d => d.remove());
    });
  }

  const headerChildren = [];

  if (!isCatReadonly) {
    headerChildren.push(el('span', {
      class: 'sec-drag-handle',
      title: 'Drag to reorder section',
      html: icon('moreHorizontal', 10),
      onclick: (e) => e.stopPropagation(),
    }));
  }

  headerChildren.push(
    el('span', {
      class: 'sec-collapse-icon',
      html: icon(collapsed ? 'chevronRight' : 'chevronDown', 10),
    }),
    isLocked ? el('span', {
      class: 'sec-lock-icon',
      title: 'Section is locked — datasets cannot be edited',
      html: icon('lock', 10),
    }) : null,
    el('div', { class: 'sec-info' }, [
      el('span', { class: 'sec-title' }, section.name),
      section.description
        ? el('span', { class: 'sec-desc' }, section.description)
        : null,
    ]),
    ...(section.tags || []).map(t =>
      el('span', { class: 'sec-tag' }, t)
    ),
    el('span', { class: 'badge badge-muted', style: { fontSize: '9px' } }, `${variables.length}`),
  );

  headerChildren.push(
    el('button', {
      class: 'sec-insert-btn',
      title: `Insert all ${variables.length} datasets into document`,
      onclick: (e) => { e.stopPropagation(); handleInsertSectionIntoDoc(section.name, variables); },
      html: icon('chevronLeft', 10),
    })
  );

  if (!isCatReadonly) {
    headerChildren.push(
      el('button', {
        class: 'sec-action-btn',
        onclick: (e) => { e.stopPropagation(); showSectionMenu(section, catalogue, e.target); },
        html: icon('moreHorizontal', 12),
      })
    );
  }

  const secHeader = el('div', {
    class: `sec-header${isLocked ? ' sec-header-locked' : ''}`,
    onclick: () => { toggleCollapse(secKey); rerender(); },
  }, headerChildren);

  if (!isCatReadonly && !isLocked) {
    secHeader.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('application/x-docgen-sec-id')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      secHeader.classList.add('sec-header-drop-target');
    });
    secHeader.addEventListener('dragleave', (e) => {
      if (!secHeader.contains(e.relatedTarget)) {
        secHeader.classList.remove('sec-header-drop-target');
      }
    });
    secHeader.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      secHeader.classList.remove('sec-header-drop-target');

      const cookbookId = e.dataTransfer.getData('application/x-docgen-cookbook-id');
      if (cookbookId) {
        const allVars = state.get('variables') || [];
        const srcVar = allVars.find(v => String(v.id) === cookbookId);
        if (srcVar) await copyToCatalogue(srcVar, section.catalogueId, section.id);
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
        return s && s.locked && s.id !== section.id;
      });
      if (lockedVars.length > 0) {
        const names = lockedVars.map(vid => allVars.find(x => String(x.id) === vid)?.name).filter(Boolean);
        showConfirmDialog(
          `Move out of locked section?`,
          `${names.length} dataset${names.length > 1 ? 's are' : ' is'} in a locked section. Moving will remove protection.`,
          async () => { await performMultiDrop(varIds, section.catalogueId, section.id, null); },
          { confirmLabel: 'Move' }
        );
        return;
      }

      await performMultiDrop(varIds, section.catalogueId, section.id, null);
    });
  }

  frag.appendChild(secHeader);

  if (collapsed) return frag;

  const cardList = el('div', { class: 'var-card-list sec-card-list' });
  variables.forEach(v => cardList.appendChild(renderVarCard(v, isCatReadonly, isLocked)));
  if (!isCatReadonly) makeDropZone(cardList, section.catalogueId, section.id);

  if (variables.length === 0 && !isCatReadonly && !isLocked) {
    cardList.appendChild(el('button', { class: 'sec-add-btn', onclick: () => {
      wizState.catalogueId = section.catalogueId;
      wizState.sectionId = section.id;
      state.set('dataView', 'new');
    }}, [el('span', { class: 'icon', html: icon('plus', 10) }), 'Add dataset']));
  } else if (variables.length === 0) {
    cardList.appendChild(el('div', { class: 'sec-empty' }, 'No datasets in this section'));
  }
  frag.appendChild(cardList);

  return frag;
}

// ─── Variable card ──────────────────────────────────────────────────────

/**
 * Render a small sync-status dot next to the variable name.
 * Shows after a batch sync check has been run.
 * Green = found in doc, Orange = multiple, Red = not found, null = no data.
 */
function makeSyncDot(variableId) {
  const status = getVarSyncStatus(variableId);
  if (!status || status === 'no_word' || status === 'no_expression') return null;

  const cfg = {
    found:     { color: 'var(--success, #2da44e)', title: 'In document (1 match)' },
    multiple:  { color: 'var(--orange, #e67700)',  title: 'Multiple matches in document' },
    not_found: { color: 'var(--danger, #CF222E)',  title: 'Not found in document' },
    error:     { color: 'var(--text-tertiary)',     title: 'Sync check failed' },
  };
  const c = cfg[status];
  if (!c) return null;

  return el('span', {
    class: 'sync-dot',
    title: c.title,
    style: { background: c.color },
  });
}

function makeExprIssueIcon(valResult) {
  const isErr = valResult.status === 'error';
  const tooltipText = valResult.issues.map(i => `${i.level}: ${i.message}`).join('\n');

  const tooltip = el('div', { class: 'expr-tooltip' }, tooltipText);
  const wrapper = el('span', {
    class: `var-expr-issue ${isErr ? 'var-expr-issue-err' : 'var-expr-issue-warn'}`,
  }, [
    el('span', { html: icon('info', 12) }),
    tooltip,
  ]);

  wrapper.addEventListener('mouseenter', () => {
    const rect = wrapper.getBoundingClientRect();
    tooltip.style.display = 'block';
    tooltip.style.left = 'auto';
    tooltip.style.right = `${document.documentElement.clientWidth - rect.right}px`;
    tooltip.style.top = `${rect.top - tooltip.offsetHeight - 8}px`;
    if (rect.top - tooltip.offsetHeight - 8 < 4) {
      tooltip.style.top = `${rect.bottom + 8}px`;
    }
  });

  wrapper.addEventListener('mouseleave', () => {
    tooltip.style.display = 'none';
  });

  return wrapper;
}

function renderVarCard(variable, isReadonly = false, sectionLocked = false) {
  const tc = TYPE_CONFIG[variable.type] || TYPE_CONFIG.bom;
  const dependents = getDependents(variable.id);
  const isSource = dependents.length > 0;

  const valResult = validationResults[variable.id];
  const valStatus = valResult ? valResult.status : 'unchecked';
  const valColor = valStatus === 'error' ? 'var(--danger, #CF222E)'
    : valStatus === 'warning' ? 'var(--warning, #D4A015)'
    : valStatus === 'valid' ? 'var(--success, #1A7F37)'
    : null;
  const valTooltip = valResult && valResult.issues.length > 0
    ? valResult.issues.map(i => `${i.level}: ${i.message}`).join('\n')
    : valStatus === 'valid' ? 'Valid — verified against live data'
    : 'Not verified — connect to Tacton to validate';

  const statsChildren = [];
  if (variable.type === 'bom') {
    statsChildren.push(
      el('div', { class: 'var-stat' }, [
        el('span', { class: 'icon', html: icon('list', 11) }),
        el('strong', {}, String(variable.matchCount || 0)),
        ' items',
      ])
    );
  }
  if (variable.filters && variable.filters.length > 0) {
    statsChildren.push(
      el('div', { class: 'var-stat' }, [
        el('span', { class: 'icon', html: icon('filter', 11) }),
        `${variable.filters.length} condition${variable.filters.length > 1 ? 's' : ''}`,
      ])
    );
  }
  if (variable.catchAll) {
    statsChildren.push(el('div', { class: 'var-stat' }, 'catch-all'));
  }

  const actionButtons = el('div', { class: 'var-card-actions' });
  const noEdit = isReadonly || sectionLocked;

  if (isReadonly) {
    actionButtons.appendChild(el('button', {
      class: 'row-action-btn', title: 'Copy to your catalogue',
      onclick: (e) => { e.stopPropagation(); copyToOwn(variable); },
      html: icon('copy', 14),
    }));
  } else if (sectionLocked) {
    actionButtons.appendChild(el('span', {
      class: 'row-action-btn', title: 'Section is locked',
      style: { cursor: 'default', color: 'var(--text-tertiary)' },
      html: icon('lock', 14),
    }));
  } else {
    actionButtons.appendChild(el('button', {
      class: 'row-action-btn', title: 'Move to catalogue',
      onclick: (e) => { e.stopPropagation(); showMoveMenu(variable, e.currentTarget); },
      html: icon('folder', 14),
    }));
    actionButtons.appendChild(el('button', {
      class: 'row-action-btn', title: 'Duplicate dataset',
      onclick: (e) => { e.stopPropagation(); duplicateVariable(variable); },
      html: icon('copy', 14),
    }));
    actionButtons.appendChild(el('button', {
      class: 'row-action-btn row-action-danger', title: 'Delete dataset',
      onclick: (e) => { e.stopPropagation(); handleDeleteVariable(variable); },
      html: icon('trash', 14),
    }));
  }

  const exprStatusClass = valResult
    ? valResult.status === 'error' ? 'var-expr-error'
      : valResult.status === 'warning' ? 'var-expr-warning'
      : 'var-expr-valid'
    : '';

  const varIdStr = String(variable.id);
  const isSelected = selectedVarIds.has(varIdStr);

  const card = el('div', {
    class: `var-card${sectionLocked ? ' var-card-locked' : ''}${isSelected ? ' var-card-selected' : ''}`,
    draggable: isReadonly ? undefined : 'true',
    'data-var-id': varIdStr,
    'data-locked-section': sectionLocked ? 'true' : undefined,
    style: isReadonly ? { opacity: '0.85' } : {},
    onclick: noEdit ? null : (e) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) {
        e.preventDefault();
        handleMultiSelect(variable, e);
        return;
      }
      if (selectedVarIds.has(varIdStr)) {
        selectedVarIds.delete(varIdStr);
        card.classList.remove('var-card-selected');
        return;
      }
      if (selectedVarIds.size > 0) {
        clearMultiSelect();
        return;
      }
      state.set('activeVariable', variable.id);
      state.set('dataView', 'detail');
    },
  }, [
    el('div', { class: 'var-head' }, [
      !isReadonly ? el('span', {
        class: 'var-drag-handle',
        title: sectionLocked ? 'Drag to move out of locked section' : 'Drag to reorder',
        html: icon('moreHorizontal', 12),
        onclick: (e) => e.stopPropagation(),
      }) : null,
      el('button', {
        class: 'var-insert-btn',
        title: valTooltip + '\nClick to insert into document',
        onclick: (e) => { e.stopPropagation(); handleInsertIntoDoc(variable, valResult); },
        html: icon('chevronLeft', 12),
      }),
      el('div', { class: 'var-type-col', 'data-val-tip': valTooltip }, [
        el('span', { class: 'icon', style: { color: valColor || tc.color }, html: icon(tc.icon, 16) }),
        el('span', { class: 'var-purpose-label', style: { color: valColor || tc.color } },
          tc.label
        ),
      ]),
      el('div', { class: 'var-info' }, [
        el('div', { class: 'var-name' }, [
          variable.name.replace(/^#/, ''),
          makeSyncDot(variable.id),
          variable.parentBlock
            ? el('span', {
                class: 'badge badge-child',
                title: `Child of ${variable.parentBlock}`,
              }, 'child')
            : (() => {
                const allVars = state.get('variables') || [];
                const hasChildren = allVars.some(v => v.id !== variable.id && v.parentBlock === variable.name);
                return hasChildren
                  ? el('span', {
                      class: 'badge badge-parent',
                      title: 'Source block — iterated by child blocks',
                    }, 'source')
                  : null;
              })(),
          isSource
            ? el('span', {
                class: 'badge badge-source',
                title: `Source for: ${dependents.map(d => d.name).join(', ')}`,
              }, [
                el('span', { html: icon('link', 9) }),
                ' SRC',
              ])
            : null,
          variable.placeholder
            ? el('span', {
                class: 'badge badge-placeholder',
                title: 'Empty define — placeholder awaiting expression',
              }, 'empty')
            : null,
        ]),
        el('div', { class: 'var-meta' }, [
          variable.catchAll
            ? el('span', { class: 'badge badge-wrn', style: { fontSize: '9px' } }, 'catch-all')
            : null,
          variable.description
            ? el('span', { style: { color: 'var(--text-tertiary)', fontSize: '11px' } }, variable.description)
            : null,
        ]),
      ]),
      actionButtons,
    ]),
    (() => {
      if (!variable.expression) return null;
      const displayExpr = variable.purpose === 'block'
        ? `${variable.name} in ${variable.expression}`
        : variable.expression;
      return el('div', { class: `var-expr ${exprStatusClass}${getShowExpr() ? ' var-expr-visible' : ''}`, title: displayExpr }, [
        el('span', { class: 'var-expr-text' }, displayExpr),
        valResult && valResult.status !== 'valid'
          ? makeExprIssueIcon(valResult)
          : null,
      ]);
    })(),
    statsChildren.length > 0
      ? el('div', { class: 'var-stats' }, statsChildren)
      : null,
  ]);

  card.addEventListener('dragstart', (e) => {
    if (isReadonly) {
      e.dataTransfer.setData('application/x-docgen-cookbook-id', String(variable.id));
      e.dataTransfer.effectAllowed = 'copy';
    } else {
      if (selectedVarIds.size > 1 && selectedVarIds.has(varIdStr)) {
        e.dataTransfer.setData('application/x-docgen-var-ids', JSON.stringify([...selectedVarIds]));
      } else {
        clearMultiSelect();
      }
      e.dataTransfer.setData('application/x-docgen-var-id', varIdStr);
      e.dataTransfer.effectAllowed = 'copyMove';
    }
    if (variable.purpose === 'block') {
      const variants = buildBlockInsertVariants(variable);
      e.dataTransfer.setData('text/plain', variants.rawExpr);
    } else {
      e.dataTransfer.setData('text/plain', buildInsertExpression(variable));
    }
    card.classList.add('var-card-dragging');
    if (selectedVarIds.size > 1 && selectedVarIds.has(varIdStr)) {
      selectedVarIds.forEach(id => {
        const c = document.querySelector(`.var-card[data-var-id="${id}"]`);
        if (c) c.classList.add('var-card-dragging');
      });
      const ghost = document.createElement('div');
      ghost.style.cssText = 'position:fixed;top:-100px;left:-100px;background:var(--tacton-blue,#0A6DC2);color:#fff;padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700;white-space:nowrap;pointer-events:none;z-index:99999';
      ghost.textContent = `${selectedVarIds.size} datasets`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, 40, 14);
      requestAnimationFrame(() => ghost.remove());
    }
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('var-card-dragging');
    document.querySelectorAll('.var-card-dragging').forEach(c => c.classList.remove('var-card-dragging'));
    document.querySelectorAll('.var-drop-target').forEach(t => t.classList.remove('var-drop-target'));
  });

  return card;
}

// ─── Data set actions ───────────────────────────────────────────────────

function handleDeleteVariable(variable) {
  const check = canDeleteVariable(variable.id);
  if (!check.ok) {
    const details = (check.usages || []).map(u => `${u.name} (${u.type})`);
    showForceDeleteDialog(
      'dataset', variable.name,
      { sections: 0, variables: details.length },
      details,
      () => forceRemoveVariable(variable.id),
    );
    return;
  }
  showConfirmDialog(`Delete dataset "${variable.name}"?`, 'This cannot be undone.', () => {
    removeVariable(variable.id);
  });
}

async function duplicateVariable(variable) {
  let name = variable.name + '_copy';
  const existing = (state.get('variables') || []).map(v => v.name);
  let i = 1;
  while (existing.includes(name)) { name = `${variable.name}_copy${++i}`; }

  await createVariable({
    purpose: variable.purpose || 'block',
    type: variable.type || 'bom',
    name,
    description: variable.description || '',
    source: variable.source || '',
    filters: variable.filters ? JSON.parse(JSON.stringify(variable.filters)) : [],
    filterLogic: variable.filterLogic || 'or',
    transforms: variable.transforms ? JSON.parse(JSON.stringify(variable.transforms)) : [],
    catchAll: false,
    catalogueId: variable.catalogueId || null,
    sectionId: variable.sectionId || null,
  });
}

// ─── Search & Filter ────────────────────────────────────────────────────

function collectAllTags(catalogues, sections) {
  const tags = new Set();
  for (const c of catalogues) (c.tags || []).forEach(t => tags.add(t));
  for (const s of sections) (s.tags || []).forEach(t => tags.add(t));
  return [...tags].sort();
}

function renderSearchFilter(allTags, listContainer) {
  const wrap = el('div', { class: 'data-search-wrap' });

  const input = el('input', {
    type: 'text',
    class: 'data-search-input',
    placeholder: 'Search datasets, catalogues\u2026',
    value: searchQuery,
  });
  input.addEventListener('input', (e) => {
    setSearchQuery(e.target.value);
    rerender();
    requestAnimationFrame(() => {
      const inp = qs('.data-search-input');
      if (inp) { inp.focus(); inp.selectionStart = inp.selectionEnd = inp.value.length; }
    });
  });

  const inputWrap = el('div', { class: 'data-search-input-wrap' }, [
    el('span', { class: 'icon data-search-icon', html: icon('search', 14) }),
    input,
  ]);
  if (searchQuery) {
    inputWrap.appendChild(el('button', {
      class: 'data-search-clear',
      onclick: () => { setSearchQuery(''); rerender(); },
      html: icon('x', 12),
    }));
  }

  // ── Icon toggle buttons ──
  const activeDoc = getActiveDocument();
  const hasViewOptions = getExpandAll() || getShowExpr() || getShowAllDocs();

  const docBtn = el('button', {
    class: `toolbar-icon-btn ${activeDoc ? 'toolbar-icon-active' : ''} ${isDocBarOpen() ? 'toolbar-icon-open' : ''}`,
    title: activeDoc ? `Document: ${activeDoc.name} (${activeDoc.id})` : 'Document identity',
    onclick: () => { toggleDocBar(); rerender(); },
    html: icon('file', 14),
  });

  const viewBtn = el('button', {
    class: `toolbar-icon-btn ${hasViewOptions ? 'toolbar-icon-active' : ''} ${isViewBarOpen() ? 'toolbar-icon-open' : ''}`,
    title: 'View options',
    onclick: () => { toggleViewBar(); rerender(); },
    html: icon('eye', 14),
  });

  const syncBtn = el('button', {
    class: `toolbar-icon-btn${Object.keys(syncStatus).length > 0 ? ' toolbar-icon-active' : ''}`,
    title: 'Check document sync',
    onclick: () => runBatchSyncCheck(),
    html: icon('refresh', 14),
  });

  const undoBtn = (() => {
    const lastChange = getLastDocumentChange();
    if (!lastChange) return null;
    return el('button', {
      class: 'toolbar-icon-btn toolbar-icon-warning',
      title: `Undo: revert "${lastChange.variableName}" in document`,
      onclick: async () => {
        const ok = await revertLastDocumentChange();
        if (ok) rerender();
        else alert('Could not revert — the expression may have changed or was not found (exactly 1 match required).');
      },
      html: icon('arrowDown', 14),  // using arrowDown rotated as "undo"
    });
  })();

  const addBtn = el('button', {
    class: 'toolbar-icon-btn toolbar-icon-action',
    title: 'New catalogue',
    onclick: () => { if (listContainer) showNewCatalogueInline(listContainer); },
    html: icon('folderPlus', 14),
  });

  const searchRow = el('div', { class: 'data-search-row' }, [inputWrap, docBtn, viewBtn, syncBtn, undoBtn, addBtn].filter(Boolean));
  wrap.appendChild(searchRow);

  // ── Collapsible document bar ──
  if (isDocBarOpen()) {
    const docBar = renderDocumentBar();
    wrap.appendChild(docBar);
  }

  // ── Collapsible view options bar ──
  if (isViewBarOpen()) {
    const viewBar = renderViewBar();
    wrap.appendChild(viewBar);
  }

  if (allTags.length > 0) {
    const chipRow = el('div', { class: 'data-tag-chips' });
    for (const tag of allTags) {
      const active = activeTagFilters.has(tag);
      chipRow.appendChild(el('button', {
        class: `data-tag-chip ${active ? 'data-tag-chip-active' : ''}`,
        onclick: () => {
          if (active) activeTagFilters.delete(tag);
          else activeTagFilters.add(tag);
          rerender();
        },
      }, tag));
    }
    if (activeTagFilters.size > 0) {
      chipRow.appendChild(el('button', {
        class: 'data-tag-chip data-tag-chip-clear',
        onclick: () => { activeTagFilters.clear(); rerender(); },
      }, 'Clear'));
    }
    wrap.appendChild(chipRow);
  }

  return wrap;
}

// ─── Document Bar ──────────────────────────────────────────────────────

// ─── View Options Bar ────────────────────────────────────────────────

function renderViewBar() {
  const bar = el('div', { class: 'view-bar' });

  const expandToggle = el('label', { class: 'view-bar-toggle', title: 'Expand / collapse all catalogues' }, [
    el('input', {
      type: 'checkbox',
      checked: getExpandAll() ? 'checked' : undefined,
      onchange: (e) => { setExpandAll(e.target.checked); rerender(); },
    }),
    el('span', {}, 'Expand all'),
  ]);

  const exprToggle = el('label', { class: 'view-bar-toggle', title: 'Show expressions on all datasets' }, [
    el('input', {
      type: 'checkbox',
      checked: getShowExpr() ? 'checked' : undefined,
      onchange: (e) => { setShowExpr(e.target.checked); rerender(); },
    }),
    el('span', {}, 'Show expressions'),
  ]);

  const allDocsToggle = el('label', { class: 'view-bar-toggle', title: 'Show catalogues from all documents' }, [
    el('input', {
      type: 'checkbox',
      checked: getShowAllDocs() ? 'checked' : undefined,
      onchange: (e) => { setShowAllDocs(e.target.checked); rerender(); },
    }),
    el('span', {}, 'All documents'),
  ]);

  bar.append(expandToggle, exprToggle, allDocsToggle);
  return bar;
}

// ─── Document Bar ────────────────────────────────────────────────────

function renderDocumentBar() {
  const bar = el('div', { class: 'doc-bar' });
  const activeDoc = getActiveDocument();
  const mode = getScopeMode();

  // ── Left side: document identity ──
  const leftSide = el('div', { class: 'doc-bar-left' });

  if (activeDoc) {
    // Document dropdown
    const docSelect = el('select', {
      class: 'doc-bar-select',
      onchange: async (e) => {
        const val = e.target.value;
        if (val === '__registry__') {
          state.set('menu.action', 'document-registry');
          return;
        }
        if (val === '__new__') {
          await handleTagCurrentDocument();
          return;
        }
        // Switch to selected document
        const doc = await getDocumentByTag(val);
        if (doc) {
          setActiveDocument(doc);
          rerender();
        }
      },
    });

    // Populate async (will flash, but acceptable)
    getAllDocuments().then(docs => {
      docs.forEach(d => {
        const opt = el('option', {
          value: d.documentId,
          selected: d.documentId === activeDoc.id ? 'selected' : undefined,
        }, d.name || `Doc ${d.documentId}`);
        docSelect.appendChild(opt);
      });
      docSelect.appendChild(el('option', { disabled: true }, '───'));
      docSelect.appendChild(el('option', { value: '__registry__' }, 'Document Registry…'));
    });

    // Tag label
    const tagLabel = el('span', { class: 'doc-bar-tag' }, `dg:${activeDoc.id}`);

    leftSide.append(docSelect, tagLabel);
  } else {
    // No document linked
    leftSide.appendChild(el('span', { class: 'doc-bar-unlinked' }, 'No document linked'));
    leftSide.appendChild(el('button', {
      class: 'btn btn-sm doc-bar-tag-btn',
      onclick: async () => { await handleTagCurrentDocument(); },
    }, [el('span', { html: icon('tag', 11) }), 'Tag this document']));
  }

  // ── Right side: scope mode toggle ──
  const modeToggle = el('div', { class: 'doc-bar-mode-toggle' });
  const modes = [
    { key: 'filter',  label: 'Focus',  title: 'Focus — hide out-of-scope catalogues' },
    { key: 'badge',   label: 'All',    title: 'All — dim out-of-scope catalogues' },
    { key: 'grouped', label: 'Group',  title: 'Group — organize catalogues by scope' },
  ];
  for (const m of modes) {
    modeToggle.appendChild(el('button', {
      class: `doc-bar-mode-btn ${mode === m.key ? 'doc-bar-mode-active' : ''}`,
      title: m.title,
      onclick: () => { setScopeMode(m.key); rerender(); },
    }, m.label));
  }

  bar.append(leftSide, modeToggle);
  return bar;
}

/** Handle tagging the current (unlinked) document. */
async function handleTagCurrentDocument() {
  const docId = generateDocId();
  await writeDocumentTag(docId);
  const doc = await createDocumentRecord(docId, `Document ${docId}`);
  setActiveDocument(doc);
  rerender();
}

// ─── New Document / Copy of Existing Dialog ────────────────────────────

function showNewDocumentDialog() {
  const overlay = el('div', { class: 'dialog-overlay doc-new-dialog-overlay' });
  const dialog = el('div', { class: 'dialog doc-new-dialog' });

  dialog.appendChild(el('div', { class: 'dialog-header' }, [
    el('span', { html: icon('file', 16) }),
    el('span', {}, 'New document detected'),
  ]));

  const body = el('div', { class: 'dialog-body' });

  body.appendChild(el('p', { style: { fontSize: '12px', color: 'var(--text-secondary)', margin: '0 0 12px' } },
    'This document has no DocGen tag. Would you like to link it?'));

  // Option 1: New document
  const newBtn = el('button', {
    class: 'btn btn-primary doc-new-opt',
    onclick: async () => {
      overlay.remove();
      await handleTagCurrentDocument();
    },
  }, [el('span', { html: icon('plus', 13) }), 'New document']);

  // Option 2: Copy of existing
  const copySelect = el('select', { class: 'doc-new-copy-select', style: { display: 'none' } });
  const copyBtn = el('button', {
    class: 'btn btn-outline doc-new-opt',
    onclick: async () => {
      if (copySelect.style.display === 'none') {
        // Show dropdown
        copySelect.style.display = 'block';
        const docs = await getAllDocuments();
        copySelect.innerHTML = '';
        copySelect.appendChild(el('option', { value: '' }, 'Select source document…'));
        docs.forEach(d => {
          copySelect.appendChild(el('option', { value: d.id }, d.name || `Doc ${d.documentId}`));
        });
      } else {
        // Confirm copy
        const sourceProjectId = copySelect.value;
        if (!sourceProjectId) return;
        overlay.remove();
        const docId = generateDocId();
        await writeDocumentTag(docId);
        const newDoc = await createDocumentRecord(docId, `Copy — ${docId}`);
        const { cloneDocumentCatalogues } = await import('../../services/document-identity.js');
        await cloneDocumentCatalogues(sourceProjectId, newDoc.id, docId);
        setActiveDocument(newDoc);
        rerender();
      }
    },
  }, [el('span', { html: icon('copy', 13) }), 'Copy from existing']);

  // Option 3: Skip
  const skipBtn = el('button', {
    class: 'btn btn-ghost doc-new-opt',
    onclick: () => { overlay.remove(); },
  }, 'Skip');

  body.append(newBtn, copyBtn, copySelect, skipBtn);
  dialog.appendChild(body);
  overlay.appendChild(dialog);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });

  (qs('.taskpane') || document.body).appendChild(overlay);
}

// ─── Helpers ────────────────────────────────────────────────────────────

function rerender() {
  if (state.get('dataView') && state.get('dataView') !== 'list') return;
  const zone = qs('#data-zone');
  if (zone) { clear(zone); renderVariableList(zone); }
}

setRerenderFn(rerender);

// ─── Batch sync check ──────────────────────────────────────────────────

/**
 * Run a batch sync check: scan the document for all variable expressions
 * and update the sync-dot indicators. Shows a summary toast after.
 */
async function runBatchSyncCheck() {
  const variables = state.get('variables') || [];
  if (variables.length === 0) return;

  // Build lightweight list with document-facing expressions
  const varList = variables.map(v => {
    const docExprs = buildDocSearchExpressions(v);
    return {
      id: v.id,
      expression: v.expression || '',
      docExpr: docExprs[0] || v.expression || '',
    };
  });

  const result = await batchSyncCheck(varList);
  setSyncStatus(result);

  // Count results for summary
  const counts = { found: 0, not_found: 0, multiple: 0, no_expression: 0 };
  Object.values(result).forEach(s => { if (s in counts) counts[s]++; });

  // Show toast summary
  const parts = [];
  if (counts.found > 0) parts.push(`${counts.found} synced`);
  if (counts.not_found > 0) parts.push(`${counts.not_found} missing`);
  if (counts.multiple > 0) parts.push(`${counts.multiple} duplicates`);
  if (counts.no_expression > 0) parts.push(`${counts.no_expression} no expression`);

  const allDev = Object.values(result).every(s => s === 'no_word');
  const msg = allDev ? 'Dev mode — no document to check' : parts.join(', ');

  showSyncToast(msg, counts.not_found > 0 ? 'warning' : 'success');

  rerender();
}

function showSyncToast(message, type) {
  const existing = document.getElementById('sync-toast');
  if (existing) existing.remove();

  const colors = {
    success: { bg: '#e8f5e9', border: '#43a047', text: '#2e7d32' },
    warning: { bg: '#fff8e1', border: '#f9a825', text: '#e67700' },
  };
  const c = colors[type] || colors.success;

  const toast = el('div', {
    id: 'sync-toast',
    style: {
      position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
      background: c.bg, border: `1px solid ${c.border}`, borderRadius: '8px',
      padding: '8px 16px', color: c.text, fontSize: '12px', fontWeight: '600',
      zIndex: '9999', boxShadow: '0 2px 8px rgba(0,0,0,.15)',
      display: 'flex', alignItems: 'center', gap: '6px',
    },
  }, [
    el('span', { html: icon('refresh', 12) }),
    message,
  ]);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4000);
}

