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
  canDeleteVariable,
} from '../../services/variables.js';
import {
  isConnected, fetchBomRecords, fetchRecords, getBomFields, getBomFieldValues,
  getBomSources, fetchModel, getStartingObject,
  describeObjectWithData, resolveCurrentObject,
  getExplorerFavorites, toggleExplorerFavorite,
} from '../../services/data-api.js';
import { wizState, resetWiz } from './wizard-state.js';
import { renderBomSection, setRefreshPipelineCallback as setBomRefresh, TRANSFORM_TYPES, buildTransformSyntax, refreshMatchPreview } from './wizard-bom.js';
import { loadObjectExplorer, setRefreshPipelineCallback as setObjectRefresh, buildPath } from './wizard-object.js';
import { loadConfigExplorer, setRefreshPipelineCallback as setConfigRefresh, resetConfigExplorer, resolveConfigAttrAcrossCPs } from './wizard-config-explorer.js';

// ─── Custom dropdown (replaces native <select> for consistent styling) ──

function makeCustomDropdown(placeholder, options, opts = {}) {
  const wrap = el('div', { class: 'cdd', style: { flex: opts.flex || '1', minWidth: opts.minWidth || '0', position: 'relative' } });
  wrap._value = '';

  const trigger = el('button', { class: 'cdd-trigger', type: 'button' }, [
    el('span', { class: `cdd-label${opts.mono ? ' cdd-mono' : ''}` }, placeholder),
    el('span', { class: 'cdd-arrow', html: icon('chevronDown', 10) }),
  ]);
  wrap.appendChild(trigger);

  const menu = el('div', { class: 'cdd-menu' });
  for (const opt of options) {
    const item = el('div', { class: 'cdd-item' }, [
      opts.mono ? el('span', { class: 'cdd-mono' }, opt.label) : opt.label,
    ]);
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      wrap._value = opt.value;
      trigger.querySelector('.cdd-label').textContent = opt.label;
      trigger.querySelector('.cdd-label').classList.add('cdd-selected');
      menu.classList.remove('cdd-open');
      trigger.classList.remove('cdd-active');
      if (wrap._onChange) wrap._onChange(opt.value);
    });
    menu.appendChild(item);
  }
  wrap.appendChild(menu);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close any other open dropdowns
    document.querySelectorAll('.cdd-menu.cdd-open').forEach(m => { if (m !== menu) { m.classList.remove('cdd-open'); m.previousElementSibling?.classList.remove('cdd-active'); } });
    menu.classList.toggle('cdd-open');
    trigger.classList.toggle('cdd-active');
  });

  // Close on outside click
  const closeHandler = (e) => { if (!wrap.contains(e.target)) { menu.classList.remove('cdd-open'); trigger.classList.remove('cdd-active'); } };
  document.addEventListener('click', closeHandler);

  return wrap;
}

// ─── Purpose selector ────────────────────────────────────────────────

function renderPurposeSelector() {
  const purposes = [
    { key: 'block',    label: 'Block', icon: 'box',    desc: '$for{}$ / $rowgroup{}$' },
    { key: 'variable', label: 'Variable',  icon: 'target', desc: 'Inline ${}$ value' },
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
          if (!wizState.isEditMode) switchTypeView();
          updateTypeSelector();
        }
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
    const typeMap = { 'BOM': 'bom', 'Object': 'object', 'Single': 'single', 'List': 'list' };
    o.classList.toggle('type-pill-sel', typeMap[label] === wizState.type);
  });
}

/** Update the purpose selector visuals to reflect current wizState.purpose. */
function updatePurposeSelector() {
  const sel = qs('#wiz-purpose-sel');
  if (!sel) return;
  const pills = sel.querySelectorAll('.purpose-pill');
  const purposeMap = { 'Block': 'block', 'Variable': 'variable' };
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
    ? 'Edit Data Set'
    : catName ? `New data set in ${catName}` : 'New Data Set';
  container.appendChild(
    el('div', { class: 'wiz-header' }, [
      el('span', { class: 'icon', style: { color: 'var(--tacton-blue)' }, html: icon(wizState.isEditMode ? 'edit' : 'plus', 16) }),
      el('div', { class: 'wiz-header-title' }, headerLabel),
    ])
  );

  // Guide text — only for new data sets
  if (!wizState.isEditMode) {
    container.appendChild(
      el('div', { class: 'wiz-guide' },
        'Give your data set a name and pick what kind of data it represents, then connect it to a source — a BOM, an object path, or a list of values. When you\'re done, drag it straight into your Word template.'
      )
    );
  }

  // ── Expression preview (always visible above tabs, builds progressively) ──
  container.appendChild(el('div', { id: 'wiz-selected-source' }));
  updateSelectedSource();

  // ── Tab bar: Classification | Source | Transformation — all required ──
  container.appendChild(renderTabBar());

  // ── Tab 1: Classification ──
  const classPanel = el('div', { id: 'wiz-tab-classify', class: 'wiz-tab-panel', style: { display: activeTab === 'classify' ? '' : 'none' } });

  // ─ Name (primary — always first) ─
  classPanel.appendChild(el('div', { class: 'wiz-card' }, [
    el('div', { class: 'wiz-card-label' }, 'Name'),
    el('div', { class: 'wiz-name-row' }, [
      el('span', { class: 'wiz-name-hash' }, '#'),
      el('input', {
        class: 'input', id: 'wiz-name',
        value: wizState.name ? wizState.name.replace(/^#/, '') : '',
        placeholder: 'e.g. pump, accessories, skidItems',
        oninput: (e) => {
          // Strip spaces — not allowed in variable names
          e.target.value = e.target.value.replace(/\s/g, '');
          wizState.name = `#${e.target.value.replace(/^#/, '')}`;
          clearErr();
          refreshPipeline();
        },
      }),
    ]),
    el('div', { id: 'wiz-err', class: 'wiz-err', style: { display: 'none' } }),
  ]));

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
  const sourcePanel = el('div', { id: 'wiz-tab-source', class: 'wiz-tab-panel', style: { display: activeTab === 'source' ? '' : 'none' } });
  sourcePanel.appendChild(el('div', { id: 'wiz-bom-section', style: { display: wizState.type === 'bom' ? '' : 'none' } }));
  sourcePanel.appendChild(el('div', { id: 'wiz-source-toggle', style: { display: wizState.type === 'single' ? '' : 'none' } }));
  sourcePanel.appendChild(el('div', { id: 'wiz-obj-section', style: { display: (wizState.type === 'object' || wizState.type === 'single') ? '' : 'none' } }));
  sourcePanel.appendChild(el('div', { id: 'wiz-list-section', style: { display: wizState.type === 'list' ? '' : 'none' } }));
  sourcePanel.appendChild(el('div', { id: 'wiz-define-section', style: { display: wizState.type === 'define' ? '' : 'none' } }));
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

  if (isConnected()) {
    bomSection.innerHTML = `<div class="obj-empty">${icon('loader', 14)} Loading data...</div>`;
    try {
      const [sources, fields, records, model, favs] = await Promise.all([
        getBomSources(), getBomFields(), fetchBomRecords(), fetchModel(), getExplorerFavorites(),
      ]);
      wizState.bomSources = sources; wizState.bomFields = fields; wizState.bomRecords = records;
      wizState.modelObjects = model || []; wizState.explorerFavs = favs;
      // Only set default BOM source for new BOM variables, not when editing or for other types
      if (!wizState.isEditMode && wizState.type === 'bom' && sources.length > 0) {
        wizState.source = sources[0].expression || sources[0].name;
      }
    } catch (e) { console.error('[wizard] Boot:', e); }
  }

  // Render the active type section
  if (wizState.type === 'bom') {
    renderBomSection(bomSection);
  } else if (wizState.type === 'single' && wizState._singleSourceMode === 'config') {
    loadConfigExplorer();
  } else if (wizState.type === 'object' || wizState.type === 'single') {
    loadObjectExplorer();
  } else if (wizState.type === 'list') {
    renderListSection(qs('#wiz-list-section'));
  } else if (wizState.type === 'define') {
    renderDefineSection(qs('#wiz-define-section'));
  } else if (wizState.type === 'code') {
    renderCodeSection(qs('#wiz-code-section'));
  }
  refreshPipeline();

  // Pre-load drawer records for edit mode (already have a source configured)
  if (wizState.source && (wizState.type === 'object' || wizState.type === 'single')) {
    if (wizState._singleSourceMode === 'config' && wizState._selectedConfigPath) {
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
    else if (t.key === 'list') wizState.source = '{""}';
    else wizState.source = '';

    const autoPurpose = (t.key === 'single' || t.key === 'list' || t.key === 'define' || t.key === 'code') ? 'variable' : 'block';
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
          showWizConfirmDialog(
            'Change data set type?',
            'This will reset the source, filters, and transforms for this data set. This cannot be undone.',
            'Change type',
            () => applyTypeChange(t, opt)
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

/** Confirmation dialog within the wizard overlay. */
function showWizConfirmDialog(title, message, confirmLabel, onConfirm) {
  const existing = document.getElementById('wiz-confirm-overlay');
  if (existing) existing.remove();

  const overlay = el('div', {
    id: 'wiz-confirm-overlay',
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
        el('div', { style: { fontWeight: '700', fontSize: '13px' } }, title),
      ]),
      el('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: '1.5' } }, message),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px' } }, [
        el('button', { class: 'btn btn-outline btn-sm', onclick: () => overlay.remove() }, 'Cancel'),
        el('button', {
          class: 'btn btn-sm',
          style: { background: 'var(--warning, #D4A015)', color: '#fff', border: 'none' },
          onclick: () => { overlay.remove(); onConfirm(); },
        }, confirmLabel),
      ]),
    ])
  );

  document.body.appendChild(overlay);
}

