/**
 * List Dialogs — Force-delete confirmation dialogs, inline editing overlays,
 * and inline catalogue/section creation forms.
 *
 * Extracted from variable-list.js for maintainability.
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import {
  createCatalogue, updateCatalogue,
  createSection, updateSection,
} from '../../services/variables.js';
import { createTagPicker } from '../../components/tag-picker.js';
import { showInfoDialog } from '../../core/dialog.js';
import { SCOPE_CONFIG } from './list-state.js';

// ═════════════════════════════════════════════════════════════════════════
//  FORCE-DELETE DIALOGS
// ═════════════════════════════════════════════════════════════════════════

/**
 * Step 1: Show what's blocking the delete, with OK to dismiss
 * and a red "Force delete" button that opens the type-DELETE confirmation.
 */
export function showForceDeleteDialog(level, name, counts, details, onConfirm) {
  const existing = document.getElementById('val-dialog-overlay');
  if (existing) existing.remove();

  const overlay = el('div', {
    id: 'val-dialog-overlay',
    style: {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.35)',
      zIndex: '9999', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    onclick: (e) => { if (e.target === overlay) overlay.remove(); },
  });

  const title = `Cannot delete ${level}`;
  const reason = level === 'dataset'
    ? 'This item is referenced by other definitions. Remove those references first, or force delete.'
    : `Cannot delete a ${level} that still contains items. Remove or move them first, or force delete.`;

  const children = [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } }, [
      el('span', { class: 'icon', style: { color: 'var(--danger, #CF222E)' }, html: icon('info', 18) }),
      el('div', { style: { fontWeight: '700', fontSize: '13px' } }, title),
    ]),
    el('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: '1.5' } }, reason),
  ];

  if (details && details.length > 0) {
    const detailList = el('div', {
      style: {
        fontSize: '11px', color: 'var(--text-tertiary)', background: 'var(--bg)',
        border: '1px solid var(--border-light)', borderRadius: 'var(--radius)',
        padding: '8px 10px', marginBottom: '10px', maxHeight: '120px', overflowY: 'auto',
      },
    });
    details.forEach(d => {
      detailList.appendChild(el('div', { style: { marginBottom: '3px' } }, `• ${d}`));
    });
    children.push(detailList);
  }

  children.push(
    el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px' } }, [
      el('button', {
        class: 'btn btn-primary btn-sm',
        onclick: () => overlay.remove(),
      }, 'OK'),
      el('button', {
        class: 'btn btn-sm',
        style: { background: '#CF222E', color: '#fff', border: 'none', fontWeight: '600' },
        onclick: () => {
          overlay.remove();
          showForceDeleteConfirm(level, name, counts, details, onConfirm);
        },
      }, 'Force delete'),
    ])
  );

  overlay.appendChild(
    el('div', {
      style: {
        background: 'var(--card, #fff)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '16px 18px', maxWidth: '360px', width: '90%',
        boxShadow: '0 8px 24px rgba(0,0,0,.18)',
      },
    }, children)
  );

  document.body.appendChild(overlay);
}

/**
 * Step 2: Type DELETE to confirm — only shown after clicking "Force delete".
 */
