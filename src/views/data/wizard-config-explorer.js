/**
 * Configuration Explorer — Browses configured product attributes from the Solution API.
 *
 * Hierarchical drill-down navigation per Tacton's getConfigurationAttribute path model:
 *   1. Start at model level: show model attributes + top-level positions
 *   2. Click a position → add to path, show its assembly's attributes + sub-positions
 *   3. Click an attribute → done, path = pos1.pos2.attrName
 *   4. Breadcrumb bar to navigate back up
 *
 * Path format: position names only — assembly names are NOT part of the path.
 *   getConfigurationAttribute("pos1.pos2.attrName")
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import { wizState } from './wizard-state.js';
import {
  fetchConfiguredProductData, getConfiguredProductList, indexConfigAttributes, isConnected,
} from '../../services/data-api.js';

// ─── Module state ──────────────────────────────────────────────────

let _cpList = null;             // [{ id, displayId, name, summary, solutionName }]
let _selectedCpId = null;       // currently loaded CP UUID
let _productTree = null;        // parsed XML tree { model, bom }
let _attrIndex = null;          // flat index from indexConfigAttributes()
let _navStack = [];             // drill-down path: array of position names
let _searchQuery = '';
let _searchResults = null;
let _refreshPipelineCallback = null;

// ─── Public API ────────────────────────────────────────────────────

export function setRefreshPipelineCallback(cb) {
  _refreshPipelineCallback = cb;
}

function refreshPipeline() {
  if (_refreshPipelineCallback) _refreshPipelineCallback();
}

/**
 * Main entry point — loads and renders the Configuration Explorer.
 */
export async function loadConfigExplorer() {
  const container = qs('#wiz-obj-section');
  if (!container) return;
  clear(container);

  if (!isConnected()) {
    container.appendChild(el('div', { class: 'obj-empty' }, [
      el('span', { class: 'icon', html: icon('alert-circle', 14) }),
      ' Connect to a Tacton instance in Setup to browse configuration attributes.',
    ]));
    renderManualInput(container);
    return;
  }

  container.appendChild(el('div', { class: 'obj-empty', style: { color: 'var(--text-tertiary)' } }, 'Loading configured products...'));

  try {
    // Load CP list if needed
    if (!_cpList || _cpList.length === 0) {
      _cpList = await getConfiguredProductList();
    }

    clear(container);

    if (_cpList.length === 0) {
      container.appendChild(el('div', { class: 'obj-empty' }, [
        el('span', { class: 'icon', html: icon('info', 14) }),
        ' No configured products found on this ticket.',
      ]));
      renderManualInput(container);
      return;
    }

    // Auto-select first CP if none selected
    if (!_selectedCpId) {
      _selectedCpId = _cpList[0].id;
    }

    // Pre-populate config explorer state from existing transforms (edit mode)
    if (wizState.source && wizState.transforms?.length) {
      const ns = wizState.transforms.find(t => t.type === 'nullSafe');
      if (ns) wizState._configFallback = ns.fallback || 'N/A';
      const pathMatch = wizState.source.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
      if (pathMatch) wizState._selectedConfigPath = pathMatch[1];
    }

    // Load product tree if needed
    if (!_productTree || _selectedCpId !== _productTree._cpId) {
      container.appendChild(el('div', { class: 'obj-empty', style: { color: 'var(--text-tertiary)' } }, 'Loading product configuration...'));
      _productTree = await fetchConfiguredProductData(_selectedCpId);
      if (_productTree) _productTree._cpId = _selectedCpId;
      _attrIndex = _productTree ? indexConfigAttributes(_productTree) : [];
      _navStack = [];
      _searchQuery = '';
      _searchResults = null;
      clear(container);
    }

    if (!_productTree || !_productTree.model) {
      console.warn('[config-explorer] productTree failed for cpId:', _selectedCpId, _productTree);
      container.appendChild(el('div', { class: 'obj-empty', style: { color: 'var(--danger)' } },
        `Could not load product configuration for CP "${_selectedCpId}" — check browser console for details.`));
      renderManualInput(container);
      return;
    }

    renderExplorer(container);
  } catch (err) {
    clear(container);
    console.error('[config-explorer] Error:', err);
    container.appendChild(el('div', { class: 'obj-empty', style: { color: 'var(--danger)' } }, `Error: ${err.message}`));
    renderManualInput(container);
  }
}

