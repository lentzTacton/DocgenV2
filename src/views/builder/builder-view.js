/**
 * Builder View — Formula Sections
 *
 * Visual template structure editor showing the document's $for/$if/$define
 * blocks as a collapsible, card-based UI matching the DocGen Builder mockup.
 *
 * Currently renders a static representation of the Alternative Products
 * pricing template for design validation.
 */

import { el, clear } from '../../core/dom.js';
import { icon } from '../../components/icon.js';

// ─── Section data for the Alternative Products template ─────────────────────

function getTemplateSections() {
  return [
    // ── Section 1: Header Defines ───────────────────────────────────
    {
      icon: 'file',
      name: 'Header Defines',
      subtitle: '2 define variables',
      desc: 'Initializes empty placeholder collection #primaryCp and builds #primaryCpsList — the list of primary CPs (no alternativeTo).',
      badges: ['Included'],
      children: [
        { kind: 'def', name: '#primaryCp', source: '#this.related(\'ConfiguredProduct\',\'solution\').{?false}', note: 'empty placeholder — filled by side-effects' },
        { kind: 'def', name: '#primaryCpsList', source: '#this.related(\'ConfiguredProduct\',\'solution\').{?alternativeTo==null}' },
      ],
    },
    // ── Section 2: BOM Comparison Loop ──────────────────────────────
    {
      icon: 'edit',
      name: 'BOM Comparison',
      subtitle: 'for-loop over primaryCpsList',
      desc: 'Iterates each primary CP, finds its alternatives, and compares BOMs. Same-product alternatives show a delta table; different-product alternatives are accumulated for the next section.',
      badges: ['Included'],
      selected: true,
      children: [
        { kind: 'for', loopVar: '#currectPrimaryCP', source: '#primaryCpsList', records: 2, children: [
          { kind: 'def', name: '#listOfAlternativeToPrimary', source: '#this.related(\'ConfiguredProduct\',\'solution\').{?alternativeTo==#currectPrimaryCP}' },
          { kind: 'if', condition: '#listOfAlternativeToPrimary.size() > 0', match: 'CP-004, CP-006 match', children: [
            { kind: 'for', loopVar: '#currentAlternative', source: '#listOfAlternativeToPrimary', children: [
              { kind: 'def', name: '#list2', source: '#currentAlternative.flatbom' },
              { kind: 'def', name: '#list1', source: '#currectPrimaryCP.flatbom' },
              { kind: 'def', name: '#added', source: '#list2.{?(path+name) not in #list1.{path+name}}', tag: 'set diff' },
              { kind: 'def', name: '#deleted', source: '#list1.{?(path+name) not in #list2.{path+name}}', tag: 'set diff', tagDanger: true },
              { kind: 'if', condition: '#currectPrimaryCP.productId == #currentAlternative.productId', label: 'same product → BOM delta', children: [
                { kind: 'text', content: 'Primary ${#currectPrimaryCP.name}$ (${#currectPrimaryCP.summary}$)' },
                { kind: 'if', condition: '#added.{qty}.sum() > 0', label: 'has BOM changes', children: [
                  { kind: 'text', content: 'The table below presents the delta Bill of Materials (BOM)...' },
                  { kind: 'def', name: '#priceDiffrence', source: '#currentAlternative.unitListPrice*1 - #currectPrimaryCP.unitListPrice*1' },
                  { kind: 'rowgroup', source: '#added', cols: ['Part No.', 'Description', 'Net Price', 'Qty'], cells: ['${name}$', '${description}$', '${listPrice.price()}$', '${qty}$'] },
                  { kind: 'text', content: 'Alternative CP ${#currentAlternative.name}$ Total: ${#currentAlternative.unitListPrice.price()}$' },
                  { kind: 'rowgroup', source: '#deleted', cols: ['Part No.', 'Description', 'Net Price', 'Qty'], cells: ['~~${name}$~~', '~~${description}$~~', '~~${listPrice.price()}$~~', '~~${qty}$~~'], strike: true },
                  { kind: 'text', content: 'Primary CP ${#currectPrimaryCP.name}$ Total: ${#currectPrimaryCP.unitListPrice.price()}$' },
                ]},
                { kind: 'else', label: 'no BOM changes', children: [
                  { kind: 'text', content: 'No changes exist between Alternative ${#currentAlternative.name}$ and Primary ${#currectPrimaryCP.name}$' },
                ]},
              ]},
              { kind: 'else', label: 'different product → accumulate', children: [
                { kind: 'action', expr: '#primaryCp.add(#currectPrimaryCP)' },
                { kind: 'action', expr: '#alternativeDifferentProductCp.add(#currentAlternative)' },
              ]},
            ]},
          ]},
        ]},
      ],
    },
    // ── Section 3: Different Product Alternatives ────────────────────
    {
      icon: 'edit',
      name: 'Different Product Alternatives',
      subtitle: 'for-loop over primaryCp.unique()',
      desc: 'Second pass — iterates the accumulated different-product CPs and their alternatives, showing product IDs and pricing deltas.',
      badges: ['Included'],
      children: [
        { kind: 'for', loopVar: '#currentCp', source: '#primaryCp.unique()', records: 1, children: [
          { kind: 'text', content: 'Primary ${#currentCp.name}$ (${#currentCp.summary||""}$): ${#currentCp.unitListPrice.price()}$' },
          { kind: 'text', content: 'Alternative Product(s) with their Pricing delta' },
          { kind: 'def', name: '#listTest', source: '#alternativeDifferentProductCp.{?alternativeTo==#currentCp}' },
          { kind: 'for', loopVar: '#currentAlternate', source: '#alternativeDifferentProductCp.{?alternativeTo==#currentCp}', children: [
            { kind: 'text', content: '${#currentAlternate.productId}$ (${#currentAlternate.summary||""}$)' },
            { kind: 'def', name: '#priceDifference', source: '#currentAlternate.unitListPrice*1 - #currentCp.unitListPrice*1' },
            { kind: 'text', content: 'Price Difference: ${#priceDifference.price()}$' },
          ]},
        ]},
      ],
    },
  ];
}

