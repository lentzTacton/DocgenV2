/**
 * Variable Wizard — Create new variable flow with live API data.
 *
 * BOM:    source dropdown → field-based filter builder → live match preview → pipeline
 * Object: tabbed model explorer (Favorites / Attributes / References) with breadcrumb nav
 * List:   static value editor
 *
 * Entry point that orchestrates the three type-specific sub-modules:
 * - wizard-state.js — shared state management
 * - wizard-bom.js — BOM section (source, filters, transforms, preview)
 * - wizard-object.js — Object explorer (tabbed navigation)
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon, iconEl } from '../../components/icon.js';
import state from '../../core/state.js';
import {
  createVariable, updateVariable, removeVariable,
  validateName, generateExpression, matchesFilters,
  canDeleteVariable, buildDocSearchExpressions,
} from '../../services/variables.js';
import {
  isConnected, fetchBomRecords, getBomFields, getBomFieldValues,
  getBomSources, fetchModel, getStartingObject,
  getExplorerFavorites, toggleExplorerFavorite,
  fetchStartingObjectInstances, getSelectedInstance, setSelectedInstance,
} from '../../services/data-api.js';
import { wizState, resetWiz, rebuildObjectPath } from './wizard-state.js';
import { renderBomSection, setRefreshPipelineCallback as setBomRefresh } from './wizard-bom.js';
import { loadObjectExplorer, setRefreshPipelineCallback as setObjectRefresh, buildPath } from './wizard-object.js';
import { loadConfigExplorer, setRefreshPipelineCallback as setConfigRefresh, resetConfigExplorer } from './wizard-config-explorer.js';
import { renderCodeSection, renderCodeRefs, setCodeRefreshPipelineCallback as setCodeRefresh } from './wizard-code.js';
import { showConfirmDialog, showInfoDialog } from '../../core/dialog.js';
import { runDocUpdateFlow, showDocUpdateOverlay } from './doc-update.js';
import { insertTextAtCursor, resetSelectionCache } from '../../services/word-api.js';

// ─── Extracted sub-modules ──────────────────────────────────────────────
import {
  getDrawerData, renderDataDrawer,
  updateDrawerBar, resetDrawerLoadAttempt,
  loadDrawerRecords, loadConfigDrawerRecords,
} from './wizard-drawer.js';
import {
  renderDetailsControls, setTransformRefreshCallback,
} from './wizard-transforms.js';

// ─── Purpose selector ────────────────────────────────────────────────

function renderPurposeSelector() {
  const purposes = [
    { key: 'block',    label: 'Block',    icon: 'box',    desc: '$for{}$ / $rowgroup{}$' },
    { key: 'variable', label: 'Variable', icon: 'target', desc: '$define{#name=…}$' },
    { key: 'inline',   label: 'Inline',   icon: 'dollar', desc: '${…}$' },
  ];
  const sel = el('div', { class: 'purpose-sel-compact', id: 'wiz-purpose-sel' });
  purposes.forEach(p => {
    const opt = el('button', {
      class: `purpose-pill ${wizState.purpose === p.key ? 'purpose-pill-sel' : ''}`,
      onclick: () => {
        wizState.purpose = p.key;
        sel.querySelectorAll('.purpose-pill').forEach(o => o.classList.remove('purpose-pill-sel'));
        opt.classList.add('purpose-pill-sel');
        if (p.key === 'block' && (wizState.type === 'single' || wizState.type === 'list')) {
          wizState.type = 'bom';
          wizState.source = wizState.bomSources[0]?.expression || wizState.bomSources[0]?.name || '#this.flatbom';
          updateTypeSelector();
        }
        // Inline behaves like variable for type selection purposes
        if (p.key === 'inline' && wizState.type === 'bom') {
          wizState.type = 'single';
          wizState.source = '';
          updateTypeSelector();
        }
        // Always refresh source sections when purpose changes (define picker visibility depends on purpose)
        switchTypeView();
        refreshPipeline();
      },
    }, [
      el('span', { class: 'icon', html: icon(p.icon, 14) }),
      el('div', { class: 'purpose-pill-text' }, [
        el('span', { class: 'purpose-pill-label' }, p.label),
        el('span', { class: 'purpose-pill-desc' }, p.desc),
      ]),
    ]);
    sel.appendChild(opt);
  });
  return sel;
}

/** Render a compact catalogue + section assignment row. */
function renderCataloguePicker() {
  const catalogues = state.get('catalogues') || [];
  const sections = state.get('sections') || [];

  // If no catalogues exist, skip the picker
  if (catalogues.length === 0) {
    return el('div');
  }

  const wrap = el('div', { class: 'form-group' });
  wrap.appendChild(el('div', { class: 'field-label' }, [
    el('span', { class: 'icon', html: icon('folder', 12) }),
    ' Location',
  ]));

  const row = el('div', { style: { display: 'flex', gap: '6px' } });

  // Catalogue dropdown
  const catOptions = [
    el('option', { value: '' }, '— No catalogue —'),
    ...catalogues.map(c => el('option', { value: String(c.id) }, c.name)),
  ];
  const catSelect = el('select', {
    class: 'input',
    style: { flex: '1', fontSize: '11px', padding: '4px 6px' },
    onchange: () => {
      const catId = catSelect.value || null;
      wizState.catalogueId = catId;
      wizState.sectionId = null;
      updateSectionOptions();
    },
  }, catOptions);
  if (wizState.catalogueId) catSelect.value = String(wizState.catalogueId);

  // Section dropdown
  const secSelect = el('select', {
    class: 'input', id: 'wiz-sec-select',
    style: { flex: '1', fontSize: '11px', padding: '4px 6px' },
    onchange: () => {
      wizState.sectionId = secSelect.value || null;
    },
  });

  function updateSectionOptions() {
    const catId = wizState.catalogueId;
    const catSections = catId ? sections.filter(s => s.catalogueId === catId) : [];
    secSelect.innerHTML = '';
    secSelect.appendChild(el('option', { value: '' }, '— No section —'));
    catSections.forEach(s => {
      secSelect.appendChild(el('option', { value: String(s.id) }, s.name));
    });
    if (wizState.sectionId) secSelect.value = String(wizState.sectionId);
  }
  updateSectionOptions();

  row.appendChild(catSelect);
  row.appendChild(secSelect);
  wrap.appendChild(row);
  return wrap;
}

/** Update the type selector visuals to reflect current wizState.type. */
function updateTypeSelector() {
  const opts = document.querySelectorAll('.type-pill');
  opts.forEach(o => {
    const label = o.querySelector('.tl')?.textContent;
    const typeMap = { 'BOM': 'bom', 'Object': 'object', 'Single': 'single', 'Config': 'config', 'List': 'list' };
    o.classList.toggle('type-pill-sel', typeMap[label] === wizState.type);
  });
}

/** Update the purpose selector visuals to reflect current wizState.purpose. */
function updatePurposeSelector() {
  const sel = qs('#wiz-purpose-sel');
  if (!sel) return;
  const pills = sel.querySelectorAll('.purpose-pill');
  const purposeMap = { 'Block': 'block', 'Variable': 'variable', 'Inline': 'inline' };
  pills.forEach(p => {
    const label = p.querySelector('.purpose-pill-label')?.textContent;
    p.classList.toggle('purpose-pill-sel', purposeMap[label] === wizState.purpose);
  });
}

// ─── Tab state ───────────────────────────────────────────────────────

let activeTab = 'classify'; // 'classify' | 'source' | 'transform'
let _updateActionButton = null; // set by renderVariableWizard, called by tab bar

// ─── Entry point ─────────────────────────────────────────────────────

