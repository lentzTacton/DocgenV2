/**
 * List Menus — Context menus for catalogues, sections, and move-to actions.
 *
 * Extracted from variable-list.js for maintainability.
 */

import { el } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import {
  updateVariable, updateCatalogue, removeCatalogue, removeSection,
  canDeleteCatalogue, canDeleteSection,
  forceRemoveCatalogue, forceRemoveSection,
  countCascadeItems,
} from '../../services/variables.js';
import { exportCatalogue, downloadJson } from '../../services/catalogue-io.js';
import { getAllDocuments } from '../../services/document-identity.js';
import { SCOPE_CONFIG } from './list-state.js';
import { wizState } from './wizard-state.js';
import { showConfirmDialog, showInfoDialog } from '../../core/dialog.js';
import { startInlineEdit, showForceDeleteDialog } from './list-dialogs.js';

// ─── Shared helpers ─────────────────────────────────────────────────────

export function menuItem(ic, label, onclick, danger = false) {
  return el('div', {
    class: `ctx-menu-item ${danger ? 'ctx-menu-danger' : ''}`,
    onclick: (e) => { e.stopPropagation(); onclick(); },
  }, [el('span', { class: 'icon', html: icon(ic, 12) }), label]);
}

export function positionMenu(menu, anchor) {
  const rect = anchor.getBoundingClientRect();
  menu.style.top = `${rect.bottom + 4}px`;
  menu.style.right = `${document.documentElement.clientWidth - rect.right}px`;
  menu.style.left = 'auto';
}

export function dismissMenus() {
  const m = document.getElementById('ctx-menu');
  if (m) m.remove();
}

// ─── Scope picker (shared by menu & create form) ───────────────────────

/**
 * Build a scope ref picker dropdown for a given scope type.
 * Returns { element, getValue } or null if scope has no ref.
 */
export function buildScopeRefPicker(scopeKey, currentRef, { truncate = 20 } = {}) {
  if (scopeKey === 'shared') return null;

  const select = el('select', {
    class: 'input scope-ref-select',
    style: { fontSize: '11px', marginTop: '4px', width: '100%' },
  });

  if (scopeKey === 'document') {
    select.appendChild(el('option', { value: '' }, '— current document —'));
    // Populate async
    getAllDocuments().then(docs => {
      for (const d of docs) {
        const opt = el('option', {
          value: d.documentId,
          selected: d.documentId === currentRef ? 'selected' : undefined,
        }, d.name || `Doc ${d.documentId}`);
        select.appendChild(opt);
      }
      // If currentRef set but not in list yet, keep selected
      if (currentRef && !select.value) select.value = currentRef;
    });
  } else if (scopeKey === 'ticket') {
    select.appendChild(el('option', { value: '' }, '— any ticket —'));
    const tickets = state.get('tickets.list') || [];
    const selectedTicket = state.get('tickets.selected');
    for (const t of tickets) {
      select.appendChild(el('option', {
        value: t.id,
        selected: (currentRef ? t.id === currentRef : t.id === selectedTicket) ? 'selected' : undefined,
      }, `${t.id}${t.summary ? ' — ' + (t.summary.length > truncate ? t.summary.slice(0, truncate) + '…' : t.summary) : ''}`));
    }
  } else if (scopeKey === 'instance') {
    select.appendChild(el('option', { value: '' }, '— current instance —'));
    const connUrl = state.get('connection.url');
    const connId = state.get('connection.instanceId');
    if (connId) {
      select.appendChild(el('option', {
        value: connId,
        selected: (currentRef === connId || !currentRef) ? 'selected' : undefined,
      }, connUrl || `Instance ${connId}`));
    }
  }

  return {
    element: select,
    getValue: () => select.value || null,
  };
}

/**
 * Build scope submenu for catalogue context menu.
 * Inline expandable: shows scope options + ref picker.
 */