/**
 * Resolve a config attribute path across all configured products.
 * Returns an array of { cpDisplayId, cpName, solutionName, value, valueDescription }
 * for each CP that has this attribute.
 *
 * @param {string} attrPath — e.g. "nonfire_pump_node-1.splitCase_nonFire_assy.pumpWeight"
 * @returns {Promise<Array>}
 */
export async function resolveConfigAttrAcrossCPs(attrPath) {
  if (!attrPath) return [];
  if (!_cpList || _cpList.length === 0) {
    try { _cpList = await getConfiguredProductList(); } catch { _cpList = null; return []; }
  }
  if (!_cpList?.length) return [];

  const results = [];
  for (const cp of _cpList) {
    try {
      const tree = await fetchConfiguredProductData(cp.id);
      if (!tree) continue;
      const index = indexConfigAttributes(tree);
      const match = index.find(a => a.path === attrPath);
      if (!match) {
        const leafName = attrPath.split('.').pop();
        const similar = index.filter(a => a.attrName === leafName).map(a => a.path);
        if (similar.length > 0) {
          console.warn(`[resolveConfigAttr] Path "${attrPath}" NOT in index. Similar paths:`, similar);
        }
      }
      results.push({
        cpDisplayId: cp.displayId || cp.id,
        cpName: (cp.name && cp.name !== cp.displayId) ? cp.name : '',
        solutionName: cp.solutionName || '',
        attribute: attrPath,
        value: match?.value || '',
        type: match?.type || '',
        attrType: match?.attrType || '',
      });
    } catch (e) {
      console.warn(`[config-explorer] Failed to resolve ${attrPath} on CP ${cp.id}:`, e.message);
      results.push({
        cpDisplayId: cp.displayId || cp.id,
        cpName: (cp.name && cp.name !== cp.displayId) ? cp.name : '',
        solutionName: cp.solutionName || '',
        attribute: attrPath,
        value: '(error)',
        type: '',
        attrType: '',
      });
    }
  }
  return results;
}

/**
 * Reset cached data (e.g. when ticket changes).
 */
export function resetConfigExplorer() {
  _cpList = null;
  _selectedCpId = null;
  _productTree = null;
  _attrIndex = null;
  _navStack = [];
  _searchQuery = '';
  _searchResults = null;
}

// ─── Hierarchical Navigation Helpers ──────────────────────────────

/**
 * Get the attributes and sub-positions for the current navigation level.
 * At model level (_navStack empty): model attrs + model positions
 * At position level: position's assembly attrs + assembly sub-positions
 */
function getCurrentLevel() {
  if (!_productTree?.model) return null;

  if (_navStack.length === 0) {
    // Model level
    const m = _productTree.model;
    return {
      attrs: m.attrs || [],
      calcAttrs: m.calcAttrs || [],
      positions: m.positions || [],
    };
  }

  // Navigate to the target position by following _navStack through the tree
  let positions = _productTree.model.positions || [];
  let pos = null;
  for (const name of _navStack) {
    pos = positions.find(p => (p.name || p.id) === name);
    if (!pos) return null;
    // Next level of positions comes from this position's assembly
    positions = pos.assembly?.positions || [];
  }

  // Show position's content: assembly attrs + sub-positions + position attrs + module
  const assy = pos.assembly;
  return {
    attrs: [...(pos.attrs || []), ...(assy?.attrs || [])],
    calcAttrs: assy?.calcAttrs || [],
    positions: assy?.positions || [],
    module: pos.module || null,
  };
}

/**
 * Build the getConfigurationAttribute path for an attribute at the current nav level.
 * Path = position chain + attrName (assembly names are NOT in the path).
 */