function switchTypeView() {
  const bom = qs('#wiz-bom-section'), obj = qs('#wiz-obj-section'), lst = qs('#wiz-list-section');
  const def = qs('#wiz-define-section'), code = qs('#wiz-code-section');
  const isObjLike = wizState.type === 'object' || wizState.type === 'single';
  if (bom) bom.style.display = wizState.type === 'bom' ? '' : 'none';
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
      if (wizState.type === 'single' && wizState._singleSourceMode === 'config') {
        loadConfigExplorer();
      } else {
        loadObjectExplorer();
      }
    }
  }
  if (lst) { lst.style.display = wizState.type === 'list' ? '' : 'none'; renderListSection(lst); }
  if (def) { def.style.display = wizState.type === 'define' ? '' : 'none'; renderDefineSection(def); }
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
//  DEFINE SECTION (Source tab — linked define picker)
// ═════════════════════════════════════════════════════════════════════

function renderDefineSection(container) {
  if (!container) return;
  clear(container);

  // Get all existing define-type variables (potential sources)
  const allVars = state.get('variables') || [];
  const defineSourceVars = allVars.filter(v =>
    v.name && v.name !== wizState.name && v.purpose === 'variable'
  );

  // Source define picker
  const sourceSelect = el('select', {
    class: 'input',
    style: { fontSize: '12px' },
    onchange: (e) => {
      wizState.sourceDefine = e.target.value;
      // Find and cache the original source of the selected define
      const refVar = allVars.find(v => v.name === e.target.value);
      wizState.sourceDefineSource = refVar?.source || '';
      wizState.source = e.target.value;
      refreshPipeline();
    },
  });
  sourceSelect.appendChild(el('option', { value: '' }, '— Select a define —'));

  defineSourceVars.forEach(v => {
    const opt = el('option', { value: v.name }, `${v.name}  (${v.type})`);
    if (v.name === wizState.sourceDefine) opt.selected = true;
    sourceSelect.appendChild(opt);
  });

  container.appendChild(el('div', { class: 'form-group' }, [
    el('div', { class: 'form-label' }, [el('span', { class: 'icon', style: { color: 'var(--purple, #8250DF)' }, html: icon('link', 12) }), 'Source define']),
    sourceSelect,
    el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' } },
      'Select another define variable to use as the source. The accessor and null-safe transforms let you extract a value from it.'),
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

  // Accessor picker
  const accessors = [
    { value: '.value', label: '.value — raw value' },
    { value: '.valueDescription', label: '.valueDescription — display text' },
    { value: '.price(0)', label: '.price(0) — price' },
  ];

  const currentAccessor = wizState.transforms.find(t => t.type === 'accessor');

  const accSelect = el('select', {
    class: 'input',
    style: { fontSize: '12px', marginTop: '8px' },
    onchange: (e) => {
      const val = e.target.value;
      const others = wizState.transforms.filter(t => t.type !== 'accessor');
      if (val) {
        others.push({ type: 'accessor', method: val });
      }
      wizState.transforms = others;
      refreshPipeline();
    },
  });
  accSelect.appendChild(el('option', { value: '' }, '— No accessor —'));
  accessors.forEach(a => {
    const opt = el('option', { value: a.value }, a.label);
    if (currentAccessor?.method === a.value) opt.selected = true;
    accSelect.appendChild(opt);
  });

  container.appendChild(el('div', { class: 'form-group', style: { marginTop: '10px' } }, [
    el('div', { class: 'form-label' }, [el('span', { class: 'icon', html: icon('chevronRight', 12) }), 'Accessor']),
    accSelect,
  ]));

  // Null-safe toggle
  const currentNullSafe = wizState.transforms.find(t => t.type === 'nullSafe');

  const nsCheck = el('input', {
    type: 'checkbox',
    checked: !!currentNullSafe,
    onchange: (e) => {
      const others = wizState.transforms.filter(t => t.type !== 'nullSafe');
      if (e.target.checked) {
        others.push({ type: 'nullSafe', fallback: fallbackInput.value || 'N/A' });
      }
      wizState.transforms = others;
      refreshPipeline();
    },
  });

  const fallbackInput = el('input', {
    class: 'input',
    style: { fontSize: '11px', width: '80px', marginLeft: '8px' },
    value: currentNullSafe?.fallback || 'N/A',
    placeholder: 'N/A',
    oninput: (e) => {
      const ns = wizState.transforms.find(t => t.type === 'nullSafe');
      if (ns) { ns.fallback = e.target.value; refreshPipeline(); }
    },
  });

  container.appendChild(el('div', { class: 'form-group', style: { marginTop: '10px' } }, [
    el('div', { class: 'form-label' }, [el('span', { class: 'icon', html: icon('shield', 12) }), 'Null-safe wrapper']),
    el('label', { class: 'wiz-define-ns-row' }, [
      nsCheck,
      el('span', {}, 'Generate two-define null-safe pattern'),
      fallbackInput,
    ]),
    el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' } },
      'Produces $define{#nameV=source}$ + $define{#name=(check) ? value: "fallback"}$'),
  ]));
}


// ═════════════════════════════════════════════════════════════════════
//  RAW SECTION (Source tab — free-form expression editor)
// ═════════════════════════════════════════════════════════════════════

/**
 * WYSIWYG Code Editor — contentEditable surface where #define references
 * render as colored inline chips. Users can type freely or insert defines
 * from a picker dropdown. The underlying wizState.source stays as plain text.
 */

function renderCodeSection(container) {
  if (!container) return;
  clear(container);

  const allVars = state.get('variables') || [];
  const allNames = new Set(allVars.map(v => v.name));
  const insertableVars = allVars.filter(v => v.name && v.name !== wizState.name && v.purpose === 'variable');

  // Look up pre-computed validation results from the list view (stored in state)
  const valResults = state.get('validationResults') || {};

  function getRefStatus(refName) {
    const refVar = allVars.find(v => v.name === refName);
    if (!refVar) return { status: 'missing', tooltip: `"${refName}" does not exist`, cls: 'wiz-code-chip-missing' };
    // Use pre-computed result from the list (has live data context)
    const result = valResults[refVar.id];
    if (!result || result.status === 'unchecked') {
      return { status: 'unchecked', tooltip: `${refName}: not verified — connect to validate`, cls: '' };
    }
    if (result.status === 'error') {
      return { status: 'error', tooltip: `${refName}: ${result.issues.map(i => i.message).join('; ')}`, cls: 'wiz-code-chip-error' };
    }
    if (result.status === 'warning') {
      return { status: 'warning', tooltip: `${refName}: ${result.issues.map(i => i.message).join('; ')}`, cls: 'wiz-code-chip-warn' };
    }
    return { status: 'valid', tooltip: `${refName}: valid`, cls: 'wiz-code-chip-valid' };
  }

  // ── Toolbar ──
  const defineSelect = el('select', { class: 'wiz-code-insert-select' });
  defineSelect.appendChild(el('option', { value: '' }, '+ Insert define…'));
  insertableVars.forEach(v => {
    defineSelect.appendChild(el('option', { value: v.name }, `${v.name}  (${v.type})`));
  });

  const toolbar = el('div', { class: 'wiz-code-toolbar' }, [
    el('div', { class: 'form-label', style: { margin: 0 } }, [
      el('span', { class: 'icon', style: { color: 'var(--text-tertiary)' }, html: icon('code', 12) }),
      'Expression',
    ]),
    defineSelect,
  ]);

  // ── Editable surface ──
  const editor = el('div', {
    class: 'wiz-code-editor',
    contentEditable: 'true',
    spellcheck: 'false',
  });

  // Render source text → mixed HTML with chips colored by validation status
  function sourceToHTML(src) {
    if (!src) return '<span class="wiz-code-placeholder">e.g. (#totalWeight-0)-(#pumpWeight-0)</span>';
    return src.replace(/#\w+/g, (match) => {
      const ref = getRefStatus(match);
      const tip = ref.tooltip.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      return `<span class="wiz-code-chip ${ref.cls}" contenteditable="false" data-define="${match}" data-tip="${tip}">${match}</span>`;
    });
  }

  // Extract plain text from editor DOM (chips → their data-define text)
  function editorToSource() {
    let text = '';
    for (const node of editor.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.dataset && node.dataset.define) {
          text += node.dataset.define;
        } else if (node.classList && node.classList.contains('wiz-code-placeholder')) {
          // Skip placeholder
        } else {
          text += node.textContent;
        }
      }
    }
    return text;
  }

  // Set initial content
  editor.innerHTML = sourceToHTML(wizState.source || '');

  // ── Floating tooltip for chips (escapes editor overflow) ──
  let chipTip = null;
  editor.addEventListener('mouseover', (e) => {
    const chip = e.target.closest('.wiz-code-chip[data-tip]');
    if (!chip) return;
    if (chipTip) chipTip.remove();
    chipTip = el('div', { class: 'wiz-chip-tooltip' }, chip.dataset.tip);
    document.body.appendChild(chipTip);
    const rect = chip.getBoundingClientRect();
    chipTip.style.left = `${rect.left}px`;
    chipTip.style.top = `${rect.top - chipTip.offsetHeight - 6}px`;
    // Flip below if off-screen top
    if (rect.top - chipTip.offsetHeight - 6 < 4) {
      chipTip.style.top = `${rect.bottom + 6}px`;
    }
  });
  editor.addEventListener('mouseout', (e) => {
    const chip = e.target.closest('.wiz-code-chip');
    if (chip && chipTip) { chipTip.remove(); chipTip = null; }
  });

  // Sync on input
  editor.addEventListener('input', () => {
    wizState.source = editorToSource();
    refreshPipeline();
    renderCodeRefs(refsContainer);
  });

  // Prevent Enter from creating divs — insert newline text node instead
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
    }
  });

  // Focus handler — clear placeholder
  editor.addEventListener('focus', () => {
    const ph = editor.querySelector('.wiz-code-placeholder');
    if (ph) { editor.innerHTML = ''; }
  });

  // Blur handler — show placeholder if empty
  editor.addEventListener('blur', () => {
    if (!editorToSource().trim()) {
      editor.innerHTML = sourceToHTML('');
    }
  });

  // Insert define from dropdown
  defineSelect.addEventListener('change', () => {
    const val = defineSelect.value;
    if (!val) return;
    defineSelect.value = '';

    // Remove placeholder if present
    const ph = editor.querySelector('.wiz-code-placeholder');
    if (ph) editor.innerHTML = '';

    // Insert chip at cursor (or end) — colored by validation status
    const ref = getRefStatus(val);
    const chip = el('span', {
      class: `wiz-code-chip ${ref.cls}`,
      contentEditable: 'false',
      'data-define': val,
      'data-tip': ref.tooltip,
    }, val);

    const sel = window.getSelection();
    if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(chip);
      // Move cursor after chip
      range.setStartAfter(chip);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.appendChild(chip);
    }

    wizState.source = editorToSource();
    refreshPipeline();
    renderCodeRefs(refsContainer);
    editor.focus();
  });

  container.appendChild(el('div', { class: 'form-group' }, [
    toolbar,
    editor,
    el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' } },
      'Visual expression editor — type freely or insert defines as blocks. Supports arithmetic, ternary, and template syntax.'),
  ]));

  // ── Referenced defines list ──
  const refsContainer = el('div', { class: 'wiz-code-refs' });
  renderCodeRefs(refsContainer);
  container.appendChild(refsContainer);
}

