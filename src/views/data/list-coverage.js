/**
 * Coverage Bar — BOM item distribution visualisation.
 *
 * Extracted from variable-list.js to reduce file size.
 * Entry point: renderCoverageBar(variables) → HTMLElement
 */

import { el } from '../../core/dom.js';
import { icon } from '../../components/icon.js';

// Coverage bar collapse state (in-memory)
let coverageCollapsed = true;

/**
 * Render the BOM coverage bar showing item distribution.
 * @param {Array} variables — full variable list from state
 * @returns {HTMLElement}
 */
export function renderCoverageBar(variables) {
  const bomVars = variables.filter(v => v.type === 'bom');
  const total = bomVars.reduce((sum, v) => sum + (v.matchCount || 0), 0) || 42;
  const colors = ['#E8713A', '#D4A015', '#8250DF', '#0A6DC2', '#1A7F37', '#CF222E', '#6E40C9'];

  const coverage = el('div', { class: 'coverage' });

  const assigned = bomVars.reduce((s, v) => s + (v.matchCount || 0), 0);

  const chevron = el('span', {
    class: 'icon',
    html: icon(coverageCollapsed ? 'chevronRight' : 'chevronDown', 10),
    style: { transition: 'transform 0.15s', display: 'inline-flex', flexShrink: '0' },
  });

  const body = el('div', {
    class: 'coverage-body',
    style: { display: coverageCollapsed ? 'none' : '' },
  });

  const header = el('div', {
    class: 'coverage-header',
    style: { cursor: 'pointer', userSelect: 'none' },
    onclick: () => {
      coverageCollapsed = !coverageCollapsed;
      body.style.display = coverageCollapsed ? 'none' : '';
      chevron.innerHTML = icon(coverageCollapsed ? 'chevronRight' : 'chevronDown', 10);
    },
  }, [
    el('span', { style: { display: 'flex', alignItems: 'center', gap: '4px', fontWeight: '700', fontSize: '12px' } }, [
      chevron,
      'BOM Coverage',
    ]),
    el('span', {
      style: { color: assigned >= total ? 'var(--success)' : 'var(--warning)', fontWeight: '600', fontSize: '12px' },
    }, `${assigned}/${total} assigned`),
  ]);
  coverage.appendChild(header);

  const bar = el('div', { class: 'coverage-bar' });
  bomVars.forEach((v, i) => {
    const pct = total > 0 ? ((v.matchCount || 0) / total) * 100 : 0;
    if (pct > 0) {
      bar.appendChild(
        el('div', {
          class: 'coverage-seg',
          style: { width: `${pct}%`, background: v.catchAll ? '#ABB4BD' : colors[i % colors.length] },
        })
      );
    }
  });
  body.appendChild(bar);

  const legend = el('div', { class: 'coverage-legend' });
  bomVars.forEach((v, i) => {
    legend.appendChild(
      el('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '3px' } }, [
        el('span', {
          class: 'coverage-dot',
          style: { background: v.catchAll ? '#ABB4BD' : colors[i % colors.length] },
        }),
        `${v.name} ${v.matchCount || 0}`,
      ])
    );
  });
  body.appendChild(legend);
  coverage.appendChild(body);

  return coverage;
}
