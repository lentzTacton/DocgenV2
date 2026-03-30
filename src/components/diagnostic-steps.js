/**
 * Shared Diagnostic Steps Component
 *
 * Renders a list of diagnostic steps using the conn-tooltip-step classes,
 * shared across ticket-card tooltips, connection-card tooltips, and
 * the locked summary diagnostics view.
 */

import { el } from '../core/dom.js';

export const STEP_ICONS = { pass: '✓', fail: '✗', skip: '–', warn: '!', checking: '…' };

/**
 * Render an array of diagnostic steps into a container element.
 * Each step: { label, status, detail }
 * @param {HTMLElement} container — parent to append into
 * @param {Array} steps
 */
export function renderDiagnosticSteps(container, steps) {
  for (const step of steps) {
    container.appendChild(el('div', { class: 'conn-tooltip-step' }, [
      el('span', { class: `conn-tooltip-icon tt-${step.status}` }, STEP_ICONS[step.status] || '–'),
      el('div', { class: 'conn-tooltip-body' }, [
        el('div', { class: 'conn-tooltip-label' }, step.label),
        el('div', { class: 'conn-tooltip-detail' }, step.detail || ''),
      ]),
    ]));
  }
}

/**
 * Build a full diagnostic tooltip panel (header + steps).
 * Used in ticket-card badge tooltip and locked summary hover tooltip.
 *
 * @param {string} title — e.g. "Token (T-00000010)"
 * @param {string} badgeLabel — e.g. "All Good", "Expired", "Error"
 * @param {string} badgeStatus — 'ok' | 'warn' | 'error'
 * @param {Array} steps — diagnostic step array
 * @returns {HTMLElement} tooltip div (not yet appended)
 */
export function buildDiagnosticPanel(title, badgeLabel, badgeStatus, steps) {
  const panel = el('div', { class: 'conn-tooltip-steps' });
  renderDiagnosticSteps(panel, steps);

  const header = el('div', { class: 'conn-tooltip-header' }, [
    el('span', { class: 'conn-tooltip-title' }, title),
    el('span', { class: `conn-tooltip-badge ${badgeStatus}` }, badgeLabel),
  ]);

  const wrap = el('div', {}, [header, panel]);
  return wrap;
}