function renderCodeRefs(container) {
  if (!container) return;
  clear(container);

  const source = wizState.source || '';
  const refs = [...new Set((source.match(/#\w+/g) || []))];
  if (refs.length === 0) return;

  const allVars = state.get('variables') || [];
  const valResults = state.get('validationResults') || {};

  container.appendChild(el('div', { class: 'form-label', style: { marginTop: '8px' } }, [
    el('span', { class: 'icon', html: icon('link', 12) }),
    `Referenced defines (${refs.length})`,
  ]));

  const statusIcons = { valid: 'check', unchecked: 'check', warning: 'alertTriangle', error: 'info', missing: 'alertTriangle' };
  const statusColors = {
    valid: 'var(--success, #1A7F37)',
    unchecked: 'var(--text-tertiary, #8b949e)',
    warning: 'var(--warning, #D4A015)',
    error: 'var(--danger, #CF222E)',
    missing: 'var(--danger, #CF222E)',
  };

  const list = el('div', { class: 'wiz-code-ref-list' });
  refs.forEach(refName => {
    const refVar = allVars.find(v => v.name === refName);
    let status, detail;
    if (!refVar) {
      status = 'missing';
      detail = 'not found';
    } else {
      // Use pre-computed validation from list view (has live data context)
      const result = valResults[refVar.id];
      if (!result) {
        status = 'unchecked';
        detail = 'not verified';
      } else {
        status = result.status;
        detail = result.issues.length > 0
          ? result.issues.map(i => i.message).join('; ')
          : result.status === 'valid' ? 'verified' : 'not verified';
      }
    }

    list.appendChild(el('div', {
      class: `wiz-code-ref-item`,
      style: { color: statusColors[status] },
      'data-tip': detail,
    }, [
      el('span', { class: 'icon', html: icon(statusIcons[status], 11) }),
      el('code', {}, refName),
      status !== 'valid' && status !== 'unchecked'
        ? el('span', { class: 'wiz-code-ref-warn', style: { color: statusColors[status] } }, detail)
        : null,
    ]));
  });
  container.appendChild(list);
}


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
    });
  } else if ((wizState.type === 'object' || wizState.type === 'single') && wizState.objectPath.length > 0) {
    // Progressive: build partial expression from current dot-walk path
    const partialPath = buildPath(); // no leaf → just the path so far
    const name = wizState.name || '#…';
    const wrapper = wizState.purpose === 'block' ? '$for' : (wizState.type === 'single' ? '$define' : '$');
    expr = `${wrapper}{${name}=${partialPath}.…}$`;
  }

  const hasContent = hasSource || expr;
  const stateClass = hasSource ? '' : (hasContent ? 'obj-selected-progress' : 'obj-selected-empty');

  wrap.appendChild(el('div', { class: `obj-selected-source ${stateClass}` }, [
    el('span', { class: 'icon', html: icon(hasSource ? 'check' : 'code', 12) }),
    el('span', { class: 'obj-selected-expr' }, expr || 'Expression builds here as you configure…'),
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
  _drawerLoadAttempted = false; // allow fresh auto-load on source change
  // Clear stale drawer records when source changes (config or object)
  if (wizState.type === 'single' && wizState._singleSourceMode === 'config') {
    wizState.objectRecords = [];
  }
  updateSelectedSource();
  updateDrawerBar();
}

const DRAWER_PAGE_SIZE = 15;

// ─── Shared data table renderer ─────────────────────────────────────
//
// Used by both the drawer and the expression-detection banner to render
// the same paginated table with column visibility support.

/**
 * Render a paginated data table into a container element.
 * @param {HTMLElement} container - Where to append the table
 * @param {Object[]} records - Data records
 * @param {string[]} visibleCols - Columns to show
 * @param {Object} [opts] - Options: pageSize, page, maxCellLen, onPageChange
 * @returns {{ totalPages: number }} metadata
 */
function renderSharedDataTable(container, records, visibleCols, opts = {}) {
  const pageSize = opts.pageSize || DRAWER_PAGE_SIZE;
  const page = opts.page || 0;
  const maxCellLen = opts.maxCellLen || 35;

  if (records.length === 0 || visibleCols.length === 0) {
    container.appendChild(el('div', { class: 'data-drawer-empty', style: { padding: '12px' } }, [
      el('span', { class: 'icon', html: icon('table', 16) }),
      el('div', {}, records.length === 0 ? 'No records' : 'No columns selected'),
    ]));
    return { totalPages: 0 };
  }

  const totalPages = Math.ceil(records.length / pageSize);
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const pageRecords = records.slice(start, start + pageSize);

  const table = el('table', { class: 'data-drawer-table' });
  const thead = el('tr');
  visibleCols.forEach(c => thead.appendChild(el('th', {}, c)));
  table.appendChild(thead);

  pageRecords.forEach(rec => {
    const tr = el('tr');
    visibleCols.forEach(c => {
      const val = rec[c];
      const display = val == null ? '' : String(val);
      tr.appendChild(el('td', { title: display },
        display.length > maxCellLen ? display.substring(0, maxCellLen) + '…' : display));
    });
    table.appendChild(tr);
  });

  container.appendChild(table);

  // Pagination row
  if (totalPages > 1 && opts.onPageChange) {
    const pagRow = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '4px 0', fontSize: '10px', color: 'var(--text-tertiary)' } });
    pagRow.appendChild(el('button', {
      class: 'btn btn-sm', style: { padding: '1px 6px' },
      disabled: safePage === 0 || undefined,
      onclick: () => opts.onPageChange(safePage - 1),
      html: icon('chevronLeft', 10),
    }));
    pagRow.appendChild(el('span', {}, `${start + 1}–${Math.min(start + pageSize, records.length)} of ${records.length}`));
    pagRow.appendChild(el('button', {
      class: 'btn btn-sm', style: { padding: '1px 6px' },
      disabled: safePage >= totalPages - 1 || undefined,
      onclick: () => opts.onPageChange(safePage + 1),
      html: icon('chevronRight', 10),
    }));
    container.appendChild(pagRow);
  }

  return { totalPages };
}

