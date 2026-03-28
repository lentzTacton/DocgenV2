# DocGen Build Plan — Phased

> Production build plan for the Tacton DocGen Word Add-in v2
> Project location: `C:\Users\carsten.lentz.t2\DocgenPluginV2`

---

## Phase 1 — Application Shell ✅ COMPLETE

### Deliverables
- Webpack 5 scaffold with Babel, CSS extraction, HTTPS dev server
- Office.js Add-in manifest (Word Document host)
- Reactive state bus (`src/core/state.js`)
- Dexie.js storage layer (`src/core/storage.js`)
- Event bus (`src/core/events.js`)
- DOM helpers (`src/core/dom.js`)
- CSS design system (variables, base, components, layout)
- SVG icon registry (36 icons)
- Tab navigation component
- App shell with 4 zone views (setup, data, builder, preview)

### Project Structure
```
DocgenPluginV2/
├── manifest.xml                    # Office Add-in manifest
├── package.json                    # Dependencies + scripts
├── webpack.config.js               # Webpack 5 config (function-style)
├── assets/
│   └── icons/                      # Static assets
├── src/
│   ├── index.html                  # Minimal HTML shell
│   ├── index.js                    # Entry point, Office.onReady boot
│   ├── core/
│   │   ├── app.js                  # Main orchestrator, zone switching
│   │   ├── state.js                # Reactive state bus
│   │   ├── storage.js              # Dexie.js database layer
│   │   ├── events.js               # Simple pub/sub event bus
│   │   └── dom.js                  # DOM utility helpers
│   ├── components/
│   │   ├── icon.js                 # 36 SVG icon functions
│   │   └── tabs.js                 # Tab bar component
│   ├── views/
│   │   ├── setup/
│   │   │   └── setup-view.js       # Setup zone (placeholders)
│   │   ├── data/
│   │   │   └── data-view.js        # Data zone (placeholders)
│   │   ├── builder/
│   │   │   └── builder-view.js     # Builder zone (placeholder)
│   │   └── preview/
│   │       └── preview-view.js     # Preview zone (placeholder)
│   └── styles/
│       ├── variables.css           # Design tokens (Tacton palette)
│       ├── base.css                # Reset, typography, utilities
│       ├── components.css          # All component styles
│       └── layout.css              # Taskpane, header, tabs, zones
└── dist/                           # Build output
```

### Dexie.js Schema
```javascript
db.version(1).stores({
  instances: '++id, name, url',
  tokens:    'key',
  projects:  'id, documentId, instanceId, updatedAt',
  tickets:   '[projectId+ticketId], projectId',
  variables: '++id, projectId, name, type, order',
});
```

### State Model
```javascript
{
  activeZone: 'setup',
  connection: { instanceId: null, url: '', status: 'disconnected', error: null },
  tickets:    { list: [], included: [], selected: null, tokenMap: {}, loading: false },
  startingObject: { type: null, id: null, name: null, locked: false },
  project:    { id: null, name: null, documentId: null, loaded: false },
  variables:  [],
  activeVariable: null,
  dataView:   'list',
}
```

---

## Phase 2 — Connection & Setup

### 2.1 Connection Management
Port TactonUtil's auth module:
- **Instance CRUD** — save/load/delete instances via Dexie
- **3-tier token resolution**:
  1. Check token cache (in-memory, keyed by instance+scope)
  2. If expired → refresh token exchange
  3. If no refresh → fall back to stored client credentials
- **Deep-merge instance save** — `saveInstance()` merges partial updates, preserving existing fields
- **Connection status** — reactive header indicator (state bus → UI)
- **Test connection** button — validates credentials against instance

### 2.2 Ticket Management
- **List tickets** — call admin API (`/api/tickets`), populate state
- **Include/exclude** — per-project ticket selection, persisted in Dexie `tickets` table
- **Ticket authorization** — ticket-scoped OAuth flow (v2.2 API)
  - Generate auth URL → user authorizes in browser → exchange code for tokens
  - Store access + refresh tokens keyed by `[projectId+ticketId]`
- **Ticket selector UI** — list with status badges (authorized / pending / error)

### 2.3 Starting Object
- **Describe model** — fetch object model for selected ticket
- **Object type picker** — searchable list of available object types
- **Lock mechanism** — once variables are defined against a starting object, lock it
  - Visual lock icon, confirmation dialog to unlock (warns about variable invalidation)
- **State persistence** — starting object saved per project

