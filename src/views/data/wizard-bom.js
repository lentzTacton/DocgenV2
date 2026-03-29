/**
 * BOM Section — Source, instance picker, filters, transforms, match preview.
 *
 * This module renders the BOM-specific UI and handles all BOM data manipulation.
 * It depends on wizState for shared state and calls refreshPipeline (passed as callback).
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import { wizState } from './wizard-state.js';
import {
  fetchRecords, getBomFieldValues, fetchModel, getStartingObject,
  fetchBomRecords,
} from '../../services/data-api.js';
import { matchesFilters } from '../../services/variables.js';

let refreshPipelineCallback = null;

/**
 * Set the refreshPipeline callback.
 * Called by the main wizard to inject the pipeline refresh function.
 */
export function setRefreshPipelineCallback(cb) {
  refreshPipelineCallback = cb;
}

/**
 * Convenience function to call the refresh callback.
 */
function refreshPipeline() {
  if (refreshPipelineCallback) refreshPipelineCallback();
}

/**
 * Render the entire BOM section.
 */
export function renderBomSection(container) {
  if (!container) return;
  clear(container);

  // Source — typeahead combo input
  container.appendChild(el('div', { class: 'form-group' }, [
    el('div', { class: 'field-label' }, [el('span', { class: 'icon', html: icon('database', 12) }), 'Source']),
    renderSourceCombo(),
  ]));

  // Instance picker — shows when the source resolves to a multi-instance collection
  container.appendChild(el('div', { id: 'wiz-instance-picker' }));
  renderInstancePicker();

  // Filter builder
  container.appendChild(el('div', { id: 'wiz-filters' }));
  renderFilterBuilder();

  // Catch-all
  container.appendChild(el('div', { style: { marginBottom: '12px' } }, [
    el('label', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer', padding: '8px 12px', border: '1px solid var(--border-light)', borderRadius: 'var(--radius)', background: '#FAFBFC' },
    }, [
      el('input', { type: 'checkbox', checked: wizState.catchAll || undefined, onchange: (e) => { wizState.catchAll = e.target.checked; refreshPipeline(); refreshMatchPreview(); } }),
      el('span', { style: { fontWeight: '600' } }, 'Catch-all remainder'),
      el('span', { style: { color: 'var(--text-tertiary)', fontSize: '11px', marginLeft: 'auto' } }, 'captures everything not in other variables'),
    ]),
  ]));

  // Transform pipeline builder
  container.appendChild(el('div', { id: 'wiz-transforms' }));
  renderTransformBuilder();

  // Match preview
  container.appendChild(el('div', { id: 'wiz-match-preview' }));
  refreshMatchPreview();
}

// ─── Source combo (typeahead + dropdown) ──────────────────────────────