function buildScopeSubmenu(catalogue) {
  const currentScope = catalogue.scope || 'ticket';
  const currentRef = catalogue.scopeRef || null;
  const sc = SCOPE_CONFIG[currentScope];

  const wrap = el('div', { class: 'ctx-scope-submenu' });

  // Trigger row
  const triggerRow = el('div', {
    class: 'ctx-menu-item',
    onclick: (e) => {
      e.stopPropagation();
      const isOpen = body.style.display !== 'none';
      body.style.display = isOpen ? 'none' : 'block';
      chevron.innerHTML = icon(isOpen ? 'chevronRight' : 'chevronDown', 10);
    },
  }, [
    el('span', { class: 'icon', html: icon('globe', 12) }),
    'Scope',
    el('span', {
      style: { marginLeft: 'auto', fontSize: '10px', color: sc.color, fontWeight: '600' },
    }, sc.label),
    (() => { const s = el('span', { class: 'icon', style: { marginLeft: '4px' }, html: icon('chevronRight', 10) }); return s; })(),
  ]);
  const chevron = triggerRow.lastChild;

  // Expandable body
  const body = el('div', { style: { display: 'none', padding: '4px 8px 6px' } });

  let selectedScope = currentScope;
  let refPicker = buildScopeRefPicker(currentScope, currentRef);

  const scopeRow = el('div', { class: 'scope-sel', style: { marginBottom: '6px' } });
  Object.entries(SCOPE_CONFIG).forEach(([key, conf]) => {
    const opt = el('div', {
      class: `scope-opt ${key === selectedScope ? 'scope-opt-sel' : ''}`,
      onclick: (e) => {
        e.stopPropagation();
        selectedScope = key;
        scopeRow.querySelectorAll('.scope-opt').forEach(o => o.classList.remove('scope-opt-sel'));
        opt.classList.add('scope-opt-sel');
        // Rebuild ref picker
        if (refContainer) refContainer.innerHTML = '';
        refPicker = buildScopeRefPicker(key, key === currentScope ? currentRef : null);
        if (refPicker && refContainer) refContainer.appendChild(refPicker.element);
      },
    }, [
      el('span', { class: 'icon', style: { color: conf.color }, html: icon(conf.icon, 12) }),
      el('span', {}, conf.label),
    ]);
    scopeRow.appendChild(opt);
  });
  body.appendChild(scopeRow);

  // Ref picker container
  const refContainer = el('div', { class: 'scope-ref-container' });
  if (refPicker) refContainer.appendChild(refPicker.element);
  body.appendChild(refContainer);

  // Apply button
  body.appendChild(el('button', {
    class: 'btn btn-primary btn-xs',
    style: { marginTop: '6px', width: '100%' },
    onclick: async (e) => {
      e.stopPropagation();
      const updates = { scope: selectedScope, scopeRef: refPicker ? refPicker.getValue() : null };
      // Auto-bind document scope to active doc if none selected
      if (selectedScope === 'document' && !updates.scopeRef) {
        const activeDocId = state.get('document.id');
        if (activeDocId) updates.scopeRef = activeDocId;
      }
      await updateCatalogue(catalogue.id, updates);
      dismissMenus();
    },
  }, 'Apply'));

  wrap.appendChild(triggerRow);
  wrap.appendChild(body);
  return wrap;
}

// ─── Catalogue context menu ─────────────────────────────────────────────

export function showCatalogueMenu(catalogue, anchor) {
  dismissMenus();
  const menu = el('div', { class: 'ctx-menu', id: 'ctx-menu' });
  const isReadonly = !!catalogue.readonly;

  if (!isReadonly) {
    menu.appendChild(menuItem('plus', 'New dataset', () => {
      dismissMenus();
      wizState.catalogueId = catalogue.id;
      state.set('dataView', 'new');
    }));
    menu.appendChild(el('div', { class: 'ctx-menu-sep' }));
    menu.appendChild(menuItem('edit', 'Rename', () => {
      dismissMenus();
      startInlineEdit(catalogue.id, 'name', catalogue.name);
    }));
  }
  menu.appendChild(menuItem('tag', 'Edit tags', () => {
    dismissMenus();
    startInlineEdit(catalogue.id, 'tags', (catalogue.tags || []).join(', '));
  }));
  if (!isReadonly) {
    menu.appendChild(el('div', { class: 'ctx-menu-sep' }));
    menu.appendChild(buildScopeSubmenu(catalogue));
    menu.appendChild(el('div', { class: 'ctx-menu-sep' }));
    menu.appendChild(menuItem('arrowDown', 'Export as JSON', () => {
      dismissMenus();
      try {
        const data = exportCatalogue(catalogue.id);
        const filename = `${catalogue.name.replace(/\s+/g, '-').toLowerCase()}-catalogue.json`;
        downloadJson(data, filename);
      } catch (e) { showInfoDialog('Export failed', e.message, []); }
    }));
    menu.appendChild(el('div', { class: 'ctx-menu-sep' }));
    menu.appendChild(menuItem('trash', 'Delete catalogue', () => {
      dismissMenus();
      const check = canDeleteCatalogue(catalogue.id);
      if (!check.ok) {
        const counts = countCascadeItems('catalogue', catalogue.id);
        showForceDeleteDialog(
          'catalogue', catalogue.name, counts,
          check.details,
          () => forceRemoveCatalogue(catalogue.id),
        );
        return;
      }
      showConfirmDialog(`Delete catalogue "${catalogue.name}"?`, 'This cannot be undone.', () => {
        removeCatalogue(catalogue.id).catch(e => { console.error('Delete failed:', e); showInfoDialog('Delete failed', e.message || 'Could not delete catalogue.', []); });
      });
    }, true));
  }

  positionMenu(menu, anchor);
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', dismissMenus, { once: true }), 10);
}

// ─── Section context menu ───────────────────────────────────────────────

