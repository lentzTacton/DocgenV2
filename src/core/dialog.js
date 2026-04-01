/**
 * Shared Dialog Utilities — reusable modal overlay, confirm dialog, and
 * validation/info dialog patterns used across the application.
 *
 * Centralises the repeated pattern of:
 *   position: fixed; inset: 0; zIndex: Z_DIALOG; ...
 * that was previously duplicated 20+ times in variable-list.js,
 * variable-wizard.js, and selection-panel.js.
 */

import { el } from './dom.js';
import { icon } from '../components/icon.js';

// ─── Z-index constants ─────────────────────────────────────────────
export const Z_OVERLAY = 9999;
export const Z_MENU = 200;

// ═════════════════════════════════════════════════════════════════════
//  OVERLAY
// ═════════════════════════════════════════════════════════════════════

/**
 * Create a full-screen overlay backdrop.
 * Clicking the backdrop dismisses by default.
 *
 * @param {Object} [opts]
 * @param {string} [opts.id] — id to prevent duplicates
 * @param {boolean} [opts.dismissOnClick=true] — close on backdrop click
 * @param {string} [opts.background='rgba(0,0,0,.35)']
 * @returns {HTMLElement} overlay element (not yet appended to DOM)
 */
export function createOverlay(opts = {}) {
  const {
    id = 'dialog-overlay',
    dismissOnClick = true,
    background = 'rgba(0,0,0,.35)',
  } = opts;

  // Remove existing if same id
  const existing = document.getElementById(id);
  if (existing) existing.remove();

  const overlay = el('div', {
    id,
    style: {
      position: 'fixed', inset: '0', background,
      zIndex: String(Z_OVERLAY),
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
  });

  if (dismissOnClick) {
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  }

  return overlay;
}

/**
 * Create the standard dialog card (white rounded box with shadow).
 *
 * @param {HTMLElement[]} children
 * @param {Object} [opts]
 * @param {string} [opts.maxWidth='360px']
 * @param {string} [opts.borderColor]
 * @returns {HTMLElement}
 */
export function createDialogCard(children, opts = {}) {
  const { maxWidth = '360px', borderColor = 'var(--border)' } = opts;
  return el('div', {
    style: {
      background: 'var(--card, #fff)',
      border: `1px solid ${borderColor}`,
      borderRadius: '8px',
      padding: '16px 18px',
      maxWidth,
      width: '90%',
      boxShadow: '0 8px 24px rgba(0,0,0,.18)',
    },
  }, children);
}

// ═════════════════════════════════════════════════════════════════════
//  CONFIRM DIALOG
// ═════════════════════════════════════════════════════════════════════

/**
 * Show a confirm/cancel dialog.
 *
 * @param {string} title
 * @param {string} message
 * @param {Function} onConfirm — called when user clicks confirm
 * @param {Object} [opts]
 * @param {string} [opts.confirmLabel='Delete']
 * @param {boolean} [opts.destructive=auto] — red styling if true
 * @param {string} [opts.id='confirm-dialog-overlay']
 */
export function showConfirmDialog(title, message, onConfirm, opts = {}) {
  const {
    confirmLabel = 'Delete',
    destructive = confirmLabel === 'Delete',
    id = 'confirm-dialog-overlay',
    btnColor,   // optional override for button background
    iconTint,   // optional override for icon colour
  } = opts;

  const defaultColor = destructive ? 'var(--danger, #CF222E)' : 'var(--accent, #0969DA)';
  const btnBg = btnColor || defaultColor;
  const iconColor = iconTint || defaultColor;

  const overlay = createOverlay({ id });

  overlay.appendChild(
    createDialogCard([
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } }, [
        el('span', { class: 'icon', style: { color: iconColor }, html: icon('info', 18) }),
        el('div', { style: { fontWeight: '700', fontSize: '13px' } }, title),
      ]),
      el('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '14px' } }, message),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px' } }, [
        el('button', { class: 'btn btn-outline btn-sm', onclick: () => overlay.remove() }, 'Cancel'),
        el('button', {
          class: 'btn btn-sm',
          style: { background: btnBg, color: '#fff', border: 'none' },
          onclick: () => { overlay.remove(); onConfirm(); },
        }, confirmLabel),
      ]),
    ], { maxWidth: '340px' })
  );

  document.body.appendChild(overlay);
  return overlay;
}

// ═════════════════════════════════════════════════════════════════════
//  VALIDATION / INFO DIALOG
// ═════════════════════════════════════════════════════════════════════

/**
 * Show an informational / validation-error dialog with optional detail list.
 *
 * @param {string} title
 * @param {string} reason — explanation text
 * @param {string[]} [details] — bullet-point details
 * @param {Object} [opts]
 * @param {string} [opts.iconName='info']
 * @param {string} [opts.iconColor='var(--danger, #CF222E)']
 * @param {string} [opts.id='val-dialog-overlay']
 */
export function showInfoDialog(title, reason, details, opts = {}) {
  const {
    iconName = 'info',
    iconColor = 'var(--danger, #CF222E)',
    id = 'val-dialog-overlay',
  } = opts;

  const overlay = createOverlay({ id });

  const children = [
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } }, [
      el('span', { class: 'icon', style: { color: iconColor }, html: icon(iconName, 18) }),
      el('div', { style: { fontWeight: '700', fontSize: '13px' } }, title),
    ]),
    el('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', lineHeight: '1.5' } }, reason),
  ];

  if (details && details.length > 0) {
    const detailList = el('div', {
      style: {
        fontSize: '11px', color: 'var(--text-tertiary)', background: 'var(--bg)',
        border: '1px solid var(--border-light)', borderRadius: 'var(--radius)',
        padding: '8px 10px', marginBottom: '10px',
      },
    });
    details.forEach(d => {
      detailList.appendChild(el('div', { style: { marginBottom: '3px' } }, `• ${d}`));
    });
    children.push(detailList);
  }

  children.push(
    el('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, [
      el('button', { class: 'btn btn-primary btn-sm', onclick: () => overlay.remove() }, 'OK'),
    ])
  );

  overlay.appendChild(createDialogCard(children));
  document.body.appendChild(overlay);
  return overlay;
}
