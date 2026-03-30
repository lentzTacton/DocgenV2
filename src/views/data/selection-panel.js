/**
 * Selection Panel — slide-up bottom panel that appears when the user
 * selects a template expression in the Word document.
 *
 * Features:
 *   - Parses and shows expression structure
 *   - Live-resolves against Tacton API (sample data preview)
 *   - "Create data set" action with catalogue picker + favourite
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
  fetchRecords,
  fetchModel,
  getObjectAttributes,
} from '../../services/data-api.js';
import { resolveConfigAttrAcrossCPs } from './wizard-config-explorer.js';

// ─── Panel state ────────────────────────────────────────────────────

let panelEl = null;
let isOpen = false;
let currentParsed = null;
let resolveData = null;
let isResolving = false;

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

// ─── Unique name generation ─────────────────────────────────────────

/**
 * Generate a unique name for an imported data set.
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
            ? 'Set up a Tacton instance connection in the Setup tab to resolve expressions and create data sets.'
            : !hasTicket
              ? 'Select a ticket in the Setup tab to start working with data.'
              : 'Complete the setup to use data features.'
        ),
      ]),
    ]);
    panelEl.append(headerRow, exprRow, descRow, breakdown, connectMsg);
    return;
  }

  // Resolve area (pass dupeInfo so it can use existing variable's column settings)
  // Find ALL matching duplicates (not just the first)
  const dupeMatches = canCreateDataSet(parsed) ? checkDuplicates(parsed) : [];
  const dupeInfo = dupeMatches.length > 0 ? dupeMatches[0] : null;
  const resolveArea = el('div', { class: 'sel-panel-resolve', id: 'sel-resolve-area' });
  renderResolveArea(resolveArea, dupeInfo);

  // Actions
  const actions = el('div', { class: 'sel-panel-actions' });
  if (canCreateDataSet(parsed)) {
    if (dupeMatches.length > 0) {
      // Found banner — header with inline "Create new" button
      const warnText = dupeMatches.length === 1
        ? `Already exists as "${dupeMatches[0].name}"`
        : `Found ${dupeMatches.length} existing data sets — click to edit`;
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
          'Create data set',
        ])
      );
    }
  }

  panelEl.append(headerRow, exprRow, descRow, breakdown, resolveArea, actions);
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
  if (parsed.source) {
    const configPath = parsed.source.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
    addRow('Source', configPath ? configPath[1] : cleanSource);
  }

  // Filter conditions
  if (filters.length > 0) {
    const logic = filterLogic === 'or' ? ' || ' : ' && ';
    const filterText = filters.map(f => `${f.field} ${f.op} "${f.value}"`).join(logic);
    addRow('Filter', filterText);
  }

  // Index access
  if (indexAccess != null) {
    const indexLabel = indexAccess === 0 ? '[0] (first record)' : `[${indexAccess}] (record ${indexAccess})`;
    addRow('Index', indexLabel);
  }

  if (parsed.accessor) addRow('Accessor', parsed.accessor);
  if (parsed.nullSafeFallback != null) addRow('Fallback', `"${parsed.nullSafeFallback}"`);
  if (parsed.loopVar) addRow('Loop var', parsed.loopVar);
  if (parsed.loopSource) addRow('Loop source', parsed.loopSource);
  if (parsed.purpose) addRow('Purpose', parsed.purpose);
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
      // Show record count — with filtered context if applicable
      const count = resolveData.totalCount ?? resolveData.records.length;
      const unfilt = resolveData.unfilteredCount;
      const countText = unfilt && unfilt !== count
        ? `${count} / ${unfilt} record${unfilt !== 1 ? 's' : ''}`
        : `${count} record${count !== 1 ? 's' : ''} found`;
      container.appendChild(
        el('div', { class: 'sel-resolve-header' }, [
          el('span', { html: icon('database', 13) }),
          countText,
          resolveData.objectName ? el('span', { class: 'sel-resolve-obj' }, resolveData.objectName) : null,
        ])
      );

      // Filter/index info now shown in breakdown rows above — no duplicate here

      // Use existing variable's column preferences when available
      const dupeColumns = dupeInfo?.previewColumns;
      const sample = resolveData.records.slice(0, 3);
      const availableFields = resolveData.fields
        ? resolveData.fields
        : Object.keys(sample[0] || {}).filter(k => !k.startsWith('_') && k !== 'id' && k !== 'href');
      const fields = (dupeColumns && dupeColumns.length > 0)
        ? dupeColumns.filter(c => availableFields.includes(c))
        : availableFields.slice(0, 4);

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

        if (resolveData.records.length > 3) {
          container.appendChild(
            el('div', { class: 'sel-resolve-more' }, `+${resolveData.records.length - 3} more…`)
          );
        }
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
}

/**
 * Try to resolve the parsed expression against the Tacton API.
 * Returns { records, fields, totalCount, objectName } or { value } or { error }.
 */
