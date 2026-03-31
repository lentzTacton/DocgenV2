/**
 * Variable Detail — Full edit view for a single variable.
 *
 * All fields are editable:
 *   - Name (with # prefix, mono font)
 *   - Description
 *   - Type-specific config:
 *     BOM:    source dropdown, filter builder, match preview
 *     Object: expression path input (or explorer when connected)
 *     List:   static value editor
 *   - Generated expression (read-only, copy)
 *   - Save / Delete buttons
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import {
  updateVariable, removeVariable, generateExpression,
  validateName, matchesFilters,
} from '../../services/variables.js';
import {
  isConnected, getBomFields, getBomFieldValues, getBomSources,
  fetchBomRecords,
} from '../../services/data-api.js';

const TYPE_CONFIG = {
  bom:    { badge: 'badge-bom', label: 'BOM', icon: 'box', color: 'var(--orange)' },
  object: { badge: 'badge-obj', label: 'OBJ', icon: 'cube', color: 'var(--purple)' },
  list:   { badge: 'badge-list', label: 'LIST', icon: 'list', color: 'var(--tacton-blue)' },
};

// Local edit state
let edit = {};
let bomFields = [];
let bomSources = [];
let bomRecords = [];

export function renderVariableDetail(container) {
  const varId = state.get('activeVariable');
  const variables = state.get('variables') || [];
  const variable = variables.find(v => v.id === varId);

  if (!variable) {
    state.set('dataView', 'list');
    return;
  }

  // Clone for local editing
  edit = JSON.parse(JSON.stringify(variable));
  if (!edit.filters) edit.filters = [];
  if (!edit.filterLogic) edit.filterLogic = 'or';

  const tc = TYPE_CONFIG[edit.type] || TYPE_CONFIG.bom;

  // ── Back button ──
  container.appendChild(
    el('button', {
      class: 'back-btn',
      onclick: () => { state.set('activeVariable', null); state.set('dataView', 'list'); },
    }, [el('span', { class: 'icon', html: icon('chevronLeft', 14) }), 'Back'])
  );

  // ── Header (type icon + badge, read-only) ──
  container.appendChild(
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' } }, [
      el('span', { class: 'icon', style: { color: tc.color }, html: icon(tc.icon, 18) }),
      el('span', { style: { fontWeight: '700', fontSize: '14px' } }, 'Edit Variable'),
      el('span', { class: `badge ${tc.badge}` }, tc.label),
    ])
  );

  // ── Name (editable) ──
  container.appendChild(el('div', { class: 'form-group' }, [
    el('div', { class: 'field-label' }, 'Name'),
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, [
      el('span', { style: { fontFamily: 'var(--mono)', fontSize: '14px', color: 'var(--text-tertiary)', fontWeight: '700' } }, '#'),
      el('input', {
        class: 'form-input', id: 'det-name',
        value: edit.name.replace(/^#/, ''),
        style: { fontFamily: 'var(--mono)' },
        oninput: (e) => { edit.name = `#${e.target.value.replace(/^#/, '')}`; refreshExpr(); },
      }),
    ]),
    el('div', { id: 'det-err', style: { color: 'var(--danger)', fontSize: '11px', marginTop: '4px', display: 'none' } }),
  ]));

  // ── Description (editable) ──
  container.appendChild(el('div', { class: 'form-group' }, [
    el('div', { class: 'field-label' }, ['Description ', el('span', { style: { fontWeight: '400', textTransform: 'none', letterSpacing: '0' } }, '(optional)')]),
    el('input', {
      class: 'form-input', id: 'det-desc',
      value: edit.description || '',
      placeholder: 'What this variable represents',
      oninput: (e) => { edit.description = e.target.value; },
    }),
  ]));

  // ── Type-specific sections ──
  container.appendChild(el('div', { class: 'data-sep' }));

  if (edit.type === 'bom') {
    container.appendChild(el('div', { id: 'det-bom-section' }));
    bootBomAsync();
  } else if (edit.type === 'object' || edit.type === 'single') {
    renderObjectSection(container);
  } else {
    renderListSection(container);
  }

  // ── Expression display ──
  container.appendChild(el('div', { class: 'data-sep' }));
  container.appendChild(el('div', { class: 'form-group' }, [
    el('div', { class: 'field-label' }, [el('span', { class: 'icon', html: icon('code', 12) }), ' Expression']),
    el('div', {
      id: 'det-expr',
      style: {
        fontFamily: 'var(--mono)', fontSize: '11px', color: 'var(--text-secondary)',
        background: 'var(--bg)', padding: '8px 10px', border: '1px solid var(--border-light)',
        borderRadius: 'var(--radius)', wordBreak: 'break-all', lineHeight: '1.5', minHeight: '20px',
      },
    }, generateExpression(edit)),
    el('button', {
      class: 'btn-ghost', style: { marginTop: '4px', fontSize: '11px' },
      onclick: () => {
        const expr = generateExpression(edit);
        navigator.clipboard.writeText(expr);
        const btn = qs('#det-copy-btn');
        if (btn) { btn.textContent = 'Copied!'; setTimeout(() => { btn.innerHTML = `${icon('copy', 11)} Copy`; }, 1200); }
      },
      id: 'det-copy-btn',
      html: `${icon('copy', 11)} Copy`,
    }),
  ]));

  // ── Action buttons ──
  container.appendChild(
    el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px' } }, [
      el('button', {
        class: 'btn btn-primary',
        style: { flex: '1', justifyContent: 'center' },
        onclick: handleSave,
      }, [el('span', { class: 'icon', html: icon('check', 14) }), 'Save changes']),
      el('button', {
        class: 'btn-danger',
        onclick: handleDelete,
        html: `${icon('trash', 14)} Delete`,
      }),
    ])
  );
}


// ═══════════════════════════════════════════════════════════════════════
//  BOM SECTION
// ═══════════════════════════════════════════════════════════════════════

async function bootBomAsync() {
  const section = qs('#det-bom-section');
  if (!section) return;

  if (isConnected()) {
    section.innerHTML = `<div class="obj-empty">${icon('loader', 14)} Loading BOM data...</div>`;
    try {
      const [sources, fields, records] = await Promise.all([
        getBomSources(), getBomFields(), fetchBomRecords(),
      ]);
      bomSources = sources; bomFields = fields; bomRecords = records;
    } catch (e) { console.error('[detail] BOM boot:', e); }
  }

  renderBomSection(section);
}

function renderBomSection(container) {
  if (!container) return;
  clear(container);

  // Source dropdown
  const sourceOpts = bomSources.map(s =>
    el('option', { value: s.name, selected: s.name === edit.source ? true : undefined },
      `${s.name} (${s.count} items)`)
  );
  if (sourceOpts.length === 0) sourceOpts.push(el('option', { value: edit.source || '#this.flatbom' }, edit.source || '#this.flatbom'));

  container.appendChild(el('div', { class: 'form-group' }, [
    el('div', { class: 'field-label' }, [el('span', { class: 'icon', html: icon('database', 12) }), ' Source']),
    el('select', {
      class: 'form-input', style: { fontFamily: 'var(--mono)', fontSize: '12px' },
      onchange: (e) => { edit.source = e.target.value; refreshExpr(); refreshMatchPreview(); },
    }, sourceOpts),
  ]));

  // Filter builder
  container.appendChild(el('div', { id: 'det-filters' }));
  renderFilterBuilder();

  // Catch-all toggle
  container.appendChild(el('div', { style: { marginBottom: '10px' } }, [
    el('label', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', cursor: 'pointer', padding: '7px 10px', border: '1px solid var(--border-light)', borderRadius: 'var(--radius)', background: 'var(--bg)' },
    }, [
      el('input', { type: 'checkbox', checked: edit.catchAll || undefined, onchange: (e) => { edit.catchAll = e.target.checked; refreshExpr(); refreshMatchPreview(); } }),
      el('span', { style: { fontWeight: '600' } }, 'Catch-all remainder'),
      el('span', { style: { color: 'var(--text-tertiary)', fontSize: '10px', marginLeft: 'auto' } }, 'items not in other variables'),
    ]),
  ]));

  // Match preview
  container.appendChild(el('div', { id: 'det-match-preview' }));
  refreshMatchPreview();
}

function renderFilterBuilder() {
  const container = qs('#det-filters');
  if (!container) return;
  clear(container);

  container.appendChild(el('div', { class: 'field-label', style: { display: 'flex', alignItems: 'center' } }, [
    el('span', { class: 'icon', html: icon('filter', 12) }), ' Filters',
    edit.filters.length > 0
      ? el('span', { class: 'badge badge-muted', style: { fontSize: '9px', marginLeft: 'auto' } },
          `${edit.filterLogic.toUpperCase()} logic`)
      : null,
  ]));

  // Existing filter rows
  edit.filters.forEach((f, idx) => {
    if (idx > 0) container.appendChild(el('div', { style: { textAlign: 'center' } }, el('span', { class: 'filter-logic' }, edit.filterLogic)));
    container.appendChild(el('div', { class: 'filter-row' }, [
      el('span', { class: 'filter-field' }, f.field),
      el('span', { class: 'filter-op' }, f.op),
      f.op !== 'not null' ? el('span', { class: 'filter-val' }, `"${f.value}"`) : null,
      el('span', { class: 'filter-x', onclick: () => { edit.filters.splice(idx, 1); renderFilterBuilder(); refreshExpr(); refreshMatchPreview(); }, html: icon('x', 12) }),
    ]));
  });

  // Add filter row — with field dropdown from API
  const fieldSel = el('select', { style: { flex: '1', padding: '3px 6px', border: '1px solid var(--border)', borderRadius: '4px', fontFamily: 'var(--mono)', fontSize: '11px', background: '#fff' } },
    [el('option', { value: '' }, '— field —'), ...bomFields.map(f => el('option', { value: f }, f))]);
  const opSel = el('select', { style: { padding: '3px 6px', border: '1px solid var(--border)', borderRadius: '4px', fontSize: '11px', background: '#fff' } },
    ['==', '!=', 'contains', '>', '<', 'not null'].map(o => el('option', { value: o }, o)));
  const valInput = el('input', { placeholder: 'value', style: { flex: '1', padding: '3px 8px', border: '1px solid var(--border)', borderRadius: '4px', fontFamily: 'var(--mono)', fontSize: '11px' } });
  const dlist = el('datalist', { id: 'det-val-sg' });
  valInput.setAttribute('list', 'det-val-sg');

  fieldSel.addEventListener('change', async () => {
    if (!fieldSel.value) return;
    clear(dlist);
    if (isConnected()) { (await getBomFieldValues(fieldSel.value)).slice(0, 50).forEach(v => dlist.appendChild(el('option', { value: v }))); }
  });
  opSel.addEventListener('change', () => { valInput.style.display = opSel.value === 'not null' ? 'none' : ''; });

  const addBtn = el('button', {
    class: 'btn btn-sm btn-primary', style: { padding: '3px 8px', flexShrink: '0' },
    onclick: () => {
      const field = fieldSel.value, op = opSel.value, value = valInput.value.trim();
      if (!field || (op !== 'not null' && !value)) return;
      edit.filters.push({ field, op, value: op === 'not null' ? '' : value });
      renderFilterBuilder(); refreshExpr(); refreshMatchPreview();
    },
  }, [el('span', { class: 'icon', html: icon('plus', 12) }), 'Add']);

  valInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') addBtn.click(); });
  container.appendChild(el('div', { class: 'filter-add-row' }, [fieldSel, opSel, valInput, dlist, addBtn]));

  if (edit.filters.length >= 2) {
    container.appendChild(el('div', { style: { display: 'flex', gap: '6px', marginTop: '4px' } }, [
      el('button', { class: 'btn btn-outline btn-sm', onclick: () => { edit.filterLogic = edit.filterLogic === 'or' ? 'and' : 'or'; renderFilterBuilder(); refreshExpr(); refreshMatchPreview(); } },
        `Switch to ${edit.filterLogic === 'or' ? 'AND' : 'OR'}`),
    ]));
  }
}

function refreshMatchPreview() {
  const container = qs('#det-match-preview');
  if (!container) return;
  clear(container);

  if (bomRecords.length === 0) {
    if (isConnected()) container.appendChild(el('div', { style: { fontSize: '11px', color: 'var(--text-tertiary)', padding: '10px', textAlign: 'center', border: '1px solid var(--border-light)', borderRadius: 'var(--radius)' } }, 'No BOM records loaded.'));
    return;
  }

  let matched;
  if (edit.catchAll) {
    const others = (state.get('variables') || []).filter(v => v.type === 'bom' && !v.catchAll && v.id !== edit.id);
    const excl = new Set();
    others.forEach(v => { bomRecords.forEach((r, i) => { if (matchesFilters(r, v.filters, v.filterLogic)) excl.add(i); }); });
    matched = bomRecords.filter((_, i) => !excl.has(i));
  } else if (edit.filters.length > 0) {
    matched = bomRecords.filter(r => matchesFilters(r, edit.filters, edit.filterLogic));
  } else {
    matched = bomRecords;
  }

  edit.matchCount = matched.length;

  container.appendChild(el('div', { class: 'field-label', style: { display: 'flex', alignItems: 'center' } }, [
    el('span', { class: 'icon', html: icon('eye', 12) }), ' Matched',
    el('span', { class: 'badge badge-grn', style: { marginLeft: 'auto' } }, `${matched.length} / ${bomRecords.length}`),
  ]));

  // Table
  const priCols = ['jdePartNumber', 'partNumber', 'description', 'jdeSegmentGroup', 'netPrice'];
  const allCols = bomFields.length > 0 ? bomFields : Object.keys(bomRecords[0] || {}).filter(k => !k.startsWith('_'));
  const cols = [];
  for (const c of priCols) { const f = allCols.find(a => a.toLowerCase() === c.toLowerCase()); if (f && cols.length < 4) cols.push(f); }
  for (const c of allCols) { if (cols.length >= 4) break; if (!cols.includes(c)) cols.push(c); }
  if (cols.length === 0) return;

  const showMax = 4;
  const rows = matched.slice(0, showMax).map(rec =>
    el('tr', { class: 'hit' }, cols.map(c => {
      const val = findField(rec, c) || '';
      const isNum = !isNaN(parseFloat(val)) && val.length < 15;
      return el('td', { style: isNum ? { textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: '600', fontSize: '11px' } : {} }, isNum ? fmtNum(val) : trunc(val, 24));
    }))
  );
  if (matched.length > showMax) rows.push(el('tr', {}, [el('td', { colspan: String(cols.length), style: { textAlign: 'center', color: 'var(--text-tertiary)', fontSize: '10px', padding: '4px' } }, `+ ${matched.length - showMax} more`)]));
  container.appendChild(el('table', { class: 'mtbl' }, [
    el('thead', {}, [el('tr', {}, cols.map(c => el('th', {}, shortCol(c))))]),
    el('tbody', {}, rows),
  ]));
}


// ═══════════════════════════════════════════════════════════════════════
//  OBJECT SECTION
// ═══════════════════════════════════════════════════════════════════════

function renderObjectSection(container) {
  container.appendChild(el('div', { class: 'form-group' }, [
    el('div', { class: 'field-label' }, [el('span', { class: 'icon', html: icon('target', 12) }), ' Expression path']),
    el('input', {
      class: 'form-input',
      style: { fontFamily: 'var(--mono)', fontSize: '12px' },
      value: edit.source || '',
      placeholder: 'e.g. solution.opportunity.account.name',
      oninput: (e) => { edit.source = e.target.value; refreshExpr(); },
    }),
    el('div', { class: 'field-hint' }, 'Dot-walk path from the starting object to a value field.'),
  ]));
}


// ═══════════════════════════════════════════════════════════════════════
//  LIST SECTION
// ═══════════════════════════════════════════════════════════════════════

function renderListSection(container) {
  container.appendChild(el('div', { class: 'form-group' }, [
    el('div', { class: 'field-label' }, [el('span', { class: 'icon', html: icon('list', 12) }), ' Values']),
    el('input', {
      class: 'form-input',
      style: { fontFamily: 'var(--mono)', fontSize: '12px' },
      value: edit.source || '',
      placeholder: '{"value1","value2","value3"}',
      oninput: (e) => { edit.source = e.target.value; refreshExpr(); },
    }),
    el('div', { class: 'field-hint' }, 'Comma-separated values inside {"...","..."}.'),
  ]));
}


// ═══════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════

function refreshExpr() {
  const exprEl = qs('#det-expr');
  if (exprEl) exprEl.textContent = generateExpression(edit);
}

function findField(rec, name) {
  const k = Object.keys(rec).find(k => k.toLowerCase() === name.toLowerCase());
  return k ? rec[k] : undefined;
}
function shortCol(name) { return name.replace(/^jde/, '').replace(/([A-Z])/g, ' $1').trim().substring(0, 12); }
function trunc(s, m) { return s && s.length > m ? s.substring(0, m) + '\u2026' : s || ''; }
function fmtNum(v) { const n = parseFloat(v); if (isNaN(n)) return v; return n > 100 ? '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(n); }

async function handleSave() {
  // Validate name
  const variables = state.get('variables') || [];
  const nameVal = edit.name;
  const error = validateName(nameVal, variables.filter(v => v.id !== edit.id));
  if (error) {
    const e = qs('#det-err');
    if (e) { e.textContent = error; e.style.display = ''; }
    return;
  }

  // Update catch-all excludeVars
  if (edit.catchAll) {
    edit.excludeVars = variables.filter(v => v.type === 'bom' && !v.catchAll && v.id !== edit.id).map(v => v.name);
  }

  await updateVariable(edit.id, edit);
  state.set('activeVariable', null);
  state.set('dataView', 'list');
}

async function handleDelete() {
  if (!confirm(`Delete dataset "${edit.name}"?`)) return;
  await removeVariable(edit.id);
  state.set('activeVariable', null);
  state.set('dataView', 'list');
}
