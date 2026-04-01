/**
 * Wizard Drawer — Slide-up data preview for the variable wizard.
 *
 * Shows paginated record tables, column selection, and auto-loads
 * records when a source is configured.
 *
 * Extracted from variable-wizard.js for maintainability.
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import { isConnected, fetchRecords, resolveCurrentObject } from '../../services/data-api.js';
import { matchesFilters } from '../../services/variables.js';
import { wizState } from './wizard-state.js';
import { resolveConfigAttrAcrossCPs } from '../../services/config-resolver.js';

// ─── Drawer state ───────────────────────────────────────────────────────

const DRAWER_PAGE_SIZE = 15;

let _drawerPage = 0;
let _drawerPinned = false;
let _drawerTab = 'data';
let _drawerLoading = false;
let _drawerLoadAttempted = false;
let _drawerShowAll = false;

export function resetDrawerLoadAttempt() {
  _drawerLoadAttempted = false;
}

// ─── List utilities (also used by wizard-transforms.js) ─────────────────

export function parseListValues(src) {
  const raw = src || '{""}';
  const values = [];
  const matchIter = raw.matchAll(/"([^"]*)"/g);
  for (const m of matchIter) values.push(m[1]);
  return values;
}

export function buildListSource(values) {
  const nonEmpty = values.filter(v => v !== '');
  if (nonEmpty.length === 0) return '{""}';
  return `{${nonEmpty.map(v => `"${v}"`).join(',')}}`;
}

// ─── Get drawer data ────────────────────────────────────────────────────

/**
 * Get the current dataset for the drawer (records + available fields).
 * @param {Object} [opts]
 * @param {boolean} [opts.showAll] - Override the "show all" toggle (ignores _drawerShowAll)
 */
export function getDrawerData({ showAll } = {}) {
  const effectiveShowAll = showAll !== undefined ? showAll : _drawerShowAll;

  let records = [];
  let allFields = [];

  if (wizState.type === 'bom') {
    records = wizState.bomRecords || [];
    allFields = wizState.bomFields.length > 0
      ? wizState.bomFields
      : (records.length > 0 ? Object.keys(records[0]).filter(k => !k.startsWith('_')) : []);
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
    if (!effectiveShowAll && records.length > 0 && wizState.type === 'single' && wizState._singleFilter) {
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

  const visibleCols = wizState.previewColumns.length > 0
    ? wizState.previewColumns.filter(c => allFields.includes(c))
    : allFields.slice(0, 6);

  return { records, allFields, visibleCols };
}

// ─── Shared data table renderer ─────────────────────────────────────────

export function renderSharedDataTable(container, records, visibleCols, opts = {}) {
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

// ─── Drawer DOM ─────────────────────────────────────────────────────────

export function renderDataDrawer(parentContainer) {
  const drawer = el('div', { id: 'wiz-data-drawer', class: 'data-drawer' });

  const bar = el('div', { class: 'data-drawer-bar', id: 'wiz-drawer-bar' }, [
    el('span', { class: 'data-drawer-bar-icon', html: icon('table', 12) }),
    el('span', { class: 'data-drawer-bar-label', id: 'wiz-drawer-bar-label' }, 'Hover to preview matched records'),
    el('span', { class: 'data-drawer-bar-count', id: 'wiz-drawer-bar-count' }),
    el('span', { class: 'data-drawer-bar-chevron', html: icon('chevronUp', 10) }),
  ]);

  const panel = el('div', { class: 'data-drawer-panel', id: 'wiz-drawer-panel' });
  const panelHeader = el('div', { class: 'data-drawer-header' }, [
    el('div', { class: 'data-drawer-tabs', id: 'wiz-drawer-tabs' }),
    el('div', { class: 'data-drawer-actions', id: 'wiz-drawer-actions' }),
  ]);
  panel.appendChild(panelHeader);
  panel.appendChild(el('div', { id: 'wiz-drawer-body', class: 'data-drawer-body' }));

  drawer.appendChild(bar);
  drawer.appendChild(panel);

  drawer.addEventListener('mouseenter', () => {
    if (!_drawerPinned) drawer.classList.add('data-drawer-open');
    refreshDrawerContent();
  });
  drawer.addEventListener('mouseleave', () => {
    if (!_drawerPinned) drawer.classList.remove('data-drawer-open');
  });

  bar.addEventListener('click', () => {
    _drawerPinned = !_drawerPinned;
    drawer.classList.toggle('data-drawer-open', _drawerPinned);
    drawer.classList.toggle('data-drawer-pinned', _drawerPinned);
    if (_drawerPinned) refreshDrawerContent();
  });

  parentContainer.appendChild(drawer);
}

// ─── Drawer bar ─────────────────────────────────────────────────────────

export function updateDrawerBar() {
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

// ─── Drawer content ─────────────────────────────────────────────────────

export function refreshDrawerContent() {
  const tabs = qs('#wiz-drawer-tabs');
  const actions = qs('#wiz-drawer-actions');
  const body = qs('#wiz-drawer-body');
  if (!tabs || !body) return;

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

  const btnRow = el('div', { style: { display: 'flex', gap: '6px', marginTop: '8px', flexWrap: 'wrap' } });
  const { records } = getDrawerData();
  if (records.length > 0) {
    btnRow.appendChild(el('button', {
      class: 'btn btn-outline btn-sm',
      onclick: () => {
        const emptyCols = allFields.filter(f =>
          records.every(r => r[f] == null || String(r[f]).trim() === '' || r[f] === 'null')
        );
        if (emptyCols.length === 0) return;
        if (wizState.previewColumns.length === 0) {
          wizState.previewColumns = [...visibleCols];
        }
        wizState.previewColumns = wizState.previewColumns.filter(c => !emptyCols.includes(c));
        refreshDrawerContent();
        updateDrawerBar();
      },
    }, [el('span', { class: 'icon', html: icon('x', 10) }), 'Hide empty']));
  }

  btnRow.appendChild(el('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => {
      wizState.previewColumns = [];
      refreshDrawerContent();
    },
  }, 'Reset to auto-select'));

  body.appendChild(colGrid);
  body.appendChild(btnRow);

  requestAnimationFrame(() => {
    const chips = colGrid.querySelectorAll('.col-chip-tip');
    if (chips.length === 0) return;
    const firstTop = chips[0].offsetTop;
    chips.forEach(c => {
      if (c.offsetTop === firstTop) c.classList.add('col-chip-tip-down');
    });
  });
}

// ─── Record loading ─────────────────────────────────────────────────────

export async function loadDrawerRecords() {
  if (_drawerLoading) return;
  if (!isConnected() || !wizState.source) return;

  _drawerLoading = true;
  _drawerLoadAttempted = true;
  updateDrawerBar();

  try {
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
    const drawer = qs('#wiz-data-drawer');
    if (drawer?.classList.contains('data-drawer-open')) {
      refreshDrawerContent();
    }
  }
}

export async function loadConfigDrawerRecords() {
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
