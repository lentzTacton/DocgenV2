/**
 * Object Explorer Section — Tabbed model navigator.
 *
 * Renders an interactive object model explorer with:
 * - Favorites tab (starred fields/refs)
 * - Fields tab (attributes grouped by mandatory/optional)
 * - References tab (forward/reverse relationships)
 * - Breadcrumb navigation
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import { wizState } from './wizard-state.js';
import {
  describeObject, resolveCurrentObject, toggleExplorerFavorite, getStartingObject,
} from '../../services/data-api.js';

let refreshPipelineCallback = null;

/**
 * If transformations (single filter) are set, show a confirmation dialog before
 * proceeding with a path change that would reset them. Calls `onConfirm` only
 * if the user agrees or no transformations exist.
 */
function confirmPathChangeIfNeeded(onConfirm) {
  if (!wizState._singleFilter) { onConfirm(); return; }
  // Build a styled confirmation overlay (same pattern as showWizConfirmDialog)
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
        el('span', { class: 'icon', style: { color: 'var(--warning, #D4A015)' }, html: icon('warning', 18) }),
        el('div', { style: { fontWeight: '700', fontSize: '13px' } }, 'Reset transformations?'),
      ]),
      el('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px', lineHeight: '1.5' } },
        'Changing the data path will reset filter conditions defined in the Transformation tab. Do you wish to continue?'),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px' } }, [
        el('button', { class: 'btn btn-outline btn-sm', onclick: () => overlay.remove() }, 'Cancel'),
        el('button', {
          class: 'btn btn-sm',
          style: { background: 'var(--warning, #D4A015)', color: '#fff', border: 'none' },
          onclick: () => { overlay.remove(); onConfirm(); },
        }, 'Continue'),
      ]),
    ])
  );
  document.body.appendChild(overlay);
}

/**
 * Set the refreshPipeline callback.
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
 * Load and render the object explorer.
 */