function buildAttrPath(attrName) {
  if (_navStack.length === 0) {
    // Model-level attribute
    const modelName = _productTree.model.name || _productTree.model.id;
    return `${modelName}.${attrName}`;
  }
  return [..._navStack, attrName].join('.');
}

// ─── Explorer Rendering ────────────────────────────────────────────

function renderExplorer(container) {
  // ── CP picker — always show so user knows which CP is loaded ──
  {
    const picker = el('div', { class: 'form-group', style: { marginBottom: '8px' } });
    picker.appendChild(el('div', { class: 'form-label', style: { fontSize: '11px' } }, 'Configured Product'));

    if (_cpList.length > 1) {
      const hasSolutions = _cpList.some(cp => cp.solutionName);
      const select = el('select', {
        class: 'input',
        style: { fontSize: '12px' },
        onchange: (e) => {
          _selectedCpId = e.target.value;
          _productTree = null;
          _attrIndex = null;
          _navStack = [];
          loadConfigExplorer();
        },
      });

      if (hasSolutions) {
        const groups = {};
        for (const cp of _cpList) {
          const sol = cp.solutionName || 'No Solution';
          if (!groups[sol]) groups[sol] = [];
          groups[sol].push(cp);
        }
        for (const [solName, cps] of Object.entries(groups)) {
          const optgroup = el('optgroup', { label: solName });
          for (const cp of cps) {
            const nameLabel = (cp.name && cp.name !== cp.displayId) ? ` — ${cp.name}` : '';
            const label = `${cp.displayId || cp.id}${nameLabel}`;
            const opt = el('option', { value: cp.id }, label);
            if (cp.id === _selectedCpId) opt.selected = true;
            optgroup.appendChild(opt);
          }
          select.appendChild(optgroup);
        }
      } else {
        for (const cp of _cpList) {
          const nameLabel = (cp.name && cp.name !== cp.displayId) ? ` — ${cp.name}` : '';
          const label = `${cp.displayId || cp.id}${nameLabel}`;
          const opt = el('option', { value: cp.id }, label);
          if (cp.id === _selectedCpId) opt.selected = true;
          select.appendChild(opt);
        }
      }
      picker.appendChild(select);
    } else {
      const cp = _cpList[0];
      const solPrefix = cp.solutionName ? `${cp.solutionName} / ` : '';
      const nameLabel = (cp.name && cp.name !== cp.displayId) ? ` — ${cp.name}` : '';
      picker.appendChild(el('div', { class: 'cfg-cp-label' },
        `${solPrefix}${cp.displayId || cp.id}${nameLabel}`));
    }

    container.appendChild(picker);
  }

  // ── Breadcrumb navigation ──
  const modelName = _productTree.model.name || 'Product';
  const bc = el('div', { class: 'obj-path-bar' });
  const level = getCurrentLevel();

  if (_navStack.length > 0) {
    // Drilled in: show clickable breadcrumb trail
    bc.appendChild(el('span', {
      class: 'obj-path-link',
      onclick: () => { _navStack = []; rerender(); },
    }, modelName));

    for (let i = 0; i < _navStack.length; i++) {
      bc.appendChild(el('span', { class: 'obj-path-sep' }, ' › '));
      const posDisplay = _navStack[i].replace(/-\d+$/, '');
      if (i < _navStack.length - 1) {
        // Clickable intermediate crumb
        const targetDepth = i + 1;
        bc.appendChild(el('span', {
          class: 'obj-path-link',
          onclick: () => { _navStack = _navStack.slice(0, targetDepth); rerender(); },
        }, posDisplay));
      } else {
        // Current level (non-clickable)
        bc.appendChild(el('span', { class: 'obj-path-current' }, posDisplay));
      }
    }

    // Show count of items at current level
    if (level) {
      const itemCount = (level.positions?.length || 0) + (level.attrs?.length || 0) + (level.calcAttrs?.length || 0);
      bc.appendChild(el('span', { class: 'obj-path-count' }, `${itemCount}`));
    }
  } else {
    // Model level
    bc.appendChild(el('span', { class: 'obj-path-current' }, modelName));
    if (level) {
      bc.appendChild(el('span', { class: 'obj-path-count' }, `${level.positions.length} positions`));
    }
  }
  container.appendChild(bc);

  // ── Tab bar ──
  const currentTab = wizState._configTab || 'all';
  const calcCt = _attrIndex.filter(a => a.attrType === 'calculated-attribute').length;
  const allCount = level
    ? (level.positions?.length || 0) + (level.attrs?.length || 0) + (level.calcAttrs?.length || 0)
    : 0;
  const tabs = [
    { id: 'all',    label: 'All',    count: allCount },
    { id: 'calc',   label: 'Calc',   count: calcCt },
    { id: 'search', label: 'Search', count: null },
  ];
  const tabBar = el('div', { class: 'obj-tab-bar' });
  tabs.forEach(t => {
    tabBar.appendChild(el('button', {
      class: `obj-tab ${currentTab === t.id ? 'obj-tab-active' : ''}`,
      onclick: () => { wizState._configTab = t.id; rerender(); },
    }, [
      t.label,
      t.count != null ? el('span', { class: 'obj-tab-count' }, String(t.count)) : null,
    ]));
  });
  container.appendChild(tabBar);

  // ── Tab content ──
  const content = el('div', { class: 'obj-content' });
  if (currentTab === 'all') renderAllTab(content);
  else if (currentTab === 'calc') renderCalcTab(content);
  else if (currentTab === 'search') renderSearchTab(content);
  container.appendChild(content);
}