function renderSourceCombo() {
  const wrap = el('div', { class: 'src-combo' });

  // Resolve display value: show the short name, not the full expression
  const currentSrc = wizState.bomSources.find(s => s.expression === wizState.source || s.name === wizState.source);
  const displayVal = currentSrc ? currentSrc.name : (wizState.source || '');

  const input = el('input', {
    class: 'input src-combo-input',
    id: 'wiz-source-input',
    type: 'text',
    value: displayVal,
    placeholder: 'Type or select a source…',
    autocomplete: 'off',
  });

  const dropBtn = el('button', {
    class: 'src-combo-drop',
    type: 'button',
    html: icon('chevronDown', 12),
    tabindex: '-1',
  });

  const list = el('div', {
    class: 'src-combo-list',
    id: 'wiz-source-list',
    style: { display: 'none' },
  });

  function buildOptions(filter) {
    clear(list);
    const lf = (filter || '').toLowerCase();
    const fallback = [{ name: 'flatbom', expression: '#this.flatbom', count: '?', category: 'bom', description: 'Flat BOM items' }];
    const allSources = wizState.bomSources.length > 0 ? wizState.bomSources : fallback;
    const options = allSources.filter(s =>
      !lf || s.name.toLowerCase().includes(lf) || (s.description || '').toLowerCase().includes(lf)
    );

    if (options.length === 0) {
      list.appendChild(el('div', { class: 'src-combo-empty' }, 'No matching sources'));
      return;
    }

    // Group by category
    const cats = { bom: 'BOM Collections', related: 'Related Objects', solution: 'Solution' };
    const grouped = {};
    for (const s of options) {
      const cat = s.category || 'bom';
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(s);
    }

    for (const [cat, items] of Object.entries(grouped)) {
      if (Object.keys(grouped).length > 1) {
        list.appendChild(el('div', { class: 'src-combo-cat' }, cats[cat] || cat));
      }
      for (const s of items) {
        const isActive = s.expression === wizState.source || s.name === wizState.source;
        list.appendChild(el('div', {
          class: `src-combo-opt ${isActive ? 'src-combo-opt-active' : ''}`,
          onmousedown: (e) => {
            e.preventDefault();
            selectSource(s);
          },
        }, [
          el('div', { class: 'src-combo-opt-main' }, [
            el('span', { class: 'src-combo-opt-name' }, s.name),
            el('span', { class: 'src-combo-opt-count' }, s.count !== '?' ? `${s.count} items` : ''),
          ]),
          s.description ? el('div', { class: 'src-combo-opt-desc' }, s.description) : null,
        ]));
      }
    }
  }

  function selectSource(src) {
    if (typeof src === 'string') {
      wizState.source = src;
      input.value = src;
    } else {
      wizState.source = src.expression || src.name;
      input.value = src.name;
    }
    wizState.instanceMode = 'all'; wizState.instanceId = null; wizState.instanceLabel = null;
    hideList();
    renderInstancePicker();
    refreshPipeline();
    refreshMatchPreview();
  }

  function showList() {
    // Show all options if the input shows the current source name; filter otherwise
    const currentSrcDef = wizState.bomSources.find(s => s.expression === wizState.source || s.name === wizState.source);
    const isCurrentName = currentSrcDef ? input.value === currentSrcDef.name : input.value === wizState.source;
    buildOptions(isCurrentName ? '' : input.value);
    list.style.display = '';
  }

  function hideList() {
    list.style.display = 'none';
  }

  // Input events
  input.addEventListener('focus', () => showList());
  input.addEventListener('input', () => {
    buildOptions(input.value);
    list.style.display = '';
  });
  input.addEventListener('blur', () => {
    setTimeout(() => {
      hideList();
      if (input.value.trim()) {
        const prevSource = wizState.source;
        const match = wizState.bomSources.find(s => s.name === input.value.trim());
        if (match) {
          wizState.source = match.expression || match.name;
        } else if (input.value.trim() !== wizState.source) {
          wizState.source = input.value.trim();
        }
        if (wizState.source !== prevSource) {
          wizState.instanceMode = 'all'; wizState.instanceId = null; wizState.instanceLabel = null;
          renderInstancePicker();
        }
        refreshPipeline();
        refreshMatchPreview();
      }
    }, 150);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (input.value.trim()) {
        const match = wizState.bomSources.find(s => s.name === input.value.trim());
        wizState.source = match ? (match.expression || match.name) : input.value.trim();
        wizState.instanceMode = 'all'; wizState.instanceId = null; wizState.instanceLabel = null;
        hideList();
        renderInstancePicker();
        refreshPipeline();
        refreshMatchPreview();
      }
    }
    if (e.key === 'Escape') {
      hideList();
      input.blur();
    }
  });

  // Drop button toggles the list
  dropBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (list.style.display === 'none') {
      input.focus();
      buildOptions(''); // show all options
      list.style.display = '';
    } else {
      hideList();
    }
  });

  wrap.appendChild(input);
  wrap.appendChild(dropBtn);
  wrap.appendChild(list);
  return wrap;
}

// ─── Instance picker ─────────────────────────────────────────────────
//
// For BOM sources: picks which ConfiguredProduct's BOM to use
//   (CPs are grouped by Solution)
// For related sources: picks which record from the collection
//   (records grouped by their parent ref)