export function showSectionMenu(section, catalogue, anchor) {
  dismissMenus();
  const menu = el('div', { class: 'ctx-menu', id: 'ctx-menu' });
  const isLocked = !!section.locked;

  if (!isLocked && !catalogue.readonly) {
    menu.appendChild(menuItem('plus', 'New dataset', () => {
      dismissMenus();
      wizState.catalogueId = catalogue.id;
      wizState.sectionId = section.id;
      state.set('dataView', 'new');
    }));
    menu.appendChild(el('div', { class: 'ctx-menu-sep' }));
  }

  menu.appendChild(menuItem(
    isLocked ? 'unlock' : 'lock',
    isLocked ? 'Unlock section' : 'Lock section',
    async () => {
      dismissMenus();
      const { updateSection } = await import('../../services/variables.js');
      if (isLocked) {
        await updateSection(section.id, { locked: false });
      } else {
        showConfirmDialog(
          `Lock section "${section.name}"?`,
          'Data sets inside a locked section cannot be edited or deleted until the section is unlocked.',
          async () => { await updateSection(section.id, { locked: true }); },
          { confirmLabel: 'Lock' }
        );
      }
    }
  ));

  if (!isLocked) {
    menu.appendChild(el('div', { class: 'ctx-menu-sep' }));
    menu.appendChild(menuItem('edit', 'Rename', () => {
      dismissMenus();
      startInlineEdit(section.id, 'name', section.name, 'section');
    }));
    menu.appendChild(menuItem('edit', 'Edit description', () => {
      dismissMenus();
      startInlineEdit(section.id, 'description', section.description || '', 'section');
    }));
    menu.appendChild(menuItem('tag', 'Edit tags', () => {
      dismissMenus();
      startInlineEdit(section.id, 'tags', (section.tags || []).join(', '), 'section');
    }));
    menu.appendChild(el('div', { class: 'ctx-menu-sep' }));
    menu.appendChild(menuItem('trash', 'Delete section', () => {
      dismissMenus();
      const check = canDeleteSection(section.id);
      if (!check.ok) {
        const counts = countCascadeItems('section', section.id);
        showForceDeleteDialog(
          'section', section.name, counts,
          check.details,
          () => forceRemoveSection(section.id),
        );
        return;
      }
      showConfirmDialog(`Delete section "${section.name}"?`, 'This cannot be undone.', () => {
        removeSection(section.id).catch(e => { console.error('Delete failed:', e); showInfoDialog('Delete failed', e.message || 'Could not delete section.', []); });
      });
    }, true));
  }

  positionMenu(menu, anchor);
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', dismissMenus, { once: true }), 10);
}

// ─── Move-to-catalogue menu ─────────────────────────────────────────────

export function showMoveMenu(variable, anchor) {
  dismissMenus();
  const catalogues = (state.get('catalogues') || []).filter(c => !c.readonly);
  const sections = state.get('sections') || [];

  if (catalogues.length === 0) {
    alert('Create a data catalogue first to move datasets into it.');
    return;
  }

  const menu = el('div', { class: 'ctx-menu', id: 'ctx-menu' });

  menu.appendChild(menuItem('list', 'Unassigned', async () => {
    dismissMenus();
    await updateVariable(variable.id, { catalogueId: null, sectionId: null });
  }));

  menu.appendChild(el('div', { class: 'ctx-menu-sep' }));

  for (const cat of catalogues) {
    const catSections = sections.filter(s => s.catalogueId === cat.id);

    const isCurrent = variable.catalogueId === cat.id && !variable.sectionId;
    menu.appendChild(el('div', {
      class: `ctx-menu-item ${isCurrent ? 'ctx-menu-item-active' : ''}`,
      onclick: async (e) => {
        e.stopPropagation();
        dismissMenus();
        await updateVariable(variable.id, { catalogueId: cat.id, sectionId: null });
      },
    }, [
      el('span', { class: 'icon', html: icon('folder', 12) }),
      el('span', { style: { fontWeight: '600' } }, cat.name),
      isCurrent ? el('span', { class: 'icon', style: { marginLeft: 'auto', color: 'var(--success)' }, html: icon('check', 12) }) : null,
    ]));

    for (const sec of catSections) {
      const isSecCurrent = variable.catalogueId === cat.id && variable.sectionId === sec.id;
      menu.appendChild(el('div', {
        class: `ctx-menu-item ${isSecCurrent ? 'ctx-menu-item-active' : ''}`,
        style: { paddingLeft: '28px' },
        onclick: async (e) => {
          e.stopPropagation();
          dismissMenus();
          await updateVariable(variable.id, { catalogueId: cat.id, sectionId: sec.id });
        },
      }, [
        el('span', { class: 'icon', html: icon('chevronRight', 10) }),
        sec.name,
        isSecCurrent ? el('span', { class: 'icon', style: { marginLeft: 'auto', color: 'var(--success)' }, html: icon('check', 12) }) : null,
      ]));
    }
  }

  positionMenu(menu, anchor);
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', dismissMenus, { once: true }), 10);
}
