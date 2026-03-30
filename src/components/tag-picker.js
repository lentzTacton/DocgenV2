/**
 * Tag Picker — Reusable tag input with autocomplete.
 *
 * Features:
 *   - Chip display with remove buttons
 *   - Autocomplete dropdown from existing tags across catalogues, sections, variables
 *   - Create new tag inline
 *   - Keyboard support: Enter to add, Backspace to remove last, Escape to close
 *
 * Usage:
 *   const picker = createTagPicker({ initialTags: ['foo'], placeholder: 'Add tags...' });
 *   container.appendChild(picker.element);
 *   const tags = picker.getTags();  // ['foo', 'bar']
 */

import { el } from '../core/dom.js';
import { icon } from '../components/icon.js';
import state from '../core/state.js';

/**
 * Create a tag picker instance.
 *
 * @param {Object} [options]
 * @param {string[]} [options.initialTags=[]] - Starting tags
 * @param {string} [options.placeholder='Add tags...'] - Input placeholder
 * @returns {{ element: HTMLElement, getTags: () => string[], setTags: (tags: string[]) => void }}
 */
export function createTagPicker(options = {}) {
  let tags = [...(options.initialTags || [])];
  const placeholder = options.placeholder || 'Add tags...';

  const wrap = el('div', { class: 'tag-picker', style: { marginTop: '4px' } });
  const chipsWrap = el('div', { class: 'tag-chips' });
  const input = el('input', {
    class: 'tag-input-inline',
    placeholder: tags.length === 0 ? placeholder : '',
    oninput: () => refreshDropdown(),
    onfocus: () => refreshDropdown(),
    onblur: () => setTimeout(() => closeDropdown(), 150),
    onkeydown: (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        e.preventDefault();
        addTag(input.value.trim());
      } else if (e.key === 'Backspace' && !input.value && tags.length > 0) {
        removeTag(tags[tags.length - 1]);
      } else if (e.key === 'Escape') {
        closeDropdown();
        input.blur();
      }
    },
  });

  let dropdown = null;

  function collectExistingTags() {
    const cats = state.get('catalogues') || [];
    const secs = state.get('sections') || [];
    const vars = state.get('variables') || [];
    const allTags = new Set();
    for (const c of cats) (c.tags || []).forEach(t => allTags.add(t));
    for (const s of secs) (s.tags || []).forEach(t => allTags.add(t));
    for (const v of vars) (v.tags || []).forEach(t => allTags.add(t));
    return [...allTags].sort();
  }

  function addTag(tag) {
    if (!tags.includes(tag)) tags.push(tag);
    input.value = '';
    input.placeholder = '';
    renderChips();
    closeDropdown();
  }

  function removeTag(tag) {
    tags = tags.filter(t => t !== tag);
    if (tags.length === 0) input.placeholder = placeholder;
    renderChips();
  }

  function renderChips() {
    chipsWrap.querySelectorAll('.tag-chip').forEach(c => c.remove());
    tags.forEach(tag => {
      const chip = el('span', { class: 'tag-chip' }, [
        tag,
        el('span', { class: 'tag-chip-x', onclick: (e) => { e.stopPropagation(); removeTag(tag); } }, '\u00d7'),
      ]);
      chipsWrap.insertBefore(chip, input);
    });
  }

  function refreshDropdown() {
    closeDropdown();
    const query = input.value.trim().toLowerCase();
    const allTags = collectExistingTags();
    const currentTags = new Set(tags);
    const available = allTags.filter(t => !currentTags.has(t) && (!query || t.toLowerCase().includes(query)));

    dropdown = el('div', { class: 'tag-dropdown' });

    if (available.length === 0 && !query) {
      dropdown.appendChild(el('div', { class: 'tag-dropdown-empty' }, 'Type to create a new tag'));
    } else {
      available.forEach(tag => {
        dropdown.appendChild(el('div', {
          class: 'tag-dropdown-item',
          onmousedown: (e) => { e.preventDefault(); addTag(tag); },
        }, [
          el('span', { class: 'icon', html: icon('tag', 10) }),
          tag,
        ]));
      });
    }

    if (query && !allTags.some(t => t.toLowerCase() === query) && !currentTags.has(query)) {
      dropdown.appendChild(el('div', {
        class: 'tag-dropdown-item tag-dd-create',
        onmousedown: (e) => { e.preventDefault(); addTag(input.value.trim()); },
      }, [
        el('span', { class: 'icon', html: icon('plus', 10) }),
        `Create "${input.value.trim()}"`,
      ]));
    }

    if (dropdown.children.length > 0) wrap.appendChild(dropdown);
  }

  function closeDropdown() {
    if (dropdown && dropdown.parentNode) dropdown.remove();
    dropdown = null;
  }

  renderChips();
  chipsWrap.appendChild(input);
  chipsWrap.addEventListener('click', () => input.focus());
  wrap.appendChild(chipsWrap);

  return {
    element: wrap,
    getTags: () => [...tags],
    setTags: (newTags) => {
      tags = [...newTags];
      if (tags.length === 0) input.placeholder = placeholder;
      else input.placeholder = '';
      renderChips();
    },
  };
}
