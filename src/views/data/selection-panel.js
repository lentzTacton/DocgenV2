/**
 * Selection Panel — slide-up bottom panel that appears when the user
 * selects a template expression in the Word document.
 *
 * Features:
 *   - Parses and shows expression structure
 *   - Live-resolves against Tacton API (sample data preview)
 *   - "Create dataset" action with catalogue picker + favourite
 *   - Duplicate detection (warns if expression already exists)
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import {
  describeExpression,
  canCreateDataSet,
  suggestDataSetFields,
  parseMultipleDefines,
  reverseParseSource,
  parseSourceFilters,
} from '../../services/expression-parser.js';
import {
  createVariable,
  detectType,
} from '../../services/variables.js';
import {
  isConnected,
  fetchStartingObjectInstances,
  getSelectedInstance,
  setSelectedInstance,
  getStartingObject,
} from '../../services/data-api.js';
import { resolveExpression, applyFiltersAndIndex } from '../../services/expression-resolver.js';

// ─── Panel state ────────────────────────────────────────────────────

let panelEl = null;
let isOpen = false;
let currentParsed = null;
let resolveData = null;
let isResolving = false;
let _solutionFilter = null;  // Client-side solution name filter for config data

// ─── Favourite catalogue (persisted via localStorage) ───────────────

const FAV_KEY = 'docgen_fav_catalogue';

function getFavouriteCatalogue() {
  try { return localStorage.getItem(FAV_KEY) || null; } catch { return null; }
}

function setFavouriteCatalogue(id) {
  try {
    if (id) localStorage.setItem(FAV_KEY, String(id));
    else localStorage.removeItem(FAV_KEY);
  } catch { /* noop */ }
}

// ─── Shared catalogue / section picker builder ─────────────────────

/**
 * Build catalogue + section picker elements with wired-up event handling.
 * Returns { catSelect, secSelect, errorEl, getSelected, refreshSectionPicker }.
 *   getSelected() → { catalogueId, sectionId }
 */
function buildCatalogueSectionPicker() {
  const catalogues = (state.get('catalogues') || []).filter(c => !c.readonly);
  const favId = getFavouriteCatalogue();

  const sortedCats = [...catalogues].sort((a, b) => {
    if (String(a.id) === favId) return -1;
    if (String(b.id) === favId) return 1;
    return (a.order || 0) - (b.order || 0);
  });

  let selectedCatId = favId && catalogues.find(c => String(c.id) === favId)
    ? favId
    : (catalogues[0] ? catalogues[0].id : null);
  let selectedSectionId = null;

  const allSections = state.get('sections') || [];

  // Catalogue select
  const catSelect = el('select', { class: 'sel-create-select' });
  if (sortedCats.length === 0) {
    catSelect.appendChild(el('option', { value: '' }, 'No catalogues — create one first'));
    catSelect.disabled = true;
  } else {
    for (const cat of sortedCats) {
      const isFav = String(cat.id) === favId;
      const opt = el('option', { value: cat.id }, `${isFav ? '★ ' : ''}${cat.name} (${cat.scope})`);
      if (String(cat.id) === String(selectedCatId)) opt.selected = true;
      catSelect.appendChild(opt);
    }
  }

  // Section select
  const secSelect = el('select', { class: 'sel-create-select' });

  function refreshSectionPicker() {
    while (secSelect.firstChild) secSelect.removeChild(secSelect.firstChild);
    const catSections = allSections.filter(s => String(s.catalogueId) === String(selectedCatId) && !s.locked);
    secSelect.appendChild(el('option', { value: '' }, '— No section —'));
    for (const sec of catSections) {
      secSelect.appendChild(el('option', { value: sec.id }, sec.name));
    }
    selectedSectionId = null;
  }
  refreshSectionPicker();

  catSelect.addEventListener('change', () => {
    selectedCatId = catSelect.value || null;
    refreshSectionPicker();
  });
  secSelect.addEventListener('change', () => {
    const val = secSelect.value;
    selectedSectionId = val ? (isNaN(Number(val)) ? val : Number(val)) : null;
  });

  const errorEl = el('div', { class: 'sel-create-error', style: { display: 'none' } });

  return {
    catSelect,
    secSelect,
    errorEl,
    favId,
    selectedCatId: () => selectedCatId,
    selectedSectionId: () => selectedSectionId,
    getSelected: () => ({ catalogueId: selectedCatId, sectionId: selectedSectionId }),
    refreshSectionPicker,
  };
}

// ─── Unique name generation ─────────────────────────────────────────

/**
 * Generate a unique name for an imported dataset.
 * Appends `_imported_xyz` (short random suffix) when the base name
 * already exists, so imports never collide with hand-crafted sets.
 */
function makeUniqueName(baseName) {
  const existingNames = new Set((state.get('variables') || []).map(v => v.name));

  // If name is already unique, still tag it as imported for clarity
  const shortId = Math.random().toString(36).slice(2, 5); // e.g. 'k7f'
  const importedName = baseName.replace(/_imported_\w+$/, '') + `_imported_${shortId}`;

  // If base name doesn't exist yet, offer it as-is (user can rename)
  if (!existingNames.has(baseName)) return baseName;

  // Otherwise use the tagged name
  return importedName;
}

// ─── Initialise ─────────────────────────────────────────────────────

/**
 * Create the panel DOM element and append it to the taskpane.
 * Subscribe to `word.selection` changes on the state bus.
 */
export function initSelectionPanel() {
  panelEl = el('div', { id: 'selection-panel', class: 'sel-panel' });
  // Append at the end of the taskpane so it sits on top
  const tp = qs('.taskpane');
  if (tp) tp.appendChild(panelEl);

  state.on('word.selection', (sel) => {
    if (sel && sel.multiDefines) {
      // Multi-define detection
      currentParsed = null;
      resolveData = null;
      openPanel();
      renderMultiDefinePanel(sel.multiDefines);
    } else if (sel && sel.parsed) {
      currentParsed = sel.parsed;
      resolveData = null;
      _solutionFilter = null;
      openPanel();
      renderPanel();
      // Auto-resolve
      autoResolve(sel.parsed);
    } else {
      currentParsed = null;
      closePanel();
    }
  });
}

// ─── Open / close ───────────────────────────────────────────────────

function openPanel() {
  if (!panelEl) return;
  isOpen = true;
  panelEl.classList.add('sel-panel-open');
}

function closePanel() {
  if (!panelEl) return;
  isOpen = false;
  panelEl.classList.remove('sel-panel-open');
}

// ─── Render ─────────────────────────────────────────────────────────

