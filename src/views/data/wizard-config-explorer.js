/**
 * Configuration Explorer — Browses configured product attributes from the Solution API.
 *
 * Hierarchical drill-down navigation per Sam's / Tacton's getConfigurationAttribute path model:
 *   1. Start at model level: show model attributes + top-level positions
 *   2. Click a position → add to path, show its ASSEMBLY's attributes + assembly sub-positions
 *      (position-level attributes are NOT shown — only the assembly's attrs and sub-positions)
 *   3. Click an attribute → done, path = pos1.pos2.attrName
 *   4. Breadcrumb bar to navigate back up
 *
 * Tabs:
 *   - All:        Everything at current drill level (positions + attrs + calc)
 *   - Nodes:      Flat outline of all tree nodes (positions/assemblies) grouped by depth
 *   - Attributes: Only regular attributes at current drill level
 *   - Positions:  Only drillable positions at current drill level
 *   - Calculated: Flat list of all calculated attributes across the tree
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
let _searchQuery = '';          // inline search filter
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

    if (!_selectedCpId) {
      // Restore from wizState if editing an existing variable with a saved CP
      if (wizState._selectedCpId && _cpList.some(cp => cp.id === wizState._selectedCpId)) {
        _selectedCpId = wizState._selectedCpId;
      } else {
        _selectedCpId = _cpList[0].id;
      }
    }
    // Always sync wizState so the CP is saved even if user never changes the dropdown
    wizState._selectedCpId = _selectedCpId;
    const cpInfo = _cpList.find(cp => cp.id === _selectedCpId);
    if (cpInfo) {
      wizState._selectedCpDisplayId = cpInfo.displayId || _selectedCpId;
      // Also persist the solution name so the selection panel can auto-select it
      if (cpInfo.solutionName) wizState.instanceSolution = cpInfo.solutionName;
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
      clear(container);
    }

    if (!_productTree || !_productTree.model) {
      console.warn('[config-explorer] productTree failed for cpId:', _selectedCpId, _productTree);
      container.appendChild(el('div', { class: 'obj-empty', style: { color: 'var(--danger)' } },
        `Could not load product configuration for CP "${_selectedCpId}" — check browser console for details.`));
      renderManualInput(container);
      return;
    }

    // Auto-navigate to selected attribute in edit mode
    if (wizState._selectedConfigPath && _navStack.length === 0) {
      autoNavigateToPath(wizState._selectedConfigPath);
    }

    renderExplorer(container);

    // Scroll selected attribute into center of view
    scrollSelectedIntoView();
  } catch (err) {
    clear(container);
    console.error('[config-explorer] Error:', err);
    container.appendChild(el('div', { class: 'obj-empty', style: { color: 'var(--danger)' } }, `Error: ${err.message}`));
    renderManualInput(container);
  }
}

/**
 * Auto-navigate _navStack to show the level containing the selected attribute.
 * For path "pos1.pos2.attrName", sets _navStack = ['pos1', 'pos2'] so the explorer
 * renders at the level where "attrName" is visible and highlighted.
 */
function autoNavigateToPath(selectedPath) {
  if (!selectedPath || !_productTree?.model) return;

  const segments = selectedPath.split('.');
  if (segments.length < 2) return; // model-level attr, no navigation needed

  // The last segment is the attribute name; everything before is the position chain
  const posSegments = segments.slice(0, -1);

  // Verify the position chain is valid by walking the tree
  let positions = _productTree.model.positions || [];
  const validChain = [];

  for (const posName of posSegments) {
    const pos = positions.find(p => (p.name || p.id) === posName);
    if (!pos) break;
    validChain.push(posName);
    positions = pos.assembly?.positions || [];
  }

  _navStack = validChain;
}

/**
 * After rendering, scroll the selected attribute row to the center of the scrollable content.
 */