function showForceDeleteConfirm(level, name, counts, details, onConfirm) {
  const existing = document.getElementById('force-del-overlay');
  if (existing) existing.remove();

  const overlay = el('div', {
    id: 'force-del-overlay',
    style: {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.45)',
      zIndex: '9999', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    onclick: (e) => { if (e.target === overlay) overlay.remove(); },
  });

  const summaryParts = [];
  if (counts.sections > 0) summaryParts.push(`${counts.sections} section${counts.sections !== 1 ? 's' : ''}`);
  if (counts.variables > 0) summaryParts.push(`${counts.variables} dataset${counts.variables !== 1 ? 's' : ''}`);
  const summaryText = summaryParts.length > 0
    ? `This will permanently delete ${summaryParts.join(' and ')} inside this ${level}.`
    : `This will permanently delete the ${level}.`;

  const deleteBtn = el('button', {
    class: 'btn btn-sm',
    disabled: true,
    style: {
      background: '#999', color: '#fff', border: 'none',
      fontWeight: '700', cursor: 'not-allowed', transition: 'background .15s',
    },
    onclick: () => { overlay.remove(); onConfirm(); },
  }, 'Force delete');

  const input = el('input', {
    type: 'text',
    placeholder: 'Type DELETE to confirm',
    autocomplete: 'off',
    spellcheck: 'false',
    style: {
      width: '100%', padding: '7px 10px', fontSize: '12px',
      border: '2px solid var(--border)', borderRadius: '4px',
      outline: 'none', boxSizing: 'border-box',
      fontFamily: 'monospace',
    },
    oninput: () => {
      const match = input.value.trim() === 'DELETE';
      deleteBtn.disabled = !match;
      deleteBtn.style.background = match ? '#CF222E' : '#999';
      deleteBtn.style.cursor = match ? 'pointer' : 'not-allowed';
      input.style.borderColor = match ? '#CF222E' : 'var(--border)';
    },
    onkeydown: (e) => {
      if (e.key === 'Enter' && input.value.trim() === 'DELETE') {
        overlay.remove();
        onConfirm();
      }
    },
  });

  const children = [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' } }, [
      el('span', { class: 'icon', style: { color: '#CF222E' }, html: icon('warning', 18) }),
      el('div', { style: { fontWeight: '700', fontSize: '14px', color: '#CF222E' } },
        `Force delete ${level}`),
    ]),
    el('div', {
      style: {
        fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px',
        padding: '6px 8px', background: 'var(--bg)', borderRadius: '4px',
        fontWeight: '600', wordBreak: 'break-all',
      },
    }, name),
    el('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '8px', lineHeight: '1.5' } },
      summaryText),
  ];

  if (details && details.length > 0) {
    const detailList = el('div', {
      style: {
        fontSize: '11px', color: '#CF222E', background: '#FFF5F5',
        border: '1px solid #FECACA', borderRadius: 'var(--radius)',
        padding: '8px 10px', marginBottom: '10px', maxHeight: '120px', overflowY: 'auto',
      },
    });
    details.forEach(d => {
      detailList.appendChild(el('div', { style: { marginBottom: '3px' } }, `• ${d}`));
    });
    children.push(detailList);
  }

  children.push(
    el('div', {
      style: { fontSize: '11px', color: '#CF222E', fontWeight: '600', marginBottom: '8px' },
    }, 'This action cannot be undone. All data will be permanently removed.')
  );

  children.push(
    el('div', { style: { marginBottom: '12px' } }, [
      el('div', { style: { fontSize: '11px', color: 'var(--text-tertiary)', marginBottom: '4px' } },
        'Type DELETE to confirm:'),
      input,
    ])
  );

  children.push(
    el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px' } }, [
      el('button', {
        class: 'btn btn-outline btn-sm',
        onclick: () => overlay.remove(),
      }, 'Cancel'),
      deleteBtn,
    ])
  );

  overlay.appendChild(
    el('div', {
      style: {
        background: 'var(--card, #fff)', border: '1px solid #FECACA',
        borderRadius: '8px', padding: '16px 18px', maxWidth: '380px', width: '90%',
        boxShadow: '0 8px 24px rgba(0,0,0,.22)',
      },
    }, children)
  );

  document.body.appendChild(overlay);
  setTimeout(() => input.focus(), 50);
}

// ═════════════════════════════════════════════════════════════════════════
//  INLINE EDITING OVERLAY
// ═════════════════════════════════════════════════════════════════════════

/**
 * Show a small inline edit dialog overlay for renaming, editing tags, etc.
 * @param {number} id - catalogue or section ID
 * @param {string} field - 'name', 'tags', or 'description'
 * @param {string} currentValue - current value as string
 * @param {string} type - 'catalogue' (default) or 'section'
 */