async function renderInstancePicker() {
  const container = qs('#wiz-instance-picker');
  if (!container) return;
  clear(container);

  const srcDef = wizState.bomSources.find(s => s.expression === wizState.source || s.name === wizState.source);
  if (!srcDef) return;

  // Determine which object to show instances for
  let targetObjName = null;   // The object type whose records we show
  let pickerLabel = 'Instance';

  if (srcDef.category === 'bom' && srcDef.cpContext) {
    // BOM source → show CP instances (which CP's BOM?)
    targetObjName = srcDef.cpContext.objectName;
    pickerLabel = 'Configured Product';
  } else if (srcDef.category === 'related' && srcDef.objectName) {
    // Related source → show records of that object type
    targetObjName = srcDef.objectName;
    pickerLabel = srcDef.objectName;
  } else {
    return; // No instance selection needed
  }

  if (!targetObjName) return;

  // Fetch records
  let records = [];
  try {
    records = await fetchRecords(targetObjName);
  } catch (e) { /* ignore */ }

  if (records.length === 0) return;

  const labelField = findLabelField(records[0]);

  // ── Resolve parent grouping (e.g., CP → Solution) ──
  const model = wizState.modelObjects;
  const objDef = model.find(o => o.name === targetObjName);
  let parentRefAttr = null;
  let parentObjName = null;
  let parentById = {};

  if (objDef) {
    const startObj = getStartingObject();
    // Look for ref to starting object (Solution) first
    for (const attr of objDef.attributes) {
      if (attr.refType && (attr.refType === startObj || attr.refType.toLowerCase().includes('solution'))) {
        parentRefAttr = attr.name;
        parentObjName = attr.refType;
        break;
      }
    }
    // Fallback: any non-self ref
    if (!parentRefAttr) {
      for (const attr of objDef.attributes) {
        if (attr.refType && attr.refType !== targetObjName) {
          parentRefAttr = attr.name;
          parentObjName = attr.refType;
          break;
        }
      }
    }
  }

  // Fetch parent records for labels
  if (parentObjName) {
    try {
      const parentRecs = await fetchRecords(parentObjName);
      const pLabelField = findLabelField(parentRecs[0]);
      for (const p of parentRecs) {
        const pid = getRecordId(p);
        parentById[pid] = pLabelField ? (p[pLabelField] || pid) : pid;
      }
    } catch (e) { /* ignore */ }
  }

  // Group records by parent
  const groups = {};
  const noParent = [];
  for (const rec of records) {
    const parentId = parentRefAttr ? (rec[parentRefAttr] || null) : null;
    if (parentId && parentById[parentId]) {
      if (!groups[parentId]) groups[parentId] = { label: parentById[parentId], id: parentId, records: [] };
      groups[parentId].records.push(rec);
    } else {
      noParent.push(rec);
    }
  }

  const hasGroups = Object.keys(groups).length > 0;
  const isBomSource = srcDef.category === 'bom';
  const pickerEl = el('div', { class: 'inst-picker' });

  // ── "All" option ──
  const allDesc = isBomSource
    ? `Iterate all ${records.length} products — $for{#cp in ...}$ pattern`
    : `Iterate all ${records.length} ${targetObjName}s (for-loop)`;

  pickerEl.appendChild(el('div', {
    class: `inst-opt ${wizState.instanceMode === 'all' ? 'inst-opt-sel' : ''}`,
    onclick: () => {
      wizState.instanceMode = 'all'; wizState.instanceId = null;
      wizState.instanceLabel = null; wizState.instanceSolution = null;
      renderInstancePicker(); refreshPipeline();
    },
  }, [
    el('span', { class: 'icon', html: icon('list', 14) }),
    el('div', { class: 'inst-opt-text' }, [
      el('div', { class: 'inst-opt-label' }, 'All'),
      el('div', { class: 'inst-opt-desc' }, allDesc),
    ]),
  ]));

  // ── Grouped instances ──
  if (hasGroups) {
    for (const [parentId, group] of Object.entries(groups)) {
      pickerEl.appendChild(el('div', { class: 'inst-group-head' }, [
        el('span', { class: 'icon', style: { color: 'var(--text-tertiary)' }, html: icon('cube', 10) }),
        `${parentObjName}: ${group.label}`,
      ]));

      for (const rec of group.records) {
        pickerEl.appendChild(buildInstanceRow(rec, labelField, srcDef, group.label, isBomSource));
      }
    }
  }

  // ── Ungrouped instances ──
  if (noParent.length > 0) {
    if (hasGroups) pickerEl.appendChild(el('div', { class: 'inst-group-head' }, 'Other'));
    for (const rec of noParent) {
      pickerEl.appendChild(buildInstanceRow(rec, labelField, srcDef, null, isBomSource));
    }
  }

  container.appendChild(el('div', { class: 'form-group', style: { marginTop: '8px' } }, [
    el('div', { class: 'field-label' }, [el('span', { class: 'icon', html: icon('target', 12) }), pickerLabel]),
    pickerEl,
  ]));
}