export function renderVariableWizard(container, existingVariable) {
  resetWiz(existingVariable);
  // Edit mode: start on Source (rarely need to change classification)
  // Create mode: start on Classification
  activeTab = existingVariable ? 'source' : 'classify';

  // Inject callbacks into sub-modules so they can call refreshPipeline
  setBomRefresh(refreshPipeline);
  setObjectRefresh(refreshPipeline);
  setConfigRefresh(refreshPipeline);
  setCodeRefresh(refreshPipeline);

  // Resolve catalogue name from context
  const catalogues = state.get('catalogues') || [];
  const catName = wizState.catalogueId
    ? (catalogues.find(c => c.id === wizState.catalogueId)?.name || '')
    : '';

  // Back
  container.appendChild(
    el('button', { class: 'back-btn', onclick: () => { state.set('activeVariable', null); state.set('dataView', 'list'); } }, [
      el('span', { class: 'icon', html: icon('chevronLeft', 14) }), wizState.isEditMode ? 'Back' : 'Cancel',
    ])
  );

  // Header — show catalogue context
  const headerLabel = wizState.isEditMode
    ? 'Edit dataset'
    : catName ? `New dataset in ${catName}` : 'New dataset';
  container.appendChild(
    el('div', { class: 'wiz-header' }, [
      el('span', { class: 'icon', style: { color: 'var(--tacton-blue)' }, html: icon(wizState.isEditMode ? 'edit' : 'plus', 16) }),
      el('div', { class: 'wiz-header-title' }, headerLabel),
    ])
  );

  // Guide text — only for new datasets
  // Guide text removed to save vertical space

  // ── Expression preview (always visible above tabs, builds progressively) ──
  container.appendChild(el('div', { id: 'wiz-selected-source' }));
  updateSelectedSource();

  // ── Tab bar: Classification | Source | Transformation — all required ──
  container.appendChild(renderTabBar());

  // ── Tab 1: Classification ──
  const classPanel = el('div', { id: 'wiz-tab-classify', class: 'wiz-tab-panel', style: { display: activeTab === 'classify' ? '' : 'none' } });

  // ─ Name + Parent Context (merged combo control — no wiz-card wrapper) ─
  const nameCard = el('div', { id: 'wiz-name-card', style: { marginBottom: '8px' } });
  renderNameCombo(nameCard);
  classPanel.appendChild(nameCard);

  // ─ Instance picker (which Solution / ConfiguredProduct / etc.) ─
  // Only show when fully connected with a healthy ticket token
  const tokenHealth = state.get('tickets.tokenHealth');
  const hasHealthyToken = tokenHealth && (tokenHealth.status === 'ok' || tokenHealth.status === 'warn');
  if (isConnected() && hasHealthyToken && !wizState.isEditMode) {
    const instanceCard = el('div', { class: 'wiz-card', id: 'wiz-instance-card' });
    const startType = getStartingObject();
    const currentInst = getSelectedInstance();

    instanceCard.appendChild(el('div', { class: 'wiz-card-label' }, `${startType} instance`));

    const instanceSelect = el('select', {
      class: 'input wiz-instance-select', id: 'wiz-instance-select',
      onchange: (e) => {
        const option = e.target.selectedOptions[0];
        if (!option || !option.value) {
          setSelectedInstance(null);
        } else {
          setSelectedInstance({
            id: option.value,
            displayId: option.dataset.displayId || option.value,
            name: option.textContent,
          });
        }
      },
    });
    instanceSelect.appendChild(el('option', { value: '' }, 'Loading instances…'));
    instanceCard.appendChild(instanceSelect);

    instanceCard.appendChild(
      el('div', { class: 'wiz-instance-hint' },
        `In production, the document is generated from a specific ${startType}. Pick one to simulate realistic data.`
      )
    );

    classPanel.appendChild(instanceCard);

    // Async-load the instances
    fetchStartingObjectInstances(startType).then(instances => {
      const sel = qs('#wiz-instance-select');
      if (!sel) return;
      clear(sel);
      sel.appendChild(el('option', { value: '' }, `— Select a ${startType} —`));
      for (const inst of instances) {
        const label = inst.displayId && inst.displayId !== inst.name
          ? `${inst.name}  (${inst.displayId})`
          : inst.name;
        const opt = el('option', {
          value: inst.id,
          'data-display-id': inst.displayId,
        }, label);
        if (currentInst && currentInst.id === inst.id) opt.selected = true;
        sel.appendChild(opt);
      }
      // Auto-select first if only one instance
      if (instances.length === 1 && !currentInst) {
        sel.value = instances[0].id;
        setSelectedInstance(instances[0]);
      }
    });
  }

  // ─ Type + Usage side-by-side ─
  const configRow = el('div', { class: 'wiz-config-row' });

  configRow.appendChild(el('div', { class: 'wiz-config-col' }, [
    el('div', { class: 'wiz-card-label' }, 'Type'),
    renderTypeSelector(),
  ]));

  configRow.appendChild(el('div', { class: 'wiz-config-col' }, [
    el('div', { class: 'wiz-card-label' }, 'Usage'),
    renderPurposeSelector(),
  ]));

  classPanel.appendChild(configRow);

  // Parent context is now merged into the Name combo above

  // ─ Optional: description + tags (last) ─
  const optCard = el('div', { class: 'wiz-card wiz-card-muted' }, [
    el('div', { class: 'wiz-card-label' }, 'Optional'),
    el('input', {
      class: 'input wiz-input-sm', id: 'wiz-desc',
      value: wizState.description || '',
      placeholder: 'Description',
      oninput: (e) => { wizState.description = e.target.value; },
    }),
  ]);
  optCard.appendChild(renderTagPicker());
  classPanel.appendChild(optCard);

  container.appendChild(classPanel);

  // ── Tab 2: Source (type-specific config) ──
  // Inline expressions can use a define as source — show define picker for all inline types
  const _initShowDefine = wizState.type === 'define' || wizState.purpose === 'inline';
  const _isObjLike = wizState.type === 'object' || wizState.type === 'single' || wizState.type === 'config';
  const sourcePanel = el('div', { id: 'wiz-tab-source', class: 'wiz-tab-panel', style: { display: activeTab === 'source' ? '' : 'none' } });
  sourcePanel.appendChild(el('div', { id: 'wiz-bom-section', style: { display: wizState.type === 'bom' ? '' : 'none' } }));
  sourcePanel.appendChild(el('div', { id: 'wiz-define-section', style: { display: _initShowDefine ? '' : 'none' } }));
  sourcePanel.appendChild(el('div', { id: 'wiz-source-toggle', style: { display: wizState.type === 'single' ? '' : 'none' } }));
  sourcePanel.appendChild(el('div', { id: 'wiz-obj-section', style: { display: _isObjLike ? '' : 'none' } }));
  sourcePanel.appendChild(el('div', { id: 'wiz-list-section', style: { display: wizState.type === 'list' ? '' : 'none' } }));
  sourcePanel.appendChild(el('div', { id: 'wiz-code-section', style: { display: wizState.type === 'code' ? '' : 'none' } }));
  container.appendChild(sourcePanel);

  // ── Tab 3: Transformation (type-specific controls + validation) ──
  const transformPanel = el('div', { id: 'wiz-tab-transform', class: 'wiz-tab-panel', style: { display: 'none' } });
  transformPanel.appendChild(el('div', { id: 'wiz-details-controls' }));
  container.appendChild(transformPanel);

  // ── Data drawer — always visible slide-up at bottom ──
  renderDataDrawer(container);

  // Action buttons — single row: Back? | Save | Next? | Close/Delete
  const actionWrap = el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px', marginBottom: '36px' } });

  function switchToTab(key) {
    activeTab = key;
    const allTabs = [
      { key: 'classify', panelId: 'wiz-tab-classify' },
      { key: 'source', panelId: 'wiz-tab-source' },
      { key: 'transform', panelId: 'wiz-tab-transform' },
    ];
    allTabs.forEach(t => {
      const panel = qs(`#${t.panelId}`);
      if (panel) panel.style.display = t.key === key ? '' : 'none';
    });
    const bar = qs('#wiz-tab-bar');
    if (bar) bar.querySelectorAll('.wiz-tab').forEach(b => b.classList.toggle('wiz-tab-active', b.dataset.tab === key));
    if (key === 'transform') { renderDetailsControls(); refreshPipeline(); }
    updateActionButtons();
  }

  function updateActionButtons() {
    actionWrap.innerHTML = '';
    const tabOrder = ['classify', 'source', 'transform'];
    const curIdx = tabOrder.indexOf(activeTab);

    // Back (not on first tab)
    if (curIdx > 0) {
      actionWrap.appendChild(el('button', {
        class: 'btn',
        onclick: () => switchToTab(tabOrder[curIdx - 1]),
      }, [el('span', { class: 'icon', html: icon('chevronLeft', 12) })]));
    }

    // Save / Create — always visible, takes remaining space
    // On non-final tabs in create mode: advance to next tab instead of saving
    const isLastTab = curIdx >= tabOrder.length - 1;
    const btnLabel = wizState.isEditMode ? 'Save' : (isLastTab ? 'Create' : 'Next');
    const btnIcon = isLastTab || wizState.isEditMode ? 'check' : 'arrowRight';
    actionWrap.appendChild(el('button', {
      class: 'btn btn-primary',
      style: { flex: '1', justifyContent: 'center' },
      onclick: () => {
        if (!wizState.isEditMode && !isLastTab) {
          // Advance to next tab (with classify validation)
          if (activeTab === 'classify') {
            const nameVal = wizState.name || `#${(qs('#wiz-name')?.value || '').replace(/^#/, '')}`;
            wizState.name = nameVal;
            if (!nameVal || nameVal === '#') {
              const e = qs('#wiz-err');
              if (e) { e.textContent = 'Name is required'; e.style.display = ''; }
              return;
            }
          }
          switchToTab(tabOrder[curIdx + 1]);
        } else {
          handleSave();
        }
      },
    }, [el('span', { class: 'icon', html: icon(btnIcon, 14) }), btnLabel]));

    // Next arrow only in edit mode (create mode uses the primary button to advance)
    if (wizState.isEditMode && curIdx < tabOrder.length - 1) {
      actionWrap.appendChild(el('button', {
        class: 'btn',
        onclick: () => switchToTab(tabOrder[curIdx + 1]),
      }, [el('span', { class: 'icon', html: icon('arrowRight', 12) })]));
    }

    // Close / Delete
    if (wizState.isEditMode) {
      actionWrap.appendChild(el('button', {
        class: 'btn-danger',
        onclick: handleDelete,
        html: icon('trash', 14),
      }));
    } else {
      actionWrap.appendChild(el('button', {
        class: 'btn',
        onclick: () => { state.set('activeVariable', null); state.set('dataView', 'list'); },
      }, [el('span', { class: 'icon', html: icon('x', 14) })]));
    }
  }

  updateActionButtons();
  _updateActionButton = updateActionButtons;
  container.appendChild(actionWrap);

  bootAsync();
}

