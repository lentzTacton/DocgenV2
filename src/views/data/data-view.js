import { el } from '../../core/dom.js';

export function createDataView(container) {
  const callout = el('div', { class: 'callout callout-info' }, [
    el('div', { class: 'callout-text' }, 'The Data Catalogue defines named building blocks from your ticket data. Complete Setup first.'),
  ]);

  const sectionHeader = el('div', { class: 'section-heading' }, [
    el('h3', { class: 'section-title' }, 'Data Catalogue'),
    el('button', { class: 'btn btn-sm btn-secondary', disabled: true }, 'New variable'),
  ]);

  const placeholder = el('div', { style: { textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)' } }, [
    el('div', { style: { fontSize: '13px' } }, 'Complete connection setup to start building variables.'),
  ]);

  const inner = el('div', { class: 'zone-inner' }, [
    callout,
    sectionHeader,
    placeholder,
  ]);

  container.appendChild(inner);
}