function buildInstanceRow(rec, labelField, srcDef, solutionLabel, isBomSource) {
  const recId = getRecordId(rec);
  const label = labelField ? (rec[labelField] || recId) : recId;
  const isSelected = wizState.instanceMode === 'single' && wizState.instanceId === recId;

  const descParts = [];
  if (isBomSource && srcDef.cpContext) descParts.push(srcDef.cpContext.objectName);
  else descParts.push(srcDef.objectName);
  descParts.push(recId);
  if (solutionLabel) descParts.push(`on ${solutionLabel}`);

  return el('div', {
    class: `inst-opt ${isSelected ? 'inst-opt-sel' : ''}`,
    onclick: () => {
      wizState.instanceMode = 'single';
      wizState.instanceId = recId;
      wizState.instanceLabel = label;
      wizState.instanceSolution = solutionLabel || null;
      renderInstancePicker();
      refreshPipeline();
      if (isBomSource) loadBomForInstance(srcDef.cpContext?.objectName, recId);
    },
  }, [
    el('span', { class: 'icon', style: { color: 'var(--tacton-blue)' }, html: icon('cube', 14) }),
    el('div', { class: 'inst-opt-text' }, [
      el('div', { class: 'inst-opt-label' }, [
        label,
        solutionLabel ? el('span', { class: 'inst-opt-solution' }, solutionLabel) : null,
      ]),
      el('div', { class: 'inst-opt-desc' }, descParts.join(' — ')),
    ]),
  ]);
}

/** Get the ID from a record, trying common field names. */
function getRecordId(rec) {
  return rec.id || rec._id || rec.ID || rec.Id || Object.values(rec)[0];
}

/** Find the most recognizable label field from a record. */
function findLabelField(record) {
  if (!record) return null;
  const candidates = ['name', 'description', 'label', 'title', 'displayName', 'productName', 'partNumber'];
  const keys = Object.keys(record);
  for (const c of candidates) {
    const match = keys.find(k => k.toLowerCase() === c.toLowerCase());
    if (match && record[match]) return match;
  }
  for (const k of keys) {
    if (k.toLowerCase() === 'id' || k.startsWith('_')) continue;
    if (typeof record[k] === 'string' && record[k].length > 0 && record[k].length < 100) return k;
  }
  return null;
}

/** Load BOM records scoped to a specific parent instance. */
async function loadBomForInstance(parentObjName, instanceId) {
  // TODO: When the API supports it, fetch BOM scoped to this instance
  refreshMatchPreview();
}