function renderTabBar() {
  const tabs = [
    { key: 'classify',  label: 'Classification',  icon: 'settings',  panelId: 'wiz-tab-classify' },
    { key: 'source',    label: 'Source',           icon: 'database',  panelId: 'wiz-tab-source' },
    { key: 'transform', label: 'Transformation',   icon: 'code',      panelId: 'wiz-tab-transform' },
  ];
  const bar = el('div', { class: 'wiz-tab-bar', id: 'wiz-tab-bar' });
  tabs.forEach(t => {
    const btn = el('button', {
      class: `wiz-tab ${activeTab === t.key ? 'wiz-tab-active' : ''}`,
      'data-tab': t.key,
      onclick: () => {
        activeTab = t.key;
        // Toggle all panels
        tabs.forEach(tab => {
          const panel = qs(`#${tab.panelId}`);
          if (panel) panel.style.display = tab.key === t.key ? '' : 'none';
        });
        // Update tab active states
        bar.querySelectorAll('.wiz-tab').forEach(b => b.classList.toggle('wiz-tab-active', b.dataset.tab === t.key));
        // Refresh pipeline when switching to transform
        if (t.key === 'transform') { renderDetailsControls(); refreshPipeline(); }
        // Update action button label
        if (_updateActionButton) _updateActionButton();
      },
    }, [
      el('span', { class: 'icon', html: icon(t.icon, 12) }),
      t.label,
      el('span', { class: 'wiz-tab-req' }, '*'),
    ]);
    bar.appendChild(btn);
  });
  return bar;
}

// ─── Async boot ──────────────────────────────────────────────────────

async function bootAsync() {
  const bomSection = qs('#wiz-bom-section');
  if (!bomSection) return;

  const needsBomData = wizState.type === 'bom';

  if (isConnected()) {
    if (needsBomData) {
      // BOM type needs full data load before rendering
      bomSection.innerHTML = `<div class="obj-empty">${icon('loader', 14)} Loading data...</div>`;
      try {
        const [sources, fields, records, model, favs] = await Promise.all([
          getBomSources(), getBomFields(), fetchBomRecords(), fetchModel(), getExplorerFavorites(),
        ]);
        wizState.bomSources = sources; wizState.bomFields = fields; wizState.bomRecords = records;
        wizState.modelObjects = model || []; wizState.explorerFavs = favs;
        if (!wizState.isEditMode && sources.length > 0) {
          wizState.source = sources[0].expression || sources[0].name;
        }
      } catch (e) { console.error('[wizard] Boot:', e); }
    } else {
      // Non-BOM types only need model + favorites (fast — no record fetching)
      try {
        const [model, favs] = await Promise.all([
          fetchModel(), getExplorerFavorites(),
        ]);
        wizState.modelObjects = model || [];
        wizState.explorerFavs = favs;
      } catch (e) { console.error('[wizard] Boot (light):', e); }
    }
  }

  // In edit mode, reconstruct the objectPath from the saved source expression
  // so the explorer shows breadcrumb navigation at the right depth.
  if (wizState.isEditMode && wizState.modelObjects.length > 0) {
    rebuildObjectPath(wizState.modelObjects);
  }

  // Render the active type section
  // Inline expressions always get the define picker (plus the model explorer below)
  if (wizState.type === 'define' || wizState.purpose === 'inline') {
    renderDefineSection(qs('#wiz-define-section'));
  }
  if (wizState.type === 'bom') {
    renderBomSection(bomSection);
  } else if (wizState.type === 'config' || (wizState.type === 'single' && wizState._singleSourceMode === 'config')) {
    loadConfigExplorer();
  } else if (wizState.type === 'object' || wizState.type === 'single') {
    loadObjectExplorer();
  } else if (wizState.type === 'list') {
    renderListSection(qs('#wiz-list-section'));
  } else if (wizState.type === 'code') {
    renderCodeSection(qs('#wiz-code-section'));
  }
  refreshPipeline();

  // Pre-load drawer records for edit mode (already have a source configured)
  if (wizState.source && (wizState.type === 'object' || wizState.type === 'single' || wizState.type === 'config')) {
    if (wizState.type === 'config' || (wizState._singleSourceMode === 'config' && wizState._selectedConfigPath)) {
      loadConfigDrawerRecords();
    } else if (wizState._singleSourceMode !== 'config') {
      loadDrawerRecords();
    }
  }
}

// ─── Type selector ───────────────────────────────────────────────────