// ─── Data Drawer (slide-up, always present) ─────────────────────────
//
// Collapsed: 30px bar at bottom — "hover to preview matched records"
// Hovered:   expands to ~50% of viewport with paginated data table
// Has two internal tabs: "Data" (the table) and "Columns" (pick visible cols)

let _drawerPage = 0;
let _drawerPinned = false;   // pinned open (click to toggle)
let _drawerTab = 'data';     // 'data' | 'columns'
let _drawerLoading = false;
let _drawerLoadAttempted = false;  // prevent infinite retry when records stay empty

/** Create the drawer DOM and append to the wizard container. */
function renderDataDrawer(parentContainer) {
  const drawer = el('div', { id: 'wiz-data-drawer', class: 'data-drawer' });

  // Collapsed bar
  const bar = el('div', { class: 'data-drawer-bar', id: 'wiz-drawer-bar' }, [
    el('span', { class: 'data-drawer-bar-icon', html: icon('table', 12) }),
    el('span', { class: 'data-drawer-bar-label', id: 'wiz-drawer-bar-label' }, 'Hover to preview matched records'),
    el('span', { class: 'data-drawer-bar-count', id: 'wiz-drawer-bar-count' }),
    el('span', { class: 'data-drawer-bar-chevron', html: icon('chevronUp', 10) }),
  ]);

  // Expanded panel
  const panel = el('div', { class: 'data-drawer-panel', id: 'wiz-drawer-panel' });

  // Panel header: tabs + pagination + pin
  const panelHeader = el('div', { class: 'data-drawer-header' }, [
    el('div', { class: 'data-drawer-tabs', id: 'wiz-drawer-tabs' }),
    el('div', { class: 'data-drawer-actions', id: 'wiz-drawer-actions' }),
  ]);
  panel.appendChild(panelHeader);

  // Panel body (table or column picker)
  panel.appendChild(el('div', { id: 'wiz-drawer-body', class: 'data-drawer-body' }));

  drawer.appendChild(bar);
  drawer.appendChild(panel);

  // ── Hover behavior ──
  drawer.addEventListener('mouseenter', () => {
    if (!_drawerPinned) drawer.classList.add('data-drawer-open');
    refreshDrawerContent();
  });
  drawer.addEventListener('mouseleave', () => {
    if (!_drawerPinned) drawer.classList.remove('data-drawer-open');
  });

  // Click bar to pin/unpin
  bar.addEventListener('click', () => {
    _drawerPinned = !_drawerPinned;
    drawer.classList.toggle('data-drawer-open', _drawerPinned);
    drawer.classList.toggle('data-drawer-pinned', _drawerPinned);
    if (_drawerPinned) refreshDrawerContent();
  });

  parentContainer.appendChild(drawer);
}

/** Get the current data set for the drawer (records + available fields). */
function getDrawerData() {
  let records = [];
  let allFields = [];

  if (wizState.type === 'bom') {
    records = wizState.bomRecords || [];
    allFields = wizState.bomFields.length > 0
      ? wizState.bomFields
      : (records.length > 0 ? Object.keys(records[0]).filter(k => !k.startsWith('_')) : []);
    // Apply filters
    if (wizState.filters.length > 0 || wizState.catchAll) {
      if (wizState.catchAll) {
        const others = (state.get('variables') || []).filter(v => v.type === 'bom' && !v.catchAll && v.id !== wizState.id);
        const excl = new Set();
        others.forEach(v => { records.forEach((r, i) => { if (matchesFilters(r, v.filters, v.filterLogic)) excl.add(i); }); });
        records = records.filter((_, i) => !excl.has(i));
      } else {
        records = records.filter(r => matchesFilters(r, wizState.filters, wizState.filterLogic));
      }
    }
  } else if (wizState.type === 'list') {
    const values = parseListValues(wizState.source);
    records = values.map((v, i) => ({ '#': i + 1, value: v }));
    allFields = ['#', 'value'];
  } else if (wizState.type === 'single' && wizState._singleSourceMode === 'config') {
    // Config attribute mode — show resolved values across all configured products
    records = wizState.objectRecords || [];
    if (records.length > 0) {
      allFields = Object.keys(records[0]).filter(k => k !== '_idx');
    } else if (wizState._selectedConfigPath) {
      allFields = ['cpDisplayId', 'solutionName', 'attribute', 'value'];
    }
  } else if (wizState.type === 'object' || wizState.type === 'single') {
    records = wizState.objectRecords || [];
    allFields = wizState.currentObjDesc?.attributes
      ? wizState.currentObjDesc.attributes.filter(a => !a.refType).map(a => a.name)
      : (records.length > 0 ? Object.keys(records[0]).filter(k => !k.startsWith('_') && k !== 'href' && k !== 'self') : []);
    if (records.length > 0 && wizState.filters.length > 0) {
      records = records.filter(r => matchesFilters(r, wizState.filters, wizState.filterLogic));
    }
  }

  // Visible columns: use user selection if set, otherwise auto-pick first 6
  const visibleCols = wizState.previewColumns.length > 0
    ? wizState.previewColumns.filter(c => allFields.includes(c))
    : allFields.slice(0, 6);

  return { records, allFields, visibleCols };
}

/** Refresh the drawer bar count badge. Called from refreshPipeline. */
function updateDrawerBar() {
  const label = qs('#wiz-drawer-bar-label');
  const count = qs('#wiz-drawer-bar-count');
  if (!label || !count) return;

  const { records } = getDrawerData();
  const hasSource = !!wizState.source && wizState.source !== '{""}';

  if (!hasSource) {
    label.textContent = 'No source configured yet';
    count.textContent = '';
    count.className = 'data-drawer-bar-count';
  } else if (records.length === 0 && !_drawerLoading) {
    label.textContent = 'Hover to preview matched records';
    count.textContent = 'No data';
    count.className = 'data-drawer-bar-count data-drawer-count-empty';
    // Auto-trigger record load for Object/Single when source is newly set
    // Guard: only trigger if we haven't already tried (prevents infinite loop)
    if ((wizState.type === 'object' || wizState.type === 'single') && isConnected() && !_drawerLoadAttempted) {
      if (wizState._singleSourceMode === 'config') {
        loadConfigDrawerRecords();
      } else {
        loadDrawerRecords();
      }
    }
  } else if (_drawerLoading) {
    label.textContent = 'Loading records…';
    count.textContent = '';
    count.className = 'data-drawer-bar-count';
  } else {
    label.textContent = 'Hover to preview matched records';
    count.textContent = `${records.length} records`;
    count.className = 'data-drawer-bar-count data-drawer-count-ok';
  }
}