// ─── All Tab (hierarchical drill-down) ───────────────────────────

function renderAllTab(container) {
  const level = getCurrentLevel();
  if (!level) {
    container.appendChild(el('div', { class: 'obj-empty' }, 'Navigation error — could not find this position in the tree.'));
    return;
  }

  const { attrs, calcAttrs, positions, module } = level;
  let hasContent = false;

  // Sub-positions (drillable nodes) — shown first per Sam's model
  if (positions.length > 0) {
    hasContent = true;
    container.appendChild(groupHeader(`Positions (${positions.length})`));
    for (const pos of positions) {
      const posName = pos.name || pos.id;
      const posDisplay = pos.name.replace(/-\d+$/, '');
      // Count items inside this position
      const subAttrCt = (pos.assembly?.attrs?.length || 0) + (pos.assembly?.calcAttrs?.length || 0) + (pos.attrs?.length || 0);
      const subPosCt = pos.assembly?.positions?.length || 0;
      const countLabel = subPosCt > 0 ? `${subAttrCt} attrs, ${subPosCt} pos` : `${subAttrCt} attrs`;

      // Highlight if selected path goes through this position
      const pathPrefix = [..._navStack, posName].join('.');
      const isActive = wizState._selectedConfigPath?.startsWith(pathPrefix + '.') || wizState._selectedConfigPath?.startsWith(pathPrefix);

      container.appendChild(el('div', {
        class: `obj-row obj-row-ref ${isActive ? 'obj-row-sel' : ''}`,
        onclick: () => { _navStack.push(posName); wizState._configTab = 'all'; rerender(); },
        style: { cursor: 'pointer' },
      }, [
        el('span', { class: 'obj-row-name' }, posDisplay),
        el('span', { class: 'obj-row-target' }, countLabel),
        el('span', { class: 'obj-row-nav', html: icon('chevron-right', 12) }),
      ]));
    }
  }

  // Regular attributes (selectable — clicking completes the path)
  if (attrs.length > 0) {
    hasContent = true;
    container.appendChild(groupHeader(`Attributes (${attrs.length})`));
    for (const attr of attrs) {
      const fullPath = buildAttrPath(attr.name);
      const isSelected = wizState._selectedConfigPath === fullPath;
      container.appendChild(el('div', {
        class: `obj-row ${isSelected ? 'obj-row-sel' : ''}`,
        onclick: () => selectAttribute({ name: attr.name, value: attr.value, type: attr.type, fullPath, isCalc: false }),
      }, [
        el('span', { class: 'obj-row-name' }, attr.name),
        attr.value ? el('span', { class: 'obj-row-type' }, truncate(attr.value, 25)) : null,
        attr.type ? el('span', { class: 'obj-row-type', style: { opacity: '0.5' } }, attr.type) : null,
      ]));
    }
  }

  // Calculated attributes
  if (calcAttrs.length > 0) {
    hasContent = true;
    container.appendChild(groupHeader(`Calculated (${calcAttrs.length})`));
    for (const attr of calcAttrs) {
      const fullPath = buildAttrPath(attr.name);
      const isSelected = wizState._selectedConfigPath === fullPath;
      container.appendChild(el('div', {
        class: `obj-row ${isSelected ? 'obj-row-sel' : ''}`,
        onclick: () => selectAttribute({ name: attr.name, value: attr.value, type: attr.type, fullPath, isCalc: true }),
      }, [
        el('span', { class: 'obj-row-name' }, attr.name),
        el('span', { class: 'cfg-calc-badge' }, 'calc'),
        attr.value ? el('span', { class: 'obj-row-type' }, truncate(attr.value, 25)) : null,
      ]));
    }
  }

  // Module/variant attributes
  if (module?.variant) {
    const v = module.variant;
    const varAttrs = [...(v.attrs || []), ...(v.calcAttrs || [])];
    if (varAttrs.length > 0) {
      hasContent = true;
      container.appendChild(groupHeader(`Variant (${varAttrs.length})`));
      for (const attr of varAttrs) {
        const fullPath = buildAttrPath(attr.name);
        const isCalc = (v.calcAttrs || []).some(ca => ca.name === attr.name);
        const isSelected = wizState._selectedConfigPath === fullPath;
        container.appendChild(el('div', {
          class: `obj-row ${isSelected ? 'obj-row-sel' : ''}`,
          onclick: () => selectAttribute({ name: attr.name, value: attr.value, type: attr.type, fullPath, isCalc }),
        }, [
          el('span', { class: 'obj-row-name' }, attr.name),
          isCalc ? el('span', { class: 'cfg-calc-badge' }, 'calc') : null,
          attr.value ? el('span', { class: 'obj-row-type' }, truncate(attr.value, 25)) : null,
        ]));
      }
    }
  }

  if (!hasContent) {
    container.appendChild(el('div', { class: 'obj-empty' }, 'No attributes or positions at this level.'));
  }
}