function renderTypeSelector() {
  const types = [
    { key: 'object', icon: 'cube', color: 'var(--purple)', label: 'Object' },
    { key: 'bom', icon: 'box', color: 'var(--orange)', label: 'BOM' },
    { key: 'single', icon: 'target', color: 'var(--success)', label: 'Single' },
    { key: 'config', icon: 'cpu', color: 'var(--info, #0288D1)', label: 'Config' },
    { key: 'define', icon: 'link', color: 'var(--purple, #8250DF)', label: 'Define' },
    { key: 'list', icon: 'list', color: 'var(--tacton-blue)', label: 'List' },
    { key: 'code', icon: 'code', color: 'var(--text-tertiary)', label: 'Code' },
  ];
  const sel = el('div', { class: 'type-sel-compact' });

  function applyTypeChange(t, opt) {
    wizState.type = t.key; wizState.filters = []; wizState.catchAll = false; wizState.objectPath = [];
    wizState.transforms = []; wizState.sourceDefine = ''; wizState.sourceDefineSource = '';
    if (t.key === 'bom') wizState.source = wizState.bomSources[0]?.expression || wizState.bomSources[0]?.name || '#this.flatbom';
    else if (t.key === 'object' || t.key === 'single') wizState.source = '';
    else if (t.key === 'config') { wizState.source = ''; wizState._singleSourceMode = 'config'; wizState._selectedConfigPath = null; wizState._selectedConfigAttr = null; }
    else if (t.key === 'list') wizState.source = '{""}';
    else wizState.source = '';

    const autoPurpose = (t.key === 'single' || t.key === 'config') ? 'variable'
      : (t.key === 'list' || t.key === 'define' || t.key === 'code') ? 'variable'
      : 'block';
    wizState.purpose = autoPurpose;
    updatePurposeSelector();

    sel.querySelectorAll('.type-pill').forEach(o => o.classList.remove('type-pill-sel'));
    opt.classList.add('type-pill-sel');
    switchTypeView();
    refreshPipeline();
  }

  types.forEach(t => {
    const opt = el('button', {
      class: `type-pill ${wizState.type === t.key ? 'type-pill-sel' : ''}`,
      onclick: () => {
        if (t.key === wizState.type) return; // already selected

        // In edit mode, warn that changing type resets source/filters/transforms
        if (wizState.isEditMode) {
          showConfirmDialog(
            'Change dataset type?',
            'This will reset the source, filters, and transforms for this dataset. This cannot be undone.',
            () => applyTypeChange(t, opt),
            { confirmLabel: 'Change type', id: 'wiz-confirm-overlay', btnColor: 'var(--warning, #D4A015)', iconTint: 'var(--warning, #D4A015)' }
          );
          return;
        }

        applyTypeChange(t, opt);
      },
    }, [
      el('span', { class: 'icon', style: { color: t.color }, html: icon(t.icon, 14) }),
      el('span', { class: 'tl' }, t.label),
    ]);
    sel.appendChild(opt);
  });
  return sel;
}

// Confirmation dialog — now uses shared showConfirmDialog from core/dialog.js

function switchTypeView() {
  const bom = qs('#wiz-bom-section'), obj = qs('#wiz-obj-section'), lst = qs('#wiz-list-section');
  const def = qs('#wiz-define-section'), code = qs('#wiz-code-section');
  const isObjLike = wizState.type === 'object' || wizState.type === 'single' || wizState.type === 'config';
  if (bom) bom.style.display = wizState.type === 'bom' ? '' : 'none';

  // Refresh name combo when type/purpose changes (parent candidates may change)
  const nameCard = qs('#wiz-name-card');
  if (nameCard) renderNameCombo(nameCard);

  // Show define section for 'define' type OR for all inline expressions (can pick a define as source)
  const showDefine = wizState.type === 'define' || wizState.purpose === 'inline';

  // Source mode toggle (Object / Configuration) — only for 'single' type
  const toggleWrap = qs('#wiz-source-toggle');
  if (toggleWrap) {
    toggleWrap.style.display = wizState.type === 'single' ? '' : 'none';
    clear(toggleWrap);
    if (wizState.type === 'single') renderSingleSourceToggle(toggleWrap);
  }

  if (obj) {
    obj.style.display = isObjLike ? '' : 'none';
    if (isObjLike) {
      if (wizState.type === 'config' || (wizState.type === 'single' && wizState._singleSourceMode === 'config')) {
        loadConfigExplorer();
      } else {
        loadObjectExplorer();
      }
    }
  }
  if (lst) { lst.style.display = wizState.type === 'list' ? '' : 'none'; renderListSection(lst); }
  if (def) { def.style.display = showDefine ? '' : 'none'; renderDefineSection(def); }
  if (code) { code.style.display = wizState.type === 'code' ? '' : 'none'; renderCodeSection(code); }
  if (wizState.type === 'bom') renderBomSection(bom);
}

/**
 * Render the Object / Configuration toggle for 'single' type.
 */
function renderSingleSourceToggle(container) {
  const mode = wizState._singleSourceMode || 'object';
  const toggle = el('div', { class: 'cfg-source-toggle' });

  const objBtn = el('button', {
    class: `cfg-source-toggle-btn ${mode === 'object' ? 'cfg-source-toggle-active' : ''}`,
    onclick: () => {
      if (wizState._singleSourceMode === 'object') return;
      wizState._singleSourceMode = 'object';
      wizState.source = '';
      wizState._selectedConfigPath = null;
      wizState._selectedConfigAttr = null;
      switchTypeView();
      refreshPipeline();
    },
  }, [el('span', { class: 'icon', html: icon('cube', 12) }), ' Object']);

  const cfgBtn = el('button', {
    class: `cfg-source-toggle-btn ${mode === 'config' ? 'cfg-source-toggle-active' : ''}`,
    onclick: () => {
      if (wizState._singleSourceMode === 'config') return;
      wizState._singleSourceMode = 'config';
      wizState.source = '';
      wizState.objectPath = [];
      // Auto-set purpose to inline for config attributes
      if (wizState.purpose === 'variable') {
        wizState.purpose = 'inline';
        updatePurposeSelector();
      }
      switchTypeView();
      refreshPipeline();
    },
  }, [el('span', { class: 'icon', html: icon('cpu', 12) }), ' Configuration']);

  toggle.appendChild(objBtn);
  toggle.appendChild(cfgBtn);
  container.appendChild(toggle);
}



// ═════════════════════════════════════════════════════════════════════
//  SINGLE CONFIG-ATTR SECTION (Source tab — getConfigurationAttribute source)
// ═════════════════════════════════════════════════════════════════════

/** Check if a source uses getConfigurationAttribute (Configured Product API, not object model). */
function isConfigAttrSource(source) {
  return source && source.includes('getConfigurationAttribute(');
}

// renderConfigAttrSection replaced by wizard-config-explorer.js → loadConfigExplorer()

// ═════════════════════════════════════════════════════════════════════
//  LIST SECTION (Source tab — raw syntax input)
// ═════════════════════════════════════════════════════════════════════

function renderListSection(container) {
  if (!container) return;
  clear(container);
  container.appendChild(el('div', { class: 'form-group' }, [
    el('div', { class: 'form-label' }, [el('span', { class: 'icon', html: icon('list', 12) }), 'List values']),
    el('input', {
      class: 'input', id: 'wiz-list-raw',
      value: wizState.source || '',
      placeholder: '{"value1","value2","value3"}',
      style: { fontSize: '12px', fontFamily: 'var(--mono)' },
      oninput: (e) => { wizState.source = e.target.value; refreshPipeline(); },
    }),
    el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' } },
      'Use the Transformation tab to add/remove values visually or paste CSV data.'),
  ]));
}


// ═════════════════════════════════════════════════════════════════════
//  PARENT CONTEXT SECTION (Source tab — for-loop parent block picker)
// ═════════════════════════════════════════════════════════════════════

/**
 * Render the merged Name + Parent Context combo control.
 *
 * Behaviour:
 * - Default: editable text input with # prefix → user types name (parent/normal block)
 * - Dropdown: shows available parent blocks to nest inside
 * - When parent selected: name auto-generates, field becomes read-only with ✕ clear button
 * - When cleared: back to editable input
 *
 * Template pattern: $for{CHILD_NAME in PARENT_NAME}$
 */
