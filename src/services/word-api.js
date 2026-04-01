/**
 * Word API Service — handles inserting template expressions into the
 * active Word document via Office JS, with validation warning dialogs,
 * toast feedback, and document selection monitoring.
 */

import { el } from '../core/dom.js';
import { icon } from '../components/icon.js';
import state from '../core/state.js';
import { parseExpression, parseMultipleDefines, parseMultipleExpressions } from './expression-parser.js';

// ─── Expression builder ─────────────────────────────────────────────

/**
 * Get the full expression to insert into the document.
 *
 * Variables insert as a define statement:
 *   $define{#accountName=solution.opportunity.account.name}$
 *
 * Blocks insert the source directly in a $for loop (clean, no prior define):
 *   $for{#item in solution.related('ConfiguredProduct','solution')}$
 *
 *   $endfor$
 *
 * Real-world patterns from production templates:
 *   Parker:  $for{#cp: #status in solution.related('ConfiguredProduct','solution').{?name=="Elevator solution"}}$
 *   TECE:    $for{#cp: #status in related('ConfiguredProduct','parentItem')}$
 *   Sandvik: $rowgroup{#config}$
 */
export function buildInsertExpression(variable) {
  // Variable/inline: expression is already the full $define{…}$ or ${…}$
  return variable.expression || '';
}

/**
 * Build the different insert variants for a block variable.
 * Returns { loopVar, source, forExpr, ifExpr, rawExpr }
 */
export function buildBlockInsertVariants(variable) {
  const source = variable.expression || variable.source || '';
  const loopVar = variable.name && variable.name.startsWith('#') ? variable.name : `#${variable.name || 'item'}`;
  return {
    loopVar,
    source,
    forExpr: `$for{${loopVar} in ${source}}$\n  \n$endfor$`,
    ifExpr: `$if{${source}}$\n  \n$endif$`,
    rawExpr: `${loopVar} in ${source}`,
  };
}

/**
 * Build combined text for all variables in a section, ready for Word insertion.
 * Variables are joined with newlines in their original order.
 */
export function buildSectionExpression(variables) {
  return variables.map(v => {
    if (v.purpose === 'block') {
      const variants = buildBlockInsertVariants(v);
      return variants.forExpr;
    }
    return buildInsertExpression(v);
  }).join('\n');
}

/**
 * Insert an entire section's variables into Word.
 */
export function handleInsertSectionIntoDoc(sectionName, variables) {
  if (!variables || variables.length === 0) {
    showInsertFeedback('Section has no datasets to insert', 'warning');
    return;
  }
  const expression = buildSectionExpression(variables);
  const warnings = [{
    icon: 'info',
    color: 'var(--tacton-blue, #0969DA)',
    text: `This will insert ${variables.length} dataset${variables.length > 1 ? 's' : ''} from section "${sectionName}" at the cursor position.`,
  }];
  showInsertWarningDialog(sectionName, expression, warnings, null);
}

// ─── Insert handler (entry point) ───────────────────────────────────

/**
 * Main handler called when the user clicks the insert button on a dataset card.
 * Checks for warnings and either inserts directly or shows a confirmation dialog.
 */
export function handleInsertIntoDoc(variable, valResult) {
  const isBlock  = variable.purpose === 'block';
  const hasErrors   = valResult && valResult.status === 'error';
  const hasWarnings = valResult && valResult.status === 'warning';
  const issues = (valResult && valResult.issues) || [];

  // Collect validation warnings (shown for all types)
  const valWarnings = [];
  if (hasErrors) {
    valWarnings.push(`Validation errors: ${issues.map(i => i.message || i).join('; ')}`);
  } else if (hasWarnings) {
    valWarnings.push(`Validation warnings: ${issues.map(i => i.message || i).join('; ')}`);
  }

  if (isBlock && variable.parentBlock) {
    // Child block — warn it should be inside a for/if, then insert with ${...}$ wrapper
    const source = variable.expression || variable.source || '';
    const inlineExpr = `\${${source}}$`;
    const warnings = [
      { icon: 'info', color: 'var(--orange, #e67700)',
        text: `This is a child dataset — make sure the cursor is inside the parent's $for or $if block.` },
      ...valWarnings.map(text => ({ icon: 'info', color: 'var(--danger, #CF222E)', text })),
    ];
    showInsertWarningDialog(variable.name, inlineExpr, warnings, null);
  } else if (isBlock) {
    // Parent/independent block — choice dialog: $for, $if, or raw
    const variants = buildBlockInsertVariants(variable);
    showBlockInsertDialog(variable.name, variants, valWarnings);
  } else {
    const expression = buildInsertExpression(variable);
    if (valWarnings.length > 0) {
      const warnings = valWarnings.map(text => ({ icon: 'info', color: 'var(--orange, #e67700)', text }));
      showInsertWarningDialog(variable.name, expression, warnings, null);
    } else {
      insertExpressionIntoWord(expression, variable.name);
    }
  }
}

