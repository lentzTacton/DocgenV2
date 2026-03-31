/**
 * Preview View (BETA) — Resolves all variables across catalogues and shows
 * a table of name → resolved value. Includes PDF export via print dialog.
 *
 * Two modes:
 *   - Table view: in-pane scrollable table (default)
 *   - PDF export: opens printable HTML in Office dialog
 */

import { el, qs, clear } from '../../core/dom.js';
import { icon, iconEl } from '../../components/icon.js';
import state from '../../core/state.js';
import { resolveConfigAttrAcrossCPs } from '../data/wizard-config-explorer.js';
import { jsPDF } from 'jspdf';

// ─── Module state ──────────────────────────────────────────────────

let _container = null;
let _resolved = null;          // cached resolution results
let _resolving = false;
let _selectedCatId = null;     // which catalogue to preview

// ─── Public API ────────────────────────────────────────────────────

export function createPreviewView(container) {
  _container = container;
  render();

  // Re-render when switching to this tab
  state.on('activeZone', (zone) => {
    if (zone === 'preview') {
      _resolved = null;  // invalidate cache so we always re-resolve
      render();
    }
  });
}

// ─── Main Render ──────────────────────────────────────────────────

function render() {
  if (!_container) return;
  clear(_container);

  const inner = el('div', { class: 'zone-inner', style: { display: 'flex', flexDirection: 'column', height: '100%' } });

  // ── Header ──
  const header = el('div', { style: {
    padding: '12px 16px', borderBottom: '1px solid var(--border, #e0e0e0)',
    display: 'flex', alignItems: 'center', gap: '8px', flexShrink: '0',
  } });

  header.appendChild(el('div', { style: { flex: '1' } }, [
    el('div', { style: { fontWeight: '600', fontSize: '14px' } }, [
      'Data Preview ',
      el('span', { style: {
        background: '#ff9800', color: '#fff', fontSize: '9px', fontWeight: '700',
        padding: '1px 5px', borderRadius: '3px', verticalAlign: 'middle',
      } }, 'BETA'),
    ]),
    el('div', { style: { fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px' } },
      'Resolve all defines against live configuration data'),
  ]));

  inner.appendChild(header);

  // ── Catalogue picker + actions bar ──
  const catalogues = (state.get('catalogues') || []).filter(c => !c.readonly);
  const variables = state.get('variables') || [];

  if (catalogues.length === 0) {
    inner.appendChild(el('div', { style: {
      textAlign: 'center', padding: '60px 20px', color: 'var(--text-tertiary)',
    } }, [
      iconEl('eye', 48),
      el('div', { style: { fontSize: '16px', fontWeight: '700', marginTop: '16px', color: 'var(--text-secondary)' } }, 'No Catalogues'),
      el('div', { style: { fontSize: '13px', marginTop: '8px' } },
        'Create a catalogue with variables in the Data tab to preview resolved values.'),
    ]));
    _container.appendChild(inner);
    return;
  }

  // Auto-select first catalogue with variables
  if (!_selectedCatId || !catalogues.find(c => c.id === _selectedCatId)) {
    const withVars = catalogues.find(c => variables.some(v => v.catalogueId === c.id));
    _selectedCatId = withVars ? withVars.id : catalogues[0].id;
  }

  const catVars = variables.filter(v => v.catalogueId === _selectedCatId);

  const toolbar = el('div', { style: {
    padding: '8px 16px', borderBottom: '1px solid var(--border-light, #f0f0f0)',
    display: 'flex', alignItems: 'center', gap: '8px', flexShrink: '0',
  } });

  // Catalogue select
  if (catalogues.length > 1) {
    const select = el('select', {
      class: 'input',
      style: { fontSize: '12px', flex: '1' },
      onchange: (e) => { _selectedCatId = e.target.value; _resolved = null; render(); },
    });
    for (const cat of catalogues) {
      const catCount = variables.filter(v => v.catalogueId === cat.id).length;
      const opt = el('option', { value: cat.id }, `${cat.name} (${catCount})`);
      if (cat.id === _selectedCatId) opt.selected = true;
      select.appendChild(opt);
    }
    toolbar.appendChild(select);
  } else {
    toolbar.appendChild(el('span', { style: { fontSize: '13px', fontWeight: '500', flex: '1' } }, catalogues[0].name));
  }

  // Resolve button
  const resolveBtn = el('button', {
    class: 'btn btn-sm',
    style: { fontSize: '11px', padding: '4px 12px', whiteSpace: 'nowrap' },
    onclick: () => runResolve(catVars),
  }, [
    el('span', { html: icon('play', 11), style: { marginRight: '4px' } }),
    _resolved ? 'Re-resolve' : `Resolve ${catVars.length}`,
  ]);
  toolbar.appendChild(resolveBtn);

  // PDF export button (only when resolved)
  if (_resolved) {
    const pdfBtn = el('button', {
      class: 'btn btn-sm',
      style: { fontSize: '11px', padding: '4px 10px', whiteSpace: 'nowrap' },
      onclick: () => exportPdf(),
    }, [
      el('span', { html: icon('download', 11), style: { marginRight: '4px' } }),
      'PDF',
    ]);
    toolbar.appendChild(pdfBtn);

    const copyBtn = el('button', {
      class: 'btn btn-sm',
      style: { fontSize: '11px', padding: '4px 10px', whiteSpace: 'nowrap' },
      onclick: (e) => {
        const tsv = _resolved.map(r => `${r.name}\t${r.value || ''}\t${r.status}`).join('\n');
        navigator.clipboard.writeText('Name\tValue\tStatus\n' + tsv).then(() => {
          e.target.textContent = 'Copied!';
          setTimeout(() => { e.target.textContent = 'Copy'; }, 1500);
        }).catch(() => {});
      },
    }, 'Copy');
    toolbar.appendChild(copyBtn);
  }

  inner.appendChild(toolbar);

  // ── Content area ──
  const content = el('div', { style: { flex: '1', overflowY: 'auto' } });

  if (_resolving) {
    content.appendChild(el('div', { id: 'preview-progress', style: {
      textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)',
    } }, [
      el('div', { style: { fontSize: '13px', fontWeight: '600', marginBottom: '6px' } }, 'Resolving...'),
      el('div', { id: 'preview-progress-msg', style: { fontSize: '12px' } }, ''),
    ]));
  } else if (_resolved) {
    renderResultsTable(content);
  } else if (catVars.length === 0) {
    content.appendChild(el('div', { style: {
      textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)', fontSize: '13px',
    } }, 'This catalogue has no variables. Select a different one or add variables in the Data tab.'));
  } else {
    content.appendChild(el('div', { style: {
      textAlign: 'center', padding: '40px 20px', color: 'var(--text-tertiary)',
    } }, [
      iconEl('play', 32),
      el('div', { style: { fontSize: '13px', marginTop: '12px' } }, [
        `${catVars.length} variables ready. `,
        el('strong', {}, 'Click Resolve'),
        ' to fetch live values from the configured product.',
      ]),
    ]));
  }

  inner.appendChild(content);
  _container.appendChild(inner);
}