// ─── Render helpers ─────────────────────────────────────────────────────────

/** Small coloured keyword badge */
function badge(text, type) {
  const cls = {
    included: 'bld-b-included',
    records: 'bld-b-records',
    match: 'bld-b-match',
    tag: 'bld-b-tag',
    tagDanger: 'bld-b-tag-danger',
    sideEffect: 'bld-b-side',
    note: 'bld-b-note',
  }[type] || 'bld-b-tag';
  return el('span', { class: `bld-b ${cls}` }, text);
}

/** Flow-item icon (small coloured square with letter) */
function flowIcon(kind) {
  const map = {
    for:      { letter: '↻', cls: 'bld-fic-for' },
    if:       { letter: '?', cls: 'bld-fic-if' },
    else:     { letter: '⤷', cls: 'bld-fic-else' },
    def:      { letter: '⊕', cls: 'bld-fic-def' },
    text:     { letter: '≡', cls: 'bld-fic-txt' },
    rowgroup: { letter: '⊞', cls: 'bld-fic-row' },
    action:   { letter: '!', cls: 'bld-fic-act' },
  };
  const cfg = map[kind] || map.text;
  return el('span', { class: `bld-fic ${cfg.cls}` }, cfg.letter);
}

/** Render a table preview for $rowgroup */
function renderTable(cols, cells, strike) {
  const hd = el('div', { class: 'bld-tbl-hd' });
  for (const c of cols) hd.appendChild(el('div', {}, c));
  const rw = el('div', { class: `bld-tbl-rw ${strike ? 'bld-tbl-strike' : ''}` });
  for (const c of cells) rw.appendChild(el('div', {}, c));
  return el('div', { class: 'bld-tbl' }, [hd, rw]);
}

/** Recursively render a tree of flow items */
function renderChildren(items, depth) {
  const wrap = el('div', { class: depth > 0 ? 'bld-nest' : 'bld-flow' });

  for (const item of items) {
    if (item.kind === 'for') {
      // For-loop header
      const row = el('div', { class: 'bld-fi' }, [
        flowIcon('for'),
        el('div', { class: 'bld-fi-body' }, [
          el('span', { class: 'bld-fi-kw' }, 'For:'),
          el('span', { class: 'bld-fi-main' }, `each ${item.loopVar} in`),
          el('div', { class: 'bld-fi-src' }, item.source),
          item.records ? badge(`${item.records} records`, 'records') : null,
        ]),
      ]);
      wrap.appendChild(row);
      if (item.children) wrap.appendChild(renderChildren(item.children, depth + 1));

    } else if (item.kind === 'if') {
      const row = el('div', { class: 'bld-fi' }, [
        flowIcon('if'),
        el('div', { class: 'bld-fi-body' }, [
          el('span', { class: 'bld-fi-kw bld-kw-if' }, 'If:'),
          el('span', { class: 'bld-fi-main' }, item.condition),
          item.match ? badge(item.match, 'match') : null,
          item.label ? el('div', { class: 'bld-fi-hint' }, item.label) : null,
        ]),
      ]);
      wrap.appendChild(row);
      if (item.children) wrap.appendChild(renderChildren(item.children, depth + 1));

    } else if (item.kind === 'else') {
      const row = el('div', { class: 'bld-fi' }, [
        flowIcon('else'),
        el('div', { class: 'bld-fi-body' }, [
          el('span', { class: 'bld-fi-kw bld-kw-else' }, 'Else:'),
          el('span', { class: 'bld-fi-main' }, item.label || ''),
        ]),
      ]);
      wrap.appendChild(row);
      if (item.children) wrap.appendChild(renderChildren(item.children, depth + 1));

    } else if (item.kind === 'def') {
      const row = el('div', { class: 'bld-fi' }, [
        flowIcon('def'),
        el('div', { class: 'bld-fi-body' }, [
          el('span', { class: 'bld-fi-name' }, item.name),
          item.tag ? badge(item.tag, item.tagDanger ? 'tagDanger' : 'tag') : null,
          item.source ? el('div', { class: 'bld-fi-src' }, item.source) : null,
          item.note ? el('div', { class: 'bld-fi-hint' }, item.note) : null,
        ]),
      ]);
      wrap.appendChild(row);

    } else if (item.kind === 'text') {
      wrap.appendChild(el('div', { class: 'bld-fi' }, [
        flowIcon('text'),
        el('div', { class: 'bld-fi-body bld-fi-txt' }, item.content),
      ]));

    } else if (item.kind === 'rowgroup') {
      const row = el('div', { class: 'bld-fi' }, [
        flowIcon('rowgroup'),
        el('div', { class: 'bld-fi-body' }, [
          el('span', { class: 'bld-fi-kw bld-kw-row' }, 'Row group:'),
          el('span', { class: 'bld-fi-main' }, item.source),
          item.strike ? badge('strikethrough', 'tagDanger') : null,
          renderTable(item.cols, item.cells, item.strike),
        ]),
      ]);
      wrap.appendChild(row);

    } else if (item.kind === 'action') {
      wrap.appendChild(el('div', { class: 'bld-fi' }, [
        flowIcon('action'),
        el('div', { class: 'bld-fi-body' }, [
          el('span', { class: 'bld-fi-main bld-fi-act-text' }, item.expr),
          badge('side-effect', 'sideEffect'),
        ]),
      ]));
    }
  }

  return wrap;
}