// ─── Warning dialog ─────────────────────────────────────────────────

function showInsertWarningDialog(name, expression, warnings, rawSource) {
  const existing = document.getElementById('insert-warn-overlay');
  if (existing) existing.remove();

  const overlay = el('div', {
    id: 'insert-warn-overlay',
    style: {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.35)',
      zIndex: '9999', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    onclick: (e) => { if (e.target === overlay) overlay.remove(); },
  });

  const warningEls = warnings.map(w =>
    el('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '6px' } }, [
      el('span', { style: { color: w.color, flexShrink: '0', marginTop: '1px' }, html: icon(w.icon, 14) }),
      el('span', { style: { fontSize: '11.5px', color: 'var(--text-secondary)', lineHeight: '1.4' } }, w.text),
    ])
  );

  overlay.appendChild(
    el('div', {
      style: {
        background: 'var(--card, #fff)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '16px 18px', maxWidth: '380px', width: '90%',
        boxShadow: '0 8px 24px rgba(0,0,0,.18)',
      },
    }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' } }, [
        el('span', { style: { color: 'var(--tacton-blue, #0071c8)' }, html: icon('info', 18) }),
        el('div', { style: { fontWeight: '700', fontSize: '13px' } }, `Insert "${name}"?`),
      ]),
      ...warningEls,
      el('div', {
        style: {
          fontSize: '11px', color: 'var(--text-tertiary)', background: 'var(--bg)',
          border: '1px solid var(--border-light)', borderRadius: 'var(--radius)',
          padding: '8px 10px', marginTop: '8px', marginBottom: '12px',
          fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: '1.5',
        },
      }, expression),
      el('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: '6px', flexWrap: 'wrap' } }, [
        el('button', { class: 'btn btn-outline btn-sm', onclick: () => overlay.remove() }, 'Cancel'),
        // "Insert raw" — only shown for blocks, inserts the raw source without $for wrapper
        ...(rawSource ? [el('button', {
          class: 'btn btn-outline btn-sm',
          style: { color: 'var(--orange, #e67700)', borderColor: 'var(--orange, #e67700)' },
          onclick: () => { overlay.remove(); insertExpressionIntoWord(rawSource, name + ' (raw)'); },
        }, 'Insert raw')] : []),
        el('button', {
          class: 'btn btn-sm',
          style: { background: 'var(--tacton-blue, #0071c8)', color: '#fff', border: 'none' },
          onclick: () => { overlay.remove(); insertExpressionIntoWord(expression, name); },
        }, 'Insert anyway'),
      ]),
    ])
  );

  document.body.appendChild(overlay);
}

// ─── Block insert choice dialog ─────────────────────────────────────

/**
 * Show a dialog letting the user choose how to insert a block:
 *   $for{} loop  |  $if{} conditional  |  raw expression
 */
