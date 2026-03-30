/**
 * Starting Object Card — Object Type Picker + Lock
 *
 * Only 4 officially supported starting points are shown by default:
 *   Solution, ConfiguredProduct, Proposal, Account
 *
 * An "Show all types" toggle reveals the full model with a warning
 * that unsupported types may not work correctly with DocGen.
 *
 * Features:
 *   - Inline scrollable list (matching ticket/instance cards)
 *   - Star favorites (persisted to Dexie)
 *   - Attribute count per row
 *   - Attribute preview panel on selection
 *   - Lock/unlock toggle in header
 */

import { el, qs, clear } from '../../core/dom.js';
import { iconEl, icon } from '../../components/icon.js';
import state from '../../core/state.js';
import events from '../../core/events.js';
import { getModel } from '../../services/api.js';
import { getInstance, loadFavorites, saveFavorites } from '../../core/storage.js';

/** Cached object model */
let cachedModel = null;

/** Star favorites for object types */
let objFavs = new Set();

/** Currently highlighted (but not yet locked) object type */
let highlightedType = null;

/** Whether the full (unsupported) object list is shown */
let showAllTypes = false;

/** The 4 officially supported starting points */
const SUPPORTED = new Set(['Solution', 'ConfiguredProduct', 'Proposal', 'ProposalMasterTemplate']);

/**
 * Create the starting object card.
 * @param {HTMLElement} container
 */
export function createStartingObjectCard(container) {
  // ── Object list ──
  const objectList = el('div', { class: 'ticket-list', id: 'so-list' }, [
    el('div', { class: 'empty-state' }, 'Select a ticket first'),
  ]);

  // ── List header row: label + "Show all types" toggle ──
  const showAllToggle = el('button', {
    class: 'ticket-auth-link',
    id: 'so-show-all-btn',
    style: { display: 'none' },
    onclick: handleToggleShowAll,
  }, 'Show all types…');

  const listHeader = el('div', { class: 'section-header-row', id: 'so-list-header' }, [
    el('span', { class: 'field-label', style: { margin: '0' } }, 'Supported types'),
    showAllToggle,
  ]);

  // ── Unsupported warning (hidden by default) ──
  const unsupportedWarning = el('div', {
    class: 'so-warning',
    id: 'so-unsupported-warning',
    style: { display: 'none' },
  });
  unsupportedWarning.innerHTML = `${icon('warning', 14)} <span>This starting object is not officially supported by DocGen. Templates may not generate correctly.</span>`;

  // ── Search (only shown with full list) ──
  const searchInput = el('input', {
    class: 'input ticket-search-input',
    id: 'so-search',
    type: 'text',
    placeholder: 'Search object types…',
    oninput: () => renderObjectList(cachedModel || [], searchInput.value),
  });

  const searchRow = el('div', {
    class: 'ticket-search-row',
    id: 'so-search-row',
    style: { display: 'none' },
  }, [
    el('span', { class: 'ticket-search-icon', html: icon('search', 14) }),
    searchInput,
  ]);

  // ── Attribute preview ──
  const attrPreview = el('div', {
    class: 'attr-preview',
    id: 'so-attrs',
    style: { display: 'none' },
  });

  const statusMsg = el('div', {
    class: 'status-message',
    id: 'so-status',
    style: { display: 'none' },
  });

  const card = el('div', { class: 'card', id: 'starting-object-card' }, [
    el('div', { class: 'card-header' }, [
      el('div', { class: 'card-header-left' }, [
        iconEl('target', 20),
        el('div', {}, [
          el('div', { class: 'card-title' }, 'Starting Object'),
          el('div', { class: 'card-subtitle' }, 'Choose the root object type for this document'),
        ]),
      ]),
    ]),
    el('div', { class: 'card-body' }, [
      listHeader,
      objectList,
      searchRow,
      unsupportedWarning,
      attrPreview,
      statusMsg,
      el('div', { class: 'card-actions', id: 'starting-object-actions' }),
    ]),
  ]);

  container.appendChild(card);

  // Listen for ticket selection → load model
  events.on('ticket:selected', handleTicketSelected);
  events.on('ticket:authorized', handleTicketAuthorized);

  // Load favorites
  loadFavorites('starting-objects').then(f => { objFavs = f; });
}

// ─── Handlers ───────────────────────────────────────────────────────────