function renderFilterBuilder() {
  const container = qs('#wiz-filters');
  if (!container) return;
  clear(container);

  container.appendChild(el('div', { class: 'form-label', style: { display: 'flex', alignItems: 'center' } }, [
    el('span', { class: 'icon', html: icon('filter', 12) }), 'Filter conditions',
    wizState.filters.length > 0
      ? el('span', { class: 'badge badge-muted', style: { fontSize: '9px', marginLeft: 'auto' } },
          `match ${wizState.filterLogic === 'and' ? 'ALL' : 'ANY'} (${wizState.filterLogic.toUpperCase()})`)
      : null,
  ]));

  // Existing rows
  wizState.filters.forEach((f, idx) => {
    if (idx > 0) container.appendChild(el('div', { style: { textAlign: 'center' } }, el('span', { class: 'filter-logic' }, wizState.filterLogic)));
    container.appendChild(el('div', { class: 'filter-row' }, [
      el('span', { class: 'filter-field' }, f.field),
      el('span', { class: 'filter-op' }, f.op),
      f.op !== 'not null' ? el('span', { class: 'filter-val' }, `"${f.value}"`) : null,
      el('span', { class: 'filter-x', onclick: () => { wizState.filters.splice(idx, 1); renderFilterBuilder(); refreshPipeline(); refreshMatchPreview(); }, html: icon('x', 12) }),
    ]));
  });

  // Add row — field dropdown from API
  const fieldSel = el('select', { style: { flex: '1', padding: '3px 6px', border: '1px solid var(--border)', borderRadius: '4px', fontFamily: 'var(--mono)', fontSize: '11px', background: '#fff' } },
    [el('option', { value: '' }, '— field —'), ...wizState.bomFields.map(f => el('option', { value: f }, f))]);
  const opSel = el('select', { style: { padding: '3px 6px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '11px', background: '#fff' } },
    ['==', '!=', 'contains', '>', '<', 'not null'].map(o => el('option', { value: o }, o)));
  const valInput = el('input', { placeholder: 'value', style: { flex: '1', padding: '3px 8px', border: '1px solid var(--border)', borderRadius: '4px', fontFamily: 'var(--mono)', fontSize: '11px', background: '#fff' } });
  const dlist = el('datalist', { id: 'wiz-val-sg' });
  valInput.setAttribute('list', 'wiz-val-sg');

  fieldSel.addEventListener('change', async () => {
    if (!fieldSel.value) return;
    clear(dlist);
    try { (await getBomFieldValues(fieldSel.value)).slice(0, 50).forEach(v => dlist.appendChild(el('option', { value: v }))); } catch (e) { /* ignore */ }
  });
  opSel.addEventListener('change', () => { valInput.style.display = opSel.value === 'not null' ? 'none' : ''; });

  const addBtn = el('button', {
    class: 'btn btn-sm btn-primary', style: { padding: '3px 8px', flexShrink: '0' },
    onclick: () => {
      const field = fieldSel.value, op = opSel.value, value = valInput.value.trim();
      if (!field || (op !== 'not null' && !value)) return;
      wizState.filters.push({ field, op, value: op === 'not null' ? '' : value });
      renderFilterBuilder(); refreshPipeline(); refreshMatchPreview();
    },
  }, [el('span', { class: 'icon', html: icon('plus', 12) }), 'Add']);

  valInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
  container.appendChild(el('div', { class: 'filter-add-row' }, [fieldSel, opSel, valInput, dlist, addBtn]));

  if (wizState.filters.length >= 2) {
    container.appendChild(el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } }, [
      el('button', { class: 'btn btn-outline btn-sm', onclick: () => { wizState.filterLogic = wizState.filterLogic === 'or' ? 'and' : 'or'; renderFilterBuilder(); refreshPipeline(); refreshMatchPreview(); } },
        `Switch to ${wizState.filterLogic === 'or' ? 'AND' : 'OR'} logic`),
    ]));
  }
}

// ─── Transform pipeline builder ──────────────────────────────────────

export const TRANSFORM_TYPES = [
  { key: 'fieldExtract', label: 'Extract field', icon: 'target', desc: 'Pick a single field from each item', syntax: '.{field}', needsField: true },
  { key: 'groupBy',      label: 'Group by',      icon: 'layers', desc: 'Group items by a field value', syntax: ".groupBy('field')", needsField: true },
  { key: 'flatten',      label: 'Flatten',        icon: 'minimize', desc: 'Flatten nested collections into one', syntax: '.flatten()', needsField: false },
  { key: 'sum',          label: 'Sum',            icon: 'hash',    desc: 'Sum numeric values', syntax: '.sum()', needsField: false },
  { key: 'size',         label: 'Count',          icon: 'hash',    desc: 'Count number of items', syntax: '.size()', needsField: false },
  { key: 'sort',         label: 'Sort',           icon: 'arrowDown', desc: 'Sort by a field', syntax: ".sort('field')", needsField: true },
];

