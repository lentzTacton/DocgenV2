/**
 * Configuration Explorer — Browses configured product attributes from the Solution API.
 *
 * UX pattern mirrors the Object Explorer:
 *   1. Flat list of all nodes (positions/assemblies) — click one to "drill in"
 *   2. Inside a node: flat list of attributes — click to select
 *   3. Breadcrumb bar to navigate back
 *
 * Patterns generated:
 *   getConfigurationAttribute("node.attrName")                          — raw
 *   getConfigurationAttribute("node.attrName").value                    — direct .value
 *   getConfigurationAttribute("node.attrName").valueDescription         — display value
 *   source!=null ? source.valueDescription : "N/A"                      — null-safe
 *   source.value!=null ? source.valueDescription : "N/A"                — null-safe (.value check)
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
let _nodeIndex = null;          // flat list of all navigable nodes
let _selectedNodeKey = null;    // currently drilled-in node key (null = top-level list)
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
    if (!_cpList) {
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
      _nodeIndex = _productTree ? buildNodeIndex(_productTree) : [];
      _selectedNodeKey = null;
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
 * @param {string} attrPath — e.g. "nonfire_pump_node-1.pumpSeries"
 * @returns {Promise<Array>}
 */
export async function resolveConfigAttrAcrossCPs(attrPath) {
  if (!attrPath) return [];
  if (!_cpList) {
    try { _cpList = await getConfiguredProductList(); } catch { return []; }
  }
  if (!_cpList?.length) return [];

  const results = [];
  for (const cp of _cpList) {
    try {
      const tree = await fetchConfiguredProductData(cp.id);
      if (!tree) continue;
      const index = indexConfigAttributes(tree);
      const match = index.find(a => a.path === attrPath);
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
  _nodeIndex = null;
  _selectedNodeKey = null;
  _searchQuery = '';
  _searchResults = null;
}

// ─── Build flat node index from product tree ───────────────────────
// Each node = { key, displayName, attrCount, attrs: [{name, value, type, isCalc, fullPath}] }

function buildNodeIndex(tree) {
  if (!tree?.model) return [];
  const nodes = [];

  function addNode(key, displayName, attrs, calcAttrs) {
    const allAttrs = [];
    if (attrs?.length) {
      for (const a of attrs) {
        allAttrs.push({
          name: a.name, value: a.value || '', type: a.type || '',
          isCalc: false, fullPath: `${key}.${a.name}`,
        });
      }
    }
    if (calcAttrs?.length) {
      for (const a of calcAttrs) {
        allAttrs.push({
          name: a.name, value: a.value || '', type: a.type || '',
          isCalc: true, fullPath: `${key}.${a.name}`,
        });
      }
    }
    if (allAttrs.length > 0) {
      nodes.push({ key, displayName, attrCount: allAttrs.length, attrs: allAttrs });
    }
  }

  // Model-level attributes
  const model = tree.model;
  const modelKey = model.name || model.id;
  addNode(modelKey, model.name || 'Model', model.attrs, model.calcAttrs);

  // Walk positions recursively
  function walkPositions(positions) {
    if (!positions) return;
    for (const pos of positions) {
      const posKey = pos.name || pos.id;
      const posDisplay = pos.name.replace(/-\d+$/, '');

      // Position-level attributes
      if (pos.attrs?.length) {
        addNode(posKey, posDisplay, pos.attrs, null);
      }

      // Assembly child
      if (pos.assembly) {
        const assy = pos.assembly;
        const assyKey = assy.name || assy.id;
        const fullAssyKey = `${posKey}.${assyKey}`;
        addNode(fullAssyKey, posDisplay, assy.attrs, assy.calcAttrs);
        // Recurse into sub-positions
        if (assy.positions?.length) walkPositions(assy.positions);
      }

      // Module/variant child
      if (pos.module?.variant) {
        const mod = pos.module;
        const modKey = mod.name || mod.id;
        const fullModKey = `${posKey}.${modKey}`;
        addNode(fullModKey, posDisplay + ' (variant)', mod.variant.attrs, mod.variant.calcAttrs);
      }
    }
  }

  walkPositions(model.positions);
  return nodes;
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
          _nodeIndex = null;
          _selectedNodeKey = null;
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

  if (_selectedNodeKey) {
    // Drilled in: show Model link > Node name
    const node = _nodeIndex.find(n => n.key === _selectedNodeKey);
    bc.appendChild(el('span', {
      class: 'obj-path-link',
      onclick: () => { _selectedNodeKey = null; rerender(); },
    }, modelName));
    bc.appendChild(el('span', { class: 'obj-path-sep' }, ' › '));
    bc.appendChild(el('span', { class: 'obj-path-current' }, node ? node.displayName : _selectedNodeKey));
    if (node) bc.appendChild(el('span', { class: 'obj-path-count' }, `${node.attrCount}`));
  } else {
    // Top level: model name + total node count
    bc.appendChild(el('span', { class: 'obj-path-current' }, modelName));
    bc.appendChild(el('span', { class: 'obj-path-count' }, `${_nodeIndex.length} nodes`));
  }
  container.appendChild(bc);

  // ── Tab bar ──
  const currentTab = wizState._configTab || 'all';
  const totalAttrs = _attrIndex.length;
  const calcCt = _attrIndex.filter(a => a.attrType === 'calculated-attribute').length;
  const tabs = [
    { id: 'all',    label: 'All',    count: _selectedNodeKey ? (_nodeIndex.find(n => n.key === _selectedNodeKey)?.attrCount || 0) : _nodeIndex.length },
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

// ─── All Tab (flat node list or drilled-in attribute list) ─────────

function renderAllTab(container) {
  if (_selectedNodeKey) {
    // Drilled in → show attributes for this node
    const node = _nodeIndex.find(n => n.key === _selectedNodeKey);
    if (!node) {
      container.appendChild(el('div', { class: 'obj-empty' }, 'Node not found.'));
      return;
    }

    const regulars = node.attrs.filter(a => !a.isCalc);
    const calcs = node.attrs.filter(a => a.isCalc);

    if (regulars.length > 0) {
      container.appendChild(groupHeader(`Attributes (${regulars.length})`));
      for (const attr of regulars) renderAttrRow(container, attr);
    }
    if (calcs.length > 0) {
      container.appendChild(groupHeader(`Calculated (${calcs.length})`));
      for (const attr of calcs) renderAttrRow(container, attr);
    }
  } else {
    // Top level → flat list of all nodes (like object explorer's refs list)
    if (_nodeIndex.length === 0) {
      container.appendChild(el('div', { class: 'obj-empty' }, 'No configuration nodes found.'));
      return;
    }
    for (const node of _nodeIndex) {
      const isActive = wizState._selectedConfigPath?.startsWith(node.key + '.');
      container.appendChild(el('div', {
        class: `obj-row obj-row-ref ${isActive ? 'obj-row-sel' : ''}`,
        onclick: () => { _selectedNodeKey = node.key; wizState._configTab = 'all'; rerender(); },
        style: { cursor: 'pointer' },
      }, [
        el('span', { class: 'obj-row-name' }, node.displayName),
        el('span', { class: 'obj-row-target' }, `${node.attrCount} attrs`),
        el('span', { class: 'obj-row-nav', html: icon('chevron-right', 12) }),
      ]));
    }
  }
}

// ─── Attribute Row (inside drilled-in node) ─────────────────────────

function renderAttrRow(container, attr) {
  const isSelected = wizState._selectedConfigPath === attr.fullPath;
  container.appendChild(el('div', {
    class: `obj-row ${isSelected ? 'obj-row-sel' : ''}`,
    onclick: () => selectAttribute(attr),
  }, [
    el('span', { class: 'obj-row-name' }, attr.name),
    attr.isCalc ? el('span', { class: 'cfg-calc-badge' }, 'calc') : null,
    attr.value ? el('span', { class: 'obj-row-type' }, truncate(attr.value, 25)) : null,
    attr.type ? el('span', { class: 'obj-row-type', style: { opacity: '0.5' } }, attr.type) : null,
  ]));
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
      el('div', { class: 'cfg-attr-path-hint' }, attr.fullNodePath),
    ]));
  }
}

// ─── Attribute Selection ───────────────────────────────────────────

function selectAttribute(attr) {
  wizState._selectedConfigPath = attr.fullPath;
  wizState._selectedConfigNodeKey = _selectedNodeKey;
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
      placeholder: 'getConfigurationAttribute("node.attr")',
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