async function handleTicketSelected({ ticketId, hasToken }) {
  if (hasToken) {
    await loadObjectModel(ticketId);
  } else {
    const listEl = qs('#so-list');
    clear(listEl);
    listEl.appendChild(el('div', { class: 'empty-state' }, 'Authorize ticket first'));
  }
}

async function handleTicketAuthorized({ ticketId }) {
  await loadObjectModel(ticketId);
}

async function loadObjectModel(ticketId) {
  const instanceId = state.get('connection.instanceId');
  const instance = await getInstance(instanceId);
  if (!instance) return;

  const listEl = qs('#so-list');
  clear(listEl);
  listEl.appendChild(el('div', { class: 'loading-state' }, 'Loading object model…'));

  const result = await getModel(instance, ticketId);

  if (!result.ok) {
    clear(listEl);
    listEl.appendChild(el('div', { class: 'error-state' }, `Failed: ${result.error}`));
    return;
  }

  cachedModel = result.objects;
  showAllTypes = false;

  // Reload favorites
  objFavs = await loadFavorites('starting-objects');

  renderObjectList(result.objects);

  // Show "Show all types" toggle if there are unsupported types
  const hasUnsupported = result.objects.some(o => !SUPPORTED.has(o.name));
  const toggleBtn = qs('#so-show-all-btn');
  if (toggleBtn) toggleBtn.style.display = hasUnsupported ? '' : 'none';

  // Restore selection if already set, or auto-select favorite
  const current = state.get('startingObject.type');
  const autoSelect = current
    || [...objFavs].find(name => result.objects.some(o => o.name === name));

  if (autoSelect) {
    highlightedType = autoSelect;
    if (!SUPPORTED.has(autoSelect)) showAllTypes = true;
    state.batch({
      'startingObject.type': autoSelect,
      'startingObject.name': autoSelect,
    });
    renderObjectList(result.objects);
    showAttributePreview(autoSelect);
    updateUnsupportedWarning(autoSelect);
    events.emit('startingObject:selected', { type: autoSelect });
  }
}

function handleToggleShowAll() {
  showAllTypes = !showAllTypes;

  const btn = qs('#so-show-all-btn');
  if (btn) btn.textContent = showAllTypes ? 'Show supported only' : 'Show all types…';

  // Update header label
  const headerLabel = qs('#so-list-header .field-label');
  if (headerLabel) headerLabel.textContent = showAllTypes ? 'All types' : 'Supported types';

  const searchRow = qs('#so-search-row');
  if (searchRow) searchRow.style.display = showAllTypes ? '' : 'none';

  // Clear search when toggling
  const searchInput = qs('#so-search');
  if (searchInput) searchInput.value = '';

  renderObjectList(cachedModel || []);
}