function renderPanel() {
  if (!panelEl || !currentParsed) return;
  clear(panelEl);

  const parsed = currentParsed;

  // Header row
  const headerRow = el('div', { class: 'sel-panel-header' }, [
    el('div', { class: 'sel-panel-title-row' }, [
      el('span', { class: 'sel-panel-icon', html: icon('code', 16) }),
      el('span', { class: 'sel-panel-title' }, 'Expression detected'),
    ]),
    el('button', {
      class: 'sel-panel-close',
      onclick: () => { state.set('word.selection', null); },
      html: icon('x', 14),
    }),
  ]);

  // Expression badge row
  // For 'inline' type, show the inferred data type (e.g. SINGLE) not "INLINE"
  const effectiveType = parsed.type === 'inline' ? (parsed.dataType || 'single') : parsed.type;
  const typeBadgeClass = {
    define: 'badge-type-define',
    'inline-assign': 'badge-type-inline',
    single: 'badge-type-single',
    bom: 'badge-type-bom',
    object: 'badge-type-object',
    list: 'badge-type-list',
    code: 'badge-type-code',
    for: 'badge-type-for',
    endfor: 'badge-type-endfor',
    dotpath: 'badge-type-dotpath',
  }[effectiveType] || '';

  const typeBadgeLabel = parsed.type === 'inline-assign' ? 'BLOCK' : effectiveType.toUpperCase();

  const exprRow = el('div', { class: 'sel-panel-expr' }, [
    el('span', { class: `sel-panel-type-badge ${typeBadgeClass}` }, typeBadgeLabel),
    el('code', { class: 'sel-panel-code' }, parsed.raw),
  ]);

  // Description
  const descRow = el('div', { class: 'sel-panel-desc' }, describeExpression(parsed));

  // Breakdown table
  const breakdownRows = buildBreakdownRows(parsed);
  const breakdown = el('div', { class: 'sel-panel-breakdown' }, breakdownRows);

  // ── Not connected → show connect prompt instead of resolve + actions ──
  const connected = isConnected();
  const hasTicket = !!state.get('tickets.selected');

  if (!connected) {
    const connectMsg = el('div', { class: 'sel-panel-connect-msg' }, [
      el('span', { class: 'sel-panel-connect-icon', html: icon('link', 18) }),
      el('div', {}, [
        el('div', { class: 'sel-panel-connect-title' }, 'Connect to Tacton first'),
        el('div', { class: 'sel-panel-connect-desc' },
          !state.get('connection.status') || state.get('connection.status') === 'disconnected'
            ? 'Set up a Tacton instance connection in the Setup tab to resolve expressions and create datasets.'
            : !hasTicket
              ? 'Select a ticket in the Setup tab to start working with data.'
              : 'Complete the setup to use data features.'
        ),
      ]),
    ]);
    panelEl.append(headerRow, exprRow, descRow, breakdown, connectMsg);
    return;
  }

  // ── Placeholder detection — skip instance picker & data preview ──
  const isPlaceholder = (parsed.source || '').includes('.{?false}');

  // ── Instance picker (simulation context) ──
  const instanceBar = el('div', { class: 'sel-instance-bar', id: 'sel-instance-bar' });
  if (!isPlaceholder) {
    renderInstancePicker(instanceBar);
  }

  // Resolve area (pass dupeInfo so it can use existing variable's column settings)
  // Find ALL matching duplicates (not just the first)
  const dupeMatches = canCreateDataSet(parsed) ? checkDuplicates(parsed) : [];
  const dupeInfo = dupeMatches.length > 0 ? dupeMatches[0] : null;
  const resolveArea = el('div', { class: 'sel-panel-resolve', id: 'sel-resolve-area' });
  if (isPlaceholder) {
    resolveArea.appendChild(el('div', {
      style: { padding: '8px 12px', fontSize: '11px', color: 'var(--text-tertiary)', fontStyle: 'italic' },
    }, 'Placeholder — starts as an empty collection (.{?false})'));
  } else {
    renderResolveArea(resolveArea, dupeInfo);
  }

  // Actions
  const actions = el('div', { class: 'sel-panel-actions' });
  if (canCreateDataSet(parsed)) {
    if (dupeMatches.length > 0) {
      // Found banner — header with inline "Create new" button
      const warnText = dupeMatches.length === 1
        ? `Already exists as "${dupeMatches[0].name}"`
        : `Found ${dupeMatches.length} existing datasets — click to edit`;
      const foundBar = el('div', { class: 'sel-panel-found-bar' }, [
        el('div', { class: 'sel-panel-found-text' }, [
          el('span', { class: 'icon', html: icon('database', 13) }),
          el('span', {}, warnText),
        ]),
        el('button', {
          class: 'btn btn-sm sel-panel-found-create',
          onclick: () => showCreateDataSetForm(parsed, dupeInfo),
        }, [el('span', { html: icon('plus', 12) }), 'Create new']),
      ]);
      actions.appendChild(foundBar);

      // Match list — compact clickable rows
      const allSections = state.get('sections') || [];
      const matchList = el('div', { class: 'sel-match-list' });

      dupeMatches.forEach(dupe => {
        const dupeSection = dupe.sectionId ? allSections.find(s => s.id === dupe.sectionId) : null;
        const isLocked = dupeSection?.locked;
        const navIcon = isLocked ? 'eye' : 'edit';
        const location = [dupe.catalogueName, dupeSection?.name].filter(Boolean).join(' › ') || 'No catalogue';

        matchList.appendChild(
          el('div', {
            class: 'sel-match-row',
            onclick: () => {
              closePanel();
              state.set('activeVariable', dupe.id);
              state.set('dataView', 'detail');
            },
          }, [
            el('span', { class: 'sel-match-row-icon', html: icon(navIcon, 12) }),
            el('span', { class: 'sel-match-row-loc' }, [
              isLocked ? el('span', { class: 'icon', html: icon('lock', 9) }) : null,
              location,
            ]),
            el('span', { class: 'sel-match-row-name' }, dupe.name),
            el('span', { class: 'sel-match-row-arrow', html: icon('chevronRight', 10) }),
          ])
        );
      });

      actions.appendChild(matchList);
    } else {
      actions.appendChild(
        el('button', {
          class: 'btn btn-primary btn-sm sel-panel-create-btn',
          onclick: () => showCreateDataSetForm(parsed, dupeInfo),
        }, [
          el('span', { html: icon('plus', 14) }),
          'Create dataset',
        ])
      );
    }
  }

  panelEl.append(headerRow, exprRow, descRow, breakdown, instanceBar, resolveArea, actions);
}

// ─── Breakdown table ────────────────────────────────────────────────