export function startInlineEdit(id, field, currentValue, type = 'catalogue') {
  const existing = document.getElementById('inline-edit-overlay');
  if (existing) existing.remove();

  const labels = { name: 'Name', tags: 'Tags', description: 'Description' };
  const isTagField = field === 'tags';

  const overlay = el('div', {
    id: 'inline-edit-overlay',
    style: {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.35)',
      zIndex: '9999', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    onclick: (e) => { if (e.target === overlay) overlay.remove(); },
  });

  if (isTagField) {
    const tags = currentValue ? currentValue.split(',').map(t => t.trim()).filter(Boolean) : [];
    const chipWrap = el('div', { class: 'tag-chip-wrap' });
    const tagInput = el('input', {
      type: 'text',
      class: 'tag-chip-input',
      placeholder: tags.length ? 'Add tag\u2026' : 'Type a tag and press Space or Enter\u2026',
    });

    function renderChips() {
      clear(chipWrap);
      for (const t of tags) {
        chipWrap.appendChild(el('span', { class: 'tag-chip-item' }, [
          el('span', {}, t),
          el('button', {
            class: 'tag-chip-remove',
            onclick: () => { tags.splice(tags.indexOf(t), 1); renderChips(); tagInput.focus(); },
            html: icon('x', 8),
          }),
        ]));
      }
      chipWrap.appendChild(tagInput);
    }

    function commitTag() {
      const val = tagInput.value.trim().replace(/,/g, '');
      if (val && !tags.includes(val)) {
        tags.push(val);
        tagInput.value = '';
        renderChips();
      }
      tagInput.value = '';
    }

    tagInput.addEventListener('keydown', (e) => {
      if ((e.key === ' ' || e.key === 'Enter' || e.key === ',') && tagInput.value.trim()) {
        e.preventDefault();
        commitTag();
      }
      if (e.key === 'Backspace' && !tagInput.value && tags.length > 0) {
        tags.pop();
        renderChips();
        tagInput.focus();
      }
      if (e.key === 'Escape') overlay.remove();
    });

    tagInput.addEventListener('blur', () => { if (tagInput.value.trim()) commitTag(); });

    renderChips();

    function saveTagField() {
      if (tagInput.value.trim()) commitTag();
      overlay.remove();
      const fn = type === 'section' ? updateSection : updateCatalogue;
      fn(id, { tags: [...tags] }).catch(e => { console.error('Edit tags failed:', e); showInfoDialog('Save failed', e.message || 'Could not save tags.', []); });
    }

    overlay.appendChild(
      el('div', {
        style: {
          background: 'var(--card, #fff)', border: '1px solid var(--border)',
          borderRadius: '8px', padding: '16px 18px', maxWidth: '380px', width: '90%',
          boxShadow: '0 8px 24px rgba(0,0,0,.18)',
        },
      }, [
        el('div', { style: { fontWeight: '700', fontSize: '13px', marginBottom: '10px' } }, 'Edit Tags'),
        el('div', { class: 'tag-chip-container', onclick: () => tagInput.focus() }, [chipWrap]),
        el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)', margin: '4px 0 10px' } },
          'Press Space or Enter to add a tag. Backspace to remove last.'),
        el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px' } }, [
          el('button', { class: 'btn btn-outline btn-sm', onclick: () => overlay.remove() }, 'Cancel'),
          el('button', { class: 'btn btn-primary btn-sm', onclick: saveTagField }, 'Save'),
        ]),
      ])
    );

    document.body.appendChild(overlay);
    requestAnimationFrame(() => tagInput.focus());
    return;
  }

  // Simple text input mode (name, description)
  const input = el('input', {
    type: 'text',
    class: 'data-search-input',
    value: currentValue,
    style: { width: '100%', marginBottom: '10px' },
    placeholder: labels[field] || field,
  });

  function save() {
    const val = input.value.trim();
    overlay.remove();
    if (!val) return;
    const fn = type === 'section' ? updateSection : updateCatalogue;
    fn(id, { [field]: val }).catch(e => { console.error(`Edit ${field} failed:`, e); showInfoDialog('Save failed', e.message || `Could not save ${field}.`, []); });
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save();
    if (e.key === 'Escape') overlay.remove();
  });

  overlay.appendChild(
    el('div', {
      style: {
        background: 'var(--card, #fff)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '16px 18px', maxWidth: '340px', width: '90%',
        boxShadow: '0 8px 24px rgba(0,0,0,.18)',
      },
    }, [
      el('div', { style: { fontWeight: '700', fontSize: '13px', marginBottom: '10px' } },
        `Edit ${labels[field] || field}`),
      input,
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px' } }, [
        el('button', { class: 'btn btn-outline btn-sm', onclick: () => overlay.remove() }, 'Cancel'),
        el('button', { class: 'btn btn-primary btn-sm', onclick: save }, 'Save'),
      ]),
    ])
  );

  document.body.appendChild(overlay);
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

// ═════════════════════════════════════════════════════════════════════════
//  INLINE CREATION FORMS
// ═════════════════════════════════════════════════════════════════════════