/** Refresh the expanded drawer panel content. */
function refreshDrawerContent() {
  const tabs = qs('#wiz-drawer-tabs');
  const actions = qs('#wiz-drawer-actions');
  const body = qs('#wiz-drawer-body');
  if (!tabs || !body) return;

  // Tab buttons
  clear(tabs);
  const tabDefs = [
    { key: 'data', label: 'Data', icon: 'table' },
    { key: 'columns', label: 'Columns', icon: 'settings' },
  ];
  tabDefs.forEach(t => {
    tabs.appendChild(el('button', {
      class: `data-drawer-tab ${_drawerTab === t.key ? 'data-drawer-tab-active' : ''}`,
      onclick: () => { _drawerTab = t.key; refreshDrawerContent(); },
    }, [el('span', { class: 'icon', html: icon(t.icon, 11) }), t.label]));
  });

  if (_drawerTab === 'data') {
    renderDrawerDataTab(body, actions);
  } else {
    renderDrawerColumnsTab(body, actions);
  }
}

function renderDrawerDataTab(body, actions) {
  clear(body);
  if (actions) clear(actions);

  const { records, visibleCols } = getDrawerData();

  // Try to load records if empty and we have a source (only once per source)
  if (records.length === 0 && wizState.source && !_drawerLoading && !_drawerLoadAttempted) {
    if (wizState.type === 'object' || wizState.type === 'single') {
      if (wizState._singleSourceMode === 'config') {
        loadConfigDrawerRecords();
      } else {
        loadDrawerRecords();
      }
    }
    body.appendChild(el('div', { class: 'data-drawer-empty' }, [
      el('span', { class: 'icon', html: icon('table', 20) }),
      el('div', {}, _drawerLoading ? 'Loading…' : 'No matched records'),
    ]));
    return;
  }

  if (records.length === 0) {
    body.appendChild(el('div', { class: 'data-drawer-empty' }, [
      el('span', { class: 'icon', html: icon('table', 20) }),
      el('div', {}, wizState.source ? 'No matched records' : 'Configure a source to preview data'),
    ]));
    return;
  }

  if (visibleCols.length === 0) {
    body.appendChild(el('div', { class: 'data-drawer-empty' }, [
      el('span', { class: 'icon', html: icon('settings', 20) }),
      el('div', {}, 'No columns selected — switch to the Columns tab to pick fields'),
    ]));
    return;
  }

  // Pagination info in actions bar
  if (actions) {
    const totalPages = Math.ceil(records.length / DRAWER_PAGE_SIZE);
    if (totalPages > 1) {
      const start = _drawerPage * DRAWER_PAGE_SIZE;
      actions.appendChild(el('button', {
        class: 'btn btn-sm', style: { padding: '1px 6px' },
        onclick: () => { _drawerPage = Math.max(0, _drawerPage - 1); renderDrawerDataTab(body, actions); },
        disabled: _drawerPage === 0 || undefined,
        html: icon('chevronLeft', 10),
      }));
      actions.appendChild(el('span', { class: 'data-drawer-page-info' },
        `${start + 1}–${Math.min(start + DRAWER_PAGE_SIZE, records.length)} of ${records.length}`));
      actions.appendChild(el('button', {
        class: 'btn btn-sm', style: { padding: '1px 6px' },
        onclick: () => { _drawerPage = Math.min(totalPages - 1, _drawerPage + 1); renderDrawerDataTab(body, actions); },
        disabled: _drawerPage >= totalPages - 1 || undefined,
        html: icon('chevronRight', 10),
      }));
    } else {
      actions.appendChild(el('span', { class: 'data-drawer-page-info' }, `${records.length} record${records.length !== 1 ? 's' : ''}`));
    }
  }

  // Use shared data table renderer
  renderSharedDataTable(body, records, visibleCols, {
    pageSize: DRAWER_PAGE_SIZE,
    page: _drawerPage,
  });
}

function renderDrawerColumnsTab(body, actions) {
  clear(body);
  if (actions) { clear(actions); actions.appendChild(el('span', { class: 'data-drawer-page-info' }, 'Select columns for data preview')); }

  const { allFields, visibleCols } = getDrawerData();

  if (allFields.length === 0) {
    body.appendChild(el('div', { class: 'data-drawer-empty' }, [
      el('span', { class: 'icon', html: icon('settings', 20) }),
      el('div', {}, 'No fields available — load data first by configuring a source'),
    ]));
    return;
  }

  const colGrid = el('div', { class: 'data-drawer-col-grid' });
  const { records: sampleRecords } = getDrawerData();
  const firstRow = sampleRecords.length > 0 ? sampleRecords[0] : null;

  allFields.forEach(f => {
    const isActive = visibleCols.includes(f);
    // Build tooltip from first record value
    const sampleVal = firstRow ? firstRow[f] : null;
    const tipText = sampleVal != null && String(sampleVal).trim() !== ''
      ? String(sampleVal).length > 80 ? String(sampleVal).substring(0, 80) + '…' : String(sampleVal)
      : '(empty)';

    const chip = el('button', {
      class: `data-drawer-col-chip ${isActive ? 'data-drawer-col-active' : ''} col-chip-tip`,
      'data-tip': tipText,
      onclick: () => {
        if (isActive) {
          if (wizState.previewColumns.length === 0) {
            wizState.previewColumns = [...visibleCols];
          }
          wizState.previewColumns = wizState.previewColumns.filter(c => c !== f);
        } else {
          if (wizState.previewColumns.length === 0) {
            wizState.previewColumns = [...visibleCols];
          }
          wizState.previewColumns.push(f);
        }
        refreshDrawerContent();
        updateDrawerBar();
      },
    }, [
      el('span', { class: 'icon', html: icon(isActive ? 'check' : 'plus', 10) }),
      f,
    ]);
    colGrid.appendChild(chip);
  });

  // Action buttons row
  const btnRow = el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' } });

  // Hide empty columns — deselect columns where all records are null/empty
  const { records } = getDrawerData();
  if (records.length > 0) {
    btnRow.appendChild(el('button', {
      class: 'btn btn-outline btn-sm',
      onclick: () => {
        const emptyCols = allFields.filter(f =>
          records.every(r => r[f] == null || String(r[f]).trim() === '' || r[f] === 'null')
        );
        if (emptyCols.length === 0) return;
        // Initialize from current visible if in auto-select mode
        if (wizState.previewColumns.length === 0) {
          wizState.previewColumns = [...visibleCols];
        }
        wizState.previewColumns = wizState.previewColumns.filter(c => !emptyCols.includes(c));
        refreshDrawerContent();
        updateDrawerBar();
      },
    }, [el('span', { class: 'icon', html: icon('x', 10) }), 'Hide empty']));
  }

  // Reset button
  btnRow.appendChild(el('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => {
      wizState.previewColumns = [];
      refreshDrawerContent();
    },
  }, 'Reset to auto-select'));

  body.appendChild(colGrid);
  body.appendChild(btnRow);

  // After layout: flip tooltips on the first row so they point downward (not clipped)
  requestAnimationFrame(() => {
    const chips = colGrid.querySelectorAll('.col-chip-tip');
    if (chips.length === 0) return;
    const firstTop = chips[0].offsetTop;
    chips.forEach(c => {
      if (c.offsetTop === firstTop) c.classList.add('col-chip-tip-down');
    });
  });
}

/** Async: load records for Object/Single types into the drawer. */
async function loadDrawerRecords() {
  if (_drawerLoading) return;
  if (!isConnected() || !wizState.source) return;

  _drawerLoading = true;
  _drawerLoadAttempted = true;
  updateDrawerBar();

  try {
    // Resolve the target object from the source expression
    let objName = null;
    const relMatch = wizState.source.match(/\.related\('([^']+)'/);
    if (relMatch) {
      objName = relMatch[1];
    } else if (wizState.currentObjDesc?.name) {
      objName = wizState.currentObjDesc.name;
    } else if (wizState.objectPath.length > 0) {
      objName = await resolveCurrentObject(wizState.objectPath);
    }

    if (objName) {
      const records = await fetchRecords(objName);
      wizState.objectRecords = records || [];
    }
  } catch (e) {
    console.warn('[drawer] Load failed:', e);
  } finally {
    _drawerLoading = false;
    updateDrawerBar();
    // Refresh content if drawer is open
    const drawer = qs('#wiz-data-drawer');
    if (drawer?.classList.contains('data-drawer-open')) {
      refreshDrawerContent();
    }
  }
}

/** Async: load resolved config attribute values across all CPs into the drawer. */
async function loadConfigDrawerRecords() {
  if (_drawerLoading) return;
  if (!isConnected() || !wizState._selectedConfigPath) return;

  _drawerLoading = true;
  _drawerLoadAttempted = true;
  updateDrawerBar();

  try {
    const results = await resolveConfigAttrAcrossCPs(wizState._selectedConfigPath);
    wizState.objectRecords = results || [];
  } catch (e) {
    console.warn('[drawer] Config resolve failed:', e);
  } finally {
    _drawerLoading = false;
    updateDrawerBar();
    const drawer = qs('#wiz-data-drawer');
    if (drawer?.classList.contains('data-drawer-open')) {
      refreshDrawerContent();
    }
  }
}