async function resolveExpression(parsed) {
  const source = parsed.source || parsed.loopSource || '';

  // ── Config attributes: resolve via Solution API, not object model ──
  if (source.includes('getConfigurationAttribute(')) {
    const pathMatch = source.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
    if (pathMatch) {
      const attrPath = pathMatch[1];
      try {
        const results = await resolveConfigAttrAcrossCPs(attrPath);
        if (results.length > 0) {
          const hasValue = results.some(r => r.value && r.value !== '(error)');
          if (hasValue) {
            return {
              records: results,
              totalCount: results.length,
              objectName: 'ConfiguredProduct',
              fields: ['cpDisplayId', 'solutionName', 'value'],
            };
          }
          return { error: `Attribute "${attrPath}" not found in any configured product` };
        }
        return { error: 'No configured products found on this ticket' };
      } catch (e) {
        return { error: `Config resolve failed: ${e.message}` };
      }
    }
  }

  // For dot-paths like solution.opportunity.account.name
  // try to walk the model and fetch the relevant object.
  // Also handles filter syntax: .{?field=="value"}, [n]
  const model = await fetchModel();
  if (!model) return { error: 'Model not loaded' };

  // ── Parse source into clean segments, extracting filters & indices ──
  const { cleanSource, filters, filterLogic, indexAccess } = parseSourceFilters(source);
  const cleanSegments = cleanSource.replace(/^#(this|cp)\./, '').split('.');
  const rootName = cleanSegments[0];

  // Try to find the object in the model
  let objMatch = model.find(o => o.name.toLowerCase() === rootName.toLowerCase());

  // If the first segment is the starting object (e.g. 'solution'), walk from there
  const startObj = state.get('startingObject.type') || 'Solution';
  if (!objMatch && rootName.toLowerCase() === startObj.toLowerCase()) {
    objMatch = model.find(o => o.name.toLowerCase() === startObj.toLowerCase());
  }

  // For BOM sources, try to fetch flatbom records
  if (source.includes('flatbom') || source.includes('.bom') || parsed.dataType === 'bom') {
    const bomObj = model.find(o => o.name.toLowerCase().includes('bom') || o.name.toLowerCase().includes('flatbom'));
    if (bomObj) {
      let records = await fetchRecords(bomObj.name);
      records = _applyFiltersAndIndex(records, filters, filterLogic, indexAccess);
      return {
        records,
        totalCount: records.length,
        objectName: bomObj.name,
        fields: bomObj.attributes
          .map(a => a.name)
          .filter(n => !n.startsWith('_'))
          .slice(0, 6),
        filters: filters.length > 0 ? filters : undefined,
        filterLogic: filters.length > 1 ? filterLogic : undefined,
        indexAccess,
      };
    }
  }

  // For object-type dot-walks, try to resolve along the path
  if (objMatch && cleanSegments.length > 1) {
    // Walk references using clean (filter-free) segments
    let currentObj = objMatch;
    for (let i = 1; i < cleanSegments.length - 1; i++) {
      const seg = cleanSegments[i];
      const attr = currentObj.attributes.find(a => a.name.toLowerCase() === seg.toLowerCase());
      if (attr && attr.refType) {
        const nextObj = model.find(o => o.name === attr.refType);
        if (nextObj) { currentObj = nextObj; continue; }
      }
      break;
    }

    // Fetch records of the resolved object
    let records = await fetchRecords(currentObj.name);
    const unfilteredCount = records.length;
    records = _applyFiltersAndIndex(records, filters, filterLogic, indexAccess);
    const lastSeg = cleanSegments[cleanSegments.length - 1];

    // If last segment is a field, extract values
    const isField = currentObj.attributes.some(a => a.name.toLowerCase() === lastSeg.toLowerCase());
    if (isField && records.length > 0) {
      const fieldKey = Object.keys(records[0]).find(k => k.toLowerCase() === lastSeg.toLowerCase());
      if (fieldKey) {
        const values = records.map(r => r[fieldKey]).filter(v => v != null);
        if (values.length === 1) {
          return {
            value: values[0],
            totalCount: unfilteredCount,
            objectName: currentObj.name,
            filters: filters.length > 0 ? filters : undefined,
            filterLogic: filters.length > 1 ? filterLogic : undefined,
            indexAccess,
          };
        }
        // Multiple → show as a list
        return {
          records: records.slice(0, 5),
          totalCount: records.length,
          unfilteredCount,
          objectName: currentObj.name,
          fields: [fieldKey],
          filters: filters.length > 0 ? filters : undefined,
          filterLogic: filters.length > 1 ? filterLogic : undefined,
          indexAccess,
        };
      }
    }

    return {
      records: records.slice(0, 5),
      totalCount: records.length,
      unfilteredCount,
      objectName: currentObj.name,
      fields: currentObj.attributes.map(a => a.name).filter(n => !n.startsWith('_')).slice(0, 6),
      filters: filters.length > 0 ? filters : undefined,
      filterLogic: filters.length > 1 ? filterLogic : undefined,
      indexAccess,
    };
  }

  // Fallback: try to fetch the root object directly
  if (objMatch) {
    const records = await fetchRecords(objMatch.name);
    return {
      records: records.slice(0, 5),
      totalCount: records.length,
      objectName: objMatch.name,
      fields: objMatch.attributes.map(a => a.name).filter(n => !n.startsWith('_')).slice(0, 6),
    };
  }

  return { error: `Could not resolve "${source}" in the model` };
}

// ─── Filter / index helpers for expression resolution ───────────────

/**
 * Apply parsed filter conditions and index access to a records array.
 * Mirrors the Spring EL semantics: .{?cond} filters, [n] picks by index.
 */
function _applyFiltersAndIndex(records, filters, filterLogic, indexAccess) {
  if (!records || records.length === 0) return records;

  // Apply field filters (.{?field=="value"})
  if (filters.length > 0) {
    records = records.filter(r => {
      const results = filters.map(f => {
        const val = String(r[f.field] ?? '');
        const target = f.value;
        switch (f.op) {
          case '==': return val === target;
          case '!=': return val !== target;
          case '>':  return parseFloat(val) > parseFloat(target);
          case '<':  return parseFloat(val) < parseFloat(target);
          case '>=': return parseFloat(val) >= parseFloat(target);
          case '<=': return parseFloat(val) <= parseFloat(target);
          case 'contains': return val.toLowerCase().includes(target.toLowerCase());
          case 'matches':  try { return new RegExp(target).test(val); } catch { return false; }
          default: return val === target;
        }
      });
      return filterLogic === 'or' ? results.some(Boolean) : results.every(Boolean);
    });
  }

  // Apply index access ([n])
  if (indexAccess != null && indexAccess >= 0 && records.length > indexAccess) {
    records = [records[indexAccess]];
  }

  return records;
}

// ─── Duplicate detection ────────────────────────────────────────────

/**
 * Find all existing variables that match the parsed expression.
 * Returns an array of matches (enriched with catalogueName), or empty array.
 */
function checkDuplicates(parsed) {
  const allVariables = state.get('variables') || [];
  const catalogues = state.get('catalogues') || [];
  // Skip cookbook / readonly catalogue entries
  const readonlyCatIds = new Set(catalogues.filter(c => c.readonly).map(c => c.id));
  const variables = allVariables.filter(v => !readonlyCatIds.has(v.catalogueId));
  const seen = new Set();
  const matches = [];

  const addMatch = (v) => {
    if (seen.has(v.id)) return;
    seen.add(v.id);
    const cat = catalogues.find(c => c.id === v.catalogueId);
    matches.push({ ...v, catalogueName: cat ? cat.name : null });
  };

  // Check by name match
  if (parsed.name) {
    variables.filter(v => v.name === parsed.name).forEach(addMatch);
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
  const allVariables = state.get('variables') || [];
  const catalogues = state.get('catalogues') || [];
  const readonlyCatIds = new Set(catalogues.filter(c => c.readonly).map(c => c.id));
  const userVars = allVariables.filter(v => !readonlyCatIds.has(v.catalogueId));
  const existingNames = new Set(userVars.map(v => v.name));

  const newDefines = defines.filter(d => !existingNames.has(d.name));
  const existingDefines = defines.filter(d => existingNames.has(d.name));

  // Header
  const headerRow = el('div', { class: 'sel-panel-header' }, [
    el('div', { class: 'sel-panel-title-row' }, [
      el('span', { class: 'sel-panel-icon', html: icon('layers', 16) }),
      el('span', { class: 'sel-panel-title' }, 'Multiple defines detected'),
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
      el('span', {}, ` define statement${defines.length !== 1 ? 's' : ''} detected`),
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

  // List each define with status and inferred type
  const typeIcons = { single: 'target', object: 'box', bom: 'database', list: 'list', define: 'link', code: 'code' };
  const typeColors = { single: 'var(--success)', object: 'var(--orange)', bom: 'var(--orange)', list: 'var(--tacton-blue)', define: 'var(--purple, #8250DF)', code: 'var(--text-tertiary)' };

  const list = el('div', { class: 'sel-multi-list' });
  for (const d of defines) {
    const exists = existingNames.has(d.name);
    const suggested = suggestDataSetFields(d);
    const iType = suggested.type || 'single';
    list.appendChild(
      el('div', { class: `sel-multi-row ${exists ? 'sel-multi-row-exists' : 'sel-multi-row-new'}` }, [
        el('span', { class: 'sel-multi-row-status', html: icon(exists ? 'check' : 'plus', 11) }),
        el('span', { class: 'sel-multi-row-type', style: { color: typeColors[iType] || '' }, html: icon(typeIcons[iType] || 'target', 10), title: iType }),
        el('code', { class: 'sel-multi-row-name' }, d.name),
        el('span', { class: 'sel-multi-row-source' }, d.source.length > 40 ? d.source.slice(0, 37) + '…' : d.source),
        exists
          ? el('span', { class: 'sel-multi-row-badge' }, 'exists')
          : el('span', { class: `sel-multi-row-badge sel-multi-row-badge-new badge-${iType}` }, iType),
      ])
    );
  }

  // Action area — always show catalogue + section picker and import button
  const actions = el('div', { class: 'sel-panel-actions' });

  const allExist = newDefines.length === 0;
  const importTargets = allExist ? defines : newDefines;
  const importLabel = allExist
    ? `Import all ${defines.length} anyway`
    : `Import ${newDefines.length} new`;

  if (allExist) {
    actions.appendChild(
      el('div', { class: 'sel-multi-all-exist' }, [
        el('span', { html: icon('check', 14) }),
        'All defines already exist in your data sets.',
      ])
    );
  }

  // Catalogue picker
  const userCats = catalogues.filter(c => !c.readonly);
  const favId = getFavouriteCatalogue();
  const sortedCats = [...userCats].sort((a, b) => {
    if (String(a.id) === favId) return -1;
    if (String(b.id) === favId) return 1;
    return (a.order || 0) - (b.order || 0);
  });
  let selectedCatId = favId && userCats.find(c => String(c.id) === favId)
    ? favId
    : (userCats[0] ? userCats[0].id : null);

  const allSections = state.get('sections') || [];

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

  // Section picker — filtered by selected catalogue
  let selectedSectionId = null;
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

  const btnRow = el('div', { class: 'sel-create-btns' }, [
    el('button', { class: 'btn btn-outline btn-sm', onclick: () => { state.set('word.selection', null); } }, 'Dismiss'),
    el('button', {
      class: `btn btn-sm ${allExist ? 'btn-outline' : 'btn-primary'}`,
      onclick: async () => {
        if (!selectedCatId) {
          errorEl.textContent = 'Select a catalogue';
          errorEl.style.display = 'block';
          return;
        }
        let imported = 0;

        // Build a lookup of all defines by name for null-safe pair detection
        const definesByName = {};
        for (const d of defines) { definesByName[d.name] = d; }

        for (const d of importTargets) {
          try {
            const suggested = suggestDataSetFields(d);
            const baseName = suggested.name.startsWith('#') ? suggested.name : `#${suggested.name}`;
            const rp = reverseParseSource(d.source, suggested.type);

            const varData = {
              name: allExist ? makeUniqueName(baseName) : baseName,
              purpose: 'variable',
              type: suggested.type,
              source: d.source,
              catalogueId: selectedCatId,
              sectionId: selectedSectionId,
            };

            // Smart linking for 'define' type — set up sourceDefine + transforms
            if (suggested.type === 'define' && rp?.sourceDefine) {
              varData.sourceDefine = rp.sourceDefine;
              // Look up the source define's original expression
              const refDef = definesByName[rp.sourceDefine];
              varData.sourceDefineSource = refDef?.source || '';
              varData.transforms = rp.transforms || [];
              varData.source = rp.sourceDefine; // source points to the define name
            } else if (suggested.type === 'code' && rp) {
              // Code: store the full expression, transforms empty
              varData.transforms = [];
            }

            await createVariable(varData);
            imported++;
          } catch (err) {
            console.warn('[DocGen] Bulk import skip:', d.name, err);
          }
        }
        showCreateToast(`Imported ${imported} of ${importTargets.length} data sets`);
        state.set('word.selection', null);
      },
    }, [el('span', { html: icon('download', 12) }), ` ${importLabel}`]),
  ]);

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

// ─── Create data set form ───────────────────────────────────────────

function showCreateDataSetForm(parsed, dupeInfo) {
  if (!panelEl) return;

  const suggested = suggestDataSetFields(parsed);
  // Generate a unique name so imports never collide with existing data sets
  suggested.name = makeUniqueName(suggested.name);
  const catalogues = (state.get('catalogues') || []).filter(c => !c.readonly);
  const favId = getFavouriteCatalogue();

  // Sort: favourite first, then by order
  const sortedCats = [...catalogues].sort((a, b) => {
    if (String(a.id) === favId) return -1;
    if (String(b.id) === favId) return 1;
    return (a.order || 0) - (b.order || 0);
  });

  // Default selected catalogue: favourite if available, else first
  let selectedCatId = favId && catalogues.find(c => String(c.id) === favId)
    ? favId
    : (catalogues[0] ? catalogues[0].id : null);

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
    el('span', { class: `badge badge-purpose-${suggested.purpose === 'variable' ? 'var' : 'block'}` }, suggested.purpose.toUpperCase()),
    el('span', { class: `badge badge-${suggested.type}` }, suggested.type.toUpperCase()),
  ]));

  // Catalogue picker
  const catSelect = el('select', { class: 'sel-create-select' });
  if (sortedCats.length === 0) {
    catSelect.appendChild(el('option', { value: '' }, 'No catalogues — create one first'));
    catSelect.disabled = true;
  } else {
    for (const cat of sortedCats) {
      const isFav = String(cat.id) === favId;
      const opt = el('option', { value: cat.id }, `${isFav ? '★ ' : ''}${cat.name} (${cat.scope})`);
      if (cat.id === selectedCatId) opt.selected = true;
      catSelect.appendChild(opt);
    }
  }
  // Section picker — filtered by selected catalogue
  const allSections = state.get('sections') || [];
  let selectedSectionId = null;
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

  // Favourite button
  const favBtn = el('button', {
    class: `sel-fav-btn ${String(selectedCatId) === favId ? 'sel-fav-active' : ''}`,
    title: 'Set as favourite catalogue',
    onclick: () => {
      const current = getFavouriteCatalogue();
      if (String(selectedCatId) === current) {
        setFavouriteCatalogue(null);
        favBtn.classList.remove('sel-fav-active');
      } else {
        setFavouriteCatalogue(selectedCatId);
        favBtn.classList.add('sel-fav-active');
      }
    },
    html: icon(String(selectedCatId) === favId ? 'starFilled' : 'star', 14),
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

  // Error display
  const errorEl = el('div', { class: 'sel-create-error', style: { display: 'none' } });
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
          await createVariable(varData);
          // Success → show toast and close
          showCreateToast(`Created "${name}" in catalogue`);
          renderPanel(); // back to expression view
        } catch (err) {
          errorEl.textContent = err.message || 'Failed to create data set';
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
        el('span', { class: 'sel-panel-title' }, 'Create data set from selection'),
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
