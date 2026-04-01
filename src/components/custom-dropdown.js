/**
 * Custom Dropdown & Combo Input — reusable form components that
 * replace native <select> elements for consistent styling.
 *
 * Extracted from variable-wizard.js.
 *
 * Exports:
 *   makeCustomDropdown(placeholder, options, opts)
 *   makeComboInput(initialValue, suggestions, opts)
 */

import { el } from '../core/dom.js';
import { icon } from './icon.js';

// ─── Custom Dropdown ────────────────────────────────────────────────────

/**
 * Create a styled dropdown (replaces native <select>).
 *
 * @param {string} placeholder — text shown when no value selected
 * @param {{ label: string, value: * }[]} options — dropdown items
 * @param {Object} [opts]
 * @param {string} [opts.flex='1']
 * @param {string} [opts.minWidth='0']
 * @param {boolean} [opts.mono=false] — use monospace font
 * @returns {HTMLElement} — wrap element with ._value and ._onChange
 */
export function makeCustomDropdown(placeholder, options, opts = {}) {
  const wrap = el('div', { class: 'cdd', style: { flex: opts.flex || '1', minWidth: opts.minWidth || '0', position: 'relative' } });
  wrap._value = '';

  const trigger = el('button', { class: 'cdd-trigger', type: 'button' }, [
    el('span', { class: `cdd-label${opts.mono ? ' cdd-mono' : ''}` }, placeholder),
    el('span', { class: 'cdd-arrow', html: icon('chevronDown', 10) }),
  ]);
  wrap.appendChild(trigger);

  const menu = el('div', { class: 'cdd-menu' });
  for (const opt of options) {
    const item = el('div', { class: 'cdd-item' }, [
      opts.mono ? el('span', { class: 'cdd-mono' }, opt.label) : opt.label,
    ]);
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      wrap._value = opt.value;
      trigger.querySelector('.cdd-label').textContent = opt.label;
      trigger.querySelector('.cdd-label').classList.add('cdd-selected');
      menu.classList.remove('cdd-open');
      trigger.classList.remove('cdd-active');
      if (wrap._onChange) wrap._onChange(opt.value);
    });
    menu.appendChild(item);
  }
  wrap.appendChild(menu);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close any other open dropdowns
    document.querySelectorAll('.cdd-menu.cdd-open').forEach(m => { if (m !== menu) { m.classList.remove('cdd-open'); m.previousElementSibling?.classList.remove('cdd-active'); } });
    menu.classList.toggle('cdd-open');
    trigger.classList.toggle('cdd-active');
  });

  // Close on outside click
  const closeHandler = (e) => { if (!wrap.contains(e.target)) { menu.classList.remove('cdd-open'); trigger.classList.remove('cdd-active'); } };
  document.addEventListener('click', closeHandler);

  return wrap;
}

// ─── Combo Input ────────────────────────────────────────────────────────

/**
 * Create a combo input: a text field with a dropdown of suggestions
 * that filters as you type (typeahead). Allows free-text entry too.
 *
 * @param {string} initialValue — current value
 * @param {string[]} suggestions — available values for the dropdown
 * @param {Object} [opts]
 * @param {string} [opts.placeholder]
 * @param {Function} [opts.onchange] — called with new value
 * @returns {HTMLElement}
 */
export function makeComboInput(initialValue, suggestions, opts = {}) {
  const wrap = el('div', { class: 'combo-input', style: { flex: '1', minWidth: '0', position: 'relative' } });

  const input = el('input', {
    class: 'input', value: initialValue,
    placeholder: opts.placeholder || '',
    style: { fontSize: '11px', width: '100%', fontFamily: 'var(--mono)', boxSizing: 'border-box', paddingRight: '22px' },
  });

  const arrow = el('span', {
    style: {
      position: 'absolute', right: '4px', top: '50%', transform: 'translateY(-50%)',
      cursor: 'pointer', display: 'flex', opacity: '0.5',
    },
    html: icon('chevronDown', 10),
  });

  const dropdown = el('div', {
    class: 'combo-dropdown',
    style: {
      display: 'none', position: 'absolute', top: '100%', left: '0', right: '0',
      maxHeight: '160px', overflowY: 'auto', background: '#fff', zIndex: '200',
      border: '1px solid var(--border)', borderRadius: '0 0 var(--radius) var(--radius)',
      boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    },
  });

  function renderOptions(filter) {
    dropdown.innerHTML = '';
    const query = (filter || '').toLowerCase();
    const filtered = query
      ? suggestions.filter(s => s.toLowerCase().includes(query))
      : suggestions;

    if (filtered.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    filtered.forEach(s => {
      const item = el('div', {
        style: {
          padding: '4px 8px', fontSize: '11px', fontFamily: 'var(--mono)',
          cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        },
      });
      // Highlight matching portion
      if (query && s.toLowerCase().includes(query)) {
        const idx = s.toLowerCase().indexOf(query);
        item.appendChild(document.createTextNode(s.slice(0, idx)));
        item.appendChild(el('strong', { style: { color: 'var(--accent)' } }, s.slice(idx, idx + query.length)));
        item.appendChild(document.createTextNode(s.slice(idx + query.length)));
      } else {
        item.textContent = s;
      }
      item.addEventListener('mousedown', (e) => {
        e.preventDefault(); // prevent blur before click fires
        input.value = s;
        dropdown.style.display = 'none';
        if (opts.onchange) opts.onchange(s);
      });
      item.addEventListener('mouseenter', () => { item.style.background = 'var(--bg, #F6F8FA)'; });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      dropdown.appendChild(item);
    });

    dropdown.style.display = filtered.length > 0 ? '' : 'none';
  }

  input.addEventListener('input', () => {
    renderOptions(input.value);
    if (opts.onchange) opts.onchange(input.value);
  });

  input.addEventListener('focus', () => { renderOptions(input.value); });
  input.addEventListener('blur', () => {
    // Delay to allow mousedown on dropdown items
    setTimeout(() => { dropdown.style.display = 'none'; }, 150);
  });

  arrow.addEventListener('mousedown', (e) => {
    e.preventDefault();
    if (dropdown.style.display === 'none') {
      input.focus();
      renderOptions(''); // show all
    } else {
      dropdown.style.display = 'none';
    }
  });

  wrap.appendChild(input);
  wrap.appendChild(arrow);
  wrap.appendChild(dropdown);
  return wrap;
}