// ─── Transformation Tab Controls (type-specific manipulation) ────────

/** Object filter operators that map to Spring EL */
const OBJ_FILTER_OPS = ['==', '!=', '>', '<', '>=', '<=', 'contains', 'matches', 'not null'];

/** Transforms applicable to Object & Single types */
const OBJ_TRANSFORM_TYPES = [
  { key: 'fieldExtract', label: 'Extract field',  icon: 'target',   desc: 'Project a single field from each item', syntax: '.{field}', needsField: true },
  { key: 'groupBy',      label: 'Group by',        icon: 'layers',   desc: 'Group items by a field value', syntax: ".groupBy('field')", needsField: true },
  { key: 'flatten',      label: 'Flatten',          icon: 'minimize', desc: 'Flatten nested collections', syntax: '.flatten()', needsField: false },
  { key: 'sum',          label: 'Sum',              icon: 'hash',     desc: 'Sum numeric values', syntax: '.sum()', needsField: false },
  { key: 'size',         label: 'Count',            icon: 'hash',     desc: 'Count items in collection', syntax: '.size()', needsField: false },
  { key: 'sort',         label: 'Sort',             icon: 'arrowDown', desc: 'Sort by a field', syntax: ".sort('field')", needsField: true },
];

/** Single-type accessor methods */
const SINGLE_ACCESSORS = [
  { key: '',                 label: '(none)',           desc: 'Raw value' },
  { key: '.value',           label: '.value',           desc: 'Raw attribute value' },
  { key: '.valueDescription',label: '.valueDescription',desc: 'Display label of attribute' },
  { key: '.price(0)',        label: '.price(0)',        desc: 'Format as price (0 decimals)' },
  { key: '.price(2)',        label: '.price(2)',        desc: 'Format as price (2 decimals)' },
  { key: '.round(2)',        label: '.round(2)',        desc: 'Round to 2 decimal places' },
  { key: '.trim()',          label: '.trim()',          desc: 'Trim whitespace' },
  { key: '.size()',          label: '.size()',          desc: 'Collection count' },
];

function renderDetailsControls() {
  const container = qs('#wiz-details-controls');
  if (!container) return;
  clear(container);

  if (wizState.type === 'object') {
    renderObjectDetailsControls(container);
  } else if (wizState.type === 'single') {
    renderSingleDetailsControls(container);
  } else if (wizState.type === 'list') {
    renderListDetailsControls(container);
  } else if (wizState.type === 'bom') {
    // BOM: filters & transforms are configured in Source tab's specialized builder.
    // Show a summary here.
    const filterCount = wizState.filters?.length || 0;
    const transformCount = wizState.transforms?.length || 0;
    const catchAll = wizState.catchAll;
    const summary = [];
    if (filterCount > 0) summary.push(`${filterCount} filter${filterCount > 1 ? 's' : ''} (${wizState.filterLogic.toUpperCase()})`);
    if (catchAll) summary.push('catch-all mode');
    if (transformCount > 0) summary.push(`${transformCount} transform${transformCount > 1 ? 's' : ''}`);
    container.appendChild(el('div', {
      style: { fontSize: '11px', color: 'var(--text-tertiary)', padding: '8px 12px', border: '1px solid var(--border-light)', borderRadius: 'var(--radius)', background: '#FAFBFC' },
    }, summary.length > 0
      ? `BOM manipulation: ${summary.join(', ')}. Edit on the Source tab.`
      : 'No filters or transforms configured. Use the Source tab to add them.'
    ));
  }

}

// ── Object type: filters + transforms ──

function renderObjectDetailsControls(container) {
  // Filter builder (Spring EL .{? condition} syntax)
  container.appendChild(renderObjectFilterBuilder());

  // Catch-all remainder toggle (same as BOM — captures everything not in other data sets)
  // Supported via Spring EL `not in` expressions in generated code
  if (wizState.purpose === 'block') {
    const catchAllWrap = el('div', { style: { marginBottom: '8px' } });
    catchAllWrap.appendChild(el('label', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer', padding: '8px 12px', border: '1px solid var(--border-light)', borderRadius: 'var(--radius)', background: '#FAFBFC' },
    }, [
      el('input', {
        type: 'checkbox', checked: wizState.catchAll || undefined,
        onchange: (e) => { wizState.catchAll = e.target.checked; renderDetailsControls(); refreshPipeline(); },
      }),
      el('span', { style: { fontWeight: '600' } }, 'Catch-all remainder'),
      el('span', { style: { color: 'var(--text-tertiary)', fontSize: '11px', marginLeft: 'auto' } }, 'captures everything not in other data sets'),
    ]));

    // When catch-all is active, show which other data sets will be excluded
    if (wizState.catchAll) {
      const sameTypeVars = (state.get('variables') || []).filter(v =>
        v.type === 'object' && !v.catchAll && v.id !== wizState.id
      );
      if (sameTypeVars.length > 0) {
        const exclList = el('div', { style: { padding: '4px 12px 8px 32px', fontSize: '11px', color: 'var(--text-secondary)' } }, [
          el('div', { style: { fontWeight: '600', marginBottom: '2px' } }, 'Excludes records matched by:'),
          ...sameTypeVars.map(v => el('div', { style: { padding: '1px 0', fontFamily: 'var(--mono)', fontSize: '10px' } }, [
            el('span', { style: { color: 'var(--tacton-blue)' } }, v.name),
            v.filters?.length > 0
              ? el('span', { style: { color: 'var(--text-tertiary)', marginLeft: '6px' } }, `(${v.filters.length} filter${v.filters.length > 1 ? 's' : ''})`)
              : null,
          ])),
        ]);
        catchAllWrap.appendChild(exclList);
      } else {
        catchAllWrap.appendChild(el('div', { style: { padding: '4px 12px 4px 32px', fontSize: '10px', color: 'var(--text-tertiary)', fontStyle: 'italic' } },
          'No other object data sets to exclude from — add filtered ones first.'));
      }
    }
    container.appendChild(catchAllWrap);
  }

  // Transform chain (Spring EL methods: .sort(), .groupBy(), .flatten(), etc.)
  container.appendChild(renderObjectTransformBuilder());

}

function renderObjectFilterBuilder() {
  const wrap = el('div', { class: 'form-group', style: { marginBottom: '8px' } });

  wrap.appendChild(el('div', { class: 'form-label', style: { display: 'flex', alignItems: 'center' } }, [
    el('span', { class: 'icon', html: icon('filter', 12) }),
    'Collection filter',
    wizState.filters.length > 0
      ? el('span', { class: 'badge badge-muted', style: { fontSize: '9px', marginLeft: 'auto' } },
          `match ${wizState.filterLogic === 'and' ? 'ALL' : 'ANY'} (${wizState.filterLogic.toUpperCase()})`)
      : null,
  ]));

  // Existing filter rows
  wizState.filters.forEach((f, idx) => {
    if (idx > 0) wrap.appendChild(el('div', { style: { textAlign: 'center' } }, el('span', { class: 'filter-logic' }, wizState.filterLogic)));
    wrap.appendChild(el('div', { class: 'filter-row' }, [
      el('span', { class: 'filter-field' }, f.field),
      el('span', { class: 'filter-op' }, f.op),
      f.op !== 'not null' ? el('span', { class: 'filter-val' }, `"${f.value}"`) : null,
      el('span', { class: 'filter-x', onclick: () => { wizState.filters.splice(idx, 1); renderDetailsControls(); refreshPipeline(); }, html: icon('x', 12) }),
    ]));
  });

  // Add filter row — field custom dropdown + operator dropdown + value
  const { allFields: filterFields } = getDrawerData();

  const fieldPicker = makeCustomDropdown('— field —', filterFields.map(f => ({ label: f, value: f })), { flex: '2', mono: true });
  const opPicker = makeCustomDropdown(OBJ_FILTER_OPS[0], OBJ_FILTER_OPS.map(o => ({ label: o, value: o })), { flex: '0 0 auto', minWidth: '70px' });
  opPicker._value = OBJ_FILTER_OPS[0];

  const valInput = el('input', { class: 'input', placeholder: 'value', style: { flex: '2' } });
  opPicker._onChange = (v) => { valInput.style.display = v === 'not null' ? 'none' : ''; };

  const addBtn = el('button', {
    class: 'btn btn-sm btn-primary',
    onclick: () => {
      const field = fieldPicker._value || '', op = opPicker._value || OBJ_FILTER_OPS[0], value = valInput.value.trim();
      if (!field || (op !== 'not null' && !value)) return;
      wizState.filters.push({ field, op, value: op === 'not null' ? '' : value });
      renderDetailsControls(); refreshPipeline();
    },
  }, [el('span', { class: 'icon', html: icon('plus', 12) }), 'Add']);

  valInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
  wrap.appendChild(el('div', { class: 'filter-add-row' }, [fieldPicker, opPicker, valInput, addBtn]));

  // AND/OR toggle
  if (wizState.filters.length >= 2) {
    wrap.appendChild(el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } }, [
      el('button', { class: 'btn btn-outline btn-sm', onclick: () => { wizState.filterLogic = wizState.filterLogic === 'or' ? 'and' : 'or'; renderDetailsControls(); refreshPipeline(); } },
        `Switch to ${wizState.filterLogic === 'or' ? 'AND' : 'OR'} logic`),
    ]));
  }

  return wrap;
}