### 2.4 Document Identity
- **Project binding** — write project ID to Word custom document properties via Office.js
- **Auto-detect** — on document open, read custom properties → `getProjectByDocumentId()`
  - If found: restore full project state (connection, tickets, starting object, variables)
  - If not: show "New Project" flow
- **Project CRUD** — create, rename, delete projects in Dexie

### Files to Create
```
src/
├── services/
│   ├── auth.js                     # Token resolution, OAuth flows
│   ├── api.js                      # Tacton API client (admin + frontend)
│   └── office.js                   # Office.js document property helpers
├── views/setup/
│   ├── setup-view.js               # Setup zone orchestrator (UPDATE)
│   ├── connection-card.js          # Instance management card
│   ├── ticket-card.js              # Ticket selection + auth card
│   └── starting-object-card.js     # Object type picker + lock card
```

### Porting from TactonUtil
| Source File | Target | Adaptation |
|-------------|--------|------------|
| `TactonUtil/src/auth.js` | `services/auth.js` | Replace Chrome storage → Dexie, replace Chrome identity → manual OAuth |
| `TactonUtil/src/api.js` | `services/api.js` | Keep fetch patterns, adapt URL construction |
| Panel show/hide pattern | Zone views | Already done in Phase 1 |

---

## Phase 3 — Data Catalogue

### 3.1 Variable CRUD
- **New variable wizard** — type selector (BOM / Object / List) → name → configure
- **Variable cards** — list view with type badge, expression preview, edit/delete actions
- **Reorder** — drag-to-reorder, persisted via `reorderVariables()`
- **Auto-type detection** — infer type from expression patterns:
  - `.flatbom.{?...}` → BOM
  - `#this.ref` or `$startingObject.field` → Object
  - `{"a","b"}` → List

### 3.2 Filter Builder (BOM variables)
- **Structured rows** — field / operator / value per row
- **Logic groups** — OR / AND grouping
- **Bidirectional** — visual builder ↔ raw Spring EL expression
  - Parse: `#this.ref matches 'regex' AND #this.category == 'value'` → structured rows
  - Generate: structured rows → Spring EL string
- **Field suggestions** — from object model metadata

### 3.3 Coverage Visualization
- **Coverage bar** — horizontal bar showing what % of flat BOM items are covered
- **Per-variable segments** — each variable's filter match count as a colored segment
- **Uncovered indicator** — items not matched by any variable highlighted
- **Live update** — recalculates as variables/filters change

### 3.4 Expression Generator
- **Type-specific generation**:
  - BOM: `$startingObject.flatbom.{?<filter_expression>}`
  - Object: `$startingObject.<field_path>`
  - List: `{"value1","value2","value3"}`
- **Copy to clipboard** — one-click copy for pasting into Word template
- **Token preview** — show how `${variableName}` will resolve

### 3.5 Match Table
- **BOM item preview** — for BOM variables, show matched items in a table
- **Columns** — ref, name, category, and any fields used in filters
- **Live filtering** — table updates as filter builder changes
- **Count indicator** — "12 of 847 items matched"

### Files to Create
```
src/
├── views/data/
│   ├── data-view.js                # Data zone orchestrator (UPDATE)
│   ├── variable-list.js            # Variable card list + reorder
│   ├── variable-detail.js          # Single variable editor
│   ├── variable-wizard.js          # New variable creation flow
│   ├── filter-builder.js           # Structured filter row builder
│   ├── coverage-bar.js             # BOM coverage visualization
│   ├── match-table.js              # BOM item match preview
│   └── expression-gen.js           # Expression generator + copy
├── services/
│   └── variables.js                # Variable resolution logic
```

---

## Future — Builder & Preview

Deferred until the data pipeline (Phases 1-3) is solid:

- **Builder Zone** — formula sections, repeating blocks, conditional content, section ordering
- **Preview Zone** — live document preview with token resolution, unresolved token highlighting

---

## Scripts

```bash
npm run dev      # Webpack dev server (HTTPS, port 3000, HMR)
npm run build    # Production build → dist/
npm run start    # Dev server without auto-open
```

---

## Key Principles

1. **Production grade** — proper error handling, loading states, graceful fallbacks
2. **Port, don't rewrite** — TactonUtil modules are battle-tested, adapt minimally
3. **State-driven UI** — all UI reacts to state bus changes, no manual DOM juggling
4. **Project-scoped storage** — everything keyed by project ID, supports multiple documents
5. **Offline resilient** — Dexie/IndexedDB survives cache clears, stores tokens and config locally
