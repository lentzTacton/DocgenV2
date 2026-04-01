/**
 * Wizard Code Section — rich code-expression editor with inline #variable chips,
 * live resolution, and arithmetic computation.
 *
 * Extracted from variable-wizard.js for maintainability.
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';
import state from '../../core/state.js';
import { isConnected } from '../../services/data-api.js';
import { wizState } from './wizard-state.js';

// ── Callback to parent wizard's refreshPipeline ──
let _refreshPipeline = () => {};
export function setCodeRefreshPipelineCallback(fn) { _refreshPipeline = fn; }

// ═════════════════════════════════════════════════════════════════════
//  MAIN ENTRY
// ═════════════════════════════════════════════════════════════════════

export function renderCodeSection(container) {
  if (!container) return;
  clear(container);

  const ctx = _buildCodeContext();
  const { editor, toolbar, resultContainer, resolveBtn, refsContainer } = _buildCodeUI(ctx);

  container.appendChild(el('div', { class: 'form-group' }, [
    toolbar,
    editor,
    el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' } }, [
      el('div', { style: { fontSize: '10px', color: 'var(--text-tertiary)' } },
        'Type freely or insert defines. Supports arithmetic.'),
      resolveBtn,
    ]),
    resultContainer,
  ]));

  container.appendChild(refsContainer);

  // Auto-resolve if in edit mode and connected
  if (wizState.isEditMode && isConnected() && Object.keys(ctx.resolvedValues).length === 0) {
    ctx.resolveAllDeps();
  }
}

// ═════════════════════════════════════════════════════════════════════
//  CONTEXT BUILDER
// ═════════════════════════════════════════════════════════════════════

function _buildCodeContext() {
  const allVars = state.get('variables') || [];
  const insertableVars = allVars.filter(v => v.name && v.name !== wizState.name && v.purpose === 'variable');
  const valResults = state.get('validationResults') || {};
  let resolvedValues = wizState._codeResolvedValues || {};
  let showValues = wizState._codeShowValues || false;

  function getRefStatus(refName) {
    const refVar = allVars.find(v => v.name === refName);
    if (!refVar) return { status: 'missing', tooltip: `"${refName}" does not exist`, cls: 'wiz-code-chip-missing' };
    if (resolvedValues[refName] !== undefined) {
      return { status: 'resolved', tooltip: `${refName} = ${resolvedValues[refName]}`, cls: '' };
    }
    const result = valResults[refVar.id];
    if (!result || result.status === 'unchecked') {
      return { status: 'unchecked', tooltip: `${refName}: not yet resolved`, cls: '' };
    }
    if (result.status === 'error') {
      return { status: 'error', tooltip: `${refName}: ${result.issues.map(i => i.message).join('; ')}`, cls: 'wiz-code-chip-error' };
    }
    if (result.status === 'warning') {
      return { status: 'warning', tooltip: `${refName}: ${result.issues.map(i => i.message).join('; ')}`, cls: 'wiz-code-chip-warn' };
    }
    return { status: 'valid', tooltip: `${refName}: valid`, cls: 'wiz-code-chip-valid' };
  }

  function sourceToHTML(src) {
    if (!src) return '<span class="wiz-code-placeholder">e.g. (#totalWeight-0)-(#pumpWeight-0)</span>';
    return src.replace(/#\w+/g, (match) => {
      const ref = getRefStatus(match);
      const tip = ref.tooltip.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      let valueLabel = '';
      if (showValues && resolvedValues[match] !== undefined) {
        const v = resolvedValues[match];
        valueLabel = `<span style="margin-left:3px;opacity:0.7;font-weight:400">= ${v}</span>`;
      }
      return `<span class="wiz-code-chip ${ref.cls}" contenteditable="false" data-define="${match}" data-tip="${tip}">${match}${valueLabel}</span>`;
    });
  }

  return {
    allVars,
    insertableVars,
    valResults,
    get resolvedValues() { return resolvedValues; },
    set resolvedValues(v) { resolvedValues = v; },
    get showValues() { return showValues; },
    set showValues(v) { showValues = v; },
    getRefStatus,
    sourceToHTML,
    resolveAllDeps: null,
  };
}

// ═════════════════════════════════════════════════════════════════════
//  UI BUILDER
// ═════════════════════════════════════════════════════════════════════

function _buildCodeUI(ctx) {
  // ── Toolbar ──
  const defineSelect = el('select', { class: 'wiz-code-insert-select' });
  defineSelect.appendChild(el('option', { value: '' }, '+ Insert define…'));
  ctx.insertableVars.forEach(v => {
    defineSelect.appendChild(el('option', { value: v.name }, `${v.name}  (${v.type})`));
  });

  const valuesToggle = el('label', { class: 'wiz-code-values-toggle' }, [
    el('input', {
      type: 'checkbox',
      checked: ctx.showValues,
      onchange: (e) => {
        ctx.showValues = e.target.checked;
        wizState._codeShowValues = ctx.showValues;
        if (ctx.showValues && Object.keys(ctx.resolvedValues).length === 0) {
          ctx.resolveAllDeps();
        } else {
          refreshEditorContent();
          renderCodeRefs(refsContainer, ctx.resolvedValues);
        }
      },
    }),
    'Values',
  ]);

  const toolbar = el('div', { class: 'wiz-code-toolbar' }, [
    el('div', { class: 'form-label', style: { margin: 0 } }, [
      el('span', { class: 'icon', style: { color: 'var(--text-tertiary)' }, html: icon('code', 12) }),
      'Expression',
    ]),
    el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, [
      valuesToggle,
      defineSelect,
    ]),
  ]);

  // ── Editable surface ──
  const editor = el('div', {
    class: 'wiz-code-editor',
    contentEditable: 'true',
    spellcheck: 'false',
  });

  function refreshEditorContent() {
    editor.innerHTML = ctx.sourceToHTML(wizState.source || '');
  }

  function editorToSource() {
    let text = '';
    for (const node of editor.childNodes) {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent;
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.dataset && node.dataset.define) {
          text += node.dataset.define;
        } else if (node.classList && node.classList.contains('wiz-code-placeholder')) {
          // Skip placeholder
        } else {
          text += node.textContent;
        }
      }
    }
    return text;
  }

  // Set initial content
  editor.innerHTML = ctx.sourceToHTML(wizState.source || '');

  // ── Floating tooltip for chips ──
  let chipTip = null;
  editor.addEventListener('mouseover', (e) => {
    const chip = e.target.closest('.wiz-code-chip[data-tip]');
    if (!chip) return;
    if (chipTip) chipTip.remove();
    chipTip = el('div', { class: 'wiz-chip-tooltip' }, chip.dataset.tip);
    document.body.appendChild(chipTip);
    const rect = chip.getBoundingClientRect();
    chipTip.style.left = `${rect.left}px`;
    chipTip.style.top = `${rect.top - chipTip.offsetHeight - 6}px`;
    if (rect.top - chipTip.offsetHeight - 6 < 4) {
      chipTip.style.top = `${rect.bottom + 6}px`;
    }
  });
  editor.addEventListener('mouseout', (e) => {
    const chip = e.target.closest('.wiz-code-chip');
    if (chip && chipTip) { chipTip.remove(); chipTip = null; }
  });

  // Sync on input
  const resultContainer = el('div', { id: 'wiz-code-result' });
  const refsContainer = el('div', { class: 'wiz-code-refs' });

  editor.addEventListener('input', () => {
    wizState.source = editorToSource();
    _refreshPipeline();
    renderCodeRefs(refsContainer, ctx.resolvedValues);
    clear(resultContainer);
  });

  // Prevent Enter from creating divs
  editor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.execCommand('insertText', false, '\n');
    }
  });

  // Focus handler — clear placeholder
  editor.addEventListener('focus', () => {
    const ph = editor.querySelector('.wiz-code-placeholder');
    if (ph) { editor.innerHTML = ''; }
  });

  // Blur handler — show placeholder if empty
  editor.addEventListener('blur', () => {
    if (!editorToSource().trim()) {
      editor.innerHTML = ctx.sourceToHTML('');
    }
  });

  // Insert define from dropdown
  defineSelect.addEventListener('change', () => {
    const val = defineSelect.value;
    if (!val) return;
    defineSelect.value = '';

    const ph = editor.querySelector('.wiz-code-placeholder');
    if (ph) editor.innerHTML = '';

    const ref = ctx.getRefStatus(val);
    let valueLabel = '';
    if (ctx.showValues && ctx.resolvedValues[val] !== undefined) {
      valueLabel = `<span style="margin-left:3px;opacity:0.7;font-weight:400">= ${ctx.resolvedValues[val]}</span>`;
    }
    const chip = el('span', {
      class: `wiz-code-chip ${ref.cls}`,
      contentEditable: 'false',
      'data-define': val,
      'data-tip': ref.tooltip,
    });
    chip.innerHTML = `${val}${valueLabel}`;

    const sel = window.getSelection();
    if (sel.rangeCount > 0 && editor.contains(sel.anchorNode)) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(chip);
      range.setStartAfter(chip);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      editor.appendChild(chip);
    }

    wizState.source = editorToSource();
    _refreshPipeline();
    renderCodeRefs(refsContainer, ctx.resolvedValues);
    editor.focus();
  });

  // ── Resolve button + logic ──
  const resolveBtn = el('button', {
    class: 'wiz-code-resolve-btn',
    onclick: () => ctx.resolveAllDeps(),
  }, [
    el('span', { class: 'icon', html: icon('play', 12) }),
    'Calculate',
  ]);

  async function resolveAllDeps() {
    const source = wizState.source || '';
    const refs = [...new Set((source.match(/#\w+/g) || []))];
    if (refs.length === 0) return;

    resolveBtn.disabled = true;
    resolveBtn.innerHTML = '';
    resolveBtn.appendChild(el('span', { class: 'icon', html: icon('loader', 12) }));
    resolveBtn.appendChild(document.createTextNode('Resolving…'));

    const newValues = {};
    let allResolved = true;

    for (const refName of refs) {
      const refVar = ctx.allVars.find(v => v.name === refName);
      if (!refVar) { allResolved = false; continue; }

      const refSource = refVar.source || '';
      if (refSource.includes('getConfigurationAttribute(')) {
        const pm = refSource.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
        if (pm) {
          try {
            const { resolveConfigAttrAcrossCPs } = await import('../../services/config-resolver.js');
            const r = await resolveConfigAttrAcrossCPs(pm[1]);
            const val = r.find(x => x.value && x.value !== '(error)');
            if (val) {
              newValues[refName] = val.value;
            } else {
              allResolved = false;
            }
          } catch {
            allResolved = false;
          }
        }
      }
    }

    ctx.resolvedValues = newValues;
    wizState._codeResolvedValues = newValues;

    ctx.showValues = true;
    wizState._codeShowValues = true;
    const cb = valuesToggle.querySelector('input');
    if (cb) cb.checked = true;

    refreshEditorContent();
    renderCodeRefs(refsContainer, ctx.resolvedValues);

    // Compute the final arithmetic result
    _computeArithmeticResult(resultContainer, source, newValues, allResolved, refs);

    resolveBtn.disabled = false;
    resolveBtn.innerHTML = '';
    resolveBtn.appendChild(el('span', { class: 'icon', html: icon('play', 12) }));
    resolveBtn.appendChild(document.createTextNode('Calculate'));
  }

  ctx.resolveAllDeps = resolveAllDeps;
  renderCodeRefs(refsContainer, ctx.resolvedValues);

  return { editor, toolbar, resultContainer, resolveBtn, refsContainer };
}

// ═════════════════════════════════════════════════════════════════════
//  ARITHMETIC RESULT
// ═════════════════════════════════════════════════════════════════════

function _computeArithmeticResult(resultContainer, source, newValues, allResolved, refs) {
  clear(resultContainer);
  if (allResolved && Object.keys(newValues).length > 0) {
    try {
      let expr = source;
      for (const [name, val] of Object.entries(newValues)) {
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
          expr = expr.split(name).join(String(numVal));
        }
      }
      if (/^[\d.+\-*/() \t]+$/.test(expr)) {
        let computed = Function('"use strict"; return (' + expr + ')')();
        if (typeof computed === 'number') {
          computed = Math.round(computed * 100) / 100;
        }
        resultContainer.appendChild(el('div', { class: 'wiz-code-result wiz-code-result-ok' }, [
          el('span', { class: 'icon', html: icon('check', 14) }),
          `Result: ${computed}`,
        ]));
      } else {
        resultContainer.appendChild(el('div', { class: 'wiz-code-result wiz-code-result-err' }, [
          el('span', { class: 'icon', html: icon('alert-circle', 14) }),
          `Expression: ${expr}`,
        ]));
      }
    } catch (e) {
      resultContainer.appendChild(el('div', { class: 'wiz-code-result wiz-code-result-err' }, [
        el('span', { class: 'icon', html: icon('alert-circle', 14) }),
        `Eval error: ${e.message}`,
      ]));
    }
  } else if (!allResolved) {
    const missing = refs.filter(r => newValues[r] === undefined);
    resultContainer.appendChild(el('div', { class: 'wiz-code-result wiz-code-result-err' }, [
      el('span', { class: 'icon', html: icon('alert-circle', 14) }),
      `Cannot compute — unresolved: ${missing.join(', ')}`,
    ]));
  }
}