// ─── Calc Tab ──────────────────────────────────────────────────────

function renderCalcTab(container) {
  const calcAttrs = _attrIndex.filter(a => a.attrType === 'calculated-attribute');
  if (calcAttrs.length === 0) {
    container.appendChild(el('div', { class: 'obj-empty' }, 'No calculated attributes found.'));
    return;
  }

  // Group by node
  const groups = {};
  for (const attr of calcAttrs) {
    const key = attr.fullNodePath || 'Model';
    if (!groups[key]) groups[key] = [];
    groups[key].push(attr);
  }

  for (const [groupName, attrs] of Object.entries(groups)) {
    container.appendChild(groupHeader(groupName));
    for (const attr of attrs) {
      const isSelected = wizState._selectedConfigPath === attr.path;
      container.appendChild(el('div', {
        class: `obj-row ${isSelected ? 'obj-row-sel' : ''}`,
        onclick: () => selectAttributeFromIndex(attr),
      }, [
        el('span', { class: 'obj-row-name' }, attr.attrName),
        el('span', { class: 'cfg-calc-badge' }, 'calc'),
        attr.value ? el('span', { class: 'obj-row-type' }, truncate(attr.value, 25)) : null,
      ]));
    }
  }
}

// ─── Search Tab ────────────────────────────────────────────────────

