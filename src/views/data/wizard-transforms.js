/**
 * Wizard Transforms — Transformation tab controls for all dataset types.
 *
 * Object:  filter builder (.{? condition}) + transform chain (.sort, .groupBy, etc.)
 * Single:  single-record filter (field match / first / index) + accessor + null-safe
 * List:    individual value editor + CSV paste import
 * BOM:     summary only (filters/transforms configured in Source tab via wizard-bom.js)
 *
 * Extracted from variable-wizard.js for maintainability.
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import { wizState } from './wizard-state.js';
import { buildTransformSyntax } from './wizard-bom.js';
import { makeCustomDropdown, makeComboInput } from '../../components/custom-dropdown.js';
import { getDrawerData, parseListValues, buildListSource } from './wizard-drawer.js';

// ─── Refresh pipeline callback (set by main wizard) ────────────────────

let _refreshPipeline = null;
export function setTransformRefreshCallback(fn) { _refreshPipeline = fn; }
function refreshPipeline() { if (_refreshPipeline) _refreshPipeline(); }

// ─── Constants ──────────────────────────────────────────────────────────

const OBJ_FILTER_OPS = ['==', '!=', '>', '<', '>=', '<=', 'contains', 'matches', 'is null', 'not null'];

const OBJ_TRANSFORM_TYPES = [
  { key: 'fieldExtract', label: 'Extract field',  icon: 'target',   desc: 'Project a single field from each item', syntax: '.{field}', needsField: true },
  { key: 'groupBy',      label: 'Group by',        icon: 'layers',   desc: 'Group items by a field value', syntax: ".groupBy('field')", needsField: true },
  { key: 'flatten',      label: 'Flatten',          icon: 'minimize', desc: 'Flatten nested collections', syntax: '.flatten()', needsField: false },
  { key: 'sum',          label: 'Sum',              icon: 'hash',     desc: 'Sum numeric values', syntax: '.sum()', needsField: false },
  { key: 'size',         label: 'Count',            icon: 'hash',     desc: 'Count items in collection', syntax: '.size()', needsField: false },
  { key: 'sort',         label: 'Sort',             icon: 'arrowDown', desc: 'Sort by a field', syntax: ".sort('field')", needsField: true },
];

// ─── Main entry: renderDetailsControls ──────────────────────────────────

export function renderDetailsControls() {
  const container = qs('#wiz-details-controls');
  if (!container) return;
  clear(container);

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
    if (wizState.placeholder) return;
  }

  if (wizState.type === 'object') {
    renderObjectDetailsControls(container);
  } else if (wizState.type === 'single') {
    renderSingleDetailsControls(container);
  } else if (wizState.type === 'list') {
    renderListDetailsControls(container);
  } else if (wizState.type === 'bom') {
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

  renderAccessorAndNullSafe(container);
}

// ─── Accessor + Null-safe (all types) ───────────────────────────────────

function renderAccessorAndNullSafe(container) {
  const card = el('div', { class: 'wiz-transform-card', style: { marginTop: '10px' } });

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

// ─── Object type: filters + transforms ──────────────────────────────────

function renderObjectDetailsControls(container) {
  container.appendChild(renderObjectFilterBuilder());

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
      if (value && value.startsWith('#')) filterEntry.isVariableRef = true;
      wizState.filters.push(filterEntry);
      renderDetailsControls(); refreshPipeline();
    },
  }, [el('span', { class: 'icon', html: icon('plus', 12) }), 'Add']);

  valInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
  wrap.appendChild(el('div', { class: 'filter-add-row' }, [fieldPicker, opPicker, valInput, addBtn]));

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
  const { allFields } = getDrawerData();
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

// ─── Single type ────────────────────────────────────────────────────────

function renderSingleDetailsControls(container) {
  const recordCount = wizState.currentObjDesc?.recordCount || wizState.objectRecords?.length || 0;
  if (recordCount > 1 || wizState._singleFilter) {
    container.appendChild(renderSingleFilterBuilder());
  }
}

function renderSingleFilterBuilder() {
  const totalRecords = wizState.currentObjDesc?.recordCount || wizState.objectRecords?.length || 0;

  const { records: filteredRecords } = getDrawerData({ showAll: false });
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
    if (!filter.conditions) {
      filter.conditions = [{ field: filter.field || '', op: filter.op || '==', value: filter.value || '' }];
      filter.logic = 'and';
    }

    const { allFields, records } = getDrawerData({ showAll: true });

    const condWrap = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0' } });

    filter.conditions.forEach((cond, idx) => {
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

// ─── List type ──────────────────────────────────────────────────────────

export function renderListDetailsControls(container) {
  const wrap = el('div', { class: 'form-group', style: { marginBottom: '8px' } });
  wrap.appendChild(el('div', { class: 'form-label' }, [
    el('span', { class: 'icon', html: icon('list', 12) }),
    'List values',
    el('span', { class: 'badge badge-muted', style: { fontSize: '9px', marginLeft: 'auto' } },
      `${parseListValues(wizState.source).length} items`),
  ]));

  const values = parseListValues(wizState.source);
  if (values.length === 0) values.push('');

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

  const btnRow = el('div', { style: { display: 'flex', gap: '6px', marginTop: '6px' } });

  btnRow.appendChild(el('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => {
      values.push('');
      wizState.source = buildListSource(values);
      renderDetailsControls(); refreshPipeline();
    },
  }, [el('span', { class: 'icon', html: icon('plus', 12) }), 'Add value']));

  btnRow.appendChild(el('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => {
      const pasteArea = wrap.querySelector('.list-paste-area');
      if (pasteArea) { pasteArea.style.display = pasteArea.style.display === 'none' ? '' : 'none'; }
    },
  }, [el('span', { class: 'icon', html: icon('clipboard', 12) }), 'Paste / CSV']));

  wrap.appendChild(btnRow);

  const pasteWrap = el('div', { class: 'list-paste-area', style: { display: 'none', marginTop: '6px' } });
  pasteWrap.appendChild(el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '4px' } },
    'Paste comma-separated values below. One value per line or separated by commas.'));
  const textarea = el('textarea', {
    class: 'input', placeholder: 'value1, value2, value3\nor one per line',
    style: { fontSize: '11px', fontFamily: 'var(--mono)', minHeight: '60px', resize: 'vertical', width: '100%', boxSizing: 'border-box' },
  });
  pasteWrap.appendChild(textarea);

  const importRow = el('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } });

  importRow.appendChild(el('button', {
    class: 'btn btn-primary btn-sm',
    onclick: () => {
      const raw = textarea.value.trim();
      if (!raw) return;
      const lines = raw.split(/\r?\n/);
      const newVals = [];
      for (const line of lines) {
        const parts = line.split(',');
        for (let p of parts) {
          p = p.trim().replace(/^["']|["']$/g, '');
          if (p) newVals.push(p);
        }
      }
      if (newVals.length === 0) return;
      const existingNonEmpty = values.filter(v => v !== '');
      const merged = existingNonEmpty.length > 0 ? [...existingNonEmpty, ...newVals] : newVals;
      wizState.source = buildListSource(merged);
      textarea.value = '';
      pasteWrap.style.display = 'none';
      renderDetailsControls(); refreshPipeline();
    },
  }, [el('span', { class: 'icon', html: icon('check', 12) }), 'Import']));

  const fileInput = el('input', {
    type: 'file', accept: '.csv,.txt', style: { display: 'none' },
    onchange: (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => { textarea.value = reader.result; };
      reader.readAsText(file);
    },
  });
  importRow.appendChild(fileInput);
  importRow.appendChild(el('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => fileInput.click(),
  }, [el('span', { class: 'icon', html: icon('upload', 12) }), 'Load CSV file']));

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