function showBlockInsertDialog(name, variants, valWarnings) {
  const existing = document.getElementById('insert-warn-overlay');
  if (existing) existing.remove();

  const overlay = el('div', {
    id: 'insert-warn-overlay',
    style: {
      position: 'fixed', inset: '0', background: 'rgba(0,0,0,.35)',
      zIndex: '9999', display: 'flex', alignItems: 'center', justifyContent: 'center',
    },
    onclick: (e) => { if (e.target === overlay) overlay.remove(); },
  });

  // Preview area — updates when hovering/selecting an option
  const previewEl = el('div', {
    style: {
      fontSize: '11px', color: 'var(--text-tertiary)', background: 'var(--bg)',
      border: '1px solid var(--border-light)', borderRadius: 'var(--radius)',
      padding: '8px 10px', marginBottom: '12px',
      fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: '1.5',
      whiteSpace: 'pre-wrap', minHeight: '40px',
    },
  }, variants.forExpr);

  const btnStyle = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px',
    flex: '1', padding: '10px 6px', border: '1px solid var(--border-light)',
    borderRadius: 'var(--radius)', cursor: 'pointer', background: 'var(--card, #fff)',
    fontSize: '12px', fontWeight: '600', textAlign: 'center',
    transition: 'border-color 0.15s, background 0.15s',
  };

  function makeChoiceBtn(label, sublabel, expr, color, cursorInside = false) {
    const btn = el('button', {
      type: 'button',
      style: { ...btnStyle },
      onmouseenter: () => { previewEl.textContent = expr; },
      onclick: () => { overlay.remove(); insertExpressionIntoWord(expr, `${name} (${label})`, { cursorInside }); },
    }, [
      el('span', { style: { color, fontSize: '13px' } }, label),
      el('span', { style: { fontSize: '10px', color: 'var(--text-tertiary)', fontWeight: '400' } }, sublabel),
    ]);
    return btn;
  }

  const choiceRow = el('div', { style: { display: 'flex', gap: '8px', marginBottom: '10px' } }, [
    makeChoiceBtn('$for{}$', 'Repeat rows', variants.forExpr, 'var(--tacton-blue, #0969DA)', true),
    makeChoiceBtn('$if{}$', 'Conditional', variants.ifExpr, 'var(--purple, #8250DF)', true),
    makeChoiceBtn('Raw', 'Expression only', variants.rawExpr, 'var(--orange, #e67700)'),
  ]);

  const warningEls = valWarnings.map(text =>
    el('div', { style: { display: 'flex', gap: '6px', alignItems: 'flex-start', marginBottom: '6px' } }, [
      el('span', { style: { color: 'var(--orange, #e67700)', flexShrink: '0', marginTop: '1px' }, html: icon('info', 14) }),
      el('span', { style: { fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.4' } }, text),
    ])
  );

  overlay.appendChild(
    el('div', {
      style: {
        background: 'var(--card, #fff)', border: '1px solid var(--border)',
        borderRadius: '8px', padding: '16px 18px', maxWidth: '400px', width: '90%',
        boxShadow: '0 8px 24px rgba(0,0,0,.18)',
      },
    }, [
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' } }, [
        el('span', { style: { color: 'var(--tacton-blue, #0071c8)' }, html: icon('info', 18) }),
        el('div', { style: { fontWeight: '700', fontSize: '13px' } }, `Insert "${name}"?`),
      ]),
      ...warningEls,
      choiceRow,
      previewEl,
      el('div', { style: { display: 'flex', justifyContent: 'flex-end' } }, [
        el('button', { class: 'btn btn-outline btn-sm', onclick: () => overlay.remove() }, 'Cancel'),
      ]),
    ])
  );

  document.body.appendChild(overlay);
}

// ─── Word API insert ────────────────────────────────────────────────

/**
 * Insert text into the Word document at the current cursor via Office JS.
 * Falls back gracefully in dev mode (no Office context).
 */
async function insertExpressionIntoWord(expression, name, opts = {}) {
  if (!window.Word) {
    showInsertFeedback(`Dev mode — would insert: ${expression}`, 'warning');
    return;
  }
  try {
    await Word.run(async (context) => {
      const sel = context.document.getSelection();

      if (opts.cursorInside) {
        // Insert block construct with cursor positioned between open/close tags.
        // Split on the placeholder newlines: "open\n  \nclose" → [open, close]
        const parts = expression.split('\n');
        const openTag = parts[0];                          // e.g. $for{#CP in source}$
        const closeTag = parts[parts.length - 1];          // e.g. $endfor$

        // Insert: openTag ¶ ¶ closeTag — three paragraphs
        sel.insertText(openTag, Word.InsertLocation.replace);
        const afterOpen = sel.getRange(Word.RangeLocation.after);
        afterOpen.insertParagraph('', Word.InsertLocation.after);
        const bodyPara = afterOpen.getRange(Word.RangeLocation.after);
        bodyPara.insertText('', Word.InsertLocation.after);
        const afterBody = bodyPara.getRange(Word.RangeLocation.after);
        afterBody.insertParagraph(closeTag, Word.InsertLocation.after);

        // Select the empty middle paragraph so the user can start typing
        bodyPara.select();
      } else {
        sel.insertText(expression, Word.InsertLocation.replace);
      }

      await context.sync();
    });
    showInsertFeedback(`Inserted "${name}" into document`, 'success');
  } catch (err) {
    console.error('[DocGen] Insert failed:', err);
    showInsertFeedback(`Insert failed: ${err.message || err}`, 'error');
  }
}

