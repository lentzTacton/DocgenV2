import { el } from '../../core/dom.js';
import { iconEl } from '../../components/icon.js';

export function createBuilderView(container) {
  function createPlaceholder(iconName, title, description) {
    return el('div', { class: 'zone-inner' }, [
      el('div', { style: { textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' } }, [
        iconEl(iconName, 48),
        el('div', { style: { fontSize: '16px', fontWeight: '700', marginTop: '16px', color: 'var(--text-secondary)' } }, title),
        el('div', { style: { fontSize: '13px', marginTop: '8px' } }, description),
      ]),
    ]);
  }

  const placeholder = createPlaceholder('edit', 'Builder', 'Formula sections will be available in a future update.');
  container.appendChild(placeholder);
}