function renderSearchTab(container) {
  const searchInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: 'Search attributes...',
    value: _searchQuery,
    style: { fontSize: '12px', marginBottom: '8px' },
    oninput: (e) => {
      _searchQuery = e.target.value;
      _searchResults = performSearch(_searchQuery);
      const resultsDiv = container.querySelector('#cfg-search-results');
      if (resultsDiv) { clear(resultsDiv); renderSearchResults(resultsDiv); }
    },
  });
  container.appendChild(searchInput);

  const resultsDiv = el('div', { id: 'cfg-search-results' });
  container.appendChild(resultsDiv);

  if (_searchQuery) {
    if (!_searchResults) _searchResults = performSearch(_searchQuery);
    renderSearchResults(resultsDiv);
  } else {
    resultsDiv.appendChild(el('div', { class: 'obj-empty', style: { fontSize: '11px' } },
      'Type to search across all configuration attributes.'));
  }
}

function performSearch(query) {
  if (!query || !_attrIndex) return [];
  const q = query.toLowerCase();
  return _attrIndex.filter(a =>
    a.attrName.toLowerCase().includes(q) ||
    a.nodeName.toLowerCase().includes(q) ||
    a.path.toLowerCase().includes(q) ||
    (a.value && a.value.toLowerCase().includes(q))
  ).slice(0, 100);
}

function renderSearchResults(container) {
  if (!_searchResults || _searchResults.length === 0) {
    container.appendChild(el('div', { class: 'obj-empty', style: { fontSize: '11px' } },
      _searchQuery ? 'No matching attributes found.' : 'Type to search across all configuration attributes.'));
    return;
  }

  container.appendChild(el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)', marginBottom: '4px' } },
    `${_searchResults.length} result${_searchResults.length !== 1 ? 's' : ''}`));

  for (const attr of _searchResults) {
    const isSelected = wizState._selectedConfigPath === attr.path;
    container.appendChild(el('div', {
      class: `obj-row ${isSelected ? 'obj-row-sel' : ''}`,
      onclick: () => selectAttributeFromIndex(attr),
    }, [
      el('span', { class: 'obj-row-name' }, attr.attrName),
      attr.attrType === 'calculated-attribute' ? el('span', { class: 'cfg-calc-badge' }, 'calc') : null,
      attr.value ? el('span', { class: 'obj-row-type' }, truncate(attr.value, 25)) : null,
      el('div', { class: 'cfg-attr-path-hint' }, attr.path),
    ]));
  }
}

// ─── Attribute Selection ───────────────────────────────────────────

function selectAttribute(attr) {
  wizState._selectedConfigPath = attr.fullPath;
  wizState._selectedConfigNodeKey = _navStack.join('.');
  wizState._selectedConfigAttr = { name: attr.name, value: attr.value, type: attr.type };
  wizState._selectedConfigIsCalc = attr.isCalc;
  wizState.source = `getConfigurationAttribute("${attr.fullPath}")`;
  rerender();
  refreshPipeline();
}

function selectAttributeFromIndex(indexEntry) {
  wizState._selectedConfigPath = indexEntry.path;
  wizState._selectedConfigNodeKey = indexEntry.nodeName;
  wizState._selectedConfigAttr = {
    name: indexEntry.attrName,
    value: indexEntry.value,
    type: indexEntry.type,
  };
  wizState._selectedConfigIsCalc = indexEntry.attrType === 'calculated-attribute';
  wizState.source = `getConfigurationAttribute("${indexEntry.path}")`;
  rerender();
  refreshPipeline();
}

function rerender() {
  const container = qs('#wiz-obj-section');
  if (!container) return;
  clear(container);
  if (_productTree && _productTree.model) {
    renderExplorer(container);
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

function groupHeader(text) {
  return el('div', { class: 'obj-group-head' }, text);
}

function renderManualInput(container) {
  container.appendChild(el('div', { class: 'form-group', style: { marginTop: '8px' } }, [
    el('div', { class: 'form-label' }, [el('span', { class: 'icon', html: icon('edit-3', 12) }), ' Manual source']),
    el('input', {
      class: 'input',
      value: wizState.source || '',
      placeholder: 'getConfigurationAttribute("pos.attr")',
      style: { fontSize: '12px' },
      oninput: (e) => { wizState.source = e.target.value; refreshPipeline(); },
    }),
    el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '4px' } },
      'Enter the getConfigurationAttribute() path manually.'),
  ]));
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}