// ─── Last-change tracking (for undo/revert) ────────────────────────

let _lastChange = null;

/**
 * Record the last document change for potential undo.
 * @param {{ oldText: string, newText: string, variableName: string }} change
 */
function recordChange(change) {
  _lastChange = { ...change, timestamp: Date.now() };
}

/**
 * Get the last document change (if any, and if recent — within 5 minutes).
 * @returns {{ oldText: string, newText: string, variableName: string, timestamp: number }|null}
 */
export function getLastDocumentChange() {
  if (!_lastChange) return null;
  // Expire after 5 minutes
  if (Date.now() - _lastChange.timestamp > 5 * 60 * 1000) { _lastChange = null; return null; }
  return _lastChange;
}

/**
 * Revert the last document change — find the new text in the document and replace with old.
 * @returns {Promise<boolean>}
 */
export async function revertLastDocumentChange() {
  if (!_lastChange || !window.Word) return false;
  const { oldText, newText } = _lastChange;
  try {
    let ok = false;
    await Word.run(async (context) => {
      const results = context.document.body.search(newText, { matchCase: true, matchWholeWord: false });
      results.load('items');
      await context.sync();
      if (results.items.length === 1) {
        results.items[0].insertText(oldText, Word.InsertLocation.replace);
        results.items[0].select();
        await context.sync();
        ok = true;
      }
    });
    if (ok) _lastChange = null;
    return ok;
  } catch (err) {
    console.error('[DocGen] revertLastDocumentChange failed:', err);
    return false;
  }
}

/**
 * Insert expression at the current cursor position in Word.
 * For the "insert on create" flow.
 * @param {string} expression — the expression text to insert
 * @param {string} name — variable name for feedback
 * @returns {Promise<boolean>}
 */
export async function insertTextAtCursor(expression, name) {
  if (!window.Word) {
    showInsertFeedback(`Dev mode — would insert: ${expression}`, 'warning');
    return false;
  }
  try {
    await Word.run(async (context) => {
      const sel = context.document.getSelection();
      sel.insertText(expression, Word.InsertLocation.replace);
      await context.sync();
    });
    showInsertFeedback(`Inserted "${name}" into document`, 'success');
    return true;
  } catch (err) {
    console.error('[DocGen] insertTextAtCursor failed:', err);
    showInsertFeedback(`Insert failed: ${err.message || err}`, 'error');
    return false;
  }
}

/**
 * Batch check: scan the document for all given expressions.
 * Each variable should include a `docExpr` field — the primary document-facing expression
 * (e.g. `$for{#name in source}$` for blocks, `$define{#name=expr}$` for variables).
 *
 * Returns a map of { [variableId]: 'found' | 'not_found' | 'multiple' }.
 * @param {Array<{ id: string|number, expression: string, docExpr: string }>} variables
 * @returns {Promise<Object>}
 */
export async function batchSyncCheck(variables) {
  const result = {};
  if (!window.Word) {
    variables.forEach(v => { result[v.id] = 'no_word'; });
    return result;
  }
  try {
    await Word.run(async (context) => {
      // Prepare searches — use docExpr (document-facing) if available, fallback to expression
      const searches = variables
        .filter(v => v.docExpr || v.expression)
        .map(v => {
          const searchText = v.docExpr || v.expression;
          const sr = context.document.body.search(searchText, { matchCase: true, matchWholeWord: false });
          sr.load('items');
          return { id: v.id, searchResult: sr };
        });

      await context.sync();

      for (const s of searches) {
        const count = s.searchResult.items.length;
        result[s.id] = count === 0 ? 'not_found' : count === 1 ? 'found' : 'multiple';
      }
    });

    // Mark variables without expressions
    variables.forEach(v => {
      if (!(v.id in result)) result[v.id] = (v.docExpr || v.expression) ? 'not_found' : 'no_expression';
    });

    return result;
  } catch (err) {
    console.error('[DocGen] batchSyncCheck failed:', err);
    variables.forEach(v => { result[v.id] = 'error'; });
    return result;
  }
}

