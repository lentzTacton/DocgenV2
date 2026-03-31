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
  resolveCurrentObject,
  getExplorerFavorites, toggleExplorerFavorite,
  fetchStartingObjectInstances, getSelectedInstance, setSelectedInstance,
} from '../../services/data-api.js';
import { wizState, resetWiz, rebuildObjectPath } from './wizard-state.js';
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

// ─── Combo input (text input + typeahead dropdown) ──────────────────

/**
 * Create a combo input: a text field with a dropdown of suggestions
 * that filters as you type (typeahead). Allows free-text entry too.
 * @param {string} initialValue - Current value
 * @param {string[]} suggestions - Available values for the dropdown
 * @param {Object} opts - { placeholder, onchange }
 */
function makeComboInput(initialValue, suggestions, opts = {}) {
  const wrap = el('div', { class: 'combo-input', style: { flex: '1', minWidth: '0', position: 'relative' } });

  const input = el('input', {
    class: 'input', value: initialValue,
    placeholder: opts.placeholder || '',
    style: { fontSize: '11px', width: '100%', fontFamily: 'var(--mono)', boxSizing: 'border-box', paddingRight: '22px' },
  });

  const arrow = el('span', {
    style: {
      position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)',
      cursor: 'pointer', display: 'flex', opacity: '0.5',
    },
    html: icon('chevronDown', 10),
  });

  const dropdown = el('div', {
    class: 'combo-dropdown',
    style: {
      display: 'none', position: 'absolute', top: '100%', left: '0', right: '0',
      maxHeight: '160px', overflowY: 'auto', background: '#fff', zIndex: '200',
      border: '1px solid var(--border)', borderRadius: '0 0 var(--radius) var(--radius)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    },
  });

  function renderOptions(filter) {
    dropdown.innerHTML = '';
    const query = (filter || '').toLowerCase();
    const filtered = query
      ? suggestions.filter(s => s.toLowerCase().includes(query))
      : suggestions;

    if (filtered.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    filtered.forEach(s => {
      const item = el('div', {
        style: {
          padding: '4px 8px', fontSize: '11px', fontFamily: 'var(--mono)',
          cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        },
      });
      // Highlight matching portion
      if (query && s.toLowerCase().includes(query)) {
        const idx = s.toLowerCase().indexOf(query);
        item.appendChild(document.createTextNode(s.slice(0, idx)));
        item.appendChild(el('strong', { style: { color: 'var(--accent)' } }, s.slice(idx, idx + query.length)));
        item.appendChild(document.createTextNode(s.slice(idx + query.length)));
      } else {
        item.textContent = s;
      }
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent blur before click fires
        input.value = s;
        dropdown.style.display = 'none';
        if (opts.onchange) opts.onchange(s);
      });
      item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg, #F6F8FA)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      dropdown.appendChild(item);
    });

    dropdown.style.display = filtered.length > 0 ? '' : 'none';
  }

  input.addEventListener('input', () => {
    renderOptions(input.value);
    if (opts.onchange) opts.onchange(input.value);
  });

  input.addEventListener('focus', () => { renderOptions(input.value); });
  input.addEventListener('blur', () => {
    // Delay to allow mousedown on dropdown items
    setTimeout(() => { dropdown.style.display = 'none'; }, 150);
  });

  arrow.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (dropdown.style.display === 'none') {
      input.focus();
      renderOptions(''); // show all
    } else {
      dropdown.style.display = 'none';
    }
  });

  wrap.appendChild(input);
  wrap.appendChild(arrow);
  wrap.appendChild(dropdown);
  return wrap;
}

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
          if (!wizState.isEditMode) switchTypeView();
          updateTypeSelector();
        }
        // Inline behaves like variable for type selection purposes
        if (p.key === 'inline' && wizState.type === 'bom') {
          wizState.type = 'single';
          wizState.source = '';
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
  const sourcePanel = el('div', { id: 'wiz-tab-source', class: 'wiz-tab-panel', style: { display: activeTab === 'source' ? '' : 'none' } });
  sourcePanel.appendChild(el('div', { id: 'wiz-bom-section', style: { display: wizState.type === 'bom' ? '' : 'none' } }));
  sourcePanel.appendChild(el('div', { id: 'wiz-source-toggle', style: { display: wizState.type === 'single' ? '' : 'none' } }));
  sourcePanel.appendChild(el('div', { id: 'wiz-obj-section', style: { display: (wizState.type === 'object' || wizState.type === 'single' || wizState.type === 'config') ? '' : 'none' } }));
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
  if (wizState.type === 'bom') {
    renderBomSection(bomSection);
  } else if (wizState.type === 'config' || (wizState.type === 'single' && wizState._singleSourceMode === 'config')) {
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
          showWizConfirmDialog(
            'Change dataset type?',
            'This will reset the source, filters, and transforms for this dataset. This cannot be undone.',
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
  const isObjLike = wizState.type === 'object' || wizState.type === 'single' || wizState.type === 'config';
  if (bom) bom.style.display = wizState.type === 'bom' ? '' : 'none';

  // Refresh name combo when type/purpose changes (parent candidates may change)
  const nameCard = qs('#wiz-name-card');
  if (nameCard) renderNameCombo(nameCard);

  // Source mode toggle (Object / Configuration) — only for 'single' type (not for 'config', it goes direct)
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

  // Accessor and null-safe controls are now in the universal Transformation tab.
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

  // Resolved values cache (populated when toggle is on or resolve is clicked)
  let _resolvedValues = wizState._codeResolvedValues || {};
  let _showValues = wizState._codeShowValues || false;

  function getRefStatus(refName) {
    const refVar = allVars.find(v => v.name === refName);
    if (!refVar) return { status: 'missing', tooltip: `"${refName}" does not exist`, cls: 'wiz-code-chip-missing' };

    // If we have a resolved value, that takes priority — use default blue chip style
    if (_resolvedValues[refName] !== undefined) {
      return { status: 'resolved', tooltip: `${refName} = ${_resolvedValues[refName]}`, cls: '' };
    }

    const result = valResults[refVar.id];
    if (!result || result.status === 'unchecked') {
      return { status: 'unchecked', tooltip: `${refName}: not yet resolved`, cls: '' };
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

  // Show values toggle
  const valuesToggle = el('label', { class: 'wiz-code-values-toggle' }, [
    el('input', {
      type: 'checkbox',
      checked: _showValues,
      onchange: (e) => {
        _showValues = e.target.checked;
        wizState._codeShowValues = _showValues;
        if (_showValues && Object.keys(_resolvedValues).length === 0) {
          resolveAllDeps();
        } else {
          refreshEditorContent();
          renderCodeRefs(refsContainer, _resolvedValues);
        }
      },
    }),
    'Values',
  ]);

  const toolbar = el('div', { class: 'wiz-code-toolbar' }, [
    el('div', { class: 'form-label', style: { margin: 0 } }, [
      el('span', { class: 'icon', style: { color: 'var(--text-tertiary)' }, html: icon('code', 12) }),
      'Expression',
    ]),
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
      valuesToggle,
      defineSelect,
    ]),
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
      // Show resolved value badge inside the chip when toggle is on
      let valueLabel = '';
      if (_showValues && _resolvedValues[match] !== undefined) {
        const v = _resolvedValues[match];
        valueLabel = `<span style="margin-left:3px;opacity:0.7;font-weight:400">= ${v}</span>`;
      }
      return `<span class="wiz-code-chip ${ref.cls}" contenteditable="false" data-define="${match}" data-tip="${tip}">${match}${valueLabel}</span>`;
    });
  }

  function refreshEditorContent() {
    // Save cursor position concept (we'll just re-render; cursor resets but that's ok for toggle)
    editor.innerHTML = sourceToHTML(wizState.source || '');
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
    renderCodeRefs(refsContainer, _resolvedValues);
    // Clear computed result on edit
    clear(resultContainer);
  });

  // Prevent Enter from creating divs
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

    const ph = editor.querySelector('.wiz-code-placeholder');
    if (ph) editor.innerHTML = '';

    const ref = getRefStatus(val);
    let valueLabel = '';
    if (_showValues && _resolvedValues[val] !== undefined) {
      valueLabel = `<span style="margin-left:3px;opacity:0.7;font-weight:400">= ${_resolvedValues[val]}</span>`;
    }
    const chip = el('span', {
      class: `wiz-code-chip ${ref.cls}`,
      contentEditable: 'false',
      'data-define': val,
      'data-tip': ref.tooltip,
    });
    chip.innerHTML = `${val}${valueLabel}`;

    const sel = window.getSelection();
    if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(chip);
      range.setStartAfter(chip);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.appendChild(chip);
    }

    wizState.source = editorToSource();
    refreshPipeline();
    renderCodeRefs(refsContainer, _resolvedValues);
    editor.focus();
  });

  // ── Result container (shows computed value after resolve) ──
  const resultContainer = el('div', { id: 'wiz-code-result' });

  // ── Resolve button ──
  const resolveBtn = el('button', {
    class: 'wiz-code-resolve-btn',
    onclick: () => resolveAllDeps(),
  }, [
    el('span', { class: 'icon', html: icon('play', 12) }),
    'Calculate',
  ]);

  // ── Resolve all dependencies and compute expression ──
  async function resolveAllDeps() {
    const source = wizState.source || '';
    const refs = [...new Set((source.match(/#\w+/g) || []))];
    if (refs.length === 0) return;

    resolveBtn.disabled = true;
    resolveBtn.innerHTML = '';
    resolveBtn.appendChild(el('span', { class: 'icon', html: icon('loader', 12) }));
    resolveBtn.appendChild(document.createTextNode('Resolving…'));

    const newValues = {};
    let allResolved = true;

    for (const refName of refs) {
      const refVar = allVars.find(v => v.name === refName);
      if (!refVar) { allResolved = false; continue; }

      const refSource = refVar.source || '';
      if (refSource.includes('getConfigurationAttribute(')) {
        const pm = refSource.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
        if (pm) {
          try {
            const { resolveConfigAttrAcrossCPs } = await import('./wizard-config-explorer.js');
            const r = await resolveConfigAttrAcrossCPs(pm[1]);
            const val = r.find(x => x.value && x.value !== '(error)');
            if (val) {
              newValues[refName] = val.value;
            } else {
              allResolved = false;
            }
          } catch {
            allResolved = false;
          }
        }
      }
    }

    _resolvedValues = newValues;
    wizState._codeResolvedValues = newValues;

    // Update toggle state
    _showValues = true;
    wizState._codeShowValues = true;
    const cb = valuesToggle.querySelector('input');
    if (cb) cb.checked = true;

    // Refresh editor with values
    refreshEditorContent();
    renderCodeRefs(refsContainer, _resolvedValues);

    // Compute the final arithmetic result
    clear(resultContainer);
    if (allResolved && Object.keys(newValues).length > 0) {
      try {
        let expr = source;
        for (const [name, val] of Object.entries(newValues)) {
          const numVal = parseFloat(val);
          if (!isNaN(numVal)) {
            expr = expr.split(name).join(String(numVal));
          }
        }
        if (/^[\d.+\-*/() \t]+$/.test(expr)) {
          let computed = Function('"use strict"; return (' + expr + ')')();
          if (typeof computed === 'number') {
            computed = Math.round(computed * 100) / 100;
          }
          resultContainer.appendChild(el('div', { class: 'wiz-code-result wiz-code-result-ok' }, [
            el('span', { class: 'icon', html: icon('check', 14) }),
            `Result: ${computed}`,
          ]));
        } else {
          resultContainer.appendChild(el('div', { class: 'wiz-code-result wiz-code-result-err' }, [
            el('span', { class: 'icon', html: icon('alert-circle', 14) }),
            `Expression: ${expr}`,
          ]));
        }
      } catch (e) {
        resultContainer.appendChild(el('div', { class: 'wiz-code-result wiz-code-result-err' }, [
          el('span', { class: 'icon', html: icon('alert-circle', 14) }),
          `Eval error: ${e.message}`,
        ]));
      }
    } else if (!allResolved) {
      const missing = refs.filter(r => newValues[r] === undefined);
      resultContainer.appendChild(el('div', { class: 'wiz-code-result wiz-code-result-err' }, [
        el('span', { class: 'icon', html: icon('alert-circle', 14) }),
        `Cannot compute — unresolved: ${missing.join(', ')}`,
      ]));
    }

    resolveBtn.disabled = false;
    resolveBtn.innerHTML = '';
    resolveBtn.appendChild(el('span', { class: 'icon', html: icon('play', 12) }));
    resolveBtn.appendChild(document.createTextNode('Calculate'));
  }

  container.appendChild(el('div', { class: 'form-group' }, [
    toolbar,
    editor,
    el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' } }, [
      el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)' } },
        'Type freely or insert defines. Supports arithmetic.'),
      resolveBtn,
    ]),
    resultContainer,
  ]));

  // ── Referenced defines list ──
  const refsContainer = el('div', { class: 'wiz-code-refs' });
  renderCodeRefs(refsContainer, _resolvedValues);
  container.appendChild(refsContainer);

  // Auto-resolve if in edit mode and connected
  if (wizState.isEditMode && isConnected() && Object.keys(_resolvedValues).length === 0) {
    resolveAllDeps();
  }
}