function renderObjectList(objects, filter) {
  const listEl = qs('#so-list');
  clear(listEl);

  if (!objects.length) {
    listEl.appendChild(el('div', { class: 'empty-state' }, 'No object types found'));
    return;
  }

  // Filter to supported types unless "Show all" is active
  let visible = showAllTypes
    ? objects
    : objects.filter(o => SUPPORTED.has(o.name));

  // Apply text filter
  const lowerFilter = (filter || '').toLowerCase();
  if (lowerFilter) {
    visible = visible.filter(o => o.name.toLowerCase().includes(lowerFilter));
  }

  if (!visible.length) {
    listEl.appendChild(el('div', { class: 'empty-state' },
      showAllTypes ? 'No matching types' : 'No supported types in this model'));
    return;
  }

  // Sort: favorites → supported priority → alphabetical
  const PRIORITY_ORDER = ['Solution', 'ConfiguredProduct', 'Proposal', 'ProposalMasterTemplate'];
  const sorted = [...visible].sort((a, b) => {
    const aFav = objFavs.has(a.name) ? 0 : 1;
    const bFav = objFavs.has(b.name) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;

    const aSup = SUPPORTED.has(a.name) ? 0 : 1;
    const bSup = SUPPORTED.has(b.name) ? 0 : 1;
    if (aSup !== bSup) return aSup - bSup;

    const aPri = PRIORITY_ORDER.indexOf(a.name);
    const bPri = PRIORITY_ORDER.indexOf(b.name);
    if (aPri >= 0 && bPri >= 0) return aPri - bPri;
    if (aPri >= 0) return -1;
    if (bPri >= 0) return 1;

    return a.name.localeCompare(b.name);
  });

  // Separator between supported and unsupported (only in "show all" mode)
  let separatorAdded = false;

  for (const obj of sorted) {
    const isSupported = SUPPORTED.has(obj.name);
    const isSelected = obj.name === highlightedType;

    // Add separator between supported and unsupported
    if (showAllTypes && !isSupported && !separatorAdded) {
      const sep = el('div', { class: 'so-separator' }, [
        el('span', { class: 'so-separator-label' }, 'Unsupported'),
      ]);
      listEl.appendChild(sep);
      separatorAdded = true;
    }

    const starBtn = el('button', {
      class: `ticket-star ${objFavs.has(obj.name) ? 'ticket-star-active' : ''}`,
      title: objFavs.has(obj.name) ? 'Remove from favorites' : 'Add to favorites',
      html: objFavs.has(obj.name) ? icon('starFilled', 14) : icon('star', 14),
      onclick: (e) => {
        e.stopPropagation();
        toggleObjFav(obj.name);
      },
    });

    const attrCount = obj.attributes ? obj.attributes.length : 0;

    const row = el('div', {
      class: `ticket-row ${isSelected ? 'ticket-row-selected' : ''}`,
      onclick: () => handleSelectObject(obj),
    }, [
      starBtn,
      el('div', { class: 'ticket-row-left' }, [
        el('span', { class: 'ticket-id' }, obj.name),
        el('span', { class: 'ticket-summary' }, `${attrCount} attributes`),
      ]),
      el('div', { class: 'ticket-row-right' }, [
        !isSupported
          ? el('span', { class: 'badge badge-warning-subtle' }, 'Unsupported')
          : null,
      ].filter(Boolean)),
    ]);

    listEl.appendChild(row);
  }
}

function handleSelectObject(obj) {
  highlightedType = obj.name;

  state.batch({
    'startingObject.type': obj.name,
    'startingObject.name': obj.name,
  });

  // Re-render list + preview
  const searchInput = qs('#so-search');
  renderObjectList(cachedModel || [], searchInput?.value || '');
  showAttributePreview(obj.name);
  updateUnsupportedWarning(obj.name);

  events.emit('startingObject:selected', { type: obj.name });
}

function updateUnsupportedWarning(typeName) {
  const warningEl = qs('#so-unsupported-warning');
  if (warningEl) {
    warningEl.style.display = !SUPPORTED.has(typeName) ? '' : 'none';
  }
}

async function toggleObjFav(name) {
  if (objFavs.has(name)) {
    objFavs.delete(name);
  } else {
    objFavs.add(name);
  }
  await saveFavorites('starting-objects', objFavs);

  // Favoriting also selects the object
  const obj = (cachedModel || []).find(o => o.name === name);
  if (obj && highlightedType !== name) {
    handleSelectObject(obj);
  } else {
    const searchInput = qs('#so-search');
    renderObjectList(cachedModel || [], searchInput?.value || '');
  }
}

function showAttributePreview(typeName) {
  if (!cachedModel) return;

  const obj = cachedModel.find(o => o.name === typeName);
  if (!obj) return;

  const previewEl = qs('#so-attrs');
  clear(previewEl);
  previewEl.style.display = '';

  // Show first 6 attributes as a compact preview
  const preview = obj.attributes.slice(0, 6);
  const remaining = obj.attributes.length - preview.length;

  for (const attr of preview) {
    const typeLabel = attr.refType ? `ref → ${attr.refType}` : attr.type;
    previewEl.appendChild(
      el('div', { class: 'attr-row' }, [
        el('span', { class: 'attr-name' }, attr.name),
        el('span', { class: 'attr-type' }, typeLabel),
      ])
    );
  }

  if (remaining > 0) {
    previewEl.appendChild(
      el('div', { class: 'attr-more' }, `+${remaining} more attributes`)
    );
  }
}

function showSOStatus(msg, type) {
  const statusEl = qs('#so-status');
  if (!msg) {
    if (statusEl) statusEl.style.display = 'none';
    return;
  }
  if (statusEl) {
    statusEl.style.display = '';
    statusEl.textContent = msg;
    statusEl.className = `status-message status-${type}`;
  }
}
