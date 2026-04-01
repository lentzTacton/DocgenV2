/**
 * Document Update Overlay — shared between variable-detail and variable-wizard.
 *
 * Shows an overlay when saving a variable that has a changed expression,
 * offering to update/replace/force-update the expression in the Word document.
 */

import { el } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import {
  checkExpressionInDocument, replaceSelectedText, selectSearchResult,
} from '../../services/word-api.js';

// ─── Overlay UI ─────────────────────────────────────────────────────

/**
 * Show an overlay for the document update flow.
 * @param {Object} opts
 * @param {string}   opts.message     — Description of what happened
 * @param {string}   opts.oldExpr     — Original expression
 * @param {string}   opts.newExpr     — New expression
 * @param {Function} [opts.onUpdate]  — Called when user confirms "Update in document"
 * @param {Function} [opts.onForce]   — Called when user clicks "Force update selected"
 * @param {Function} [opts.onSkip]    — Called when user clicks "Save data only"
 * @param {Function} [opts.onPick]    — Called with matchIndex when user picks from list
 * @param {Array}    [opts.matches]   — Search results for picker UI
 * @param {boolean}  [opts.skipOnly]  — Only show the skip button (no update option)
 */
export function showDocUpdateOverlay(opts) {
  // Remove any previous overlay
  const prev = document.querySelector('#doc-update-overlay');
  if (prev) prev.remove();

  const overlay = el('div', {
    id: 'doc-update-overlay',
    class: 'doc-update-overlay',
  });

  const card = el('div', { class: 'doc-update-card' });

  // Header
  card.appendChild(el('div', { class: 'doc-update-header' }, [
    el('span', { class: 'icon', style: { color: 'var(--tacton-blue)' }, html: icon('edit', 16) }),
    el('span', { style: { fontWeight: '700', fontSize: '13px' } }, 'Update Document'),
  ]));

  // Message
  card.appendChild(el('div', { class: 'doc-update-msg' }, opts.message));

  // Expression diff preview
  const diffWrap = el('div', { class: 'doc-update-diff' });
  diffWrap.appendChild(el('div', { class: 'doc-update-diff-row doc-update-diff-old' }, [
    el('span', { class: 'doc-update-diff-label' }, 'Before'),
    el('code', {}, opts.oldExpr),
  ]));
  diffWrap.appendChild(el('div', { class: 'doc-update-diff-row doc-update-diff-new' }, [
    el('span', { class: 'doc-update-diff-label' }, 'After'),
    el('code', {}, opts.newExpr),
  ]));
  card.appendChild(diffWrap);

  // Match picker (multi-match scenario)
  if (opts.matches && opts.matches.length > 1) {
    const picker = el('div', { class: 'doc-update-picker' });
    picker.appendChild(el('div', { class: 'doc-update-picker-label' }, 'Select which occurrence to update:'));
    opts.matches.forEach((m, idx) => {
      picker.appendChild(el('button', {
        class: 'doc-update-match-btn',
        onclick: () => { overlay.remove(); opts.onPick(idx); },
      }, [
        el('span', { class: 'doc-update-match-num' }, `#${idx + 1}`),
        el('code', { class: 'doc-update-match-ctx' },
          (m.contextBefore ? '…' + m.contextBefore : '') + m.text + (m.contextAfter ? m.contextAfter + '…' : '')),
      ]));
    });
    card.appendChild(picker);
  }

  // Action buttons
  const actions = el('div', { class: 'doc-update-actions' });
  if (!opts.skipOnly && opts.onUpdate) {
    actions.appendChild(el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: () => { overlay.remove(); opts.onUpdate(); },
    }, [el('span', { class: 'icon', html: icon('check', 12) }), 'Update in document']));
  }
  if (opts.onForce) {
    actions.appendChild(el('button', {
      class: 'btn btn-warning btn-sm',
      onclick: () => { overlay.remove(); opts.onForce(); },
    }, [el('span', { class: 'icon', html: icon('zap', 12) }), 'Force update selected']));
  }
  actions.appendChild(el('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => { overlay.remove(); if (opts.onSkip) opts.onSkip(); },
  }, opts.skipOnly && !opts.onForce ? 'OK, save data only' : 'Save data only'));
  actions.appendChild(el('button', {
    class: 'btn btn-outline btn-sm',
    style: { color: 'var(--text-tertiary)' },
    onclick: () => overlay.remove(),
  }, 'Cancel'));
  card.appendChild(actions);

  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

// ─── Full doc-update flow ───────────────────────────────────────────

/**
 * Run the full document update flow for edited variables.
 * Checks the document for the old expression and shows the appropriate overlay.
 *
 * @param {string|string[]} oldExpr — single expression or array of search candidates (for blocks)
 * @param {string} newExpr — the new expression to replace with in the document
 * @param {string} variableName — for undo tracking
 * @param {Function} commitSave — called to persist the save after user choice
 * @returns {Promise<boolean>} true if save was committed immediately (unchanged/no_word/default),
 *          false if an overlay is shown and save is deferred to user action.
 */
export async function runDocUpdateFlow(oldExpr, newExpr, variableName, commitSave) {
  const docResult = await checkExpressionInDocument(oldExpr, newExpr);

  // Use whichever candidate pattern was actually found in the document
  const matched = docResult.matchedPattern || (Array.isArray(oldExpr) ? oldExpr[0] : oldExpr);
  const displayOld = matched;

  const doReplace = async () => {
    const ok = await replaceSelectedText(newExpr, matched, variableName);
    if (ok) await commitSave();
    else showDocUpdateOverlay({
      message: 'Replace failed — document not updated.',
      oldExpr: displayOld, newExpr, onSkip: commitSave, skipOnly: true,
    });
  };

  switch (docResult.status) {
    case 'unchanged':
    case 'no_word':
      await commitSave();
      return true;

    case 'selected':
      showDocUpdateOverlay({
        message: 'The original expression is still selected in the document.',
        oldExpr: displayOld, newExpr,
        onUpdate: doReplace,
        onSkip: commitSave,
      });
      return false;

    case 'found_one':
      showDocUpdateOverlay({
        message: 'Found the expression in the document (1 match, now selected).',
        oldExpr: displayOld, newExpr,
        onUpdate: doReplace,
        onSkip: commitSave,
      });
      return false;

    case 'found_many':
      showDocUpdateOverlay({
        message: `Found ${docResult.matches.length} matches in the document. Select which one to update:`,
        oldExpr: displayOld, newExpr,
        matches: docResult.matches,
        onPick: async (idx) => {
          await selectSearchResult(matched, idx);
          const ok = await replaceSelectedText(newExpr, matched, variableName);
          if (ok) await commitSave();
          else showDocUpdateOverlay({
            message: 'Replace failed — document not updated.',
            oldExpr: displayOld, newExpr, onSkip: commitSave, skipOnly: true,
          });
        },
        onSkip: commitSave,
      });
      return false;

    case 'not_found':
      showDocUpdateOverlay({
        message: 'Expression not found in the document. Select the out-of-sync text in Word and click "Force update" to overwrite it.',
        oldExpr: displayOld, newExpr,
        onForce: async () => {
          const ok = await replaceSelectedText(newExpr, matched, variableName);
          if (ok) await commitSave();
          else showDocUpdateOverlay({
            message: 'Nothing is selected in the document. Select the text you want to replace first.',
            oldExpr: displayOld, newExpr, onSkip: commitSave, skipOnly: true,
          });
        },
        onSkip: commitSave,
      });
      return false;

    default:
      await commitSave();
      return true;
  }
}