function scrollSelectedIntoView() {
  requestAnimationFrame(() => {
    const selected = document.querySelector('#wiz-obj-section .obj-row-sel');
    if (selected) {
      selected.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
}

/**
 * Resolve a config attribute path across all configured products.
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
}

// ─── Hierarchical Navigation Helpers ──────────────────────────────

/**
 * Get the attributes and sub-positions for the current navigation level.
 *
 * Per Sam's model:
 *   - Model level (_navStack empty): model attrs + model positions
 *   - Position level: position's ASSEMBLY attrs + assembly sub-positions
 *     (position-level attrs are NOT shown — only what's inside the assembly)
 */
function getCurrentLevel() {
  if (!_productTree?.model) return null;

  if (_navStack.length === 0) {
    const m = _productTree.model;
    return {
      attrs: m.attrs || [],
      calcAttrs: m.calcAttrs || [],
      positions: m.positions || [],
    };
  }

  let positions = _productTree.model.positions || [];
  let pos = null;
  for (const name of _navStack) {
    pos = positions.find(p => (p.name || p.id) === name);
    if (!pos) return null;
    positions = pos.assembly?.positions || [];
  }

  const assy = pos.assembly;
  return {
    attrs: assy?.attrs || [],
    calcAttrs: assy?.calcAttrs || [],
    positions: assy?.positions || [],
    module: pos.module || null,
  };
}

/**
 * Build the getConfigurationAttribute path for an attribute at the current nav level.
 */
function buildAttrPath(attrName) {
  if (_navStack.length === 0) {
    const modelName = _productTree.model.name || _productTree.model.id;
    return `${modelName}.${attrName}`;
  }
  return [..._navStack, attrName].join('.');
}

/**
 * Collect all tree nodes (positions) recursively for the Nodes tab.
 * Returns flat array of { name, displayName, depth, path (posChain), attrCount, subPosCount }
 */
function collectAllNodes() {
  if (!_productTree?.model) return [];
  const nodes = [];

  function walk(positions, depth, chain) {
    if (!positions) return;
    for (const pos of positions) {
      const posName = pos.name || pos.id;
      const displayName = posName.replace(/-\d+$/, '');
      const currentChain = chain ? `${chain}.${posName}` : posName;
      const attrCount = (pos.assembly?.attrs?.length || 0) + (pos.assembly?.calcAttrs?.length || 0);
      const subPosCount = pos.assembly?.positions?.length || 0;
      nodes.push({ name: posName, displayName, depth, path: currentChain, attrCount, subPosCount });
      if (pos.assembly?.positions?.length) {
        walk(pos.assembly.positions, depth + 1, currentChain);
      }
    }
  }

  walk(_productTree.model.positions, 0, '');
  return nodes;
}

// ─── Explorer Rendering ────────────────────────────────────────────

function renderExplorer(container) {
  // ── CP picker ──
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
          // Persist selected CP to wizState so it's saved with the variable
          wizState._selectedCpId = _selectedCpId;
          const cpInfo = _cpList.find(cp => cp.id === _selectedCpId);
          wizState._selectedCpDisplayId = cpInfo?.displayId || _selectedCpId;
          if (cpInfo?.solutionName) wizState.instanceSolution = cpInfo.solutionName;
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
    bc.appendChild(el('span', {
      class: 'obj-path-link',
      onclick: () => { _navStack = []; _searchQuery = ''; rerender(); },
    }, modelName));

    for (let i = 0; i < _navStack.length; i++) {
      bc.appendChild(el('span', { class: 'obj-path-sep' }, ' > '));
      const posDisplay = _navStack[i].replace(/-\d+$/, '');
      if (i < _navStack.length - 1) {
        const targetDepth = i + 1;
        bc.appendChild(el('span', {
          class: 'obj-path-link',
          onclick: () => { _navStack = _navStack.slice(0, targetDepth); _searchQuery = ''; rerender(); },
        }, posDisplay));
      } else {
        bc.appendChild(el('span', { class: 'obj-path-current' }, posDisplay));
      }
    }

    if (level) {
      const itemCount = (level.positions?.length || 0) + (level.attrs?.length || 0) + (level.calcAttrs?.length || 0);
      bc.appendChild(el('span', { class: 'obj-path-count' }, `${itemCount}`));
    }
  } else {
    bc.appendChild(el('span', { class: 'obj-path-current' }, modelName));
    if (level) {
      bc.appendChild(el('span', { class: 'obj-path-count' }, `${level.positions.length} positions`));
    }
  }
  container.appendChild(bc);

  // ── Tab bar ──
  const currentTab = wizState._configTab || 'all';
  const calcCt = _attrIndex.filter(a => a.attrType === 'calculated-attribute').length;
  const levelAttrs = level ? (level.attrs?.length || 0) : 0;
  const levelCalc = level ? (level.calcAttrs?.length || 0) : 0;
  const levelPos = level ? (level.positions?.length || 0) : 0;
  const allNodes = collectAllNodes();

  const tabs = [
    { id: 'all',        label: 'All',   count: null },
    { id: 'nodes',      label: 'Nodes', count: allNodes.length },
    { id: 'attrs',      label: 'Attr.',  count: levelAttrs + levelCalc },
    { id: 'positions',  label: 'Pos.',   count: levelPos },
    { id: 'calc',       label: 'Calc.',  count: calcCt },
  ];

  const tabBar = el('div', { class: 'obj-tab-bar' });
  tabs.forEach(t => {
    tabBar.appendChild(el('button', {
      class: `obj-tab ${currentTab === t.id ? 'obj-tab-active' : ''}`,
      onclick: () => { wizState._configTab = t.id; _searchQuery = ''; rerender(); },
    }, [
      t.label,
      t.count != null ? el('span', { class: 'obj-tab-count' }, String(t.count)) : null,
    ]));
  });
  container.appendChild(tabBar);

  // ── Inline search filter ──
  const placeholders = {
    all: 'Filter attributes & positions...',
    nodes: 'Filter nodes...',
    attrs: 'Filter attributes...',
    positions: 'Filter positions...',
    calc: 'Filter calculated attributes...',
  };
  const searchWrap = el('div', { style: { position: 'relative', marginBottom: '6px' } });
  const searchInput = el('input', {
    class: 'input',
    type: 'text',
    placeholder: placeholders[currentTab] || 'Filter...',
    value: _searchQuery,
    style: { fontSize: '12px', paddingLeft: '26px', paddingRight: _searchQuery ? '26px' : '8px' },
    oninput: (e) => {
      _searchQuery = e.target.value;
      rerender();
    },
  });
  searchWrap.appendChild(el('span', {
    style: { position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)', opacity: '0.4', pointerEvents: 'none' },
    html: icon('search', 13),
  }));
  if (_searchQuery) {
    searchWrap.appendChild(el('span', {
      style: { position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', cursor: 'pointer', opacity: '0.5' },
      html: icon('x', 13),
      onclick: () => { _searchQuery = ''; rerender(); },
    }));
  }
  searchWrap.appendChild(searchInput);
  container.appendChild(searchWrap);

  // ── Tab content ──
  const content = el('div', { class: 'obj-content' });
  if (currentTab === 'all') renderAllTab(content);
  else if (currentTab === 'nodes') renderNodesTab(content, allNodes);
  else if (currentTab === 'attrs') renderAttrsTab(content);
  else if (currentTab === 'positions') renderPositionsTab(content);
  else if (currentTab === 'calc') renderCalcTab(content);
  container.appendChild(content);
}

// ─── All Tab (hierarchical drill-down — everything at current level) ──

function renderAllTab(container) {
  const level = getCurrentLevel();
  if (!level) {
    container.appendChild(el('div', { class: 'obj-empty' }, 'Navigation error — could not find this position in the tree.'));
    return;
  }

  const { attrs, calcAttrs, positions, module } = level;
  const q = _searchQuery.toLowerCase();
  let hasContent = false;

  // Positions (drillable)
  const filteredPositions = q
    ? positions.filter(p => (p.name || p.id).toLowerCase().includes(q))
    : positions;

  if (filteredPositions.length > 0) {
    hasContent = true;
    container.appendChild(groupHeader(`Positions (${filteredPositions.length})`));
    for (const pos of filteredPositions) {
      renderPositionRow(container, pos);
    }
  }

  // Regular attributes
  const filteredAttrs = q
    ? attrs.filter(a => a.name.toLowerCase().includes(q) || (a.value && a.value.toLowerCase().includes(q)))
    : attrs;

  if (filteredAttrs.length > 0) {
    hasContent = true;
    container.appendChild(groupHeader(`Attributes (${filteredAttrs.length})`));
    for (const attr of filteredAttrs) {
      renderAttrRow(container, attr, false);
    }
  }

  // Calculated attributes
  const filteredCalc = q
    ? calcAttrs.filter(a => a.name.toLowerCase().includes(q) || (a.value && a.value.toLowerCase().includes(q)))
    : calcAttrs;

  if (filteredCalc.length > 0) {
    hasContent = true;
    container.appendChild(groupHeader(`Calculated (${filteredCalc.length})`));
    for (const attr of filteredCalc) {
      renderAttrRow(container, attr, true);
    }
  }

  // Module/variant
  if (module?.variant) {
    renderVariantSection(container, module.variant, q);
    hasContent = true;
  }

  if (!hasContent) {
    container.appendChild(el('div', { class: 'obj-empty' },
      q ? 'No matching items.' : 'No attributes or positions at this level.'));
  }
}

// ─── Nodes Tab (flat outline of all tree positions) ─────────────

function renderNodesTab(container, allNodes) {
  const q = _searchQuery.toLowerCase();
  const filtered = q
    ? allNodes.filter(n => n.displayName.toLowerCase().includes(q) || n.path.toLowerCase().includes(q))
    : allNodes;

  if (filtered.length === 0) {
    container.appendChild(el('div', { class: 'obj-empty' },
      q ? 'No matching nodes.' : 'No positions found in the configuration tree.'));
    return;
  }

  for (const node of filtered) {
    // Highlight if selected path goes through this node
    const isActive = wizState._selectedConfigPath?.startsWith(node.path + '.') || wizState._selectedConfigPath === node.path;

    const indent = node.depth * 14;
    const countParts = [];
    if (node.attrCount > 0) countParts.push(`${node.attrCount} attrs`);
    if (node.subPosCount > 0) countParts.push(`${node.subPosCount} pos`);

    container.appendChild(el('div', {
      class: `obj-row obj-row-ref ${isActive ? 'obj-row-sel' : ''}`,
      style: { paddingLeft: `${8 + indent}px`, cursor: 'pointer' },
      onclick: () => {
        // Navigate to this node
        const segments = node.path.split('.');
        _navStack = segments;
        wizState._configTab = 'all';
        _searchQuery = '';
        rerender();
      },
    }, [
      el('span', { class: 'obj-row-name' }, node.displayName),
      countParts.length > 0
        ? el('span', { class: 'obj-row-target' }, countParts.join(', '))
        : null,
      el('span', { class: 'obj-row-nav', html: icon('chevron-right', 12) }),
    ]));
  }
}

// ─── Attributes Tab (only attrs at current level, no positions) ──

function renderAttrsTab(container) {
  const level = getCurrentLevel();
  if (!level) {
    container.appendChild(el('div', { class: 'obj-empty' }, 'Navigation error.'));
    return;
  }

  const { attrs, calcAttrs, module } = level;
  const q = _searchQuery.toLowerCase();
  let hasContent = false;

  const filteredAttrs = q
    ? attrs.filter(a => a.name.toLowerCase().includes(q) || (a.value && a.value.toLowerCase().includes(q)))
    : attrs;

  if (filteredAttrs.length > 0) {
    hasContent = true;
    container.appendChild(groupHeader(`Attributes (${filteredAttrs.length})`));
    for (const attr of filteredAttrs) {
      renderAttrRow(container, attr, false);
    }
  }

  const filteredCalc = q
    ? calcAttrs.filter(a => a.name.toLowerCase().includes(q) || (a.value && a.value.toLowerCase().includes(q)))
    : calcAttrs;

  if (filteredCalc.length > 0) {
    hasContent = true;
    container.appendChild(groupHeader(`Calculated (${filteredCalc.length})`));
    for (const attr of filteredCalc) {
      renderAttrRow(container, attr, true);
    }
  }

  if (module?.variant) {
    renderVariantSection(container, module.variant, q);
    hasContent = true;
  }

  if (!hasContent) {
    container.appendChild(el('div', { class: 'obj-empty' },
      q ? 'No matching attributes.' : 'No attributes at this level.'));
  }
}

// ─── Positions Tab (only drillable positions at current level) ───

function renderPositionsTab(container) {
  const level = getCurrentLevel();
  if (!level) {
    container.appendChild(el('div', { class: 'obj-empty' }, 'Navigation error.'));
    return;
  }

  const { positions } = level;
  const q = _searchQuery.toLowerCase();
  const filtered = q
    ? positions.filter(p => (p.name || p.id).toLowerCase().includes(q))
    : positions;

  if (filtered.length === 0) {
    container.appendChild(el('div', { class: 'obj-empty' },
      q ? 'No matching positions.' : 'No sub-positions at this level.'));
    return;
  }

  for (const pos of filtered) {
    renderPositionRow(container, pos);
  }
}

// ─── Calc Tab (flat list of all calculated attrs across tree) ────

function renderCalcTab(container) {
  const calcAttrs = _attrIndex.filter(a => a.attrType === 'calculated-attribute');
  if (calcAttrs.length === 0) {
    container.appendChild(el('div', { class: 'obj-empty' }, 'No calculated attributes found.'));
    return;
  }

  const q = _searchQuery.toLowerCase();
  const filtered = q
    ? calcAttrs.filter(a =>
        a.attrName.toLowerCase().includes(q) ||
        a.nodeName.toLowerCase().includes(q) ||
        a.path.toLowerCase().includes(q) ||
        (a.value && a.value.toLowerCase().includes(q)))
    : calcAttrs;

  if (filtered.length === 0) {
    container.appendChild(el('div', { class: 'obj-empty', style: { fontSize: '11px' } },
      'No matching calculated attributes.'));
    return;
  }

  const groups = {};
  for (const attr of filtered) {
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

// ─── Shared row renderers ─────────────────────────────────────────

function renderPositionRow(container, pos) {
  const posName = pos.name || pos.id;
  const posDisplay = posName.replace(/-\d+$/, '');
  const subAttrCt = (pos.assembly?.attrs?.length || 0) + (pos.assembly?.calcAttrs?.length || 0);
  const subPosCt = pos.assembly?.positions?.length || 0;
  const countLabel = subPosCt > 0 ? `${subAttrCt} attrs, ${subPosCt} pos` : `${subAttrCt} attrs`;

  const pathPrefix = [..._navStack, posName].join('.');
  const isActive = wizState._selectedConfigPath?.startsWith(pathPrefix + '.') || wizState._selectedConfigPath === pathPrefix;

  container.appendChild(el('div', {
    class: `obj-row obj-row-ref ${isActive ? 'obj-row-sel' : ''}`,
    onclick: () => { _navStack.push(posName); wizState._configTab = 'all'; _searchQuery = ''; rerender(); scrollSelectedIntoView(); },
    style: { cursor: 'pointer' },
  }, [
    el('span', { class: 'obj-row-name' }, posDisplay),
    el('span', { class: 'obj-row-target' }, countLabel),
    el('span', { class: 'obj-row-nav', html: icon('chevron-right', 12) }),
  ]));
}

function renderAttrRow(container, attr, isCalc) {
  const fullPath = buildAttrPath(attr.name);
  const isSelected = wizState._selectedConfigPath === fullPath;
  container.appendChild(el('div', {
    class: `obj-row ${isSelected ? 'obj-row-sel' : ''}`,
    onclick: () => selectAttribute({ name: attr.name, value: attr.value, type: attr.type, fullPath, isCalc }),
  }, [
    el('span', { class: 'obj-row-name' }, attr.name),
    isCalc ? el('span', { class: 'cfg-calc-badge' }, 'calc') : null,
    attr.value ? el('span', { class: 'obj-row-type' }, truncate(attr.value, 25)) : null,
    !isCalc && attr.type ? el('span', { class: 'obj-row-type', style: { opacity: '0.5' } }, attr.type) : null,
  ]));
}

function renderVariantSection(container, variant, q) {
  const varAttrs = [...(variant.attrs || []), ...(variant.calcAttrs || [])];
  const filtered = q
    ? varAttrs.filter(a => a.name.toLowerCase().includes(q) || (a.value && a.value.toLowerCase().includes(q)))
    : varAttrs;

  if (filtered.length > 0) {
    container.appendChild(groupHeader(`Variant (${filtered.length})`));
    for (const attr of filtered) {
      const isCalc = (variant.calcAttrs || []).some(ca => ca.name === attr.name);
      renderAttrRow(container, attr, isCalc);
    }
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
  // Navigate the explorer to the correct level for this attribute
  const segments = indexEntry.path.split('.');
  if (segments.length >= 2) {
    const posSegments = segments.slice(0, -1);
    let positions = _productTree?.model?.positions || [];
    const validChain = [];
    for (const posName of posSegments) {
      const pos = positions.find(p => (p.name || p.id) === posName);
      if (!pos) break;
      validChain.push(posName);
      positions = pos.assembly?.positions || [];
    }
    _navStack = validChain;
  }

  wizState._selectedConfigPath = indexEntry.path;
  wizState._selectedConfigNodeKey = indexEntry.nodeName;
  wizState._selectedConfigAttr = {
    name: indexEntry.attrName,
    value: indexEntry.value,
    type: indexEntry.type,
  };
  wizState._selectedConfigIsCalc = indexEntry.attrType === 'calculated-attribute';
  wizState.source = `getConfigurationAttribute("${indexEntry.path}")`;
  wizState._configTab = 'all';
  _searchQuery = '';
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