function renderObjectTransformBuilder() {
  const wrap = el('div', { class: 'form-group', style: { marginBottom: '8px' } });

  wrap.appendChild(el('div', { class: 'form-label', style: { display: 'flex', alignItems: 'center' } }, [
    el('span', { class: 'icon', html: icon('arrowRight', 12) }),
    'Transforms',
    wizState.transforms.length > 0
      ? el('span', { class: 'badge badge-muted', style: { fontSize: '9px', marginLeft: 'auto' } }, `${wizState.transforms.length} step${wizState.transforms.length > 1 ? 's' : ''}`)
      : null,
  ]));

  // Existing transform chain
  if (wizState.transforms.length > 0) {
    const chain = el('div', { class: 'tf-chain' });
    wizState.transforms.forEach((t, idx) => {
      const def = OBJ_TRANSFORM_TYPES.find(d => d.key === t.type) || OBJ_TRANSFORM_TYPES[0];
      chain.appendChild(el('div', { class: 'tf-step' }, [
        el('div', { class: 'tf-step-head' }, [
          el('span', { class: 'icon', style: { color: 'var(--tacton-blue)' }, html: icon(def.icon, 12) }),
          el('span', { class: 'tf-step-label' }, def.label),
          t.field ? el('span', { class: 'tf-step-field' }, t.field) : null,
          el('button', {
            class: 'tf-step-x',
            onclick: () => { wizState.transforms.splice(idx, 1); renderDetailsControls(); refreshPipeline(); },
            html: icon('x', 10),
          }),
        ]),
        el('div', { class: 'tf-step-syntax' }, buildTransformSyntax(t)),
      ]));
      if (idx < wizState.transforms.length - 1) {
        chain.appendChild(el('div', { class: 'tf-chain-arrow' }, [el('span', { html: icon('arrowDown', 8) })]));
      }
    });
    wrap.appendChild(chain);
  }

  // Add transform button + dropdown
  const addWrap = el('div', { class: 'tf-add-wrap' });
  const addBtn = el('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => { const m = wrap.querySelector('.tf-add-menu'); if (m) m.style.display = m.style.display === 'none' ? '' : 'none'; },
  }, [el('span', { class: 'icon', html: icon('plus', 12) }), 'Add transform']);

  const menu = el('div', { class: 'tf-add-menu', style: { display: 'none' } });
  for (const def of OBJ_TRANSFORM_TYPES) {
    menu.appendChild(el('div', {
      class: 'tf-add-opt',
      onclick: () => {
        if (def.needsField) {
          showObjTransformFieldPicker(menu, wrap, def);
        } else {
          wizState.transforms.push({ type: def.key });
          menu.style.display = 'none';
          renderDetailsControls(); refreshPipeline();
        }
      },
    }, [
      el('span', { class: 'icon', html: icon(def.icon, 14) }),
      el('div', { class: 'tf-add-opt-text' }, [
        el('div', { class: 'tf-add-opt-label' }, def.label),
        el('div', { class: 'tf-add-opt-desc' }, def.desc),
      ]),
      el('span', { class: 'tf-add-opt-syntax' }, def.syntax),
    ]));
  }

  addWrap.appendChild(addBtn);
  addWrap.appendChild(menu);
  wrap.appendChild(addWrap);
  return wrap;
}

function showObjTransformFieldPicker(menu, parentWrap, def) {
  clear(menu);
  // Get fields from drawer data (most reliable source — uses records + model)
  const { allFields } = getDrawerData();
  // Fallback to model attributes if drawer has nothing
  const fields = allFields.length > 0
    ? allFields
    : (wizState.currentObjDesc?.attributes || []).filter(a => !a.refType).map(a => a.name);

  menu.appendChild(el('div', { class: 'tf-field-picker' }, [
    el('div', { style: { fontSize: '11px', fontWeight: '600', marginBottom: '4px' } }, `${def.label} — pick a field`),
    el('div', { class: 'tf-field-list' },
      fields.length > 0
        ? fields.map(f => el('button', {
            class: 'tf-field-btn',
            onclick: () => {
              wizState.transforms.push({ type: def.key, field: f });
              menu.style.display = 'none';
              renderDetailsControls(); refreshPipeline();
            },
          }, f))
        : [el('input', {
            class: 'input', placeholder: 'field name', style: { fontSize: '11px' },
            onkeydown: (e) => {
              if (e.key === 'Enter' && e.target.value.trim()) {
                wizState.transforms.push({ type: def.key, field: e.target.value.trim() });
                menu.style.display = 'none';
                renderDetailsControls(); refreshPipeline();
              }
            },
          })]
    ),
    el('button', {
      class: 'btn btn-sm', style: { marginTop: '4px' },
      onclick: () => { menu.style.display = 'none'; renderDetailsControls(); },
    }, 'Cancel'),
  ]));
}

// ── Single type: accessor method + null-safety ──

function renderSingleDetailsControls(container) {
  // ── Section 1: Accessor Method ──
  const accessorCard = el('div', { class: 'wiz-transform-card' });
  accessorCard.appendChild(el('div', { class: 'wiz-transform-card-header' }, [
    el('span', { class: 'icon', html: icon('settings', 12) }),
    'Accessor method',
  ]));

  // Read current accessor from transforms
  const currentAccessor = (wizState.transforms.length > 0 && wizState.transforms[0].type === 'accessor')
    ? wizState.transforms[0].method : '';

  const sel = el('select', {
    class: 'input', style: { fontSize: '11px' },
    onchange: (e) => {
      wizState.transforms = wizState.transforms.filter(t => t.type !== 'accessor');
      if (e.target.value) {
        wizState.transforms.unshift({ type: 'accessor', method: e.target.value });
      }
      refreshPipeline();
    },
  }, SINGLE_ACCESSORS.map(a =>
    el('option', { value: a.key, selected: a.key === currentAccessor || undefined }, `${a.label} — ${a.desc}`)
  ));
  accessorCard.appendChild(sel);
  container.appendChild(accessorCard);

  // ── Section 2: Null-safe Wrapper ──
  const nullSafe = wizState.transforms.some(t => t.type === 'nullSafe');
  const nullCard = el('div', { class: 'wiz-transform-card' });
  nullCard.appendChild(el('div', { class: 'wiz-transform-card-header' }, [
    el('span', { class: 'icon', html: icon('shield', 12) }),
    'Null-safe wrapper',
  ]));

  // Toggle row
  nullCard.appendChild(el('label', {
    class: 'wiz-transform-toggle',
  }, [
    el('input', {
      type: 'checkbox', checked: nullSafe || undefined,
      onchange: (e) => {
        wizState.transforms = wizState.transforms.filter(t => t.type !== 'nullSafe');
        if (e.target.checked) {
          wizState.transforms.push({ type: 'nullSafe', fallback: 'N/A' });
        }
        renderDetailsControls();
        refreshPipeline();
      },
    }),
    el('span', { style: { fontWeight: '600', flex: '1' } }, 'Enable null-safe wrapper'),
    el('span', { class: 'wiz-transform-hint' }, '!= null ? expr : "N/A"'),
  ]));

  // Fallback value (nested inside the card when enabled)
  if (nullSafe) {
    const nsTransform = wizState.transforms.find(t => t.type === 'nullSafe');
    const fallbackRow = el('div', { class: 'wiz-transform-sub' }, [
      el('div', { class: 'wiz-transform-sub-label' }, 'Fallback value'),
      el('input', {
        class: 'input', value: nsTransform?.fallback || 'N/A', placeholder: 'N/A',
        style: { fontSize: '11px', maxWidth: '160px', fontFamily: 'var(--mono)' },
        oninput: (e) => { if (nsTransform) { nsTransform.fallback = e.target.value; refreshPipeline(); } },
      }),
    ]);
    nullCard.appendChild(fallbackRow);
  }

  container.appendChild(nullCard);

  // Also allow collection filter + transforms if source is a collection (related())
  if (wizState.source && (wizState.source.includes('related(') || wizState.source.includes('.{'))) {
    container.appendChild(renderObjectFilterBuilder());
    container.appendChild(renderObjectTransformBuilder());
  }
}