function renderCodeRefs(container, resolvedValues) {
  if (!container) return;
  clear(container);

  const source = wizState.source || '';
  const refs = [...new Set((source.match(/#\w+/g) || []))];
  if (refs.length === 0) return;

  const allVars = state.get('variables') || [];
  const valResults = state.get('validationResults') || {};
  const resolved = resolvedValues || {};

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

    const hasValue = resolved[refName] !== undefined;

    list.appendChild(el('div', {
      class: `wiz-code-ref-item`,
      style: { color: statusColors[status] },
      'data-tip': detail,
    }, [
      el('span', { class: 'icon', html: icon(statusIcons[status], 11) }),
      el('code', {}, refName),
      hasValue
        ? el('span', { style: { marginLeft: 'auto', fontFamily: 'var(--mono, monospace)', fontWeight: '600', color: 'var(--success, #1A7F37)' } }, resolved[refName])
        : (status !== 'valid' && status !== 'unchecked'
          ? el('span', { class: 'wiz-code-ref-warn', style: { color: statusColors[status] } }, detail)
          : null),
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
      // Compute filtered count
      const savedShowAll = _drawerShowAll;
      _drawerShowAll = false;
      const { records: filtered } = getDrawerData();
      _drawerShowAll = savedShowAll;
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
  _drawerLoadAttempted = false; // allow fresh auto-load on source change
  // Clear stale drawer records when source changes (config or object)
  if (wizState.type === 'config' || (wizState.type === 'single' && wizState._singleSourceMode === 'config')) {
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
let _drawerShowAll = false;        // show all records (ignore filters in preview)

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

/** Get the current dataset for the drawer (records + available fields). */
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
  } else if (wizState.type === 'config' || (wizState.type === 'single' && wizState._singleSourceMode === 'config')) {
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
    // Apply single filter to preview — unless "show all" is on
    if (!_drawerShowAll && records.length > 0 && wizState.type === 'single' && wizState._singleFilter) {
      const sf = wizState._singleFilter;
      if (sf.mode === 'field') {
        const conds = sf.conditions || (sf.field ? [{ field: sf.field, op: sf.op, value: sf.value }] : []);
        const validConds = conds.filter(c => c.field && c.value);
        if (validConds.length > 0) {
          const isOr = sf.logic === 'or';
          records = records.filter(r => {
            const results = validConds.map(c => {
              const v = r[c.field];
              if (v == null) return false;
              const sv = String(v), fv = c.value;
              if (c.op === '==') return sv === fv;
              if (c.op === '!=') return sv !== fv;
              if (c.op === 'contains') return sv.includes(fv);
              if (c.op === '>') return parseFloat(sv) > parseFloat(fv);
              if (c.op === '<') return parseFloat(sv) < parseFloat(fv);
              if (c.op === '>=') return parseFloat(sv) >= parseFloat(fv);
              if (c.op === '<=') return parseFloat(sv) <= parseFloat(fv);
              if (c.op === 'matches') return new RegExp(fv).test(sv);
              return true;
            });
            return isOr ? results.some(Boolean) : results.every(Boolean);
          });
        }
      } else if (sf.mode === 'first') {
        records = records.slice(0, 1);
      } else if (sf.mode === 'index') {
        const idx = sf.index || 0;
        records = idx < records.length ? [records[idx]] : [];
      }
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
    if ((wizState.type === 'object' || wizState.type === 'single' || wizState.type === 'config') && isConnected() && !_drawerLoadAttempted) {
      if (wizState.type === 'config' || wizState._singleSourceMode === 'config') {
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

  // "Show all" checkbox — visible when a filter is active
  const hasActiveFilter = (wizState._singleFilter && wizState.type === 'single')
    || (wizState.filters.length > 0) || wizState.catchAll;
  if (hasActiveFilter) {
    tabs.appendChild(el('label', {
      style: { display: 'flex', alignItems: 'center', gap: '4px', marginLeft: 'auto', fontSize: '10px', color: 'var(--text-tertiary)', cursor: 'pointer', whiteSpace: 'nowrap' },
    }, [
      el('input', {
        type: 'checkbox', checked: _drawerShowAll || undefined,
        style: { margin: '0' },
        onchange: (e) => { _drawerShowAll = e.target.checked; refreshDrawerContent(); },
      }),
      'Show all',
    ]));
  }

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
    if (wizState.type === 'object' || wizState.type === 'single' || wizState.type === 'config') {
      if (wizState.type === 'config' || wizState._singleSourceMode === 'config') {
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
const OBJ_FILTER_OPS = ['==', '!=', '>', '<', '>=', '<=', 'contains', 'matches', 'is null', 'not null'];

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

  // ── Placeholder toggle (first item for object/single types) ──
  if (wizState.type === 'object' || wizState.type === 'single') {
    const placeholderCard = el('div', { class: 'wiz-transform-card', style: { marginBottom: '8px' } });
    placeholderCard.appendChild(el('div', { class: 'wiz-transform-card-header' }, [
      el('span', { class: 'icon', html: icon('fileText', 12) }),
      'Placeholder (empty collection)',
    ]));

    placeholderCard.appendChild(el('label', {
      class: 'wiz-transform-toggle',
    }, [
      el('input', {
        type: 'checkbox', checked: wizState.placeholder || undefined,
        onchange: (e) => {
          wizState.placeholder = e.target.checked;
          if (wizState.placeholder) {
            // Clear all transforms when placeholder is enabled
            wizState.filters = [];
            wizState.transforms = [];
            wizState.catchAll = false;
          }
          renderDetailsControls();
          refreshPipeline();
        },
      }),
      el('span', { style: { fontWeight: '600', flex: '1' } }, 'Start empty'),
      el('span', { class: 'wiz-transform-hint' }, '.{?false}'),
    ]));

    if (wizState.placeholder) {
      placeholderCard.appendChild(el('div', {
        style: {
          padding: '8px 12px', fontSize: '11px', color: 'var(--text-secondary)',
          background: 'var(--bg-warm, #FFFDF5)', borderTop: '1px solid var(--border-light)',
          lineHeight: '1.5',
        },
      }, 'This dataset starts as an empty collection (.{?false}). '
        + 'Use conditional logic in your template to populate it. '
        + 'Useful as a default placeholder that other logic can override.'));
    }

    container.appendChild(placeholderCard);

    // When placeholder is active, skip all other transformation controls
    if (wizState.placeholder) return;
  }

  if (wizState.type === 'object') {
    renderObjectDetailsControls(container);
  } else if (wizState.type === 'single') {
    renderSingleDetailsControls(container);
  } else if (wizState.type === 'list') {
    renderListDetailsControls(container);
  } else if (wizState.type === 'bom') {
    // BOM: filters & transforms are configured in Source tab's specialized builder.
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

  // ── Universal: Accessor + Null-safe wrapper (all types) ──
  renderAccessorAndNullSafe(container);
}

/**
 * Accessor (.value / .valueDescription) + Null-safe wrapper — available on ALL types.
 * Renders into the Transformation tab.
 */
function renderAccessorAndNullSafe(container) {
  const card = el('div', { class: 'wiz-transform-card', style: { marginTop: '10px' } });

  // ── Accessor picker ──
  const currentAccessor = wizState.transforms.find(t => t.type === 'accessor');
  const accessors = [
    { key: '',                  label: '(none)',            desc: 'No accessor' },
    { key: '.value',            label: '.value',            desc: 'Raw attribute value' },
    { key: '.valueDescription', label: '.valueDescription', desc: 'Display label' },
    { key: '.price(0)',         label: '.price(0)',         desc: 'Price (0 decimals)' },
    { key: '.price(2)',         label: '.price(2)',         desc: 'Price (2 decimals)' },
    { key: '.round(2)',         label: '.round(2)',         desc: 'Round to 2 decimals' },
  ];

  const accSelect = el('select', {
    class: 'input', style: { fontSize: '12px' },
    onchange: (e) => {
      wizState.transforms = wizState.transforms.filter(t => t.type !== 'accessor');
      if (e.target.value) {
        wizState.transforms.unshift({ type: 'accessor', method: e.target.value });
      }
      renderDetailsControls(); refreshPipeline();
    },
  });
  accessors.forEach(a => {
    const opt = el('option', { value: a.key }, `${a.label} — ${a.desc}`);
    if (currentAccessor?.method === a.key) opt.selected = true;
    accSelect.appendChild(opt);
  });

  card.appendChild(el('div', { class: 'wiz-transform-card-header' }, [
    el('span', { class: 'icon', html: icon('type', 12) }),
    'Accessor',
  ]));
  card.appendChild(el('div', { style: { padding: '6px 10px' } }, [accSelect]));

  // ── Null-safe wrapper ──
  const currentNullSafe = wizState.transforms.find(t => t.type === 'nullSafe');

  const fallbackInput = el('input', {
    class: 'input',
    value: currentNullSafe?.fallback || 'N/A',
    placeholder: 'N/A',
    style: { fontSize: '12px', width: '80px' },
    oninput: (e) => {
      const ns = wizState.transforms.find(t => t.type === 'nullSafe');
      if (ns) { ns.fallback = e.target.value; refreshPipeline(); }
    },
  });

  card.appendChild(el('div', { class: 'wiz-transform-card-header', style: { marginTop: '6px', borderTop: '1px solid var(--border-light)', paddingTop: '8px' } }, [
    el('span', { class: 'icon', html: icon('shield', 12) }),
    'Null-safe wrapper',
  ]));

  card.appendChild(el('label', {
    class: 'wiz-transform-toggle',
  }, [
    el('input', {
      type: 'checkbox', checked: !!currentNullSafe,
      onchange: (e) => {
        const others = wizState.transforms.filter(t => t.type !== 'nullSafe');
        if (e.target.checked) {
          others.push({ type: 'nullSafe', fallback: fallbackInput.value || 'N/A' });
        }
        wizState.transforms = others;
        renderDetailsControls(); refreshPipeline();
      },
    }),
    el('span', { style: { fontWeight: '600', flex: '1' } }, 'Enable null-safe wrapper'),
    el('span', { class: 'wiz-transform-hint' }, '\u2260 null ? expr : "N/A"'),
  ]));

  if (currentNullSafe) {
    card.appendChild(el('div', { style: { padding: '4px 10px 8px', display: 'flex', alignItems: 'center', gap: '6px' } }, [
      el('span', { style: { fontSize: '11px', color: 'var(--text-secondary)' } }, 'Fallback:'),
      fallbackInput,
    ]));
  }

  container.appendChild(card);
}

// ── Object type: filters + transforms ──

function renderObjectDetailsControls(container) {
  // Filter builder (Spring EL .{? condition} syntax)
  container.appendChild(renderObjectFilterBuilder());

  // Catch-all remainder toggle (same as BOM — captures everything not in other datasets)
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
      el('span', { style: { color: 'var(--text-tertiary)', fontSize: '11px', marginLeft: 'auto' } }, 'captures everything not in other datasets'),
    ]));

    // When catch-all is active, show which other datasets will be excluded
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
          'No other object datasets to exclude from — add filtered ones first.'));
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
      (f.op !== 'not null' && f.op !== 'is null')
        ? el('span', { class: 'filter-val' }, f.isVariableRef ? f.value : `"${f.value}"`)
        : null,
      el('span', { class: 'filter-x', onclick: () => { wizState.filters.splice(idx, 1); renderDetailsControls(); refreshPipeline(); }, html: icon('x', 12) }),
    ]));
  });

  // Add filter row — field custom dropdown + operator dropdown + value
  const { allFields: filterFields } = getDrawerData();

  const fieldPicker = makeCustomDropdown('— field —', filterFields.map(f => ({ label: f, value: f })), { flex: '2', mono: true });
  const opPicker = makeCustomDropdown(OBJ_FILTER_OPS[0], OBJ_FILTER_OPS.map(o => ({ label: o, value: o })), { flex: '0 0 auto', minWidth: '70px' });
  opPicker._value = OBJ_FILTER_OPS[0];

  const valInput = el('input', { class: 'input', placeholder: 'value', style: { flex: '2' } });
  const isNullOp = (v) => v === 'not null' || v === 'is null';
  opPicker._onChange = (v) => { valInput.style.display = isNullOp(v) ? 'none' : ''; };

  const addBtn = el('button', {
    class: 'btn btn-sm btn-primary',
    onclick: () => {
      const field = fieldPicker._value || '', op = opPicker._value || OBJ_FILTER_OPS[0], value = valInput.value.trim();
      if (!field || (!isNullOp(op) && !value)) return;
      const filterEntry = { field, op, value: isNullOp(op) ? null : value };
      // Detect variable references (#varName) in value
      if (value && value.startsWith('#')) filterEntry.isVariableRef = true;
      wizState.filters.push(filterEntry);
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
  // Accessor and null-safe controls are now in the universal section (renderAccessorAndNullSafe).
  // Single type only adds its collection filter builder here.
  const recordCount = wizState.currentObjDesc?.recordCount || wizState.objectRecords?.length || 0;
  if (recordCount > 1 || wizState._singleFilter) {
    container.appendChild(renderSingleFilterBuilder());
  }
}

// ── Single type: guided collection filter ──

function renderSingleFilterBuilder() {
  const totalRecords = wizState.currentObjDesc?.recordCount || wizState.objectRecords?.length || 0;

  // Get filtered count
  const savedShowAll = _drawerShowAll;
  _drawerShowAll = false;
  const { records: filteredRecords } = getDrawerData();
  _drawerShowAll = savedShowAll;
  const filteredCount = filteredRecords.length;

  const filter = wizState._singleFilter;
  const hasFilter = filter && (filter.mode === 'first' || filter.mode === 'index' ||
    (filter.mode === 'field' && (filter.conditions || []).some(c => c.field && c.value)));

  const countLabel = hasFilter
    ? `${filteredCount} / ${totalRecords}`
    : `${totalRecords} records`;
  const countColor = hasFilter
    ? (filteredCount === 1 ? 'var(--success, #1A7F37)' : '#F57F17')
    : 'var(--text-tertiary)';

  const card = el('div', { class: 'wiz-transform-card' });
  card.appendChild(el('div', { class: 'wiz-transform-card-header' }, [
    el('span', { class: 'icon', style: { color: '#F57F17' }, html: icon('filter', 12) }),
    'Narrow to single record',
    el('span', { style: { fontSize: '10px', color: countColor, fontWeight: hasFilter ? '600' : '400', marginLeft: 'auto' } }, countLabel),
  ]));

  if (!filter) {
    // No filter set — show mode options
    const modeRow = el('div', { style: { display: 'flex', gap: '6px', padding: '8px 0' } });
    [
      { key: 'field', label: 'Match field', desc: '.{?field=="value"}' },
      { key: 'first', label: 'First',       desc: '[0]' },
      { key: 'index', label: 'By index',    desc: '[n]' },
    ].forEach(m => {
      modeRow.appendChild(el('button', {
        class: 'btn btn-outline btn-sm', style: { flex: '1', justifyContent: 'center', flexDirection: 'column', padding: '6px 4px', gap: '2px' },
        onclick: () => {
          wizState._singleFilter = { mode: m.key, conditions: [{ field: '', op: '==', value: '' }], logic: 'and', index: 0 };
          renderDetailsControls();
          refreshPipeline();
        },
      }, [
        el('span', { style: { fontFamily: 'var(--mono)', fontSize: '10px', color: 'var(--text-tertiary)' } }, m.desc),
        el('span', { style: { fontSize: '11px' } }, m.label),
      ]));
    });
    card.appendChild(modeRow);
  } else if (filter.mode === 'field') {
    // Multi-condition field match with AND/OR
    // Migrate old single-condition format
    if (!filter.conditions) {
      filter.conditions = [{ field: filter.field || '', op: filter.op || '==', value: filter.value || '' }];
      filter.logic = 'and';
    }

    // Get fields from the unfiltered data
    const savedShowAll = _drawerShowAll;
    _drawerShowAll = true;
    const { allFields, records } = getDrawerData();
    _drawerShowAll = savedShowAll;

    const condWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0' } });

    filter.conditions.forEach((cond, idx) => {
      // Logic label between conditions
      if (idx > 0) {
        condWrap.appendChild(el('div', { style: { textAlign: 'center', padding: '2px 0' } }, [
          el('button', {
            class: 'btn btn-sm', style: { fontSize: '10px', padding: '1px 8px', fontWeight: '600', color: 'var(--accent)' },
            onclick: () => { filter.logic = filter.logic === 'and' ? 'or' : 'and'; renderDetailsControls(); refreshPipeline(); },
            title: 'Toggle AND / OR',
          }, filter.logic === 'and' ? '&&  AND' : '||  OR'),
        ]));
      }

      const fieldSel = el('select', {
        class: 'input', style: { fontSize: '11px', flex: '1', minWidth: '0' },
        onchange: (e) => { cond.field = e.target.value; cond.value = ''; renderDetailsControls(); refreshPipeline(); },
      }, [
        el('option', { value: '' }, '— field —'),
        ...allFields.map(f => el('option', { value: f, selected: f === cond.field || undefined }, f)),
      ]);

      const opSel = el('select', {
        class: 'input', style: { fontSize: '11px', width: '56px', flexShrink: '0' },
        onchange: (e) => { cond.op = e.target.value; refreshPipeline(); },
      }, ['==', '!=', '>', '<', '>=', '<=', 'contains', 'matches'].map(op =>
        el('option', { value: op, selected: op === cond.op || undefined }, op)
      ));

      // Value: combo input with typeahead dropdown from column values
      const uniqueVals = (cond.field && records.length > 0)
        ? [...new Set(records.map(r => r[cond.field]).filter(v => v != null && v !== ''))].map(String).sort()
        : [];
      const valueEl = makeComboInput(cond.value || '', uniqueVals, {
        placeholder: 'value',
        onchange: (val) => { cond.value = val; refreshPipeline(); },
      });

      const removeCondBtn = el('button', {
        class: 'btn btn-sm',
        style: { padding: '2px', flexShrink: '0', width: '20px', visibility: filter.conditions.length > 1 ? 'visible' : 'hidden' },
        onclick: () => { filter.conditions.splice(idx, 1); renderDetailsControls(); refreshPipeline(); },
        html: icon('x', 10),
      });

      condWrap.appendChild(el('div', { style: { display: 'flex', gap: '3px', alignItems: 'center' } }, [
        fieldSel, opSel, valueEl, removeCondBtn,
      ]));
    });

    card.appendChild(condWrap);

    // Button row: Add condition + Remove all
    card.appendChild(el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', padding: '4px 0 2px' } }, [
      el('button', {
        class: 'btn btn-outline btn-sm',
        onclick: () => { filter.conditions.push({ field: '', op: '==', value: '' }); renderDetailsControls(); refreshPipeline(); },
      }, [el('span', { class: 'icon', html: icon('plus', 10) }), 'Add condition']),
      el('button', {
        class: 'btn btn-sm', style: { marginLeft: 'auto', padding: '2px 6px' },
        onclick: () => { wizState._singleFilter = null; renderDetailsControls(); refreshPipeline(); },
      }, [el('span', { class: 'icon', html: icon('x', 10) }), 'Remove']),
    ]));
  } else if (filter.mode === 'first') {
    card.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' } }, [
      el('span', { style: { fontSize: '12px' } }, 'Takes the first record'),
      el('span', { style: { fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-tertiary)' } }, '[0]'),
      el('button', {
        class: 'btn btn-sm', style: { marginLeft: 'auto', padding: '2px 6px' },
        onclick: () => { wizState._singleFilter = null; renderDetailsControls(); refreshPipeline(); },
      }, [el('span', { class: 'icon', html: icon('x', 10) }), 'Remove']),
    ]));
  } else if (filter.mode === 'index') {
    card.appendChild(el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' } }, [
      el('span', { style: { fontSize: '12px' } }, 'Record at index'),
      el('input', {
        class: 'input', type: 'number', value: filter.index || 0, min: 0,
        style: { fontSize: '11px', width: '50px', fontFamily: 'var(--mono)', textAlign: 'center' },
        oninput: (e) => { filter.index = parseInt(e.target.value) || 0; refreshPipeline(); },
      }),
      el('span', { style: { fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-tertiary)' } }, `[${filter.index || 0}]`),
      el('button', {
        class: 'btn btn-sm', style: { marginLeft: 'auto', padding: '2px 6px' },
        onclick: () => { wizState._singleFilter = null; renderDetailsControls(); refreshPipeline(); },
      }, [el('span', { class: 'icon', html: icon('x', 10) }), 'Remove']),
    ]));
  }

  return card;
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
    showWizValidationDialog('Cannot delete dataset', check.reason, details);
    return;
  }
  if (!confirm(`Delete dataset "${wizState.name}"? This cannot be undone.`)) return;
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