// ─── Word document helpers (read / search / replace) ───────────────

/**
 * Get the currently selected text in Word.
 * Returns the trimmed text string, or null if nothing selected / dev mode.
 */
export async function getSelectedText() {
  if (!window.Word) return null;
  try {
    let text = null;
    await Word.run(async (context) => {
      const sel = context.document.getSelection();
      sel.load('text');
      await context.sync();
      text = (sel.text || '').trim();
    });
    return text || null;
  } catch {
    return null;
  }
}

/**
 * Search the entire Word document body for an exact text string.
 * Returns an array of { index, contextBefore, contextAfter } for each match.
 * `index` is a 0-based position within results (used to pick one later).
 */
export async function searchDocument(searchText) {
  if (!window.Word) return [];
  try {
    const results = [];
    await Word.run(async (context) => {
      const body = context.document.body;
      const ranges = body.search(searchText, { matchCase: true, matchWholeWord: false });
      ranges.load('text');
      context.load(ranges, 'items');
      await context.sync();

      for (let i = 0; i < ranges.items.length; i++) {
        const r = ranges.items[i];
        // Try to get surrounding context for display
        let contextBefore = '', contextAfter = '';
        try {
          const para = r.paragraphs.getFirst();
          para.load('text');
          await context.sync();
          const full = para.text || '';
          const idx = full.indexOf(searchText);
          if (idx >= 0) {
            contextBefore = full.substring(Math.max(0, idx - 30), idx);
            contextAfter = full.substring(idx + searchText.length, idx + searchText.length + 30);
          }
        } catch { /* context extraction optional */ }
        results.push({ index: i, text: r.text, contextBefore, contextAfter });
      }
    });
    return results;
  } catch (err) {
    console.error('[DocGen] searchDocument failed:', err);
    return [];
  }
}

/**
 * Select a specific search result in Word (by searching again and selecting the Nth match).
 */
