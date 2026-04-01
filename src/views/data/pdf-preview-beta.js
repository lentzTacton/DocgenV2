/**
 * Data Preview (BETA) — Resolves all variables in a catalogue and shows
 * a summary panel with name → resolved value for each define.
 *
 * Isolated module: only entry point is generateCataloguePdf(catalogue, variables).
 * Uses the existing resolveConfigAttrAcrossCPs() for config attribute lookups.
 *
 * Renders inside the task pane as an overlay (Office Add-in can't open blob URLs).
 */

import { resolveConfigAttrAcrossCPs } from '../../services/config-resolver.js';
import state from '../../core/state.js';

// ─── Public Entry Point ───────────────────────────────────────────

/**
 * Resolve all variables in a catalogue and show a preview panel.
 * @param {object} catalogue — { id, name, scope, ... }
 * @param {Array}  variables — array of variable objects from state
 */
export async function generateCataloguePdf(catalogue, variables) {
  const overlay = showProgress(`Resolving ${variables.length} variables...`);

  try {
    // 1. Resolve all variables
    const resolved = await resolveAllVariables(variables, (i) => {
      updateProgress(overlay, `Resolving ${i + 1} / ${variables.length}...`);
    });

    // 2. Show results in an overlay panel
    hideProgress(overlay);
    showResultsPanel(catalogue, resolved);

  } catch (err) {
    console.error('[pdf-preview-beta] Error:', err);
    hideProgress(overlay);
    showErrorPanel(err.message);
  }
}

// ─── Variable Resolution ──────────────────────────────────────────