function renderNameCombo(container) {
  clear(container);

  const allVars = state.get('variables') || [];
  const isChild = !!wizState.parentBlock;
  const parentVar = isChild ? allVars.find(v => v.name === wizState.parentBlock) : null;
  const isDefineParent = parentVar && parentVar.purpose === 'variable';
  // Lock name field only for block parents (child name = parent name).
  // Define parents need a different loop variable name, so keep editable.
  const nameLocked = isChild && !isDefineParent;

  // Candidate parents: blocks or defines that hold a collection (can be iterated)
  const parentCandidates = allVars.filter(v =>
    v.name && v.name !== wizState.name
    && (v.purpose === 'block' || v.purpose === 'variable')
    && (v.type === 'object' || v.type === 'bom' || v.type === 'define')
  );

  container.appendChild(el('div', { class: 'wiz-card-label' }, 'Name'));

  // ── Single name input: [ # | name input ] ──
  // Parent context is shown as a subtle info line BELOW, not inside the combo.
  const comboWrap = el('div', {
    style: { display: 'flex', alignItems: 'center', border: '1px solid var(--border-light)', borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--bg-input, #fff)' },
  });

  // # prefix
  comboWrap.appendChild(el('span', {
    style: { padding: '0 0 0 8px', fontSize: '13px', color: 'var(--text-tertiary)', fontWeight: '500', userSelect: 'none' },
  }, '#'));

  // Name input — locked for block parents, editable for define parents and normal mode
  comboWrap.appendChild(el('input', {
    id: 'wiz-name',
    value: wizState.name ? wizState.name.replace(/^#/, '') : '',
    placeholder: isDefineParent ? 'loop variable name' : 'e.g. pump, accessories, skidItems',
    readOnly: nameLocked ? true : undefined,
    style: {
      flex: '1', border: 'none', outline: 'none', padding: '6px 4px', fontSize: '13px',
      background: nameLocked ? 'var(--bg-warm, #FAFBFC)' : 'transparent',
      color: nameLocked ? 'var(--text-secondary)' : 'inherit',
      cursor: nameLocked ? 'default' : 'text',
      minWidth: '0',
    },
    oninput: nameLocked ? undefined : (e) => {
      e.target.value = e.target.value.replace(/\s/g, '');
      wizState.name = `#${e.target.value.replace(/^#/, '')}`;
      if (isChild) wizState.parentLoopVar = wizState.name;
      clearErr();
      refreshPipeline();
    },
  }));

  // Right side: parent selector button (only when NOT already a child)
  if (!isChild && parentCandidates.length > 0) {
    const parentBtn = el('button', {
      type: 'button',
      style: { flex: '0 0 auto', border: 'none', borderLeft: '1px solid var(--border-light)', outline: 'none', padding: '4px 8px', fontSize: '11px', color: 'var(--text-secondary)', background: 'var(--bg-warm, #FAFBFC)', cursor: 'pointer', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '4px' },
      onclick: (e) => {
        e.stopPropagation();
        // Show parent picker panel below the combo
        const existingPanel = qs('#wiz-parent-picker');
        if (existingPanel) { existingPanel.remove(); return; }
        showParentPicker(container, allVars, parentCandidates, currentObjName => {
          renderNameCombo(container);
          const obj = qs('#wiz-obj-section');
          if (obj) { wizState.objectPath = []; wizState.source = ''; loadObjectExplorer(); }
          refreshPipeline();
        });
      },
    }, [
      'child of\u2026',
      el('span', { style: { fontSize: '9px' } }, '\u25BE'),
    ]);
    comboWrap.appendChild(parentBtn);
  }

  container.appendChild(comboWrap);

  container.appendChild(el('div', { id: 'wiz-err', class: 'wiz-err', style: { display: 'none' } }));

  // ── Subtle parent context line below the name field (child mode only) ──
  if (isChild) {
    container.appendChild(el('div', {
      style: { fontSize: '11px', color: 'var(--text-secondary)', padding: '3px 0 0 0', display: 'flex', alignItems: 'center', gap: '4px' },
    }, [
      el('span', { class: 'icon', html: icon('link', 11) }),
      `child of `,
      el('strong', { style: { fontWeight: '600' } }, wizState.parentBlock),
      wizState.parentObjectType
        ? el('span', { style: { color: 'var(--text-tertiary)' } }, ` (${wizState.parentObjectType})`)
        : null,
      el('button', {
        type: 'button', title: 'Remove parent — make independent',
        style: { marginLeft: '4px', padding: '0 4px', fontSize: '11px', lineHeight: '1', color: 'var(--text-tertiary)', cursor: 'pointer', background: 'none', border: 'none' },
        onclick: () => {
          wizState.parentBlock = '';
          wizState.parentLoopVar = '';
          wizState.parentObjectType = '';
          wizState.name = '';
          renderNameCombo(container);
          const obj = qs('#wiz-obj-section');
          if (obj) { wizState.objectPath = []; wizState.source = ''; loadObjectExplorer(); }
          refreshPipeline();
        },
      }, '✕'),
    ]));
  }
}


/**
 * Show a rich parent picker panel below the name combo.
 * Each candidate shows: name, type badge, and description.
 */
function showParentPicker(container, allVars, parentCandidates, onSelect) {
  const existing = qs('#wiz-parent-picker');
  if (existing) existing.remove();

  const TYPE_LABELS = { object: 'OBJ', bom: 'BOM' };
  const TYPE_COLORS = { object: '#0969DA', bom: '#E8713A' };
  const PURPOSE_LABELS = { block: 'block', variable: 'define' };

  const panel = el('div', {
    id: 'wiz-parent-picker',
    style: {
      border: '1px solid var(--border)', borderRadius: 'var(--radius)',
      background: 'var(--card, #fff)', boxShadow: '0 4px 12px rgba(0,0,0,.12)',
      maxHeight: '220px', overflowY: 'auto', marginTop: '4px',
    },
  });

  // --- Group candidates by section proximity ---
  const curSection = wizState.sectionId || null;
  const curCatalogue = wizState.catalogueId || null;

  const sameSection = [];
  const sameCatalogue = [];
  const rest = [];

  parentCandidates.forEach(v => {
    if (curSection && String(v.sectionId) === String(curSection)) {
      sameSection.push(v);
    } else if (curCatalogue && String(v.catalogueId) === String(curCatalogue)) {
      sameCatalogue.push(v);
    } else {
      rest.push(v);
    }
  });

  const groups = [];
  if (sameSection.length) groups.push({ label: 'This section', items: sameSection });
  if (sameCatalogue.length) groups.push({ label: 'This catalogue', items: sameCatalogue });
  if (rest.length) groups.push({ label: groups.length ? 'Other' : null, items: rest });
  // If only one group and no meaningful label, skip headers
  const showHeaders = groups.length > 1 || (groups.length === 1 && groups[0].label && sameSection.length + sameCatalogue.length > 0);

  function buildRow(v) {
    const typeLabel = TYPE_LABELS[v.type] || v.type;
    const typeColor = TYPE_COLORS[v.type] || 'var(--text-tertiary)';
    const purposeLabel = PURPOSE_LABELS[v.purpose] || v.purpose;
    const desc = v.description || '';

    return el('div', {
      style: {
        display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 10px',
        cursor: 'pointer', fontSize: '12px', borderBottom: '1px solid var(--border-light)',
      },
      onmouseenter: (e) => { e.currentTarget.style.background = 'var(--bg-warm, #F6F8FA)'; },
      onmouseleave: (e) => { e.currentTarget.style.background = ''; },
      onclick: () => {
        const parentVar = allVars.find(pv => pv.name === v.name);
        wizState.parentBlock = v.name;
        wizState.parentLoopVar = '';
        if (parentVar) resolveParentObjectType(parentVar);
        autoGenerateChildName();
        wizState.parentLoopVar = wizState.name;
        panel.remove();
        onSelect();
      },
    }, [
      // Type badge
      el('span', {
        style: {
          flex: '0 0 auto', fontSize: '9px', fontWeight: '700', color: '#fff',
          background: typeColor, borderRadius: '3px', padding: '1px 4px',
          lineHeight: '1.4', textTransform: 'uppercase',
        },
      }, typeLabel),
      // Name + purpose
      el('div', { style: { flex: '1', minWidth: '0' } }, [
        el('div', { style: { fontWeight: '600', fontSize: '12px' } }, [
          v.name.replace(/^#/, ''),
          el('span', { style: { fontWeight: '400', fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: '4px' } }, purposeLabel),
        ]),
        desc ? el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, desc) : null,
      ]),
    ]);
  }

  groups.forEach(group => {
    if (showHeaders && group.label) {
      panel.appendChild(el('div', {
        style: {
          padding: '4px 10px', fontSize: '9px', fontWeight: '700', textTransform: 'uppercase',
          letterSpacing: '0.5px', color: 'var(--text-tertiary)', background: 'var(--bg-warm, #F6F8FA)',
          borderBottom: '1px solid var(--border-light)',
        },
      }, group.label));
    }
    group.items.forEach(v => panel.appendChild(buildRow(v)));
  });

  container.appendChild(panel);

  // Close on outside click
  const close = (e) => { if (!panel.contains(e.target)) { panel.remove(); document.removeEventListener('click', close); } };
  setTimeout(() => document.addEventListener('click', close), 0);
}

/**
 * Render the parent context selector (legacy — now merged into renderNameCombo).
 * Kept for backward compatibility with any code that calls it.
 */
function renderParentContextSection(container) {
  clear(container);

  const allVars = state.get('variables') || [];

  // Candidate parents: blocks or defines that hold a collection (can be iterated)
  const parentCandidates = allVars.filter(v =>
    v.name && v.name !== wizState.name
    && (v.purpose === 'block' || v.purpose === 'variable')
    && (v.type === 'object' || v.type === 'bom' || v.type === 'define')
  );

  // If no candidates and no current parent, don't show
  if (parentCandidates.length === 0 && !wizState.parentBlock) return;

  const card = el('div', { class: 'wiz-card', style: { marginBottom: '8px' } });
  card.appendChild(el('div', { class: 'form-label', style: { display: 'flex', alignItems: 'center', gap: '6px' } }, [
    el('span', { class: 'icon', html: icon('arrowRight', 12) }),
    'Parent context',
    el('span', { style: { fontSize: '10px', color: 'var(--text-tertiary)', marginLeft: 'auto', fontWeight: '400' } }, 'child of for-loop'),
  ]));

  // Parent block selector
  const select = el('select', {
    class: 'input', style: { fontSize: '12px', marginBottom: '6px' },
    onchange: (e) => {
      const selectedName = e.target.value;
      if (!selectedName) {
        wizState.parentBlock = '';
        wizState.parentLoopVar = '';
        wizState.parentObjectType = '';
      } else {
        const parentVar = allVars.find(v => v.name === selectedName);
        wizState.parentBlock = selectedName;
        // The current block's name IS the loop variable — parentLoopVar tracks
        // the parent's name so we know how to prefix the source expression
        wizState.parentLoopVar = wizState.name || '';
        // Resolve parent's object type
        if (parentVar) resolveParentObjectType(parentVar);
      }
      // Re-render and refresh explorer
      renderParentContextSection(container);
      const obj = qs('#wiz-obj-section');
      if (obj) { wizState.objectPath = []; wizState.source = ''; loadObjectExplorer(); }
      // Auto-generate child name from parent + path
      autoGenerateChildName();
      refreshPipeline();
    },
  }, [
    el('option', { value: '' }, '— No parent (root context) —'),
    ...parentCandidates.map(v =>
      el('option', { value: v.name, selected: v.name === wizState.parentBlock || undefined },
        `child of ${v.name} (${v.type})`)
    ),
  ]);
  card.appendChild(select);

  if (wizState.parentBlock) {
    const childName = wizState.name || '#child';

    // Show the template preview: $for{childName in parentName}$
    card.appendChild(el('div', {
      style: { fontSize: '11px', padding: '4px 8px', background: 'var(--bg-warm, #FAFBFC)', border: '1px solid var(--border-light)', borderRadius: 'var(--radius)', fontFamily: 'var(--mono)', marginBottom: '4px' },
    }, `$for{${childName} in ${wizState.parentBlock}}$`));

    // Show resolved object type
    if (wizState.parentObjectType) {
      card.appendChild(el('div', {
        style: { fontSize: '11px', color: 'var(--text-secondary)', padding: '4px 0', display: 'flex', alignItems: 'center', gap: '4px' },
      }, [
        el('span', { class: 'icon', html: icon('target', 11) }),
        'Explorer scoped to: ',
        el('strong', {}, wizState.parentObjectType),
      ]));
    }
  }

  container.appendChild(card);
}

/**
 * Auto-generate child dataset name from parent.
 * The child's name becomes the loop variable in $for{childName in parentName}$.
 *
 * - Block parent: child name = same as parent (e.g. #CP → child #CP)
 * - Define parent: child needs a DIFFERENT name (e.g. #listTest → child #currentItem)
 *   because $for{#listTest in #listTest}$ would be nonsensical.
 */
function autoGenerateChildName() {
  if (!wizState.parentBlock) return;

  const allVars = state.get('variables') || [];
  const parentVar = allVars.find(v => v.name === wizState.parentBlock);
  const isDefineParent = parentVar && parentVar.purpose === 'variable';

  if (isDefineParent) {
    // Define parent: suggest "current" + capitalized parent name
    const cleanName = wizState.parentBlock.replace(/^#/, '');
    const suggested = `#current${cleanName.charAt(0).toUpperCase()}${cleanName.slice(1)}`;
    wizState.name = suggested;
  } else {
    // Block parent: child name = same as parent
    wizState.name = wizState.parentBlock;
  }

  wizState.parentLoopVar = wizState.name;
  const nameInput = qs('#wiz-name');
  if (nameInput) nameInput.value = wizState.name.replace(/^#/, '');
}

/**
 * Resolve the object type of a parent block's collection items.
 * E.g. if parent source is "#this.related('ConfiguredProduct','solution')",
 * the items are of type "ConfiguredProduct".
 */
function resolveParentObjectType(parentVar) {
  if (!parentVar?.source) return;
  const source = parentVar.source;

  // Pattern: related('ObjectType', 'relation') — first arg is the object type
  const relatedMatch = source.match(/related\(\s*'([^']+)'/);
  if (relatedMatch) {
    wizState.parentObjectType = relatedMatch[1];
    return;
  }

  // Pattern: dot-walk from starting object (e.g. solution.opportunity) — last segment is a ref
  // Use the model to resolve the final object type
  const startObj = state.get('startingObject.type') || 'Solution';
  const model = wizState.modelObjects || [];
  if (model.length > 0) {
    const root = startObj.charAt(0).toLowerCase() + startObj.slice(1);
    if (source.startsWith(root + '.')) {
      const segments = source.slice(root.length + 1).split('.');
      let current = startObj;
      for (const seg of segments) {
        const obj = model.find(o => o.name === current);
        if (!obj) break;
        const attr = obj.attributes.find(a => a.name === seg && a.refType);
        if (attr) current = attr.refType;
      }
      wizState.parentObjectType = current;
      return;
    }
  }

  // For BOM sources, items are BOM records (generic)
  if (source.includes('flatbom') || source.includes('.bom')) {
    wizState.parentObjectType = 'BOM';
    return;
  }
}


// ═════════════════════════════════════════════════════════════════════
//  DEFINE SECTION (Source tab — linked define picker)
// ═════════════════════════════════════════════════════════════════════

function renderDefineSection(container) {
  if (!container) return;
  clear(container);

  // Get all existing define-type variables (potential sources)
  // For inline expressions, allow same-name defines (the inline ${#x}$ references define $define{#x=...}$)
  const allVars = state.get('variables') || [];
  const defineSourceVars = allVars.filter(v => {
    if (!v.name || v.purpose !== 'variable') return false;
    // Exclude self (same id), but allow same-name if different variable (inline→define link)
    if (wizState.id && v.id === wizState.id) return false;
    if (!wizState.id && v.name === wizState.name && v.purpose === wizState.purpose) return false;
    return true;
  });

  // Source define picker
  const sourceSelect = el('select', {
    class: 'input',
    style: { fontSize: '12px' },
    onchange: (e) => {
      const val = e.target.value;
      wizState.sourceDefine = val;
      if (val) {
        const refVar = allVars.find(v => v.name === val);
        wizState.sourceDefineSource = refVar?.source || '';
        wizState.source = val;
      } else {
        // Cleared → allow model explorer to take over
        wizState.sourceDefineSource = '';
        wizState.source = '';
      }
      renderDefineSection(container); // refresh ref-info
      refreshPipeline();
    },
  });
  sourceSelect.appendChild(el('option', { value: '' }, '— None (use model below) —'));

  defineSourceVars.forEach(v => {
    const opt = el('option', { value: v.name }, `${v.name}  (${v.type})`);
    if (v.name === wizState.sourceDefine) opt.selected = true;
    sourceSelect.appendChild(opt);
  });

  const helpText = wizState.purpose === 'inline'
    ? 'Pick a define variable as source, or use the model explorer below.'
    : 'Select another define variable to use as the source.';

  container.appendChild(el('div', { class: 'form-group' }, [
    el('div', { class: 'form-label' }, [el('span', { class: 'icon', style: { color: 'var(--purple, #8250DF)' }, html: icon('link', 12) }), 'Source define']),
    sourceSelect,
    el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' } }, helpText),
  ]));

  // Show what the source define resolves to
  if (wizState.sourceDefine) {
    const refVar = allVars.find(v => v.name === wizState.sourceDefine);
    if (refVar) {
      container.appendChild(el('div', { class: 'wiz-define-ref-info' }, [
        el('div', { class: 'wiz-define-ref-label' }, 'Source expression:'),
        el('code', { class: 'wiz-define-ref-code' }, refVar.source || refVar.expression || '(empty)'),
      ]));
    }
  }

  // Accessor and null-safe controls are now in the universal Transformation tab.
}

// ═════════════════════════════════════════════════════════════════════
//  RAW SECTION → extracted to wizard-code.js
//  (renderCodeSection, renderCodeRefs imported at top)
// ═════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════
//  SELECTED SOURCE (always visible above tabs)
// ═════════════════════════════════════════════════════════════════════

function updateSelectedSource() {
  const wrap = qs('#wiz-selected-source');
  if (!wrap) return;
  clear(wrap);

  // Build expression: full if source is set, partial from objectPath during dot-walk
  let expr = '';
  let hasSource = !!wizState.source;

  if (wizState.source) {
    // Full expression with transforms
    expr = generateExpression({
      type: wizState.type, name: wizState.name, purpose: wizState.purpose,
      source: wizState.source, filters: wizState.filters, filterLogic: wizState.filterLogic,
      catchAll: wizState.catchAll, transforms: wizState.transforms,
      sourceDefine: wizState.sourceDefine, sourceDefineSource: wizState.sourceDefineSource,
      _singleFilter: wizState._singleFilter, _singleLeafField: wizState._singleLeafField,
      placeholder: wizState.placeholder,
    });
  } else if ((wizState.type === 'object' || wizState.type === 'single') && wizState.objectPath.length > 0) {
    // Progressive: build partial expression from current dot-walk path
    const partialPath = buildPath(); // no leaf → just the path so far
    const name = wizState.name || '#…';
    const wrapper = wizState.purpose === 'block' ? '$for' : wizState.purpose === 'inline' ? '$' : '$define';
    expr = `${wrapper}{${name}=${partialPath}.…}$`;
  }

  const hasContent = hasSource || expr;

  // Multi-value detection for single type
  let resolvedCount = 0;
  let isMultiValue = false;
  if (hasSource && wizState.type === 'single') {
    const totalRecords = wizState.currentObjDesc?.recordCount || wizState.objectRecords?.length || 0;
    if (totalRecords > 1) {
      const { records: filtered } = getDrawerData({ showAll: false });
      resolvedCount = filtered.length;
      isMultiValue = resolvedCount !== 1;
    }
  }
  const stateClass = isMultiValue ? 'obj-selected-warn'
    : hasSource ? '' : (hasContent ? 'obj-selected-progress' : 'obj-selected-empty');
  const tooltip = isMultiValue
    ? `Resolves to ${resolvedCount} value${resolvedCount !== 1 ? 's' : ''} — use a filter to narrow to 1`
    : expr;

  wrap.appendChild(el('div', { class: `obj-selected-source ${stateClass}`, title: tooltip }, [
    el('span', { class: 'icon', html: icon(isMultiValue ? 'warning' : (hasSource ? 'check' : 'code'), 12) }),
    el('span', { class: 'obj-selected-expr' }, expr || 'Expression builds here as you configure…'),
    isMultiValue ? el('span', { style: { fontSize: '9px', opacity: '0.8', whiteSpace: 'nowrap' } }, `${resolvedCount} values`) : null,
    hasSource ? el('button', {
      class: 'obj-selected-clear',
      onclick: () => {
        wizState.source = '';
        updateSelectedSource();
        loadObjectExplorer();
        refreshPipeline();
      },
      title: 'Clear selection',
      html: icon('x', 10),
    }) : null,
  ]));
}

// ═════════════════════════════════════════════════════════════════════
//  REFRESH (coordinates selected source, drawer, validation)
// ═════════════════════════════════════════════════════════════════════

function refreshPipeline() {
  resetDrawerLoadAttempt();
  if (wizState.type === 'config' || (wizState.type === 'single' && wizState._singleSourceMode === 'config')) {
    wizState.objectRecords = [];
  }
  updateSelectedSource();
  updateDrawerBar();
}

// Inject refreshPipeline into extracted sub-modules
setTransformRefreshCallback(refreshPipeline);

// Drawer + Transforms code moved to wizard-drawer.js and wizard-transforms.js



// ─── Duplicate warning dialog ────────────────────────────────────────

function showDuplicateWarningDialog(message, onProceed) {
  const existing = document.getElementById('val-dialog-overlay');
  if (existing) existing.remove();

  const overlay = el('div', {
    id: 'val-dialog-overlay',
    style: {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.35)',
      zIndex: '9999', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    onclick: (e) => { if (e.target === overlay) overlay.remove(); },
  });

  overlay.appendChild(
    el('div', {
      style: {
        background: 'var(--card, #fff)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '16px 18px', maxWidth: '340px', width: '90%',
        boxShadow: '0 8px 24px rgba(0,0,0,.18)',
      },
    }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } }, [
        el('span', { class: 'icon', style: { color: 'var(--warning, #D4A015)' }, html: icon('info', 18) }),
        el('div', { style: { fontWeight: '700', fontSize: '13px' } }, 'Duplicate name'),
      ]),
      el('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: '1.5' } },
        `${message}. Do you want to proceed anyway?`
      ),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px' } }, [
        el('button', { class: 'btn btn-sm', onclick: () => overlay.remove() }, 'Cancel'),
        el('button', {
          class: 'btn btn-primary btn-sm',
          onclick: () => { overlay.remove(); onProceed(); },
        }, 'Proceed'),
      ]),
    ])
  );

  document.body.appendChild(overlay);
}