export async function selectSearchResult(searchText, matchIndex) {
  if (!window.Word) return false;
  try {
    await Word.run(async (context) => {
      const ranges = context.document.body.search(searchText, { matchCase: true });
      context.load(ranges, 'items');
      await context.sync();
      if (matchIndex < ranges.items.length) {
        ranges.items[matchIndex].select();
        await context.sync();
      }
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Replace the currently selected text in Word with new text.
 * Optionally records the change for undo if oldText and variableName are provided.
 * @param {string} newText
 * @param {string} [oldText] — original text (for undo tracking)
 * @param {string} [variableName] — variable name (for undo tracking)
 * @returns {Promise<boolean>}
 */
export async function replaceSelectedText(newText, oldText, variableName) {
  if (!window.Word) return false;
  try {
    await Word.run(async (context) => {
      const sel = context.document.getSelection();
      sel.insertText(newText, Word.InsertLocation.replace);
      await context.sync();
    });
    // Track for undo
    if (oldText) recordChange({ oldText, newText, variableName: variableName || '' });
    return true;
  } catch (err) {
    console.error('[DocGen] replaceSelectedText failed:', err);
    return false;
  }
}

/**
 * Full expression update flow:
 *   1. If the same old expression is still selected → confirm → replace
 *   2. Otherwise search document for old expression (tries multiple patterns for blocks)
 *   3. If one match → select it → confirm → replace
 *   4. If multiple matches → return them for picker UI
 *   5. If zero matches → return empty (not in document)
 *
 * @param {string|string[]} oldExpression — single expression or array of search candidates (most likely first)
 * @param {string} newExpression — the new expression to replace with
 * @returns result object with status and optional matches/matchedPattern
 */
export async function checkExpressionInDocument(oldExpression, newExpression) {
  // Normalize to array
  const oldCandidates = Array.isArray(oldExpression) ? oldExpression : [oldExpression];
  const primaryOld = oldCandidates[0] || '';

  // No change → nothing to do (compare primary candidate)
  if (primaryOld === newExpression) return { status: 'unchanged' };

  // Dev mode → skip document interaction
  if (!window.Word) return { status: 'no_word' };

  // Step 1: Check current selection against all candidates
  const selected = await getSelectedText();
  if (selected) {
    for (const candidate of oldCandidates) {
      if (selected === candidate) {
        return { status: 'selected', matchedPattern: candidate };
      }
    }
  }

  // Step 2: Search document — try each candidate until we find matches
  for (const candidate of oldCandidates) {
    if (!candidate) continue;
    const matches = await searchDocument(candidate);
    if (matches.length === 0) continue;

    // Found matches with this candidate
    if (matches.length === 1) {
      await selectSearchResult(candidate, 0);
      return { status: 'found_one', matches, matchedPattern: candidate };
    }
    return { status: 'found_many', matches, matchedPattern: candidate };
  }

  return { status: 'not_found' };
}

// ─── Toast feedback ─────────────────────────────────────────────────

function showInsertFeedback(message, type) {
  const existing = document.getElementById('insert-toast');
  if (existing) existing.remove();

  const colors = {
    success: { bg: '#e8f5e9', border: '#43a047', text: '#2e7d32', ico: 'check' },
    warning: { bg: '#fff8e1', border: '#f9a825', text: '#e67700', ico: 'info' },
    error:   { bg: '#ffeaea', border: '#CF222E', text: '#CF222E', ico: 'info' },
  };
  const c = colors[type] || colors.success;

  const toast = el('div', {
    id: 'insert-toast',
    style: {
      position: 'fixed', bottom: '16px', left: '50%', transform: 'translateX(-50%)',
      background: c.bg, border: `1px solid ${c.border}`, borderRadius: '6px',
      padding: '8px 14px', fontSize: '11.5px', color: c.text,
      boxShadow: '0 4px 12px rgba(0,0,0,.12)', zIndex: '9999',
      display: 'flex', alignItems: 'center', gap: '6px',
      animation: 'fadeIn .15s ease',
    },
  }, [
    el('span', { html: icon(c.ico, 14) }),
    el('span', {}, message),
  ]);

  document.body.appendChild(toast);
  setTimeout(() => { if (toast.parentNode) toast.remove(); }, 3000);
}

// ─── Selection monitoring ───────────────────────────────────────────

let selectionInterval = null;
let lastSelectionText = '';

/**
 * Start listening for selection changes in the Word document.
 * Polls every 500ms (Office JS doesn't have a native selection event).
 * When a selection is detected that parses as a known expression,
 * it's published on the state bus as `word.selection`.
 */
export function startSelectionListener() {
  if (selectionInterval) return; // already running

  if (!window.Word) {
    console.log('[DocGen] Word API not available — selection listener disabled');
    return;
  }

  selectionInterval = setInterval(async () => {
    try {
      await Word.run(async (context) => {
        const sel = context.document.getSelection();
        sel.load('text');
        await context.sync();

        const text = (sel.text || '').trim();

        // Only act when the selection meaningfully changed
        if (text === lastSelectionText) return;
        lastSelectionText = text;

        if (!text) {
          state.set('word.selection', null);
          return;
        }

        // Check for multiple expressions first (defines, inline ${}, $for{})
        const multiDefines = parseMultipleExpressions(text) || parseMultipleDefines(text);
        if (multiDefines) {
          state.set('word.selection', { text, multiDefines, parsed: null });
          return;
        }

        const parsed = parseExpression(text);
        state.set('word.selection', parsed ? { text, parsed } : null);
      });
    } catch (err) {
      // Silently ignore — Word might be busy or context lost
    }
  }, 500);
}

/**
 * Stop the selection listener.
 */
export function stopSelectionListener() {
  if (selectionInterval) {
    clearInterval(selectionInterval);
    selectionInterval = null;
  }
  lastSelectionText = '';
}

/**
 * Dev helper: simulate a Word selection for testing without Office.
 * Usage from console: window.__devSelectExpression('$define{#name=expr}$')
 */
if (!window.Word) {
  window.__devSelectExpression = (text) => {
    const multiDefines = parseMultipleExpressions(text) || parseMultipleDefines(text);
    if (multiDefines) {
      state.set('word.selection', { text, multiDefines, parsed: null });
      console.log('[DocGen dev] Simulated multi-expression selection:', multiDefines);
      return;
    }
    const parsed = parseExpression(text);
    state.set('word.selection', parsed ? { text, parsed } : null);
    console.log('[DocGen dev] Simulated selection:', parsed);
  };
}
