/**
 * List Menus — Context menus for catalogues, sections, and move-to actions.
 *
 * Extracted from variable-list.js for maintainability.
 */

import { el } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import {
  updateVariable, removeCatalogue, removeSection,
  canDeleteCatalogue, canDeleteSection,
  forceRemoveCatalogue, forceRemoveSection,
  countCascadeItems,
} from '../../services/variables.js';
import { exportCatalogue, downloadJson } from '../../services/catalogue-io.js';
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