// ═════════════════════════════════════════════════════════════════════
//  REFERENCED DEFINES LIST
// ═════════════════════════════════════════════════════════════════════

export function renderCodeRefs(container, resolvedValues) {
  if (!container) return;
  clear(container);

  const source = wizState.source || '';
  const refs = [...new Set((source.match(/#\w+/g) || []))];
  if (refs.length === 0) return;

  const allVars = state.get('variables') || [];
  const valResults = state.get('validationResults') || {};
  const resolved = resolvedValues || {};

  container.appendChild(el('div', { class: 'form-label', style: { marginTop: '8px' } }, [
    el('span', { class: 'icon', html: icon('link', 12) }),
    `Referenced defines (${refs.length})`,
  ]));

  const statusIcons = { valid: 'check', unchecked: 'check', warning: 'alertTriangle', error: 'info', missing: 'alertTriangle' };
  const statusColors = {
    valid: 'var(--success, #1A7F37)',
    unchecked: 'var(--text-tertiary, #8b949e)',
    warning: 'var(--warning, #D4A015)',
    error: 'var(--danger, #CF222E)',
    missing: 'var(--danger, #CF222E)',
  };

  const list = el('div', { class: 'wiz-code-ref-list' });
  refs.forEach(refName => {
    const refVar = allVars.find(v => v.name === refName);
    let status, detail;
    if (!refVar) {
      status = 'missing';
      detail = 'not found';
    } else {
      const result = valResults[refVar.id];
      if (!result) {
        status = 'unchecked';
        detail = 'not verified';
      } else {
        status = result.status;
        detail = result.issues.length > 0
          ? result.issues.map(i => i.message).join('; ')
          : result.status === 'valid' ? 'verified' : 'not verified';
      }
    }

    const hasValue = resolved[refName] !== undefined;

    list.appendChild(el('div', {
      class: `wiz-code-ref-item`,
      style: { color: statusColors[status] },
      'data-tip': detail,
    }, [
      el('span', { class: 'icon', html: icon(statusIcons[status], 11) }),
      el('code', {}, refName),
      hasValue
        ? el('span', { style: { marginLeft: 'auto', fontFamily: 'var(--mono, monospace)', fontWeight: '600', color: 'var(--success, #1A7F37)' } }, resolved[refName])
        : (status !== 'valid' && status !== 'unchecked'
          ? el('span', { class: 'wiz-code-ref-warn', style: { color: statusColors[status] } }, detail)
          : null),
    ]));
  });
  container.appendChild(list);
}