export async function loadObjectExplorer() {
  const container = qs('#wiz-obj-section');
  if (!container) return;
  clear(container);

  if (wizState.modelObjects.length === 0) {
    // Fallback: manual text input
    container.appendChild(el('div', { class: 'form-group' }, [
      el('div', { class: 'form-label' }, [el('span', { class: 'icon', html: icon('target', 12) }), 'Expression path']),
      el('input', { class: 'input', value: wizState.source, placeholder: 'e.g. solution.opportunity.account.name', style: { fontSize: '12px' }, oninput: (e) => { wizState.source = e.target.value; refreshPipeline(); } }),
    ]));
    return;
  }

  // Show loading
  container.appendChild(el('div', { class: 'obj-empty', style: { color: 'var(--text-tertiary)' } }, 'Loading...'));

  try {
    // Resolve current object from path
    const currentObjName = await resolveCurrentObject(wizState.objectPath);
    wizState.currentObjDesc = await describeObject(currentObjName);

    clear(container);
    renderObjectExplorer(container, currentObjName);
    // Update breadcrumb now that currentObjDesc is loaded (breadcrumb is in shared wizard area)
    refreshPipeline();

    // Auto-scroll to the selected field so it's visible on edit
    requestAnimationFrame(() => {
      const sel = container.querySelector('.obj-row-sel');
      if (sel) sel.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  } catch (err) {
    clear(container);
    console.error('[object-explorer] Error:', err);
    container.appendChild(el('div', { class: 'obj-empty', style: { color: 'var(--danger)' } }, `Error: ${err.message}`));
    // Add manual fallback
    container.appendChild(el('div', { class: 'form-group' }, [
      el('div', { class: 'form-label' }, [el('span', { class: 'icon', html: icon('target', 12) }), 'Expression path (manual)']),
      el('input', { class: 'input', value: wizState.source, placeholder: 'e.g. solution.opportunity.account.name', style: { fontSize: '12px' }, oninput: (e) => { wizState.source = e.target.value; refreshPipeline(); } }),
    ]));
  }
}

/**
 * Render the object explorer UI.
 */
function renderObjectExplorer(container, currentObjName) {
  clear(container);

  // ── Breadcrumb navigation (inside object explorer, above tabs) ──
  const startObj = getStartingObject();
  if (wizState.objectPath.length > 0) {
    const bc = el('div', { class: 'obj-path-bar' });
    bc.appendChild(el('span', {
      class: 'obj-path-link',
      onclick: () => confirmPathChangeIfNeeded(() => { wizState.objectPath = []; wizState.source = ''; wizState._singleFilter = null; wizState._singleLeafField = null; loadObjectExplorer(); refreshPipeline(); }),
    }, startObj));
    wizState.objectPath.forEach((seg, idx) => {
      bc.appendChild(el('span', { class: 'obj-path-sep' }, seg.reverse ? ' ← ' : ' › '));
      const isLast = idx === wizState.objectPath.length - 1;
      bc.appendChild(el('span', {
        class: isLast ? 'obj-path-current' : 'obj-path-link',
        onclick: isLast ? null : () => confirmPathChangeIfNeeded(() => { wizState.objectPath = wizState.objectPath.slice(0, idx + 1); wizState.source = ''; wizState._singleFilter = null; wizState._singleLeafField = null; loadObjectExplorer(); refreshPipeline(); }),
      }, seg.reverse ? seg.fromObject : seg.name));
    });
    if (wizState.currentObjDesc?.recordCount != null) {
      bc.appendChild(el('span', { class: 'obj-path-count' }, `${wizState.currentObjDesc.recordCount}`));
    }
    container.appendChild(bc);
  } else {
    container.appendChild(el('div', { class: 'obj-path-bar' }, [
      el('span', { class: 'obj-path-current' }, currentObjName),
      wizState.currentObjDesc?.recordCount != null ? el('span', { class: 'obj-path-count' }, `${wizState.currentObjDesc.recordCount}`) : null,
    ]));
  }

  // ── Tab bar ──
  const allCount = wizState.currentObjDesc.attributes.length + wizState.currentObjDesc.forwardRefs.length + wizState.currentObjDesc.reverseRefs.length;
  const tabs = [
    { id: 'all',  label: 'All',        count: allCount },
    { id: 'ref',  label: 'Refs',       count: wizState.currentObjDesc.forwardRefs.length + wizState.currentObjDesc.reverseRefs.length },
    { id: 'fav',  label: 'Favorites',  count: countFavs(currentObjName) },
  ];
  const tabBar = el('div', { class: 'obj-tab-bar' });
  tabs.forEach(t => {
    tabBar.appendChild(el('button', {
      class: `obj-tab ${wizState.explorerTab === t.id ? 'obj-tab-active' : ''}`,
      onclick: () => { wizState.explorerTab = t.id; renderObjectExplorer(container, currentObjName); },
    }, [
      t.label,
      el('span', { class: 'obj-tab-count' }, String(t.count)),
    ]));
  });
  container.appendChild(tabBar);

  // ── Tab content ──
  const content = el('div', { class: 'obj-content' });
  if (wizState.explorerTab === 'fav') renderFavTab(content, currentObjName);
  else if (wizState.explorerTab === 'ref') renderRefTab(content, currentObjName);
  else renderAllTab(content, currentObjName);
  container.appendChild(content);
}

// ── Favorites tab ──

function favKey(objName, item) {
  if (item._reverse) return `${objName}.←${item._reverse.fromObject}.${item._reverse.attribute}`;
  return `${objName}.${item.name}`;
}

function allFavCandidates() {
  if (!wizState.currentObjDesc) return [];
  return [
    ...wizState.currentObjDesc.attributes,
    ...wizState.currentObjDesc.forwardRefs,
    ...wizState.currentObjDesc.reverseRefs.map(r => ({ name: `← ${r.fromObject}.${r.attribute}`, _reverse: r, refType: r.fromObject })),
  ];
}

function countFavs(objName) {
  if (!wizState.explorerFavs || !wizState.currentObjDesc) return 0;
  return allFavCandidates().filter(a => wizState.explorerFavs.has(favKey(objName, a))).length;
}

function renderFavTab(container, objName) {
  const favItems = allFavCandidates().filter(a => wizState.explorerFavs.has(favKey(objName, a)));

  if (favItems.length === 0) {
    container.appendChild(el('div', { class: 'obj-empty' }, [
      el('div', { html: icon('star', 18) }),
      'Star fields or refs from the other tabs',
    ]));
    return;
  }

  favItems.forEach(a => {
    if (a._reverse) {
      renderRefRow(container, objName, a._reverse, true);
    } else if (a.refType) {
      renderForwardRefRow(container, objName, a, true);
    } else {
      renderAttrRow(container, objName, a, true);
    }
  });
}

// ── All tab (unified view: refs first, then fields — like original prototype) ──

function renderAllTab(container, objName) {
  const { attributes, forwardRefs, reverseRefs } = wizState.currentObjDesc;

  if (attributes.length === 0 && forwardRefs.length === 0 && reverseRefs.length === 0) {
    container.appendChild(el('div', { class: 'obj-empty' }, 'No attributes found on this object.'));
    return;
  }

  // Forward references first (navigable — clicking navigates deeper)
  if (forwardRefs.length > 0) {
    container.appendChild(groupHeader(`References → (${forwardRefs.length})`));
    forwardRefs.forEach(a => renderForwardRefRow(container, objName, a));
  }

  // Reverse references (incoming — .related() pattern)
  if (reverseRefs.length > 0) {
    container.appendChild(groupHeader(`Incoming ← (${reverseRefs.length})`));
    reverseRefs.forEach(r => renderRefRow(container, objName, r));
  }

  // Value attributes (leaf fields — clicking selects as expression endpoint)
  if (attributes.length > 0) {
    const mandatory = attributes.filter(a => a.mandatory);
    const optional = attributes.filter(a => !a.mandatory);

    if (mandatory.length > 0) {
      container.appendChild(groupHeader(`Fields — mandatory (${mandatory.length})`));
      mandatory.forEach(a => renderAttrRow(container, objName, a));
    }
    if (optional.length > 0) {
      container.appendChild(groupHeader(`Fields — optional (${optional.length})`));
      optional.forEach(a => renderAttrRow(container, objName, a));
    }
  }
}

function renderAttrRow(container, objName, attr, showStar = false) {
  const isSelected = wizState.source === buildPath(attr.name);
  const fk = `${objName}.${attr.name}`;
  const starred = wizState.explorerFavs.has(fk);

  container.appendChild(el('div', {
    class: `obj-row ${isSelected ? 'obj-row-sel' : ''}`,
    onclick: () => confirmPathChangeIfNeeded(() => { wizState.source = buildPath(attr.name); wizState._singleFilter = null; wizState._singleLeafField = attr.name; loadObjectExplorer(); refreshPipeline(); }),
  }, [
    el('span', { class: 'obj-row-name' }, attr.name),
    el('span', { class: 'obj-row-type' }, attr.type || 'string'),
    el('span', {
      class: `obj-star ${starred ? 'obj-star-on' : ''}`,
      onclick: (e) => { e.stopPropagation(); toggleFav(fk); loadObjectExplorer(); },
    }, starred ? '★' : '☆'),
  ]));
}

// ── References tab ──

function renderRefTab(container, objName) {
  const { forwardRefs, reverseRefs } = wizState.currentObjDesc;

  if (forwardRefs.length === 0 && reverseRefs.length === 0) {
    container.appendChild(el('div', { class: 'obj-empty' }, 'No references on this object.'));
    return;
  }

  if (forwardRefs.length > 0) {
    container.appendChild(groupHeader(`Outgoing → (${forwardRefs.length})`));
    forwardRefs.forEach(a => renderForwardRefRow(container, objName, a));
  }
  if (reverseRefs.length > 0) {
    container.appendChild(groupHeader(`Incoming ← (${reverseRefs.length})`));
    reverseRefs.forEach(r => renderRefRow(container, objName, r));
  }
}

function renderForwardRefRow(container, objName, attr, showStar = false) {
  const fk = `${objName}.${attr.name}`;
  const starred = wizState.explorerFavs.has(fk);
  const refPath = buildPath(attr.name);
  const isSelected = wizState.source === refPath;

  // Forward ref: clicking the row navigates INTO the object (dot-walk).
  // This matches the original prototype behavior.
  const navigate = () => confirmPathChangeIfNeeded(() => {
    wizState.objectPath.push({ name: attr.name, refType: attr.refType });
    wizState.source = '';
    wizState._singleFilter = null;
    wizState._singleLeafField = null;
    loadObjectExplorer();
    refreshPipeline();
  });

  // Select as source (collection) — secondary action via select button
  const selectAsSource = (e) => {
    e.stopPropagation();
    wizState.source = refPath;
    loadObjectExplorer();
    refreshPipeline();
  };

  container.appendChild(el('div', {
    class: `obj-row obj-row-ref ${isSelected ? 'obj-row-sel' : ''}`,
    onclick: navigate,
    style: { cursor: 'pointer' },
  }, [
    el('span', { class: 'obj-row-name' }, attr.name),
    el('span', { class: 'obj-row-target' }, `→ ${attr.refType}`),
    el('span', {
      class: 'obj-row-use', style: { fontSize: '9px', padding: '1px 5px', border: '1px solid var(--border)', borderRadius: '3px', color: 'var(--text-tertiary)', cursor: 'pointer', whiteSpace: 'nowrap' },
      onclick: selectAsSource,
      title: 'Use as collection source',
    }, 'use'),
    el('span', {
      class: `obj-star ${starred ? 'obj-star-on' : ''}`,
      onclick: (e) => { e.stopPropagation(); toggleFav(fk); loadObjectExplorer(); },
    }, starred ? '★' : '☆'),
  ]));
}

function renderRefRow(container, objName, rev, showStar = false) {
  const fk = `${objName}.←${rev.fromObject}.${rev.attribute}`;
  const starred = wizState.explorerFavs.has(fk);
  // Reverse ref: builds related('Type','field') expression
  // Always starts with the lowercased starting object name, matching Tacton conventions:
  //   solution.related('ConfiguredProduct','solution')
  //   solution.opportunity.account.related('Contact','account')
  const revSeg = { name: rev.attribute, reverse: true, fromObject: rev.fromObject };
  const tempPath = [...wizState.objectPath, revSeg];
  const startObj = getStartingObject();
  const root = startObj.charAt(0).toLowerCase() + startObj.slice(1);
  let revExpr = root;
  for (const seg of tempPath) {
    if (seg.reverse) {
      revExpr = `${revExpr}.related('${seg.fromObject}','${seg.name}')`;
    } else {
      revExpr = `${revExpr}.${seg.name}`;
    }
  }
  const isSelected = wizState.source === revExpr;

  // Click row: set as source (collection). Click arrow: navigate into source object.
  const selectAsSource = () => confirmPathChangeIfNeeded(() => { wizState.source = revExpr; wizState._singleFilter = null; wizState._singleLeafField = null; refreshPipeline(); loadObjectExplorer(); });
  const navigateInto = (e) => {
    e.stopPropagation();
    confirmPathChangeIfNeeded(() => {
      wizState.objectPath.push(revSeg);
      wizState.source = '';
      wizState._singleFilter = null;
      wizState._singleLeafField = null;
      loadObjectExplorer();
      refreshPipeline();
    });
  };

  container.appendChild(el('div', {
    class: `obj-row obj-row-rev ${isSelected ? 'obj-row-sel' : ''}`,
    onclick: selectAsSource,
    style: { cursor: 'pointer' },
    title: `related('${rev.fromObject}','${rev.attribute}')`,
  }, [
    el('span', { class: 'obj-row-rev-arrow' }, '←'),
    el('span', { class: 'obj-row-name' }, rev.fromObject),
    el('span', {
      class: 'obj-row-via',
      style: { fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--mono)' },
    }, `via .${rev.attribute}`),
    el('span', {
      class: 'obj-row-target', style: { cursor: 'pointer', fontSize: '10px' },
      onclick: navigateInto,
      title: `Navigate into ${rev.fromObject}`,
    }, '→'),
    el('span', {
      class: `obj-star ${starred ? 'obj-star-on' : ''}`,
      onclick: (e) => { e.stopPropagation(); toggleFav(fk); loadObjectExplorer(); },
    }, starred ? '★' : '☆'),
  ]));
}

// ── Explorer helpers ──

function groupHeader(text) {
  return el('div', { class: 'obj-group-head' }, text);
}

/**
 * Build a Tacton expression path from the current objectPath + leaf field.
 *
 * Real template expressions always start with the starting object name
 * (lowercased), matching how Tacton evaluates them in the document context:
 *   solution.opportunity.account.name
 *   solution.related('ConfiguredProduct','solution')
 *   solution.currency.isoCode
 *
 * Forward refs: dot-walk   → solution.opportunity.account.name
 * Reverse refs: related()  → solution.related('ConfiguredProduct','solution')
 * Mixed:                   → solution.opportunity.account.related('Contact','account')
 */
export function buildPath(leafField) {
  const startObj = getStartingObject();
  // Root expression segment: lowercased starting object name
  // e.g. 'Solution' → 'solution'
  const root = startObj.charAt(0).toLowerCase() + startObj.slice(1);
  let expr = root;

  for (const seg of wizState.objectPath) {
    if (seg.reverse) {
      // Reverse ref → .related('fromObject','attribute')
      expr = `${expr}.related('${seg.fromObject}','${seg.name}')`;
    } else {
      // Forward ref → simple dot-walk
      expr = `${expr}.${seg.name}`;
    }
  }

  // Append leaf field
  if (leafField) {
    expr = `${expr}.${leafField}`;
  }

  return expr;
}

/**
 * Build the full source expression (without leaf) for collection-level operations.
 */
function buildCollectionPath() {
  return buildPath(null);
}

async function toggleFav(key) {
  // Extract objectName and attrName for storage
  const dotIdx = key.indexOf('.');
  const objName = key.substring(0, dotIdx);
  const attrName = key.substring(dotIdx + 1);
  // Let data-api be the single source of truth (it toggles + persists)
  wizState.explorerFavs = await toggleExplorerFavorite(objName, attrName);
}
