/**
 * Word API Service — handles inserting template expressions into the
 * active Word document via Office JS, with validation warning dialogs,
 * toast feedback, and document selection monitoring.
 */

import { el } from '../core/dom.js';
import { icon } from '../components/icon.js';
import state from '../core/state.js';
import { parseExpression, parseMultipleDefines } from './expression-parser.js';

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
  if (variable.purpose === 'block') {
    // Block expression is the raw source (no wrapper).
    // Insert directly into a $for loop.
    const source = variable.expression || variable.source || '';
    return `$for{#item in ${source}}$\n  \n$endfor$`;
  }

  // Variable: expression is already the full $define{…}$
  return variable.expression || '';
}

/**
 * Build combined text for all variables in a section, ready for Word insertion.
 * Variables are joined with newlines in their original order.
 */
export function buildSectionExpression(variables) {
  return variables.map(v => buildInsertExpression(v)).join('\n');
}

/**
 * Insert an entire section's variables into Word.
 */
export function handleInsertSectionIntoDoc(sectionName, variables) {
  if (!variables || variables.length === 0) {
    showInsertFeedback('Section has no data sets to insert', 'warning');
    return;
  }
  const expression = buildSectionExpression(variables);
  const warnings = [{
    icon: 'info',
    color: 'var(--tacton-blue, #0969DA)',
    text: `This will insert ${variables.length} data set${variables.length > 1 ? 's' : ''} from section "${sectionName}" at the cursor position.`,
  }];
  showInsertWarningDialog(sectionName, expression, warnings, null);
}

// ─── Insert handler (entry point) ───────────────────────────────────

/**
 * Main handler called when the user clicks the insert button on a data set card.
 * Checks for warnings and either inserts directly or shows a confirmation dialog.
 */
export function handleInsertIntoDoc(variable, valResult) {
  const isBlock  = variable.purpose === 'block';
  const hasErrors   = valResult && valResult.status === 'error';
  const hasWarnings = valResult && valResult.status === 'warning';
  const issues = (valResult && valResult.issues) || [];

  const expression = buildInsertExpression(variable);

  // Collect warnings
  const warnings = [];

  if (isBlock) {
    warnings.push({
      icon: 'info',
      color: 'var(--orange, #e67700)',
      text: 'This is a data block — it will insert a $for loop template. Make sure the cursor is positioned where the repeating section should start.',
    });
  }

  if (hasErrors) {
    warnings.push({
      icon: 'info',
      color: 'var(--danger, #CF222E)',
      text: `Validation errors: ${issues.map(i => i.message || i).join('; ')}`,
    });
  } else if (hasWarnings) {
    warnings.push({
      icon: 'info',
      color: 'var(--orange, #e67700)',
      text: `Validation warnings: ${issues.map(i => i.message || i).join('; ')}`,
    });
  }

  // Raw source for blocks (without $for wrapper) — used by "Insert raw" option
  const rawSource = isBlock ? (variable.expression || variable.source || '') : null;

  if (warnings.length > 0) {
    showInsertWarningDialog(variable.name, expression, warnings, rawSource);
  } else {
    insertExpressionIntoWord(expression, variable.name);
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

// ─── Word API insert ────────────────────────────────────────────────

/**
 * Insert text into the Word document at the current cursor via Office JS.
 * Falls back gracefully in dev mode (no Office context).
 */
async function insertExpressionIntoWord(expression, name) {
  if (!window.Word) {
    showInsertFeedback(`Dev mode — would insert: ${expression}`, 'warning');
    return;
  }
  try {
    await Word.run(async (context) => {
      const range = context.document.getSelection();
      range.insertText(expression, Word.InsertLocation.replace);
      await context.sync();
    });
    showInsertFeedback(`Inserted "${name}" into document`, 'success');
  } catch (err) {
    console.error('[DocGen] Insert failed:', err);
    showInsertFeedback(`Insert failed: ${err.message || err}`, 'error');
  }
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

        // Check for multiple defines first (e.g. two-define null-safe pattern)
        const multiDefines = parseMultipleDefines(text);
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
    const multiDefines = parseMultipleDefines(text);
    if (multiDefines) {
      state.set('word.selection', { text, multiDefines, parsed: null });
      console.log('[DocGen dev] Simulated multi-define selection:', multiDefines);
      return;
    }
    const parsed = parseExpression(text);
    state.set('word.selection', parsed ? { text, parsed } : null);
    console.log('[DocGen dev] Simulated selection:', parsed);
  };
}