async function resolveAllVariables(variables, onProgress) {
  const allVars = state.get('variables') || [];
  const results = [];

  for (let i = 0; i < variables.length; i++) {
    const v = variables[i];
    if (onProgress) onProgress(i);

    const entry = {
      name: v.name || '(unnamed)',
      expression: v.expression || '',
      source: v.source || '',
      type: v.type || 'single',
      purpose: v.purpose || 'variable',
      value: null,
      status: 'pending',
    };

    try {
      const source = v.source || '';

      // Config attribute — resolve via Solution API
      if (source.includes('getConfigurationAttribute(')) {
        const pm = source.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
        if (pm) {
          const r = await resolveConfigAttrAcrossCPs(pm[1]);
          const val = r.find(x => x.value && x.value !== '(error)');
          entry.value = val?.value || null;
          entry.status = val ? 'resolved' : 'no value';
        }
      }

      // Code expression — try to evaluate arithmetic with #var refs
      else if (/#\w+/.test(source) && /[+\-*/]/.test(source)) {
        const varRefs = [...new Set(source.match(/#\w+/g) || [])];
        let expr = source;
        let allFound = true;

        for (const ref of varRefs) {
          // Look up the referenced variable's resolved value from results so far
          const resolved = results.find(r => r.name === ref);
          if (resolved?.value != null) {
            const numVal = parseFloat(resolved.value);
            if (!isNaN(numVal)) {
              expr = expr.split(ref).join(String(numVal));
              continue;
            }
          }
          // Try resolving the ref from the full variable list
          const refVar = allVars.find(vv => vv.name === ref);
          if (refVar?.source?.includes('getConfigurationAttribute(')) {
            const pm = refVar.source.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
            if (pm) {
              const r = await resolveConfigAttrAcrossCPs(pm[1]);
              const val = r.find(x => x.value && x.value !== '(error)');
              if (val?.value) {
                expr = expr.split(ref).join(String(parseFloat(val.value)));
                continue;
              }
            }
          }
          allFound = false;
        }

        if (allFound && /^[\d.+\-*/() \t]+$/.test(expr)) {
          try {
            const computed = Function('"use strict"; return (' + expr + ')')();
            entry.value = typeof computed === 'number' ? String(Math.round(computed * 100) / 100) : String(computed);
            entry.status = 'computed';
          } catch { entry.status = 'eval error'; }
        } else {
          entry.status = allFound ? 'non-numeric' : 'unresolved deps';
        }
      }

      // Linked / ternary — resolve the underlying config ref
      else if (/#\w+/.test(source)) {
        const varRefs = [...new Set(source.match(/#\w+/g) || [])];
        const refVar = allVars.find(vv => vv.name === varRefs[0]);
        if (refVar?.source?.includes('getConfigurationAttribute(')) {
          const pm = refVar.source.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
          if (pm) {
            const r = await resolveConfigAttrAcrossCPs(pm[1]);
            const val = r.find(x => x.value && x.value !== '(error)');
            entry.value = val?.value || null;
            entry.status = val ? 'resolved (linked)' : 'no value';
          }
        } else {
          entry.status = 'linked';
        }
      }

      // Static / literal value
      else if (source && !source.includes('.') && !source.includes('(')) {
        entry.value = source;
        entry.status = 'static';
      }

    } catch (err) {
      entry.status = 'error';
      entry.value = err.message;
    }

    results.push(entry);
  }

  return results;
}

// ─── Results Panel (in-pane overlay) ──────────────────────────────

function showResultsPanel(catalogue, resolved) {
  removeExisting();

  const resolvedCount = resolved.filter(r => r.value).length;
  const unresolvedCount = resolved.length - resolvedCount;

  const panel = document.createElement('div');
  panel.id = 'pdf-beta-panel';
  panel.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: var(--bg-primary, #fff); z-index: 9999;
    display: flex; flex-direction: column; overflow: hidden;
  `;

  // Header
  const header = document.createElement('div');
  header.style.cssText = `
    padding: 12px 16px; border-bottom: 1px solid var(--border, #e0e0e0);
    display: flex; align-items: center; gap: 8px; flex-shrink: 0;
  `;
  header.innerHTML = `
    <div style="flex:1;min-width:0">
      <div style="font-weight:600;font-size:14px;">${esc(catalogue.name)}
        <span style="background:#ff9800;color:#fff;font-size:9px;font-weight:700;padding:1px 5px;border-radius:3px;margin-left:6px;vertical-align:middle;">BETA</span>
      </div>
      <div style="font-size:11px;color:var(--text-tertiary,#999);margin-top:2px;">
        <strong style="color:var(--success,#4caf50)">${resolvedCount}</strong> resolved &middot;
        <strong style="color:var(--danger,#f44336)">${unresolvedCount}</strong> unresolved &middot;
        ${resolved.length} total
      </div>
    </div>
  `;

  // Copy button
  const copyBtn = document.createElement('button');
  copyBtn.style.cssText = 'padding:4px 10px;border:1px solid var(--border,#ddd);border-radius:4px;background:var(--bg-secondary,#f5f5f5);cursor:pointer;font-size:11px;white-space:nowrap;';
  copyBtn.textContent = 'Copy TSV';
  copyBtn.onclick = () => {
    const tsv = resolved.map(r => `${r.name}\t${r.value || ''}\t${r.status}`).join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy TSV'; }, 1500);
    }).catch(() => {});
  };
  header.appendChild(copyBtn);

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = 'padding:4px 8px;border:none;background:none;cursor:pointer;font-size:18px;color:var(--text-secondary,#666);line-height:1;';
  closeBtn.textContent = '\u00D7';
  closeBtn.onclick = removeExisting;
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // Scrollable body
  const body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow-y:auto;padding:0;';

  // Table
  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:collapse;font-size:12px;';

  // Table header
  table.innerHTML = `
    <thead>
      <tr style="position:sticky;top:0;background:var(--bg-secondary,#f5f5f5);z-index:1;">
        <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;color:var(--text-tertiary,#888);border-bottom:1px solid var(--border,#eee);font-weight:600;">Name</th>
        <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;color:var(--text-tertiary,#888);border-bottom:1px solid var(--border,#eee);font-weight:600;">Value</th>
        <th style="text-align:left;padding:6px 10px;font-size:10px;text-transform:uppercase;color:var(--text-tertiary,#888);border-bottom:1px solid var(--border,#eee);font-weight:600;">Status</th>
      </tr>
    </thead>
  `;

  const tbody = document.createElement('tbody');
  for (const r of resolved) {
    const tr = document.createElement('tr');
    tr.style.cssText = 'border-bottom:1px solid var(--border-light, #f0f0f0);';
    if (r.value) {
      tr.style.cssText += 'background:var(--bg-primary,#fff);';
    } else {
      tr.style.cssText += 'background:var(--bg-warning-subtle, #fff8e1);';
    }

    const statusColor = r.value ? 'var(--success,#4caf50)' : 'var(--text-tertiary,#999)';

    tr.innerHTML = `
      <td style="padding:6px 10px;font-family:monospace;font-size:11px;white-space:nowrap;">${esc(r.name)}</td>
      <td style="padding:6px 10px;font-weight:600;color:${r.value ? 'var(--info,#1a73e8)' : 'var(--text-tertiary,#ccc)'};">
        ${r.value ? esc(r.value) : '—'}
      </td>
      <td style="padding:6px 10px;font-size:10px;color:${statusColor};">${esc(r.status)}</td>
    `;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  body.appendChild(table);
  panel.appendChild(body);

  // Get the task pane container (or fall back to body)
  const taskPane = document.getElementById('app') || document.body;
  taskPane.appendChild(panel);
}

function showErrorPanel(message) {
  removeExisting();
  const panel = document.createElement('div');
  panel.id = 'pdf-beta-panel';
  panel.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:var(--bg-primary,#fff);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;';
  panel.innerHTML = `
    <div style="color:var(--danger,#f44336);font-weight:600;">Preview failed</div>
    <div style="font-size:12px;color:var(--text-secondary,#666);max-width:80%;text-align:center;">${esc(message)}</div>
    <button id="pdf-beta-close-err" style="padding:6px 16px;border:1px solid var(--border,#ddd);border-radius:4px;background:var(--bg-secondary,#f5f5f5);cursor:pointer;font-size:12px;">Close</button>
  `;
  const taskPane = document.getElementById('app') || document.body;
  taskPane.appendChild(panel);
  panel.querySelector('#pdf-beta-close-err').onclick = removeExisting;
}

// ─── UI Helpers ───────────────────────────────────────────────────

function removeExisting() {
  const existing = document.getElementById('pdf-beta-panel');
  if (existing) existing.remove();
  const prog = document.getElementById('pdf-beta-progress');
  if (prog) prog.remove();
}

function showProgress(message) {
  removeExisting();
  const overlay = document.createElement('div');
  overlay.id = 'pdf-beta-progress';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.3); display: flex; align-items: center;
    justify-content: center; z-index: 9999;
  `;
  overlay.innerHTML = `
    <div style="background:var(--bg-primary,#fff);padding:20px 32px;border-radius:8px;box-shadow:0 4px 24px rgba(0,0,0,0.15);font-size:14px;text-align:center;">
      <div style="margin-bottom:8px;font-weight:600;">Resolving Data</div>
      <div id="pdf-beta-msg" style="color:var(--text-secondary,#666);font-size:12px;">${esc(message)}</div>
    </div>
  `;
  const taskPane = document.getElementById('app') || document.body;
  taskPane.appendChild(overlay);
  return overlay;
}

function updateProgress(overlay, message) {
  const msg = overlay?.querySelector('#pdf-beta-msg');
  if (msg) msg.textContent = message;
}

function hideProgress(overlay) {
  if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
}

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
