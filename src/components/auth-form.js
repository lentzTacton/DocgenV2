/**
 * Shared Auth Form Component
 *
 * Reusable inline authorization form with:
 *   - Access token input (password masked + eye toggle)
 *   - Refresh token input (password masked + eye toggle)
 *   - Authorize / Cancel buttons
 *   - Status message area
 *
 * Used in both the ticket-card auth section and the locked summary re-auth.
 */

import { el, qs } from '../core/dom.js';
import { icon } from '../components/icon.js';

/**
 * Toggle password visibility on a token input.
 * @param {HTMLButtonElement} btn — the eye toggle button
 */
export function toggleTokenVisibility(btn) {
  const input = btn.parentElement.querySelector('input');
  if (!input) return;
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  btn.innerHTML = icon(isHidden ? 'eyeOff' : 'eye', 14);
  btn.title = isHidden ? 'Hide token' : 'Show token';
}

/**
 * Build an auth form section.
 *
 * @param {Object} opts
 * @param {string} opts.idPrefix — ID prefix for elements (e.g. 'ticket-auth' or 'locked-reauth')
 * @param {string} opts.title — display title (e.g. 'Authorize T-00000010')
 * @param {Function} opts.onSubmit — called when Authorize is clicked
 * @param {Function} [opts.onCancel] — called when Cancel is clicked (omit to hide Cancel)
 * @param {Function} [opts.onGetToken] — called when "Get token" link is clicked (omit to hide)
 * @param {boolean} [opts.showRefreshToken=true] — whether to show the refresh token field
 * @returns {{ section: HTMLElement, getAccessValue: Function, getRefreshValue: Function, clearInputs: Function, resetVisibility: Function, setTitle: Function, showStatus: Function }}
 */
export function buildAuthForm(opts) {
  const {
    idPrefix,
    title,
    onSubmit,
    onCancel,
    onGetToken,
    showRefreshToken = true,
  } = opts;

  const statusEl = el('div', {
    class: 'locked-reauth-status',
    id: `${idPrefix}-status`,
    style: { display: 'none' },
  });

  // Access token field
  const accessInput = el('input', {
    class: 'input',
    id: `${idPrefix}-code`,
    type: 'password',
    placeholder: 'Paste access token',
  });

  const accessToggle = el('button', {
    class: 'token-visibility-toggle',
    type: 'button',
    title: 'Show / hide token',
    html: icon('eye', 14),
    onclick: (e) => toggleTokenVisibility(e.currentTarget),
  });

  const accessField = el('div', { class: 'ticket-auth-field' }, [
    el('label', { class: 'ticket-auth-label', for: `${idPrefix}-code` }, 'Access Token'),
    el('div', { class: 'input-with-toggle' }, [accessInput, accessToggle]),
  ]);

  // Refresh token field
  let refreshInput = null;
  let refreshToggle = null;
  let refreshField = null;

  if (showRefreshToken) {
    refreshInput = el('input', {
      class: 'input',
      id: `${idPrefix}-refresh`,
      type: 'password',
      placeholder: 'Paste refresh token',
    });

    refreshToggle = el('button', {
      class: 'token-visibility-toggle',
      type: 'button',
      title: 'Show / hide token',
      html: icon('eye', 14),
      onclick: (e) => toggleTokenVisibility(e.currentTarget),
    });

    refreshField = el('div', { class: 'ticket-auth-field' }, [
      el('label', { class: 'ticket-auth-label', for: `${idPrefix}-refresh` }, [
        'Refresh Token',
        el('span', { class: 'ticket-auth-label-hint' }, '(for auto-renewal)'),
      ]),
      el('div', { class: 'input-with-toggle' }, [refreshInput, refreshToggle]),
    ]);
  }

  // Buttons
  const submitBtn = el('button', {
    class: 'btn btn-sm btn-primary',
    id: `${idPrefix}-submit-btn`,
    onclick: onSubmit,
  }, 'Authorize');

  const cancelBtn = onCancel
    ? el('button', { class: 'btn btn-sm btn-ghost', onclick: onCancel }, 'Cancel')
    : null;

  const getTokenBtn = onGetToken
    ? el('button', {
        class: 'ticket-inline-btn',
        id: `${idPrefix}-open-btn`,
        html: `Get token ${icon('externalLink', 10)}`,
        onclick: onGetToken,
      })
    : null;

  // Header
  const headerChildren = [
    el('span', { class: 'ticket-auth-title', id: `${idPrefix}-title` }, title),
  ];
  if (getTokenBtn) headerChildren.push(getTokenBtn);

  const section = el('div', {
    class: 'ticket-auth-section',
    id: `${idPrefix}-section`,
    style: { display: 'none' },
  }, [
    el('div', { class: 'ticket-auth-header' }, headerChildren),
    el('div', { class: 'ticket-auth-fields' }, [
      accessField,
      refreshField,
    ].filter(Boolean)),
    el('div', { class: 'ticket-auth-input-row' }, [
      submitBtn,
      cancelBtn,
    ].filter(Boolean)),
    statusEl,
  ]);

  // API
  return {
    section,
    getAccessValue: () => accessInput.value.trim(),
    getRefreshValue: () => (refreshInput ? refreshInput.value.trim() : ''),
    clearInputs: () => {
      accessInput.value = '';
      accessInput.type = 'password';
      accessToggle.innerHTML = icon('eye', 14);
      if (refreshInput) {
        refreshInput.value = '';
        refreshInput.type = 'password';
        refreshToggle.innerHTML = icon('eye', 14);
      }
    },
    resetVisibility: () => {
      accessInput.type = 'password';
      accessToggle.innerHTML = icon('eye', 14);
      accessToggle.title = 'Show / hide token';
      if (refreshInput) {
        refreshInput.type = 'password';
        refreshToggle.innerHTML = icon('eye', 14);
        refreshToggle.title = 'Show / hide token';
      }
    },
    setTitle: (t) => {
      const titleEl = section.querySelector(`#${idPrefix}-title`);
      if (titleEl) titleEl.textContent = t;
    },
    showStatus: (msg, type) => {
      if (!msg) { statusEl.style.display = 'none'; return; }
      statusEl.style.display = '';
      statusEl.textContent = msg;
      statusEl.className = `status-message status-${type}`;
    },
    setSubmitLoading: (loading) => {
      submitBtn.disabled = loading;
      submitBtn.textContent = loading ? 'Authorizing…' : 'Authorize';
    },
    show: () => { section.style.display = ''; },
    hide: () => { section.style.display = 'none'; },
    isVisible: () => section.style.display !== 'none',
    focusAccess: () => accessInput.focus(),
  };
}
