/**
 * Document Update Overlay — shared between variable-detail and variable-wizard.
 *
 * Shows an overlay when saving a variable that has a changed expression,
 * offering to update/replace/force-update the expression in the Word document.
 */

import { el } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import {
  checkExpressionInDocument, replaceSelectedText, replaceAllInDocument, selectSearchResult,
} from '../../services/word-api.js';
import state from '../../core/state.js';
import { resolveThisAlias, getResolvedRoot } from '../../services/variables.js';

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
 * @param {string}   [opts.searchText]— The search text used to find matches (for hover-to-select)
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
    const selIdx = (opts.selectedIndex != null && opts.selectedIndex >= 0) ? opts.selectedIndex : -1;
    opts.matches.forEach((m, idx) => {
      const isOriginal = idx === selIdx;
      const btn = el('button', {
        class: 'doc-update-match-btn' + (isOriginal ? ' doc-update-match-selected' : ''),
        onclick: () => { overlay.remove(); opts.onPick(idx); },
      }, [
        el('span', { class: 'doc-update-match-num' }, `#${idx + 1}${isOriginal ? ' ◀' : ''}`),
        el('code', { class: 'doc-update-match-ctx' },
          (m.contextBefore ? '…' + m.contextBefore : '') + m.text + (m.contextAfter ? m.contextAfter + '…' : '')),
      ]);
      // Hover-to-select: navigate to this occurrence in the Word document
      if (opts.searchText) {
        btn.addEventListener('mouseenter', () => {
          selectSearchResult(opts.searchText, idx);
        });
      }
      picker.appendChild(btn);
    });
    card.appendChild(picker);
  }

  // Action buttons
  const actions = el('div', { class: 'doc-update-actions' });
  // Buttons: Cancel (left) → Save data only → Update (right = primary)
  actions.appendChild(el('button', {
    class: 'btn btn-outline btn-sm',
    style: { color: 'var(--text-tertiary)' },
    onclick: () => overlay.remove(),
  }, 'Cancel'));
  actions.appendChild(el('button', {
    class: 'btn btn-outline btn-sm',
    onclick: () => { overlay.remove(); if (opts.onSkip) opts.onSkip(); },
  }, opts.skipOnly && !opts.onForce ? 'OK, save data only' : 'Save data only'));
  if (opts.onForce) {
    actions.appendChild(el('button', {
      class: 'btn btn-warning btn-sm',
      onclick: () => { overlay.remove(); opts.onForce(); },
    }, [el('span', { class: 'icon', html: icon('zap', 12) }), 'Force update selected']));
  }
  if (!opts.skipOnly && opts.onUpdate) {
    actions.appendChild(el('button', {
      class: opts.onUpdateAll ? 'btn btn-outline btn-sm' : 'btn btn-primary btn-sm',
      onclick: () => { overlay.remove(); opts.onUpdate(); },
    }, [el('span', { class: 'icon', html: icon('check', 12) }), 'Update in document']));
  }
  if (!opts.skipOnly && opts.onUpdateAll && opts.matches && opts.matches.length > 1) {
    const updateAllBtn = el('button', {
      class: 'btn btn-primary btn-sm',
      onclick: () => { overlay.remove(); opts.onUpdateAll(); },
    }, [el('span', { class: 'icon', html: icon('check', 12) }), `Update all (${opts.matches.length})`]);
    if (opts.searchText) {
      const homeIdx = (opts.selectedIndex != null && opts.selectedIndex >= 0) ? opts.selectedIndex : 0;
      updateAllBtn.addEventListener('mouseenter', () => {
        selectSearchResult(opts.searchText, homeIdx);
      });
    }
    actions.appendChild(updateAllBtn);
  }
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
export async function runDocUpdateFlow(oldExpr, newExpr, variableName, commitSave, opts = {}) {
  console.log('[DocGen] runDocUpdateFlow:', {
    oldExpr: Array.isArray(oldExpr) ? oldExpr : [oldExpr],
    newExpr,
    variableName,
  });
  const docResult = await checkExpressionInDocument(oldExpr, newExpr);
  console.log('[DocGen] checkExpressionInDocument result:', docResult.status, docResult.matchedPattern || '(none)');

  // Use whichever candidate pattern was actually found in the document
  const matched = docResult.matchedPattern || (Array.isArray(oldExpr) ? oldExpr[0] : oldExpr);
  const displayOld = matched;

  // ── Align newExpr root with matched document form ──────────────────
  // When the user made a REAL change (old stored form ≠ new stored form),
  // align the new expression to match the document's root convention
  // (e.g. if document uses "solution.", write back with "solution." too).
  //
  // When old === new stored form (user didn't change the expression),
  // DON'T align — let the dialog show the actual difference between
  // the document form (e.g. "solution.") and the stored form (e.g. "#this.").
  // This way the user can choose to normalize the document.
  const primaryOld = Array.isArray(oldExpr) ? oldExpr[0] : oldExpr;
  const storedUnchanged = resolveThisAlias(primaryOld) === resolveThisAlias(newExpr);

  // ── Align newExpr root with matched document form ──────────────────
  // When the user made a REAL change, align the new expression to match
  // the document's root convention (e.g. if document uses "solution.",
  // write back with "solution." too).
  // When unchanged, DON'T align — let the dialog show the difference
  // so the user can choose to normalize.
  let alignedNewExpr = newExpr;
  const resolvedRoot = getResolvedRoot();
  if (!storedUnchanged && resolvedRoot && matched) {
    const matchHasThis = matched.includes('#this');
    const newHasThis = newExpr.includes('#this');
    if (!matchHasThis && newHasThis) {
      alignedNewExpr = newExpr.replace(/#this\b/g, resolvedRoot);
    } else if (matchHasThis && !newHasThis && newExpr.includes(resolvedRoot)) {
      alignedNewExpr = newExpr.replace(new RegExp(`\\b${resolvedRoot}\\b`, 'g'), '#this');
    }
  }

  const doReplace = async () => {
    const ok = await replaceSelectedText(alignedNewExpr, matched, variableName);
    if (ok) await commitSave();
    else showDocUpdateOverlay({
      message: 'Replace failed — document not updated.',
      oldExpr: displayOld, newExpr: alignedNewExpr, onSkip: commitSave, skipOnly: true,
    });
  };

  const singleMsg = 'Following changes detected, want to proceed?';
  const multiCount = docResult.matches?.length || 0;
  const multiMsg = `Following changes detected across ${multiCount} matches. Select which one to update:`;

  switch (docResult.status) {
    case 'unchanged':
    case 'no_word':
      await commitSave();
      return true;

    case 'selected':
    case 'found_one':
      showDocUpdateOverlay({
        message: singleMsg,
        oldExpr: displayOld, newExpr: alignedNewExpr,
        onUpdate: doReplace,
        onSkip: commitSave,
      });
      return false;

    case 'found_many':
      showDocUpdateOverlay({
        message: multiMsg,
        oldExpr: displayOld, newExpr: alignedNewExpr,
        matches: docResult.matches,
        searchText: matched,
        selectedIndex: docResult.selectedIndex ?? -1,
        onUpdateAll: async () => {
          const count = await replaceAllInDocument(matched, alignedNewExpr, variableName);
          if (count > 0) await commitSave();
          else showDocUpdateOverlay({
            message: 'Replace all failed — document not updated.',
            oldExpr: displayOld, newExpr: alignedNewExpr, onSkip: commitSave, skipOnly: true,
          });
        },
        onPick: async (idx) => {
          await selectSearchResult(matched, idx);
          const ok = await replaceSelectedText(alignedNewExpr, matched, variableName);
          if (ok) await commitSave();
          else showDocUpdateOverlay({
            message: 'Replace failed — document not updated.',
            oldExpr: displayOld, newExpr: alignedNewExpr, onSkip: commitSave, skipOnly: true,
          });
        },
        onSkip: commitSave,
      });
      return false;

    case 'not_found':
      showDocUpdateOverlay({
        message: 'Expression not found in the document. Select the out-of-sync text in Word and click "Force update" to overwrite it.',
        oldExpr: displayOld, newExpr: alignedNewExpr,
        onForce: async () => {
          const ok = await replaceSelectedText(alignedNewExpr, matched, variableName);
          if (ok) await commitSave();
          else showDocUpdateOverlay({
            message: 'Nothing is selected in the document. Select the text you want to replace first.',
            oldExpr: displayOld, newExpr: alignedNewExpr, onSkip: commitSave, skipOnly: true,
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