export function showNewCatalogueInline(container) {
  const existing = qs('#cat-inline-form');
  if (existing) existing.remove();

  const emptyState = container.querySelector('.data-empty');
  if (emptyState) emptyState.style.display = 'none';

  const form = el('div', { class: 'cat-inline-form', id: 'cat-inline-form' });

  const obs = new MutationObserver(() => {
    if (!form.parentNode) {
      obs.disconnect();
      if (emptyState && emptyState.parentNode) emptyState.style.display = '';
    }
  });
  obs.observe(container, { childList: true });

  const nameInput = el('input', {
    class: 'input', placeholder: 'Catalogue name',
    style: { fontSize: '12px', fontWeight: '600' },
  });
  const descInput = el('input', {
    class: 'input', placeholder: 'Description (optional)',
    style: { fontSize: '11px' },
  });

  const tagPicker = createTagPicker({ placeholder: 'Add tags...' });

  let selectedScope = 'ticket';
  let scopeCollapsed = true;

  const scopeSel = el('div', { class: 'scope-sel' });
  Object.entries(SCOPE_CONFIG).forEach(([key, sc]) => {
    const opt = el('div', {
      class: `scope-opt ${key === selectedScope ? 'scope-opt-sel' : ''}`,
      onclick: () => {
        selectedScope = key;
        scopeSel.querySelectorAll('.scope-opt').forEach(o => o.classList.remove('scope-opt-sel'));
        opt.classList.add('scope-opt-sel');
      },
    }, [
      el('span', { class: 'icon', style: { color: sc.color }, html: icon(sc.icon, 14) }),
      el('span', {}, sc.label),
    ]);
    scopeSel.appendChild(opt);
  });

  const scopeBody = el('div', { style: { display: 'none' } }, [scopeSel]);

  const scopeChevron = el('span', {
    class: 'icon',
    html: icon('chevronRight', 10),
    style: { transition: 'transform 0.15s', display: 'inline-flex' },
  });

  const scopeHeader = el('div', {
    class: 'field-label cat-form-section-toggle',
    style: { marginTop: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', userSelect: 'none' },
    onclick: () => {
      scopeCollapsed = !scopeCollapsed;
      scopeBody.style.display = scopeCollapsed ? 'none' : '';
      scopeChevron.innerHTML = icon(scopeCollapsed ? 'chevronRight' : 'chevronDown', 10);
    },
  }, [scopeChevron, 'Scope']);

  const actions = el('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } }, [
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: async () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        await createCatalogue({
          name,
          description: descInput.value.trim(),
          scope: selectedScope,
          tags: tagPicker.getTags(),
        });
        form.remove();
      },
    }, [el('span', { class: 'icon', html: icon('check', 12) }), 'Create']),
    el('button', {
      class: 'btn btn-outline btn-sm',
      onclick: () => form.remove(),
    }, 'Cancel'),
  ]);

  form.appendChild(el('div', { class: 'field-label' }, 'New Data Catalogue'));
  form.appendChild(nameInput);
  form.appendChild(descInput);
  form.appendChild(tagPicker.element);
  form.appendChild(scopeHeader);
  form.appendChild(scopeBody);
  form.appendChild(actions);

  const header = container.querySelector('.data-section-head');
  if (header && header.nextSibling) {
    container.insertBefore(form, header.nextSibling);
  } else {
    container.appendChild(form);
  }
  nameInput.focus();
}

export function showNewSectionInline(body, catalogueId) {
  const existing = body.querySelector('.sec-inline-form');
  if (existing) existing.remove();

  const form = el('div', { class: 'sec-inline-form' });

  const nameInput = el('input', {
    class: 'input', placeholder: 'Section name',
    style: { fontSize: '12px', fontWeight: '600' },
  });
  const descInput = el('input', {
    class: 'input', placeholder: 'Description (optional)',
    style: { fontSize: '11px' },
  });

  const tagPicker = createTagPicker({ placeholder: 'Add tags...' });

  const actions = el('div', { style: { display: 'flex', gap: '6px', justifyContent: 'flex-end' } }, [
    el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: async () => {
        const name = nameInput.value.trim();
        if (!name) { nameInput.focus(); return; }
        await createSection({
          catalogueId,
          name,
          description: descInput.value.trim(),
          tags: tagPicker.getTags(),
        });
        form.remove();
      },
    }, [el('span', { class: 'icon', html: icon('check', 12) }), 'Add']),
    el('button', {
      class: 'btn btn-outline btn-sm',
      onclick: () => form.remove(),
    }, 'Cancel'),
  ]);

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') actions.querySelector('.btn-primary').click();
    if (e.key === 'Escape') form.remove();
  });

  form.appendChild(nameInput);
  form.appendChild(descInput);
  form.appendChild(tagPicker.element);
  form.appendChild(actions);

  const footer = body.querySelector('.cat-footer-actions');
  if (footer) body.insertBefore(form, footer);
  else body.appendChild(form);
  nameInput.focus();
}