// ─── Resolution ───────────────────────────────────────────────────

async function runResolve(catVars) {
  _resolving = true;
  _resolved = null;
  render();

  try {
    const allVars = state.get('variables') || [];
    const results = [];

    for (let i = 0; i < catVars.length; i++) {
      // Update progress
      const msg = qs('#preview-progress-msg');
      if (msg) msg.textContent = `${i + 1} / ${catVars.length}: ${catVars[i].name || '...'}`;

      const v = catVars[i];
      const entry = {
        name: v.name || '(unnamed)',
        source: v.source || '',
        purpose: v.purpose || 'variable',
        value: null,
        status: 'pending',
      };

      try {
        const source = v.source || '';

        // Config attribute
        if (source.includes('getConfigurationAttribute(')) {
          const pm = source.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
          if (pm) {
            const r = await resolveConfigAttrAcrossCPs(pm[1]);
            const val = r.find(x => x.value && x.value !== '(error)');
            entry.value = val?.value || null;
            entry.status = val ? 'resolved' : 'no value';
          }
        }

        // Code expression (arithmetic with #var refs)
        else if (/#\w+/.test(source) && /[+\-*/]/.test(source)) {
          const varRefs = [...new Set(source.match(/#\w+/g) || [])];
          let expr = source;
          let allFound = true;

          for (const ref of varRefs) {
            const prev = results.find(r => r.name === ref);
            if (prev?.value != null) {
              const n = parseFloat(prev.value);
              if (!isNaN(n)) { expr = expr.split(ref).join(String(n)); continue; }
            }
            const refVar = allVars.find(vv => vv.name === ref);
            if (refVar?.source?.includes('getConfigurationAttribute(')) {
              const pm = refVar.source.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
              if (pm) {
                const r = await resolveConfigAttrAcrossCPs(pm[1]);
                const val = r.find(x => x.value && x.value !== '(error)');
                if (val?.value) { expr = expr.split(ref).join(String(parseFloat(val.value))); continue; }
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

        // Linked variable
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
          } else { entry.status = 'linked'; }
        }

        // Static
        else if (source && !source.includes('.') && !source.includes('(')) {
          entry.value = source;
          entry.status = 'static';
        }

      } catch (err) {
        entry.status = 'error';
      }

      results.push(entry);
    }

    _resolved = results;
  } catch (err) {
    console.error('[preview] Resolution failed:', err);
  } finally {
    _resolving = false;
    render();
  }
}

// ─── Results Table ────────────────────────────────────────────────

function renderResultsTable(container) {
  if (!_resolved) return;

  const resolvedCt = _resolved.filter(r => r.value).length;

  // Summary bar
  container.appendChild(el('div', { style: {
    padding: '8px 16px', background: 'var(--bg-secondary, #f8f9fa)',
    fontSize: '12px', color: 'var(--text-secondary)',
    borderBottom: '1px solid var(--border-light, #f0f0f0)',
  } }, [
    el('strong', { style: { color: 'var(--success, #4caf50)' } }, String(resolvedCt)),
    ` resolved \u00b7 `,
    el('strong', { style: { color: resolvedCt < _resolved.length ? 'var(--danger, #f44336)' : 'var(--text-tertiary)' } },
      String(_resolved.length - resolvedCt)),
    ` unresolved \u00b7 ${_resolved.length} total`,
  ]));

  // Table
  const table = el('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '12px' } });

  table.appendChild(el('thead', {}, [
    el('tr', { style: { position: 'sticky', top: '0', background: 'var(--bg-primary, #fff)', zIndex: '1' } }, [
      el('th', { style: thStyle() }, 'Name'),
      el('th', { style: thStyle() }, 'Value'),
      el('th', { style: thStyle() }, 'Status'),
    ]),
  ]));

  const tbody = el('tbody');
  for (const r of _resolved) {
    const hasVal = !!r.value;
    tbody.appendChild(el('tr', {
      style: {
        borderBottom: '1px solid var(--border-light, #f0f0f0)',
        background: hasVal ? '' : 'var(--bg-warning-subtle, #fff8e1)',
      },
    }, [
      el('td', { style: { padding: '5px 10px', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'nowrap' } }, r.name),
      el('td', { style: {
        padding: '5px 10px', fontWeight: '600',
        color: hasVal ? 'var(--info, #1a73e8)' : 'var(--text-tertiary, #ccc)',
      } }, hasVal ? r.value : '\u2014'),
      el('td', { style: {
        padding: '5px 10px', fontSize: '10px',
        color: hasVal ? 'var(--success, #4caf50)' : 'var(--text-tertiary, #999)',
      } }, r.status),
    ]));
  }

  table.appendChild(tbody);
  container.appendChild(table);
}

function thStyle() {
  return {
    textAlign: 'left', padding: '6px 10px', fontSize: '10px',
    textTransform: 'uppercase', color: 'var(--text-tertiary, #888)',
    borderBottom: '2px solid var(--border, #e0e0e0)', fontWeight: '600',
  };
}

// ─── PDF Export (real .pdf via jsPDF, bundled locally) ────────────

function exportPdf() {
  if (!_resolved) return;

  const cat = (state.get('catalogues') || []).find(c => c.id === _selectedCatId);
  const catName = cat?.name || 'Data Preview';
  const now = new Date().toLocaleString();
  const resolvedCt = _resolved.filter(r => r.value).length;

  try {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 18;

    // ── Title ──
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(catName, margin, y);

    // Beta badge
    doc.setFillColor(255, 152, 0);
    doc.roundedRect(margin + doc.getTextWidth(catName) + 3, y - 4, 14, 5, 1, 1, 'F');
    doc.setFontSize(6);
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.text('BETA', margin + doc.getTextWidth(catName) + 5.5, y - 0.8);

    // Subtitle
    y += 6;
    doc.setFontSize(8);
    doc.setTextColor(150, 150, 150);
    doc.setFont('helvetica', 'normal');
    doc.text(`Generated ${now}  \u00b7  Tacton DocGen Data Preview`, margin, y);

    // ── Summary bar ──
    y += 8;
    doc.setFillColor(240, 247, 255);
    doc.roundedRect(margin, y - 4, pageW - margin * 2, 8, 1.5, 1.5, 'F');
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(26, 115, 232);
    doc.text(`${resolvedCt}`, margin + 3, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(`resolved  \u00b7  ${_resolved.length - resolvedCt} unresolved  \u00b7  ${_resolved.length} total`,
      margin + 3 + doc.getTextWidth(`${resolvedCt} `), y);

    // ── Table ──
    y += 10;
    const colX = [margin, margin + 60, margin + 110];
    const colW = [58, 48, pageW - margin - 110];

    // Header
    doc.setFillColor(245, 245, 245);
    doc.rect(margin, y - 4, pageW - margin * 2, 6, 'F');
    doc.setFontSize(7);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(120, 120, 120);
    doc.text('NAME', colX[0] + 2, y);
    doc.text('VALUE', colX[1] + 2, y);
    doc.text('STATUS', colX[2] + 2, y);

    // Divider
    y += 3;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageW - margin, y);
    y += 4;

    // Rows
    doc.setFontSize(8);
    for (const r of _resolved) {
      // Page break check
      if (y > 275) {
        doc.addPage();
        y = 18;
      }

      // Unresolved row background
      if (!r.value) {
        doc.setFillColor(255, 248, 225);
        doc.rect(margin, y - 3.5, pageW - margin * 2, 5.5, 'F');
      }

      // Name
      doc.setFont('courier', 'normal');
      doc.setTextColor(51, 51, 51);
      const name = r.name.length > 28 ? r.name.substring(0, 27) + '\u2026' : r.name;
      doc.text(name, colX[0] + 2, y);

      // Value
      doc.setFont('helvetica', 'bold');
      if (r.value) {
        doc.setTextColor(26, 115, 232);
        const val = r.value.length > 22 ? r.value.substring(0, 21) + '\u2026' : r.value;
        doc.text(val, colX[1] + 2, y);
      } else {
        doc.setTextColor(200, 200, 200);
        doc.text('\u2014', colX[1] + 2, y);
      }

      // Status
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(r.value ? 76 : 160, r.value ? 175 : 160, r.value ? 80 : 160);
      doc.text(r.status, colX[2] + 2, y);
      doc.setFontSize(8);

      // Row divider
      y += 2;
      doc.setDrawColor(240, 240, 240);
      doc.line(margin, y, pageW - margin, y);
      y += 4;
    }

    // ── Save ──
    const filename = `${catName.replace(/[^a-zA-Z0-9]/g, '_')}_preview.pdf`;
    doc.save(filename);

  } catch (err) {
    console.error('[preview] PDF export failed:', err);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────

function esc(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