// ─── Tag picker ──────────────────────────────────────────────────────

function renderTagPicker() {
  const wrap = el('div', { class: 'tag-picker', style: { marginTop: '4px' } });
  const chipsWrap = el('div', { class: 'tag-chips' });
  const input = el('input', {
    class: 'tag-input-inline',
    placeholder: (wizState.tags || []).length === 0 ? 'Add tags...' : '',
    oninput: () => refreshDropdown(),
    onfocus: () => refreshDropdown(),
    onblur: () => setTimeout(() => closeDropdown(), 150),
    onkeydown: (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        e.preventDefault();
        addTag(input.value.trim());
      } else if (e.key === 'Backspace' && !input.value && (wizState.tags || []).length > 0) {
        removeTag(wizState.tags[wizState.tags.length - 1]);
      } else if (e.key === 'Escape') {
        closeDropdown();
        input.blur();
      }
    },
  });

  let dropdown = null;

  function collectExistingTags() {
    const cats = state.get('catalogues') || [];
    const secs = state.get('sections') || [];
    const tags = new Set();
    for (const c of cats) (c.tags || []).forEach(t => tags.add(t));
    for (const s of secs) (s.tags || []).forEach(t => tags.add(t));
    // Also collect tags from variables
    const vars = state.get('variables') || [];
    for (const v of vars) (v.tags || []).forEach(t => tags.add(t));
    return [...tags].sort();
  }

  function addTag(tag) {
    if (!wizState.tags) wizState.tags = [];
    if (!wizState.tags.includes(tag)) {
      wizState.tags.push(tag);
    }
    input.value = '';
    input.placeholder = '';
    renderChips();
    closeDropdown();
  }

  function removeTag(tag) {
    wizState.tags = (wizState.tags || []).filter(t => t !== tag);
    if (wizState.tags.length === 0) input.placeholder = 'Add tags...';
    renderChips();
  }

  function renderChips() {
    // Remove existing chips (keep input)
    chipsWrap.querySelectorAll('.tag-chip').forEach(c => c.remove());
    (wizState.tags || []).forEach(tag => {
      const chip = el('span', { class: 'tag-chip' }, [
        tag,
        el('span', { class: 'tag-chip-x', onclick: (e) => { e.stopPropagation(); removeTag(tag); } }, '\u00d7'),
      ]);
      chipsWrap.insertBefore(chip, input);
    });
  }

  function refreshDropdown() {
    closeDropdown();
    const query = input.value.trim().toLowerCase();
    const allTags = collectExistingTags();
    const currentTags = new Set(wizState.tags || []);
    const available = allTags.filter(t => !currentTags.has(t) && (!query || t.toLowerCase().includes(query)));

    dropdown = el('div', { class: 'tag-dropdown' });

    if (available.length === 0 && !query) {
      dropdown.appendChild(el('div', { class: 'tag-dropdown-empty' }, 'Type to create a new tag'));
    } else {
      available.forEach(tag => {
        dropdown.appendChild(el('div', {
          class: 'tag-dropdown-item',
          onmousedown: (e) => { e.preventDefault(); addTag(tag); },
        }, [
          el('span', { class: 'icon', html: icon('tag', 10) }),
          tag,
        ]));
      });
    }

    // Show "Create new" option if query doesn't match existing
    if (query && !allTags.some(t => t.toLowerCase() === query) && !currentTags.has(query)) {
      dropdown.appendChild(el('div', {
        class: 'tag-dropdown-item tag-dd-create',
        onmousedown: (e) => { e.preventDefault(); addTag(input.value.trim()); },
      }, [
        el('span', { class: 'icon', html: icon('plus', 10) }),
        `Create "${input.value.trim()}"`,
      ]));
    }

    if (dropdown.children.length > 0) wrap.appendChild(dropdown);
  }

  function closeDropdown() {
    if (dropdown && dropdown.parentNode) dropdown.remove();
    dropdown = null;
  }

  renderChips();
  chipsWrap.appendChild(input);
  chipsWrap.addEventListener('click', () => input.focus());
  wrap.appendChild(chipsWrap);
  return wrap;
}

