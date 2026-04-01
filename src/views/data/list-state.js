/**
 * List State — Shared constants, mutable UI state, and utilities
 * used across the variable-list sub-modules.
 *
 * Centralises module-level state that was previously scattered
 * across the monolithic variable-list.js.
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import { isConnected, fetchModel } from '../../services/data-api.js';

// ─── Constants ──────────────────────────────────────────────────────────

export const TYPE_CONFIG = {
  bom:    { badge: 'badge-bom',    label: 'BOM',    icon: 'box',    color: 'var(--orange)' },
  object: { badge: 'badge-obj',    label: 'OBJ',    icon: 'cube',   color: 'var(--purple)' },
  single: { badge: 'badge-single', label: 'SINGLE', icon: 'target', color: 'var(--success)' },
  define: { badge: 'badge-define', label: 'DEF',    icon: 'link',   color: 'var(--purple, #8250DF)' },
  list:   { badge: 'badge-list',   label: 'LIST',   icon: 'list',   color: 'var(--tacton-blue)' },
  code:   { badge: 'badge-code',   label: 'CODE',   icon: 'code',   color: 'var(--text-tertiary)' },
};

export const SCOPE_CONFIG = {
  instance: { label: 'Instance', icon: 'database', color: 'var(--purple)', desc: 'Shared across all tickets on this instance' },
  ticket:   { label: 'Ticket',   icon: 'ticket',   color: 'var(--orange)', desc: 'Scoped to the current ticket/branch' },
  shared:   { label: 'Shared',   icon: 'globe',    color: 'var(--tacton-blue)', desc: 'Available in all projects' },
};

// ─── Collapse state (in-memory, persists during session) ────────────────

const collapseState = {};

const EXPAND_ALL_KEY = 'docgen_expand_all';
let expandAll = (() => { try { return localStorage.getItem(EXPAND_ALL_KEY) === 'true'; } catch { return false; } })();

export function isCollapsed(key) {
  if (key in collapseState) return collapseState[key];
  return !expandAll;
}

export function toggleCollapse(key) { collapseState[key] = !isCollapsed(key); }

export function setExpandAll(val) {
  expandAll = val;
  Object.keys(collapseState).forEach(k => delete collapseState[k]);
  try { localStorage.setItem(EXPAND_ALL_KEY, String(val)); } catch { /* noop */ }
}

export function getExpandAll() { return expandAll; }

// ─── Show expression toggle ─────────────────────────────────────────────

const SHOW_EXPR_KEY = 'docgen_show_expr';
let showExpr = (() => { try { return localStorage.getItem(SHOW_EXPR_KEY) === 'true'; } catch { return false; } })();

export function getShowExpr() { return showExpr; }

export function setShowExpr(val) {
  showExpr = val;
  try { localStorage.setItem(SHOW_EXPR_KEY, String(val)); } catch { /* noop */ }
}

// ─── Search / filter state ──────────────────────────────────────────────

export let searchQuery = '';
export function setSearchQuery(val) { searchQuery = val; }

export const activeTagFilters = new Set();

// ─── Multi-select state ─────────────────────────────────────────────────

export const selectedVarIds = new Set();
export let lastClickedVarId = null;
export function setLastClickedVarId(val) { lastClickedVarId = val; }

// ─── Validation context cache ───────────────────────────────────────────

export const validationCtx = {
  bomSources: [], bomFields: [], bomRecords: [],
  modelObjects: [], configAttrPaths: new Set(),
};
export let validationCtxLoaded = false;
export function setValidationCtxLoaded(val) { validationCtxLoaded = val; }

export const validationResults = {};

// ─── Rerender registration ──────────────────────────────────────────────

let _rerenderFn = null;
export function setRerenderFn(fn) { _rerenderFn = fn; }
export function rerender() { if (_rerenderFn) _rerenderFn(); }

// ─── Floating tooltip (delegates on [data-val-tip]) ─────────────────────

let _valTip = null;

export function dismissAllTooltips() {
  if (_valTip) { _valTip.remove(); _valTip = null; }
  document.querySelectorAll('.wiz-chip-tooltip').forEach(t => t.remove());
}

document.addEventListener('mouseover', (e) => {
  const target = e.target.closest('[data-val-tip]');
  if (!target) return;
  if (_valTip) _valTip.remove();
  const text = target.dataset.valTip;
  if (!text) return;
  _valTip = el('div', { class: 'wiz-chip-tooltip' }, text);
  document.body.appendChild(_valTip);
  const rect = target.getBoundingClientRect();
  _valTip.style.left = `${rect.right + 8}px`;
  _valTip.style.top = `${rect.top + (rect.height / 2) - (_valTip.offsetHeight / 2)}px`;
  if (rect.right + 8 + _valTip.offsetWidth > window.innerWidth - 8) {
    _valTip.style.left = `${rect.left - _valTip.offsetWidth - 8}px`;
  }
  if (parseFloat(_valTip.style.top) + _valTip.offsetHeight > window.innerHeight - 8) {
    _valTip.style.top = `${window.innerHeight - _valTip.offsetHeight - 8}px`;
  }
});

document.addEventListener('mouseout', (e) => {
  const target = e.target.closest('[data-val-tip]');
  if (target && _valTip) { _valTip.remove(); _valTip = null; }
});

state.on('dataView', dismissAllTooltips);
state.on('activeVariable', dismissAllTooltips);