// ── List type: individual value editor + paste/CSV import ──

/** Parse {"a","b","c"} source into an array of strings */
function parseListValues(src) {
  const raw = src || '{""}';
  const values = [];
  const matchIter = raw.matchAll(/"([^"]*)"/g);
  for (const m of matchIter) values.push(m[1]);
  return values;
}

/** Rebuild source string from values array */
function buildListSource(values) {
  const nonEmpty = values.filter(v => v !== '');
  if (nonEmpty.length === 0) return '{""}';
  return `{${nonEmpty.map(v => `"${v}"`).join(',')}}`;
}

function renderListDetailsControls(container) {
  const wrap = el('div', { class: 'form-group', style: { marginBottom: '8px' } });
  wrap.appendChild(el('div', { class: 'form-label' }, [
    el('span', { class: 'icon', html: icon('list', 12) }),
    'List values',
    el('span', { class: 'badge badge-muted', style: { fontSize: '9px', marginLeft: 'auto' } },
      `${parseListValues(wizState.source).length} items`),
  ]));

  const values = parseListValues(wizState.source);
  if (values.length === 0) values.push('');

  // Render individual value rows
  const list = el('div', { class: 'list-val-rows', style: { display: 'flex', flexDirection: 'column', gap: '3px', maxHeight: '200px', overflowY: 'auto' } });
  values.forEach((v, idx) => {
    list.appendChild(el('div', { style: { display: 'flex', gap: '4px', alignItems: 'center' } }, [
      el('span', { style: { fontSize: '9px', color: 'var(--text-tertiary)', width: '18px', textAlign: 'right', flexShrink: '0' } }, `${idx + 1}`),
      el('input', {
        class: 'input', value: v, placeholder: `Value ${idx + 1}`,
        style: { flex: '1', fontSize: '11px', padding: '3px 6px', fontFamily: 'var(--mono)' },
        oninput: (e) => {
          values[idx] = e.target.value;
          wizState.source = buildListSource(values);
          refreshPipeline();
          // Also update Source tab raw input
          const rawInput = qs('#wiz-list-raw');
          if (rawInput) rawInput.value = wizState.source;
        },
      }),
      el('button', {
        class: 'btn btn-sm', style: { padding: '2px 4px', opacity: values.length > 1 ? '1' : '0.3' },
        onclick: () => {
          if (values.length <= 1) return;
          values.splice(idx, 1);
          wizState.source = buildListSource(values);
          renderDetailsControls(); refreshPipeline();
        },
        html: icon('x', 10),
      }),
    ]));
  });
  wrap.appendChild(list);

  // Button row: Add value + Paste CSV
  const btnRow = el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } });

  btnRow.appendChild(el('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => {
      values.push('');
      wizState.source = buildListSource(values);
      renderDetailsControls(); refreshPipeline();
    },
  }, [el('span', { class: 'icon', html: icon('plus', 12) }), 'Add value']));

  // Paste / CSV import toggle
  btnRow.appendChild(el('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => {
      const pasteArea = wrap.querySelector('.list-paste-area');
      if (pasteArea) { pasteArea.style.display = pasteArea.style.display === 'none' ? '' : 'none'; }
    },
  }, [el('span', { class: 'icon', html: icon('clipboard', 12) }), 'Paste / CSV']));

  wrap.appendChild(btnRow);

  // Paste area (hidden by default)
  const pasteWrap = el('div', { class: 'list-paste-area', style: { display: 'none', marginTop: '6px' } });
  pasteWrap.appendChild(el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '4px' } },
    'Paste comma-separated values below. One value per line or separated by commas.'));
  const textarea = el('textarea', {
    class: 'input', placeholder: 'value1, value2, value3\nor one per line',
    style: { fontSize: '11px', fontFamily: 'var(--mono)', minHeight: '60px', resize: 'vertical', width: '100%', boxSizing: 'border-box' },
  });
  pasteWrap.appendChild(textarea);

  const importRow = el('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } });

  // Import button — parses the textarea and adds values
  importRow.appendChild(el('button', {
    class: 'btn btn-primary btn-sm',
    onclick: () => {
      const raw = textarea.value.trim();
      if (!raw) return;
      // Split by newlines first, then by commas within each line
      const lines = raw.split(/\r?\n/);
      const newVals = [];
      for (const line of lines) {
        // Split by comma, trim each value, strip surrounding quotes
        const parts = line.split(',');
        for (let p of parts) {
          p = p.trim().replace(/^["']|["']$/g, '');
          if (p) newVals.push(p);
        }
      }
      if (newVals.length === 0) return;
      // Replace single empty-string placeholder or append to existing
      const existingNonEmpty = values.filter(v => v !== '');
      const merged = existingNonEmpty.length > 0 ? [...existingNonEmpty, ...newVals] : newVals;
      wizState.source = buildListSource(merged);
      textarea.value = '';
      pasteWrap.style.display = 'none';
      renderDetailsControls(); refreshPipeline();
    },
  }, [el('span', { class: 'icon', html: icon('check', 12) }), 'Import']));

  // CSV file import
  const fileInput = el('input', {
    type: 'file', accept: '.csv,.txt', style: { display: 'none' },
    onchange: (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        textarea.value = reader.result;
      };
      reader.readAsText(file);
    },
  });
  importRow.appendChild(fileInput);
  importRow.appendChild(el('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => fileInput.click(),
  }, [el('span', { class: 'icon', html: icon('upload', 12) }), 'Load CSV file']));

  // Clear all
  importRow.appendChild(el('button', {
    class: 'btn btn-outline btn-sm', style: { marginLeft: 'auto' },
    onclick: () => {
      wizState.source = '{""}';
      renderDetailsControls(); refreshPipeline();
    },
  }, [el('span', { class: 'icon', html: icon('trash', 12) }), 'Clear all']));

  pasteWrap.appendChild(importRow);
  wrap.appendChild(pasteWrap);

  container.appendChild(wrap);
}

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
    await updateVariable(wizState.id, wizState);
  } else {
    await createVariable(wizState);
  }
  state.set('activeVariable', null);
  state.set('dataView', 'list');
}

async function handleDelete() {
  const check = canDeleteVariable(wizState.id);
  if (!check.ok) {
    // Show validation overlay with usages
    const details = (check.usages || []).map(u => `${u.name} (${u.type})`);
    showWizValidationDialog('Cannot delete data set', check.reason, details);
    return;
  }
  if (!confirm(`Delete data set "${wizState.name}"? This cannot be undone.`)) return;
  await removeVariable(wizState.id);
  state.set('activeVariable', null);
  state.set('dataView', 'list');
}

function showWizValidationDialog(title, reason, details) {
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

  const children = [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } }, [
      el('span', { class: 'icon', style: { color: 'var(--danger, #CF222E)' }, html: icon('info', 18) }),
      el('div', { style: { fontWeight: '700', fontSize: '13px' } }, title),
    ]),
    el('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: '1.5' } }, reason),
  ];

  if (details && details.length > 0) {
    const detailList = el('div', {
      style: {
        fontSize: '11px', color: 'var(--text-tertiary)', background: 'var(--bg)',
        border: '1px solid var(--border-light)', borderRadius: 'var(--radius)',
        padding: '8px 10px', marginBottom: '10px',
      },
    });
    details.forEach(d => {
      detailList.appendChild(el('div', { style: { marginBottom: '3px' } }, `• ${d}`));
    });
    children.push(detailList);
  }

  children.push(
    el('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, [
      el('button', {
        class: 'btn btn-primary btn-sm',
        onclick: () => overlay.remove(),
      }, 'OK'),
    ])
  );

  overlay.appendChild(
    el('div', {
      style: {
        background: 'var(--card, #fff)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '16px 18px', maxWidth: '360px', width: '90%',
        boxShadow: '0 8px 24px rgba(0,0,0,.18)',
      },
    }, children)
  );

  document.body.appendChild(overlay);
}