/** Render a single section card */
function renderSection(sec) {
  const collapsed = { value: false };

  // Inner flow panel (the bordered box with the tree)
  const flowPanel = el('div', { class: 'bld-flow-panel' }, [
    renderChildren(sec.children, 0),
  ]);

  // Buttons
  const btns = el('div', { class: 'bld-sec-btns' }, [
    el('button', { class: 'bld-btn bld-btn-primary' }, [
      el('span', { html: icon('edit', 12) }),
      'Edit formulas',
    ]),
    el('button', { class: 'bld-btn' }, [
      el('span', { html: icon('eye', 12) }),
      'Preview',
    ]),
  ]);

  // Body = description + flow panel + buttons
  const body = el('div', { class: 'bld-sec-body' }, [
    sec.desc ? el('div', { class: 'bld-sec-desc' }, sec.desc) : null,
    flowPanel,
    btns,
  ]);

  // Badges
  const badgeEls = (sec.badges || []).map(b => badge(b, 'included'));

  // Header
  const chevron = el('span', { class: 'bld-sec-chev', html: icon('chevronDown', 14) });

  const head = el('div', { class: 'bld-sec-head', onclick: () => {
    collapsed.value = !collapsed.value;
    body.style.display = collapsed.value ? 'none' : '';
    chevron.innerHTML = icon(collapsed.value ? 'chevronRight' : 'chevronDown', 14);
  }}, [
    el('span', { class: 'bld-sec-drag', html: icon('drag', 10) }),
    el('span', { class: 'bld-sec-icon', html: icon(sec.icon || 'edit', 18) }),
    el('div', { class: 'bld-sec-meta' }, [
      el('div', { class: 'bld-sec-name' }, sec.name),
      el('div', { class: 'bld-sec-sub' }, sec.subtitle || ''),
    ]),
    el('div', { class: 'bld-sec-badges' }, badgeEls),
    chevron,
  ]);

  return el('div', { class: `bld-sec ${sec.selected ? 'bld-sec-selected' : ''}` }, [head, body]);
}

// ─── Main entry point ───────────────────────────────────────────────────────

export function createBuilderView(container) {
  clear(container);

  const root = el('div', { class: 'zone-inner bld-root' });

  // Active dataset bar
  root.appendChild(el('div', { class: 'bld-ds-bar' }, [
    el('span', { class: 'bld-ds-circle' }),
    el('span', { style: { fontSize: '11px', color: 'var(--text-secondary)' } }, 'Active dataset:'),
    el('select', { class: 'bld-ds-select' }, [
      el('option', {}, 'High discount scenario (CP-004, CP-006)'),
    ]),
  ]));

  // Title bar
  root.appendChild(el('div', { class: 'bld-title-bar' }, [
    el('span', { html: icon('layers', 16), style: { color: 'var(--text-secondary)' } }),
    el('span', { class: 'bld-title' }, 'Formula Sections'),
    el('button', { class: 'bld-add-sec-btn' }, [
      el('span', { html: icon('plus', 12) }),
      'Add section',
    ]),
  ]));

  // Section list
  const list = el('div', { class: 'bld-list' });
  for (const sec of getTemplateSections()) {
    list.appendChild(renderSection(sec));
  }
  root.appendChild(list);
  container.appendChild(root);
}