// ─── Utilities ───────────────────────────────────────────────────────

function clearErr() { const e = qs('#wiz-err'); if (e) e.style.display = 'none'; }
function findField(rec, name) { const k = Object.keys(rec).find(k => k.toLowerCase() === name.toLowerCase()); return k ? rec[k] : undefined; }
function shortCol(name) { return name.replace(/^jde/, '').replace(/([A-Z])/g, ' $1').trim().substring(0, 12); }
function trunc(s, m) { return s && s.length > m ? s.substring(0, m) + '…' : s || ''; }
function fmtNum(v) { const n = parseFloat(v); if (isNaN(n)) return v; return n > 100 ? '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(n); }

async function handleSave(skipDupeCheck) {
  const vars = state.get('variables') || [];
  const nameVal = wizState.name || `#${(qs('#wiz-name')?.value || '').replace(/^#/, '')}`;
  wizState.name = nameVal;

  // Validate name — scoped to catalogue
  // In edit mode, if the name hasn't changed from the original, skip the duplicate check
  // (only run format validation). This prevents false "duplicate" warnings when simply
  // saving an existing variable without renaming it.
  const nameUnchanged = wizState.isEditMode && wizState.existingVariable && nameVal === wizState.existingVariable.name;
  const otherVars = wizState.isEditMode ? vars.filter(v => String(v.id) !== String(wizState.id)) : vars;
  const result = nameUnchanged
    ? validateName(nameVal, [], null, wizState.catalogueId)  // format-only: no duplicate scope
    : validateName(nameVal, otherVars, wizState.isEditMode ? wizState.id : null, wizState.catalogueId);
  if (result) {
    const errEl = qs('#wiz-err');
    if (typeof result === 'object' && result.level === 'warn') {
      // Warning — allow proceed via dialog
      if (!skipDupeCheck) {
        showDuplicateWarningDialog(result.message, () => handleSave(true));
        return;
      }
      // User confirmed — continue past the warning
    } else {
      // Hard error
      if (errEl) { errEl.textContent = result; errEl.className = 'wiz-err'; errEl.style.display = ''; }
      return;
    }
  }

  // Config type is stored as 'single' (the template engine treats it the same)
  if (wizState.type === 'config') wizState.type = 'single';

  // Resolve cpContext from the current source definition
  const srcDef = wizState.bomSources.find(s => s.expression === wizState.source || s.name === wizState.source);
  wizState.cpContext = srcDef?.cpContext || null;

  // Catch-all exclude list
  if (wizState.catchAll) wizState.excludeVars = vars.filter(v => v.type === 'bom' && !v.catchAll && v.id !== wizState.id).map(v => v.name);

  // Compute match count for BOM
  if (wizState.type === 'bom' && wizState.bomRecords.length > 0) {
    if (wizState.catchAll) {
      const others = vars.filter(v => v.type === 'bom' && !v.catchAll && v.id !== wizState.id);
      const excl = new Set();
      others.forEach(v => { wizState.bomRecords.forEach((r, i) => { if (matchesFilters(r, v.filters, v.filterLogic)) excl.add(i); }); });
      wizState.matchCount = wizState.bomRecords.length - excl.size;
    } else if (wizState.filters.length > 0) {
      wizState.matchCount = wizState.bomRecords.filter(r => matchesFilters(r, wizState.filters, wizState.filterLogic)).length;
    } else wizState.matchCount = wizState.bomRecords.length;
  }

  if (wizState.isEditMode) {
    // ── Document write-back flow (shared) ──
    // Build document-facing search candidates (handles blocks, defines, inlines)
    const oldSearchExprs = buildDocSearchExpressions(wizState.existingVariable || {});
    const newSearchExprs = buildDocSearchExpressions(wizState);
    const newDocExpr = newSearchExprs[0] || generateExpression(wizState);
    const immediate = await runDocUpdateFlow(
      oldSearchExprs.length > 0 ? oldSearchExprs : (wizState.existingVariable?.expression || ''),
      newDocExpr,
      wizState.name,
      commitWizardSave,
    );
    if (!immediate) return; // overlay shown — save deferred to user action
  } else {
    // ── Create + insert-at-cursor flow ──
    await createVariable(wizState);
    const newSearchExprs = buildDocSearchExpressions(wizState);
    const newDocExpr = newSearchExprs[0] || generateExpression(wizState);

    if (window.Word && newDocExpr) {
      // Offer to insert the new expression into the document
      showDocUpdateOverlay({
        message: 'Dataset created. Insert the expression into the document at the cursor position?',
        oldExpr: '(new)',
        newExpr: newDocExpr,
        onUpdate: async () => {
          await insertTextAtCursor(newDocExpr, wizState.name);
          state.set('activeVariable', null);
          state.set('dataView', 'list');
        },
        onSkip: () => {
          state.set('activeVariable', null);
          state.set('dataView', 'list');
        },
      });
      return;
    }

    state.set('activeVariable', null);
    state.set('dataView', 'list');
  }
}

/** Persist wizard changes and navigate back. */
async function commitWizardSave() {
  const overlay = document.querySelector('#doc-update-overlay');
  if (overlay) overlay.remove();

  const fromResolver = state.get('editOrigin') === 'resolver';
  state.set('editOrigin', null);

  await updateVariable(wizState.id, wizState);
  state.set('activeVariable', null);
  state.set('dataView', 'list');

  // If we came from the expression resolver, reset the selection cache
  // so the selection listener re-fires and the resolver panel re-opens
  if (fromResolver) {
    resetSelectionCache();
  }
}

// showDocUpdateOverlay is now imported from ./doc-update.js

async function handleDelete() {
  const check = canDeleteVariable(wizState.id);
  if (!check.ok) {
    // Show validation overlay with usages
    const details = (check.usages || []).map(u => `${u.name} (${u.type})`);
    showInfoDialog('Cannot delete dataset', check.reason, details);
    return;
  }
  if (!confirm(`Delete dataset "${wizState.name}"? This cannot be undone.`)) return;
  await removeVariable(wizState.id);
  state.set('activeVariable', null);
  state.set('dataView', 'list');
}

// Validation dialog — now uses shared showInfoDialog from core/dialog.js