function buildBreakdownRows(parsed) {
  const rows = [];

  const addRow = (label, value, valueStyle) => {
    if (!value) return;
    rows.push(
      el('div', { class: 'sel-bd-row' }, [
        el('span', { class: 'sel-bd-label' }, label),
        typeof value === 'string'
          ? el('span', { class: 'sel-bd-value', style: valueStyle || {} }, value)
          : el('span', { class: 'sel-bd-value', style: valueStyle || {} }, [value]),
      ])
    );
  };

  // Parse filter/index from source to show clean breakdown
  const sourceExpr = parsed.source || parsed.loopSource || '';
  const { cleanSource, filters, filterLogic, indexAccess } = parseSourceFilters(sourceExpr);

  // Name — for inline/dotpath, derive a short name from the clean path
  if (parsed.name) {
    let displayName = parsed.name;
    if (parsed.type === 'inline' || parsed.type === 'dotpath') {
      const clean = parseSourceFilters(parsed.name).cleanSource;
      // Use last two segments as a short readable name (e.g. "opportunity.name")
      const segs = clean.replace(/^#(this|cp)\./, '').split('.');
      displayName = segs.length > 2 ? segs.slice(-2).join('.') : clean;
    }
    addRow('Name', displayName);
  }

  // Source — clean, without filter/index syntax
  // Check if source references a #variable that doesn't exist
  const allVarsForCheck = state.get('variables') || [];
  const existingVarNames = new Set(allVarsForCheck.map(v => v.name));

  if (parsed.source) {
    const configPath = parsed.source.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
    const sourceDisplay = configPath ? configPath[1] : cleanSource;
    // Flag red if source starts with #var that doesn't exist
    // #this is a context alias (resolves to starting object), not a variable
    const sourceRefMatch = cleanSource.match(/^(#\w+)/);
    const sourceRefMissing = sourceRefMatch && sourceRefMatch[1] !== '#this' && !existingVarNames.has(sourceRefMatch[1]);
    if (sourceRefMissing) {
      addRow('Source', el('span', {}, [
        el('span', {}, sourceDisplay),
        el('span', { style: { fontSize: '9px', fontWeight: '600', color: '#D32F2F', marginLeft: '6px' } }, 'not in data'),
      ]), { color: '#D32F2F', fontFamily: 'var(--mono)' });
    } else {
      addRow('Source', sourceDisplay);
    }
  }

  // Filter conditions
  if (filters.length > 0) {
    const logic = filterLogic === 'or' ? ' || ' : ' && ';
    const filterText = filters.map(f => {
      if (f.field === '_literal') return f.value === 'false' ? '{?false} (empty collection)' : '{?true} (all records)';
      if (f.op === 'is null') return `${f.field} == null`;
      if (f.op === 'not null') return `${f.field} != null`;
      if (f.isVariableRef) return `${f.field} ${f.op} ${f.value}`;
      return `${f.field} ${f.op} "${f.value}"`;
    }).join(logic);
    addRow('Filter', filterText);
  }

  // Index access
  if (indexAccess != null) {
    const indexLabel = indexAccess === 0 ? '[0] (first record)' : `[${indexAccess}] (record ${indexAccess})`;
    addRow('Index', indexLabel);
  }

  // Parent context — detect when source starts with #varName. (dot-walk into a parent)
  // Only show if the parent ref differs from the clean source (otherwise it's redundant)
  // #this is a context alias (resolves to starting object), not a parent variable
  const parentLoopMatch = (parsed.source || '').match(/^(#\w+)\./);
  if (parentLoopMatch && parentLoopMatch[1] !== '#this' && parentLoopMatch[1] !== cleanSource) {
    const parentRef = parentLoopMatch[1];
    const parentMissing = !existingVarNames.has(parentRef);
    if (parentMissing) {
      addRow('Parent context', el('span', {}, [
        el('span', {}, parentRef),
        el('span', { style: { fontSize: '9px', fontWeight: '600', color: '#D32F2F', marginLeft: '6px' } }, 'not in data'),
      ]), { fontFamily: 'var(--mono)', color: '#D32F2F' });
    } else {
      addRow('Parent context', parentRef, { fontFamily: 'var(--mono)', color: 'var(--purple, #8250DF)' });
    }
  }

  if (parsed.accessor) addRow('Accessor', parsed.accessor);
  if (parsed.nullSafeFallback != null) addRow('Fallback', `"${parsed.nullSafeFallback}"`);
  if (parsed.loopVar) addRow('Loop var', parsed.loopVar);
  if (parsed.loopSource) addRow('Loop source', parsed.loopSource);
  // Use suggested purpose (corrects 'variable' → 'inline' for ${...}$ expressions)
  const effectivePurpose = parsed.type === 'inline'
    ? 'inline'
    : parsed.purpose;
  if (effectivePurpose) addRow('Purpose', effectivePurpose);
  if (parsed.dataType) addRow('Data type', parsed.dataType);
  if (parsed.path) addRow('Path', parsed.path.join(' → '));

  return rows;
}

// ─── Resolve area (live data preview) ───────────────────────────────

function renderResolveArea(container, dupeInfo) {
  clear(container);

  if (isResolving) {
    container.appendChild(
      el('div', { class: 'sel-resolve-loading' }, [
        el('span', { class: 'sel-resolve-spinner' }),
        'Resolving…',
      ])
    );
    return;
  }

  if (resolveData) {
    if (resolveData.error) {
      container.appendChild(
        el('div', { class: 'sel-resolve-error' }, [
          el('span', { html: icon('info', 13) }),
          resolveData.error,
        ])
      );
    } else if (resolveData.records && resolveData.records.length > 0) {
      // Apply client-side solution filter if active
      const filteredRecords = _solutionFilter
        ? resolveData.records.filter(r => r.solutionName === _solutionFilter)
        : resolveData.records;

      // Show record count — with filtered context if applicable
      const count = filteredRecords.length;
      const unfiltTotal = _solutionFilter ? resolveData.records.length : resolveData.unfilteredCount;
      const countText = unfiltTotal && unfiltTotal !== count
        ? `${count} / ${unfiltTotal} record${unfiltTotal !== 1 ? 's' : ''}`
        : `${count} record${count !== 1 ? 's' : ''} found`;

      // Instance-scoped badge: shows when data is narrowed to a specific instance
      const scopedInst = resolveData.instanceScoped ? getSelectedInstance() : null;
      const scopedBadge = scopedInst
        ? el('span', { class: 'sel-resolve-scoped' }, `${scopedInst.name}`)
        : null;

      // Effective cardinality: when instance-scoped, 1 record = single, not multi
      const effectiveCount = count;
      const isSingleInContext = resolveData.instanceScoped && effectiveCount === 1;
      const cardinalityBadge = isSingleInContext
        ? el('span', { class: 'badge badge-type-single', style: { fontSize: '9px', marginLeft: '6px' } }, 'SINGLE')
        : null;

      container.appendChild(
        el('div', { class: 'sel-resolve-header' }, [
          el('span', { html: icon('database', 13) }),
          countText,
          resolveData.objectName ? el('span', { class: 'sel-resolve-obj' }, resolveData.objectName) : null,
          scopedBadge,
          cardinalityBadge,
        ].filter(Boolean))
      );

      // Filter/index info now shown in breakdown rows above — no duplicate here

      // Use existing variable's column preferences when available
      const dupeColumns = dupeInfo?.previewColumns;
      const sample = filteredRecords.slice(0, 3);
      const availableFields = resolveData.fields
        ? resolveData.fields
        : Object.keys(sample[0] || {}).filter(k => !k.startsWith('_') && k !== 'id' && k !== 'href');
      let fields;
      if (dupeColumns && dupeColumns.length > 0) {
        fields = dupeColumns.filter(c => availableFields.includes(c));
      } else {
        // Default: filter out fields that are empty/null across all sample records
        const nonEmpty = availableFields.filter(f =>
          sample.some(r => r[f] != null && r[f] !== '')
        );
        if (nonEmpty.length > 0) {
          fields = nonEmpty.slice(0, 4);
        } else {
          // All suggested fields are empty — scan actual record keys for populated fields
          const allKeys = Object.keys(sample[0] || {}).filter(k => !k.startsWith('_') && k !== 'id' && k !== 'href');
          const populated = allKeys.filter(f =>
            sample.some(r => r[f] != null && r[f] !== '')
          );
          fields = (populated.length > 0 ? populated : availableFields).slice(0, 4);
        }
      }

      if (fields.length > 0) {
        const thead = el('div', { class: 'sel-resolve-thead' },
          fields.map(f => el('span', { class: 'sel-resolve-th' }, f))
        );
        const tbody = sample.map(rec =>
          el('div', { class: 'sel-resolve-trow' },
            fields.map(f => el('span', { class: 'sel-resolve-td' }, String(rec[f] ?? '–')))
          )
        );
        container.append(thead, ...tbody);

        if (filteredRecords.length > 3) {
          container.appendChild(
            el('div', { class: 'sel-resolve-more' }, `+${filteredRecords.length - 3} more…`)
          );
        }
      }

      // Show computed value for code expressions (arithmetic results)
      if (resolveData.computedValue != null) {
        container.appendChild(
          el('div', { class: 'sel-resolve-computed', style: {
            marginTop: '6px', padding: '6px 8px', background: 'var(--bg-success, #e8f5e9)',
            borderRadius: '4px', fontSize: '12px', fontWeight: '600',
          } }, [
            el('span', { style: { color: 'var(--text-tertiary)', fontWeight: '400', marginRight: '6px' } }, 'Result:'),
            resolveData.computedValue,
          ])
        );
      }

      // Missing dependency hint — when inline ref points to a variable that doesn't exist yet
      if (resolveData.hasMissing && resolveData.missingVars?.length > 0) {
        container.appendChild(
          el('div', { class: 'sel-resolve-missing', style: {
            marginTop: '6px', padding: '6px 8px', background: 'var(--bg-warning, #fff8e1)',
            borderRadius: '4px', fontSize: '11px', color: 'var(--text-secondary)',
          } }, [
            el('span', { html: icon('alertTriangle', 12), style: { marginRight: '4px' } }),
            `Missing: ${resolveData.missingVars.join(', ')} — create define first`,
          ])
        );
      }
    } else if (resolveData.value !== undefined) {
      // Single value result — filter info now shown in breakdown rows above
      container.appendChild(
        el('div', { class: 'sel-resolve-single' }, [
          el('span', { class: 'sel-resolve-label' }, 'Value:'),
          el('code', { class: 'sel-resolve-val' }, String(resolveData.value)),
        ])
      );
    } else {
      container.appendChild(
        el('div', { class: 'sel-resolve-empty' }, 'No data returned')
      );
    }
  } else if (!isConnected()) {
    container.appendChild(
      el('div', { class: 'sel-resolve-disconnected' }, [
        el('span', { html: icon('info', 13) }),
        'Connect to Tacton to resolve live data',
      ])
    );
  }
}

// ─── Auto-resolve ───────────────────────────────────────────────────

async function autoResolve(parsed) {
  if (!isConnected()) return;
  if (!parsed) return;

  isResolving = true;
  const resolveEl = qs('#sel-resolve-area');
  if (resolveEl) renderResolveArea(resolveEl);

  try {
    const result = await resolveExpression(parsed);
    resolveData = result;
  } catch (err) {
    resolveData = { error: err.message || 'Resolve failed' };
  }

  isResolving = false;
  const resolveEl2 = qs('#sel-resolve-area');
  if (resolveEl2) renderResolveArea(resolveEl2);

  // ── Populate Solution dropdown from resolved config data ──
  // Config attribute results include solutionName per record.
  // Back-fill the instance picker with those solution names so the user
  // can filter by solution without a separate API call.
  if (resolveData?.records?.length > 0) {
    const sel = qs('#sel-instance-select');
    if (sel && sel.options.length <= 1) {
      const solNames = [...new Set(
        resolveData.records.map(r => r.solutionName).filter(Boolean)
      )];
      for (const name of solNames) {
        sel.appendChild(el('option', { value: `sol:${name}` }, name));
      }
    }

    // ── Auto-select solution from existing dataset or single-solution data ──
    // Priority:
    //   1. Existing variable has instanceSolution saved → select that
    //   2. Existing variable has selectedCpDisplayId → derive solution from resolved records
    //   3. Fallback: only ONE unique solution in resolved data → auto-select it
    if (sel && resolveData?.records?.length > 0) {
      let targetSol = null;

      // Check existing variable for saved solution context
      if (currentParsed) {
        const dupeMatches = checkDuplicates(currentParsed);
        if (dupeMatches.length > 0) {
          const existing = dupeMatches[0];
          // 1. Direct instanceSolution
          if (existing.instanceSolution) {
            targetSol = existing.instanceSolution;
          }
          // 2. Derive from selectedCpDisplayId
          if (!targetSol && existing.selectedCpDisplayId) {
            const cpRec = resolveData.records.find(r => r.cpDisplayId === existing.selectedCpDisplayId);
            if (cpRec?.solutionName) targetSol = cpRec.solutionName;
          }
        }
      }

      // 3. Fallback: if only one unique solution in the data, auto-select it
      //    Also auto-select the first solution when there's an existing variable
      //    match but no saved instanceSolution (legacy data migration path).
      if (!targetSol) {
        const uniqueSols = [...new Set(resolveData.records.map(r => r.solutionName).filter(Boolean))];
        if (uniqueSols.length === 1) {
          targetSol = uniqueSols[0];
        } else if (uniqueSols.length > 1 && currentParsed) {
          // 4. Existing variable with no saved solution → pick the first solution
          const dupeMatches = checkDuplicates(currentParsed);
          if (dupeMatches.length > 0) {
            targetSol = uniqueSols[0];
          }
        }
      }

      if (targetSol) {
        let matched = false;
        for (const opt of sel.options) {
          if (opt.value === `sol:${targetSol}`) {
            sel.value = opt.value;
            _solutionFilter = targetSol;
            matched = true;
            break;
          }
          const optName = opt.textContent.replace(/\s+\(.*\)$/, '').trim();
          if (optName === targetSol) {
            sel.value = opt.value;
            _solutionFilter = targetSol;
            matched = true;
            break;
          }
        }
        if (matched) {
          const resolveEl = qs('#sel-resolve-area');
          if (resolveEl) renderResolveArea(resolveEl);
        }
      }
    }
  }
}

// ─── Instance picker (simulation context) ──────────────────────────

/** Cached instance list to avoid re-fetching on every panel render */
let _cachedInstances = null;
let _cachedInstanceType = null;

/**
 * Render a compact instance picker dropdown inside the selection panel.
 * Switching instance triggers a full re-resolve of the current expression.
 */
function renderInstancePicker(container) {
  if (!isConnected()) return;
  // Only show when we have a healthy ticket token
  const tokenHealth = state.get('tickets.tokenHealth');
  if (!tokenHealth || (tokenHealth.status !== 'ok' && tokenHealth.status !== 'warn')) return;
  clear(container);

  const startType = getStartingObject();
  const currentInst = getSelectedInstance();

  const label = el('span', { class: 'sel-instance-label' }, `${startType}:`);
  const select = el('select', {
    class: 'sel-instance-select', id: 'sel-instance-select',
    onchange: (e) => {
      const opt = e.target.selectedOptions[0];
      if (!opt || !opt.value) {
        setSelectedInstance(null);
        _solutionFilter = null;
      } else if (opt.value.startsWith('sol:')) {
        // Solution name filter — filter resolved records client-side
        _solutionFilter = opt.value.slice(4);
        const resolveEl = qs('#sel-resolve-area');
        if (resolveEl) renderResolveArea(resolveEl);
        return;
      } else {
        // Regular instance selected — for config data, filter client-side by solutionName
        // (resolveConfigAttrAcrossCPs ignores selectedInstance)
        const isConfigData = resolveData?.records?.some(r => r.solutionName);
        if (isConfigData && resolveData) {
          // Match the solutionName in resolved records.
          // The option text is "SolName  (uuid)" — extract just the name part.
          const optName = opt.textContent.replace(/\s+\(.*\)$/, '').trim();
          // Find a record whose solutionName matches this instance
          const matchedSol = resolveData.records.find(r =>
            r.solutionName === optName || r.solutionName === opt.value
          );
          _solutionFilter = matchedSol ? matchedSol.solutionName : optName;
          setSelectedInstance({
            id: opt.value,
            displayId: opt.dataset.displayId || opt.value,
            name: opt.textContent,
          });
          const resolveEl = qs('#sel-resolve-area');
          if (resolveEl) renderResolveArea(resolveEl);
          return;
        }
        _solutionFilter = null;
        setSelectedInstance({
          id: opt.value,
          displayId: opt.dataset.displayId || opt.value,
          name: opt.textContent,
        });
      }
      // Re-resolve the current expression with new instance context
      if (currentParsed) {
        resolveData = null;
        autoResolve(currentParsed);
      }
    },
  });
  select.appendChild(el('option', { value: '' }, 'All (no filter)'));
  container.append(label, select);

  // Load instances (use cache if same type)
  const populateSelect = (instances) => {
    const sel = qs('#sel-instance-select');
    if (!sel) return;
    // Keep the "All" option, add instances
    for (const inst of instances) {
      // Hide UUID-style displayIds (32+ hex chars) — they're just noise
      const isUuid = /^[0-9a-f]{20,}$/i.test(inst.displayId || '');
      const text = inst.displayId && inst.displayId !== inst.name && !isUuid
        ? `${inst.name}  (${inst.displayId})`
        : inst.name;
      const opt = el('option', {
        value: inst.id,
        'data-display-id': inst.displayId,
      }, text);
      if (currentInst && currentInst.id === inst.id) opt.selected = true;
      sel.appendChild(opt);
    }
  };

  if (_cachedInstances && _cachedInstanceType === startType) {
    populateSelect(_cachedInstances);
  } else {
    fetchStartingObjectInstances(startType).then(instances => {
      _cachedInstances = instances;
      _cachedInstanceType = startType;
      populateSelect(instances);
    });
  }
}

// ─── Duplicate detection ────────────────────────────────────────────

/**
 * Find all existing variables that match the parsed expression.
 * Returns an array of matches (enriched with catalogueName), or empty array.
 */
function checkDuplicates(parsed) {
  const allVariables = state.get('variables') || [];
  const catalogues = state.get('catalogues') || [];
  // Skip cookbook / readonly catalogue entries (String coercion to avoid type mismatch)
  const readonlyCatIds = new Set(catalogues.filter(c => c.readonly).map(c => String(c.id)));
  const variables = allVariables.filter(v => !readonlyCatIds.has(String(v.catalogueId)));
  const seen = new Set();
  const matches = [];

  const addMatch = (v) => {
    if (seen.has(v.id)) return;
    seen.add(v.id);
    const cat = catalogues.find(c => c.id === v.catalogueId);
    matches.push({ ...v, catalogueName: cat ? cat.name : null });
  };

  // Check by name match — scoped by expression type:
  // $define{#x=...}$ matches define-purpose variables, ${#x}$ matches inline-purpose variables
  if (parsed.name) {
    const isInlineRef = parsed.type === 'inline' && /^#\w+$/.test(parsed.source || parsed.name);
    const isDefine = parsed.type === 'define';
    variables.filter(v => {
      if (v.name !== parsed.name) return false;
      // Inline ref → only match inline-purpose entries
      if (isInlineRef) return v.purpose === 'inline';
      // Define → only match variable/define-purpose entries (not inlines)
      if (isDefine) return v.purpose !== 'inline';
      // Other types → match any
      return true;
    }).forEach(addMatch);
  }

  // Check by source / expression match
  if (parsed.source) {
    variables.filter(v => {
      const exprMatch = v.expression === parsed.raw;
      const sourceMatch = v.source === parsed.source;
      return exprMatch || sourceMatch;
    }).forEach(addMatch);
  }

  return matches;
}

/** Backward-compat wrapper — returns first match or null */
function checkDuplicate(parsed) {
  const all = checkDuplicates(parsed);
  return all.length > 0 ? all[0] : null;
}

// ─── Multi-define panel ─────────────────────────────────────────────

/**
 * Render the multi-define detection panel.
 * Shows count of detected defines, which already exist (skipping cookbook),
 * and offers a bulk-load import button.
 */
function renderMultiDefinePanel(defines) {
  if (!panelEl) return;
  clear(panelEl);

  // Cross-reference with existing non-cookbook variables
  // Use String() coercion on IDs to avoid type-mismatch (number vs string)
  const allVariables = state.get('variables') || [];
  const catalogues = state.get('catalogues') || [];
  const readonlyCatIds = new Set(catalogues.filter(c => c.readonly).map(c => String(c.id)));
  const userVars = allVariables.filter(v => !readonlyCatIds.has(String(v.catalogueId)));
  const existingNames = new Set(userVars.map(v => v.name));

  const newDefines = defines.filter(d => !existingNames.has(d.name));
  const existingDefines = defines.filter(d => existingNames.has(d.name));

  // Header
  const headerRow = el('div', { class: 'sel-panel-header' }, [
    el('div', { class: 'sel-panel-title-row' }, [
      el('span', { class: 'sel-panel-icon', html: icon('layers', 16) }),
      el('span', { class: 'sel-panel-title' }, 'Multiple expressions detected'),
    ]),
    el('button', {
      class: 'sel-panel-close',
      onclick: () => { state.set('word.selection', null); },
      html: icon('x', 14),
    }),
  ]);

  // Summary counts
  const summary = el('div', { class: 'sel-multi-summary' }, [
    el('div', { class: 'sel-multi-count' }, [
      el('span', { class: 'sel-multi-count-num' }, String(defines.length)),
      el('span', {}, ` expression${defines.length !== 1 ? 's' : ''} detected`),
    ]),
    newDefines.length > 0
      ? el('div', { class: 'sel-multi-new' }, [
          el('span', { html: icon('plus', 12) }),
          `${newDefines.length} new`,
        ])
      : null,
    existingDefines.length > 0
      ? el('div', { class: 'sel-multi-existing' }, [
          el('span', { html: icon('check', 12) }),
          `${existingDefines.length} already exist`,
        ])
      : null,
  ]);

  // List each define with status, purpose, and inferred type
  const typeIcons = { single: 'target', object: 'box', bom: 'database', list: 'list', define: 'link', code: 'code' };
  const typeColors = { single: 'var(--success)', object: 'var(--orange)', bom: 'var(--orange)', list: 'var(--tacton-blue)', define: 'var(--purple, #8250DF)', code: 'var(--text-tertiary)' };
  const purposeLabels = { inline: 'inline', variable: 'variable', block: 'block' };

  // Build a lookup of define names in this batch — for detecting source relationships
  const batchDefineNames = new Set(defines.filter(d => d.type === 'define').map(d => d.name));

  const list = el('div', { class: 'sel-multi-list' });
  for (const d of defines) {
    const exists = existingNames.has(d.name);
    const suggested = suggestDataSetFields(d);
    const iType = suggested.type || 'single';
    const iPurpose = suggested.purpose || 'variable';

    // Detect inline refs that have a matching define in this batch
    const isInlineRef = d.type === 'inline' && /^#\w+$/.test(d.source || d.name);
    const sourceDefName = isInlineRef ? (d.source || d.name) : null;
    const hasSourceInBatch = sourceDefName && batchDefineNames.has(sourceDefName);

    // Source display: for inline refs with a batch define, show the link icon + define name
    const sourceDisplay = hasSourceInBatch
      ? el('span', { class: 'sel-multi-row-source sel-multi-row-linked', title: `References define ${sourceDefName}` }, [
          el('span', { html: icon('link', 10), style: { marginRight: '2px', opacity: '0.6' } }),
          sourceDefName,
        ])
      : el('span', { class: 'sel-multi-row-source' }, d.source.length > 40 ? d.source.slice(0, 37) + '…' : d.source);

    list.appendChild(
      el('div', { class: `sel-multi-row ${exists ? 'sel-multi-row-exists' : 'sel-multi-row-new'}` }, [
        el('span', { class: 'sel-multi-row-status', html: icon(exists ? 'check' : 'plus', 11) }),
        el('span', { class: 'sel-multi-row-type', style: { color: typeColors[iType] || '' }, html: icon(typeIcons[iType] || 'target', 10), title: iType }),
        el('code', { class: 'sel-multi-row-name' }, d.name),
        sourceDisplay,
        exists
          ? el('span', { class: 'sel-multi-row-badge' }, 'exists')
          : el('span', { class: 'sel-multi-row-badges' }, [
              el('span', { class: `sel-multi-row-badge sel-multi-row-badge-purpose badge-purpose-${iPurpose === 'variable' ? 'var' : iPurpose}` }, purposeLabels[iPurpose] || iPurpose),
              el('span', { class: `sel-multi-row-badge sel-multi-row-badge-new badge-${iType}` }, iType),
            ]),
      ])
    );
  }

  // Action area — always show catalogue + section picker and import button
  const actions = el('div', { class: 'sel-panel-actions' });

  const allExist = newDefines.length === 0;
  const hasMix = newDefines.length > 0 && existingDefines.length > 0;

  if (allExist) {
    actions.appendChild(
      el('div', { class: 'sel-multi-all-exist' }, [
        el('span', { html: icon('check', 14) }),
        'All expressions already exist in your datasets.',
      ])
    );
  }

  // Catalogue + section picker (shared builder)
  const picker = buildCatalogueSectionPicker();
  const { catSelect, secSelect, errorEl } = picker;

  // Shared import function — skipExisting: true = only new, false = all (duplicates get unique names)
  async function doImport(skipExisting) {
    const selectedCatId = picker.selectedCatId();
    const selectedSectionId = picker.selectedSectionId();
    if (!selectedCatId) {
      errorEl.textContent = 'Select a catalogue';
      errorEl.style.display = 'block';
      return;
    }
    let imported = 0;
    let skipped = 0;

    const definesByName = {};
    for (const d of defines) { definesByName[d.name] = d; }

    // Sort: defines/variables first, then inline refs — so sourceDefine targets exist before refs
    const sorted = [...defines].sort((a, b) => {
      const aIsInline = a.type === 'inline' && !a.source?.includes('getConfigurationAttribute(');
      const bIsInline = b.type === 'inline' && !b.source?.includes('getConfigurationAttribute(');
      if (aIsInline && !bIsInline) return 1;
      if (!aIsInline && bIsInline) return -1;
      return 0;
    });

    for (const d of sorted) {
      try {
        const suggested = suggestDataSetFields(d);
        const baseName = suggested.name.startsWith('#') ? suggested.name : `#${suggested.name}`;
        const alreadyExists = existingNames.has(baseName);

        if (alreadyExists && skipExisting) { skipped++; continue; }

        const rp = reverseParseSource(d.source, suggested.type);

        const varData = {
          name: alreadyExists ? makeUniqueName(baseName) : baseName,
          purpose: suggested.purpose || 'variable',
          type: suggested.type,
          source: suggested.source || d.source,
          catalogueId: selectedCatId,
          sectionId: selectedSectionId,
        };

        // Pass through null-safe / accessor transforms from inline expressions
        if (suggested.accessor || suggested.nullSafeFallback != null) {
          const transforms = [];
          if (suggested.accessor) transforms.push({ type: 'accessor', method: suggested.accessor });
          if (suggested.nullSafeFallback != null) {
            const nsTrans = { type: 'nullSafe', fallback: suggested.nullSafeFallback };
            if (suggested.nullCheckField) nsTrans.nullCheckField = suggested.nullCheckField;
            transforms.push(nsTrans);
          }
          varData.transforms = transforms;
        }

        // Smart linking for 'define' type — set up sourceDefine + transforms
        if (suggested.type === 'define' && rp?.sourceDefine) {
          varData.sourceDefine = rp.sourceDefine;
          const refDef = definesByName[rp.sourceDefine];
          varData.sourceDefineSource = refDef?.source || '';
          varData.transforms = rp.transforms || [];
          varData.source = rp.sourceDefine;
        } else if (suggested.type === 'code' && rp) {
          varData.transforms = [];
        }

        // Inline #variable reference → set up sourceDefine relationship
        // e.g. ${#lengthUom}$ has source '#lengthUom' pointing to $define{#lengthUom=...}$
        if (suggested.purpose === 'inline' && varData.source && /^#\w+$/.test(varData.source)) {
          // Fresh lookup — the define may have been created earlier in this batch
          const currentVars = state.get('variables') || [];
          const sourceVar = currentVars.find(v => v.name === varData.source && v.purpose !== 'inline');
          varData.sourceDefine = varData.source;
          if (sourceVar) {
            varData.sourceDefineSource = sourceVar.sourceDefine || sourceVar.source || '';
          }
          // If the define was just created in this batch, the name already exists.
          // The inline keeps the same name — two entries with different purposes is correct.
        }

        // Detect placeholder (.{?false}) in source and set flag
        if (varData.source && varData.source.includes('.{?false}')) {
          varData.placeholder = true;
          varData.source = varData.source.replace(/\.\{\?false\}$/, '');
        }

        // Detect parent-child block relationship (#loopVar.rest)
        if (varData.source) {
          const loopVarMatch = varData.source.match(/^(#\w+)\./);
          if (loopVarMatch) {
            varData.parentLoopVar = loopVarMatch[1];
            varData.source = varData.source.slice(loopVarMatch[0].length);
          }
        }

        await createVariable(varData);
        imported++;
      } catch (err) {
        console.warn('[DocGen] Bulk import skip:', d.name, err);
      }
    }
    const msg = skipped > 0
      ? `Imported ${imported}, skipped ${skipped} existing`
      : `Imported ${imported} dataset${imported !== 1 ? 's' : ''}`;
    showCreateToast(msg);
    state.set('word.selection', null);
  }

  // Button row: Dismiss + Import new (if mix) + Import all
  const btnChildren = [
    el('button', { class: 'btn btn-outline btn-sm', onclick: () => { state.set('word.selection', null); } }, 'Dismiss'),
  ];

  if (hasMix) {
    // Two import options: new only + all
    btnChildren.push(
      el('button', {
        class: 'btn btn-primary btn-sm',
        onclick: () => doImport(true),
      }, [el('span', { html: icon('download', 12) }), ` Import ${newDefines.length} new`])
    );
    btnChildren.push(
      el('button', {
        class: 'btn btn-outline btn-sm',
        onclick: () => doImport(false),
      }, [el('span', { html: icon('download', 12) }), ` Import all ${defines.length}`])
    );
  } else {
    // All new or all exist — single button
    btnChildren.push(
      el('button', {
        class: 'btn btn-sm ' + (allExist ? 'btn-outline' : 'btn-primary'),
        onclick: () => doImport(allExist ? false : true),
      }, [el('span', { html: icon('download', 12) }), allExist ? ` Import all ${defines.length} anyway` : ` Import ${newDefines.length} new`])
    );
  }

  const btnRow = el('div', { class: 'sel-create-btns' }, btnChildren);

  actions.appendChild(
    el('div', { class: 'sel-create-field', style: { marginBottom: '4px' } }, [
      el('label', { class: 'sel-create-label' }, 'Import to catalogue'),
      catSelect,
    ])
  );
  actions.appendChild(
    el('div', { class: 'sel-create-field', style: { marginBottom: '4px' } }, [
      el('label', { class: 'sel-create-label' }, 'Section'),
      secSelect,
    ])
  );
  actions.appendChild(errorEl);
  actions.appendChild(btnRow);

  panelEl.append(headerRow, summary, list, actions);
}

// ─── Create dataset form ───────────────────────────────────────────

function showCreateDataSetForm(parsed, dupeInfo) {
  if (!panelEl) return;

  const suggested = suggestDataSetFields(parsed);
  // Generate a unique name so imports never collide with existing datasets
  suggested.name = makeUniqueName(suggested.name);
  // Catalogue + section picker (shared builder)
  const picker = buildCatalogueSectionPicker();
  const { catSelect, secSelect, errorEl, favId } = picker;

  // Form container
  const form = el('div', { class: 'sel-create-form' });

  // Duplicate warning
  if (dupeInfo) {
    form.appendChild(
      el('div', { class: 'sel-create-dupe-banner' }, [
        el('span', { html: icon('info', 14) }),
        el('div', {}, [
          el('strong', {}, `"${dupeInfo.name}" already exists`),
          el('div', { style: { fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' } },
            `In ${dupeInfo.catalogueName || 'a catalogue'}. Creating will add a new copy.`
          ),
        ]),
      ])
    );
  }

  // Name field
  const nameInput = el('input', {
    type: 'text',
    class: 'sel-create-input',
    value: suggested.name,
    placeholder: '#variableName',
  });
  form.appendChild(el('div', { class: 'sel-create-field' }, [
    el('label', { class: 'sel-create-label' }, 'Name'),
    nameInput,
  ]));

  // Source field (readonly display)
  form.appendChild(el('div', { class: 'sel-create-field' }, [
    el('label', { class: 'sel-create-label' }, 'Source'),
    el('code', { class: 'sel-create-source' }, suggested.source || parsed.raw),
  ]));

  // Purpose + Type badges
  form.appendChild(el('div', { class: 'sel-create-badges' }, [
    el('span', { class: `badge badge-purpose-${suggested.purpose === 'variable' ? 'var' : suggested.purpose === 'inline' ? 'inline' : 'block'}` }, suggested.purpose.toUpperCase()),
    el('span', { class: `badge badge-${suggested.type}` }, suggested.type.toUpperCase()),
  ]));

  // Favourite button
  const favBtn = el('button', {
    class: `sel-fav-btn ${String(picker.selectedCatId()) === favId ? 'sel-fav-active' : ''}`,
    title: 'Set as favourite catalogue',
    onclick: () => {
      const current = getFavouriteCatalogue();
      if (String(picker.selectedCatId()) === current) {
        setFavouriteCatalogue(null);
        favBtn.classList.remove('sel-fav-active');
      } else {
        setFavouriteCatalogue(picker.selectedCatId());
        favBtn.classList.add('sel-fav-active');
      }
    },
    html: icon(String(picker.selectedCatId()) === favId ? 'starFilled' : 'star', 14),
  });

  form.appendChild(el('div', { class: 'sel-create-field' }, [
    el('label', { class: 'sel-create-label' }, 'Catalogue'),
    el('div', { class: 'sel-create-cat-row' }, [catSelect, favBtn]),
  ]));

  // Section picker
  form.appendChild(el('div', { class: 'sel-create-field' }, [
    el('label', { class: 'sel-create-label' }, 'Section'),
    secSelect,
  ]));

  form.appendChild(errorEl);

  // Buttons
  form.appendChild(el('div', { class: 'sel-create-btns' }, [
    el('button', { class: 'btn btn-outline btn-sm', onclick: () => renderPanel() }, 'Cancel'),
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: async () => {
        const name = nameInput.value.trim();
        if (!name) {
          errorEl.textContent = 'Name is required';
          errorEl.style.display = 'block';
          return;
        }
        if (!name.startsWith('#')) {
          errorEl.textContent = 'Name must start with #';
          errorEl.style.display = 'block';
          return;
        }
        const selectedCatId = picker.selectedCatId();
        const selectedSectionId = picker.selectedSectionId();
        if (!selectedCatId) {
          errorEl.textContent = 'Select a catalogue';
          errorEl.style.display = 'block';
          return;
        }

        try {
          const varData = {
            name,
            purpose: suggested.purpose,
            type: suggested.type,
            source: suggested.source || parsed.raw,
            catalogueId: selectedCatId,
            sectionId: selectedSectionId,
          };
          // Pass through null-safe / accessor transforms from inline expressions
          if (suggested.accessor || suggested.nullSafeFallback != null) {
            const transforms = [];
            if (suggested.accessor) transforms.push({ type: 'accessor', method: suggested.accessor });
            if (suggested.nullSafeFallback != null) {
              const nsTrans = { type: 'nullSafe', fallback: suggested.nullSafeFallback };
              if (suggested.nullCheckField) nsTrans.nullCheckField = suggested.nullCheckField;
              transforms.push(nsTrans);
            }
            varData.transforms = transforms;
          }
          // Save active solution filter as instanceSolution on the dataset
          if (_solutionFilter) {
            varData.instanceSolution = _solutionFilter;
          }

          // ── Inline #variable reference → set up sourceDefine relationship ──
          // When ${#lengthUom}$ is created, the source is '#lengthUom' which
          // refers to a $define{#lengthUom=...}$ variable. Link them via sourceDefine
          // so the system knows this inline output draws from the define chain.
          if (suggested.purpose === 'inline' && varData.source && /^#\w+$/.test(varData.source)) {
            const allVarsForLink = state.get('variables') || [];
            const sourceVar = allVarsForLink.find(v => v.name === varData.source);
            varData.sourceDefine = varData.source;
            if (sourceVar) {
              varData.sourceDefineSource = sourceVar.sourceDefine || sourceVar.source || '';
            }
          }

          // Detect placeholder (.{?false}) in source and set flag
          if (varData.source && varData.source.includes('.{?false}')) {
            varData.placeholder = true;
            varData.source = varData.source.replace(/\.\{\?false\}$/, '');
          }
          // Detect parent-child block relationship (#loopVar.rest)
          if (varData.source) {
            const loopVarMatch = varData.source.match(/^(#\w+)\./);
            if (loopVarMatch) {
              varData.parentLoopVar = loopVarMatch[1];
              varData.source = varData.source.slice(loopVarMatch[0].length);
            }
          }

          // ── Check for missing source dependency ─────────────────────
          // Only check the primary source reference (the #varName the data
          // comes FROM), not #variables inside filters which are runtime
          // loop context variables (e.g. #currentCp in a $for loop).
          const allVars = state.get('variables') || [];
          const existingNames = new Set(allVars.map(v => v.name));
          const sourceExpr = suggested.source || parsed.source || '';
          // Extract only the leading #varName (the source), ignoring filter contents
          // #this is a context alias (resolved to starting object), not a variable dep
          const sourceRefMatch = sourceExpr.match(/^(#\w+)/);
          const missingRefs = sourceRefMatch
            && sourceRefMatch[1] !== name
            && sourceRefMatch[1] !== '#this'
            && !existingNames.has(sourceRefMatch[1])
            ? [sourceRefMatch[1]]
            : [];

          if (missingRefs.length > 0) {
            const proceed = await showMissingDepsDialog(missingRefs, selectedCatId, selectedSectionId);
            if (!proceed) return; // user cancelled
          }

          await createVariable(varData);
          // Success → show toast and close
          showCreateToast(`Created "${name}" in catalogue`);
          renderPanel(); // back to expression view
        } catch (err) {
          errorEl.textContent = err.message || 'Failed to create dataset';
          errorEl.style.display = 'block';
        }
      },
    }, 'Create'),
  ]));

  // Replace panel content with form
  clear(panelEl);

  // Keep a small header
  panelEl.appendChild(
    el('div', { class: 'sel-panel-header' }, [
      el('div', { class: 'sel-panel-title-row' }, [
        el('span', { class: 'sel-panel-icon', html: icon('plus', 16) }),
        el('span', { class: 'sel-panel-title' }, 'Create dataset from selection'),
      ]),
      el('button', {
        class: 'sel-panel-close',
        onclick: () => renderPanel(),
        html: icon('x', 14),
      }),
    ])
  );
  panelEl.appendChild(form);
}

// ─── Missing dependency dialog ──────────────────────────────────────

/**
 * Show a dialog warning that some #variable references don't exist yet.
 * Offers to create placeholder defines for them.
 * Returns a Promise<boolean> — true if user proceeds, false if cancelled.
 */
function showMissingDepsDialog(missingRefs, catalogueId, sectionId) {
  return new Promise((resolve) => {
    const overlay = el('div', {
      style: {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: '9999',
      },
    });

    const refList = missingRefs.map(ref =>
      el('div', {
        style: {
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '4px 8px', background: 'var(--bg-warm, #F6F8FA)',
          borderRadius: 'var(--radius, 4px)', fontSize: '12px', fontFamily: 'var(--mono)',
        },
      }, [
        el('span', { html: icon('alertTriangle', 12), style: { color: '#E65100', flex: '0 0 auto' } }),
        el('span', { style: { fontWeight: '600' } }, ref),
        el('span', { style: { color: 'var(--text-tertiary)', fontSize: '10px' } }, '— not found'),
      ])
    );

    const dialog = el('div', {
      style: {
        background: 'var(--card, #fff)', borderRadius: '8px', padding: '16px',
        boxShadow: '0 8px 24px rgba(0,0,0,.18)', maxWidth: '340px', width: '100%',
      },
    }, [
      el('div', { style: { fontWeight: '700', fontSize: '13px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '6px' } }, [
        el('span', { html: icon('alertTriangle', 16), style: { color: '#E65100' } }),
        'Missing dependencies',
      ]),
      el('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px' } },
        'The expression references variables that don\'t exist yet:',
      ),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' } }, refList),
      el('div', { style: { fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '14px' } },
        'Create placeholder defines so the expression can resolve? They will be added to the same catalogue.',
      ),
      el('div', { style: { display: 'flex', gap: '8px', justifyContent: 'flex-end' } }, [
        el('button', {
          class: 'btn btn-outline btn-sm',
          onclick: () => { overlay.remove(); resolve(false); },
        }, 'Cancel'),
        el('button', {
          class: 'btn btn-outline btn-sm',
          onclick: () => {
            // Skip — create the variable without placeholders
            overlay.remove();
            resolve(true);
          },
        }, 'Skip'),
        el('button', {
          class: 'btn btn-primary btn-sm',
          onclick: async () => {
            try {
              for (const ref of missingRefs) {
                await createVariable({
                  name: ref,
                  purpose: 'variable',
                  type: 'define',
                  source: '',
                  description: '(placeholder — source not yet defined)',
                  catalogueId,
                  sectionId,
                });
              }
              showCreateToast(`Created ${missingRefs.length} placeholder${missingRefs.length > 1 ? 's' : ''}`);
            } catch (err) {
              console.error('Failed to create placeholders:', err);
            }
            overlay.remove();
            resolve(true);
          },
        }, `Create ${missingRefs.length === 1 ? 'placeholder' : `${missingRefs.length} placeholders`}`),
      ]),
    ]);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  });
}

// ─── Create toast ───────────────────────────────────────────────────

function showCreateToast(message) {
  const existing = document.getElementById('sel-create-toast');
  if (existing) existing.remove();

  const toast = el('div', {
    id: 'sel-create-toast',
    class: 'sel-create-toast',
  }, [
    el('span', { html: icon('check', 14) }),
    el('span', {}, message),
  ]);

  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 2500);
}