function renderTransformBuilder() {
  const container = qs('#wiz-transforms');
  if (!container) return;
  clear(container);

  container.appendChild(el('div', { class: 'form-label', style: { display: 'flex', alignItems: 'center' } }, [
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
      const def = TRANSFORM_TYPES.find(d => d.key === t.type) || TRANSFORM_TYPES[0];
      chain.appendChild(el('div', { class: 'tf-step' }, [
        el('div', { class: 'tf-step-head' }, [
          el('span', { class: 'icon', style: { color: 'var(--tacton-blue)' }, html: icon(def.icon, 12) }),
          el('span', { class: 'tf-step-label' }, def.label),
          t.field ? el('span', { class: 'tf-step-field' }, t.field) : null,
          el('button', {
            class: 'tf-step-x',
            onclick: () => { wizState.transforms.splice(idx, 1); renderTransformBuilder(); refreshPipeline(); },
            html: icon('x', 10),
          }),
        ]),
        el('div', { class: 'tf-step-syntax' }, buildTransformSyntax(t)),
      ]));
      if (idx < wizState.transforms.length - 1) {
        chain.appendChild(el('div', { class: 'tf-chain-arrow' }, [el('span', { html: icon('arrowDown', 8) })]));
      }
    });
    container.appendChild(chain);
  }

  // Add transform button + dropdown
  const addWrap = el('div', { class: 'tf-add-wrap' });
  const addBtn = el('button', {
    class: 'btn btn-outline btn-sm',
    id: 'tf-add-btn',
    onclick: () => {
      const menu = qs('#tf-add-menu');
      if (menu) menu.style.display = menu.style.display === 'none' ? '' : 'none';
    },
  }, [el('span', { class: 'icon', html: icon('plus', 12) }), 'Add transform']);

  const menu = el('div', { class: 'tf-add-menu', id: 'tf-add-menu', style: { display: 'none' } });
  for (const def of TRANSFORM_TYPES) {
    menu.appendChild(el('div', {
      class: 'tf-add-opt',
      onclick: () => {
        if (def.needsField) {
          // Show field picker inline
          showTransformFieldPicker(menu, def);
        } else {
          wizState.transforms.push({ type: def.key });
          menu.style.display = 'none';
          renderTransformBuilder();
          refreshPipeline();
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
  container.appendChild(addWrap);
}

function showTransformFieldPicker(menu, def) {
  // Replace menu content with field picker
  clear(menu);
  menu.appendChild(el('div', { class: 'tf-field-picker' }, [
    el('div', { style: { fontSize: '11px', fontWeight: '600', marginBottom: '4px' } }, `${def.label} — pick a field`),
    el('div', { class: 'tf-field-list' },
      wizState.bomFields.length > 0
        ? wizState.bomFields.map(f => el('button', {
            class: 'tf-field-btn',
            onclick: () => {
              wizState.transforms.push({ type: def.key, field: f });
              menu.style.display = 'none';
              renderTransformBuilder();
              refreshPipeline();
            },
          }, f))
        : [
            el('input', {
              class: 'input', placeholder: 'field name', style: { fontSize: '11px' },
              onkeydown: (e) => {
                if (e.key === 'Enter' && e.target.value.trim()) {
                  wizState.transforms.push({ type: def.key, field: e.target.value.trim() });
                  menu.style.display = 'none';
                  renderTransformBuilder();
                  refreshPipeline();
                }
              },
            }),
          ]
    ),
    el('button', {
      class: 'btn btn-sm', style: { marginTop: '4px' },
      onclick: () => { menu.style.display = 'none'; renderTransformBuilder(); },
    }, 'Cancel'),
  ]));
}

export function buildTransformSyntax(t) {
  switch (t.type) {
    case 'fieldExtract': return `.{${t.field || 'field'}}`;
    case 'groupBy':      return `.groupBy('${t.field || 'field'}')`;
    case 'flatten':      return '.flatten()';
    case 'sum':          return '.sum()';
    case 'size':         return '.size()';
    case 'sort':         return `.sort('${t.field || 'field'}')`;
    default:             return '';
  }
}

export function refreshMatchPreview() {
  const container = qs('#wiz-match-preview');
  if (!container) return;
  clear(container);
  if (wizState.bomRecords.length === 0) {
    container.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-tertiary)', padding: '12px', textAlign: 'center', border: '1px solid var(--border-light)', borderRadius: 'var(--radius)' } }, 'No BOM records loaded.'));
    return;
  }

  let matched;
  if (wizState.catchAll) {
    const others = (state.get('variables') || []).filter(v => v.type === 'bom' && !v.catchAll);
    const excl = new Set();
    others.forEach(v => { wizState.bomRecords.forEach((r, i) => { if (matchesFilters(r, v.filters, v.filterLogic)) excl.add(i); }); });
    matched = wizState.bomRecords.filter((_, i) => !excl.has(i));
  } else if (wizState.filters.length > 0) {
    matched = wizState.bomRecords.filter(r => matchesFilters(r, wizState.filters, wizState.filterLogic));
  } else {
    matched = wizState.bomRecords;
  }

  container.appendChild(el('div', { class: 'form-label' }, [
    el('span', { class: 'icon', html: icon('eye', 12) }), 'Matched items',
    el('span', { class: 'badge badge-grn', style: { marginLeft: 'auto' } }, `${matched.length} / ${wizState.bomRecords.length}`),
  ]));

  const priCols = ['jdePartNumber', 'partNumber', 'description', 'jdeSegmentGroup', 'segmentGroup', 'netPrice', 'listPrice', 'totalQty'];
  const allCols = wizState.bomFields.length > 0 ? wizState.bomFields : Object.keys(wizState.bomRecords[0] || {}).filter(k => !k.startsWith('_'));
  const cols = [];
  for (const c of priCols) { const f = allCols.find(a => a.toLowerCase() === c.toLowerCase()); if (f && cols.length < 4) cols.push(f); }
  for (const c of allCols) { if (cols.length >= 4) break; if (!cols.includes(c)) cols.push(c); }
  if (cols.length === 0) return;

  const showMax = 5;
  const rows = matched.slice(0, showMax).map(rec =>
    el('tr', { class: 'hit' }, cols.map(c => {
      const val = findField(rec, c) || '';
      const isNum = !isNaN(parseFloat(val)) && val.length < 15;
      return el('td', { style: isNum ? { textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: '600', fontSize: '11px' } : {} }, isNum ? fmtNum(val) : trunc(val, 30));
    }))
  );
  if (matched.length > showMax) rows.push(el('tr', {}, [el('td', { colspan: String(cols.length), style: { textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '11px', padding: '6px' } }, `+ ${matched.length - showMax} more`)]));
  container.appendChild(el('table', { class: 'mtbl' }, [
    el('thead', {}, [el('tr', {}, cols.map(c => el('th', {}, shortCol(c))))]),
    el('tbody', {}, rows),
  ]));
}

// ─── Utilities ────────────────────────────────────────────────────────

function findField(rec, name) {
  const k = Object.keys(rec).find(k => k.toLowerCase() === name.toLowerCase());
  return k ? rec[k] : undefined;
}

function shortCol(name) {
  return name.replace(/^jde/, '').replace(/([A-Z])/g, ' $1').trim().substring(0, 12);
}

function trunc(s, m) {
  return s && s.length > m ? s.substring(0, m) + '…' : s || '';
}

function fmtNum(v) {
  const n = parseFloat(v);
  if (isNaN(n)) return v;
  return n > 100 ? '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(n);
}
