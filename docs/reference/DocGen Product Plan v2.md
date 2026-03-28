# DocGen Product Plan v2

> Consolidated from Samuel Bell feedback session — 2026-03-27
> Supersedes the original prototype planning doc

---

## Vision

A production-grade Word Add-in that lets Tacton CPQ users generate rich documents directly from configured product data. The plugin connects to a Tacton CPQ instance, resolves ticket-scoped object data, and lets users define variables that map to BOM items, object fields, and list expressions — then stamps those into Word templates via content controls or `${}` token syntax.

---

## Architecture: 4-Zone Tabbed Taskpane

Replaces the old 6-step accordion with a cleaner mental model:

| Zone | Purpose | Phase |
|------|---------|-------|
| **Setup** | Connection, ticket selection, starting object, document identity | 2 |
| **Data** | Unified variable catalogue — define, filter, preview, reorder | 3 |
| **Builder** | Formula sections, repeating blocks, conditional content | Future |
| **Preview** | Live document preview with token resolution | Future |

The taskpane is 420 px wide, fixed header with status indicator, sticky tab bar below.

---

## Feature Inventory

### F0 — Application Shell
- Webpack 5 + vanilla ES6 modules (no framework)
- Reactive state bus with path-based subscriptions
- Dexie.js / IndexedDB for structured storage surviving cache clears
- Office.js Add-in manifest (Word Document host, ReadWriteDocument)
- 4-zone tab navigation with zone-level state

### F1 — Connection Management
- Instance CRUD (URL, name, client credentials)
- 3-tier token resolution: cache → refresh exchange → stored fallback
- Deep-merge instance save (preserve existing creds on partial update)
- Connection status indicator in header (connected / disconnected / error)
- Port from TactonUtil Chrome extension auth module

### F2 — Ticket Management
- List tickets from connected instance (admin API)
- Include/exclude tickets per project
- Ticket-scoped OAuth authorization flow
- Token storage keyed by `[projectId+ticketId]`
- Ticket selector with status badges

### F3 — Starting Object
- Select starting object type from ticket's object model
- Lock starting object per project (prevents accidental changes after variables defined)
- Object type picker with search

### F4 — Document Identity
- Bind Word document to a project via custom document properties
- Auto-detect existing project on document open (`getProjectByDocumentId`)
- Project CRUD with name, instance, starting object

### F5 — Variable System (the `$define{}$` concept)
- Variables ARE the data catalogue (no separate "data sets")
- Each variable maps to a Tacton expression that resolves data
- Three types:
  - **BOM** — flat BOM queries: `$startingObject.flatbom.{?#this.ref matches '...'}`
  - **Object** — direct field references: `$startingObject.fieldName`
  - **List** — enumerated values: `{"option1","option2","option3"}`
- Auto-type detection from expression patterns
- Variable ordering (drag-to-reorder, persisted)
- Variable cards with type badge, expression preview, action buttons

### F6 — Filter Builder
- Structured filter rows: field / operator / value
- OR / AND logic groups
- Bidirectional with raw Spring EL expressions
- Visual builder renders `#this.ref matches 'regex'` etc.
- Used within BOM variable definitions

### F7 — Coverage Visualization
- Coverage bar showing distribution of BOM items across all defined variables
- Visual indicator of what percentage of the flat BOM is "covered" by variable filters
- Helps users verify they haven't missed items

### F8 — Expression Generator
- Given variable type + filters, generates the full Tacton expression
- BOM: `$startingObject.flatbom.{?#this.ref matches '...' AND #this.category == '...'}`
- Object: `$startingObject.path.to.field`
- List: `{"a","b","c"}`
- Copy-to-clipboard for pasting into Word template tokens

### F9 — Match Table / Preview
- For BOM variables: show which items match the current filter
- Table with item ref, name, category, matched fields
- Updates live as filters change
- Helps users verify their filters capture the right items

### F10 — Builder Zone (Future)
- Formula sections defining document structure
- Repeating blocks for iterating over BOM items
- Conditional content based on variable values
- Section ordering and nesting

### F11 — Preview Zone (Future)
- Live document preview with token resolution
- Show what the generated document will look like
- Highlight unresolved tokens
- Side-by-side with Word document

---

## Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| UI | Vanilla ES6 modules | Both DocgenPlugin + TactonUtil succeed with this; Office Add-in runtime constraints; manageable complexity |
| Bundler | Webpack 5 | Babel transpilation, CSS extraction, dev server with HTTPS + HMR |
| Storage | Dexie.js (IndexedDB) | Survives cache clearing, structured queries, keyed by project |
| State | Custom reactive bus | Path-based subscriptions (`state.on('connection.status', cb)`) |
| Events | Simple pub/sub | For non-state events (toasts, authorization triggers) |
| Icons | Inline SVG functions | 36 icons, no external dependencies |
| Host | Office.js | Word Document host, TaskPaneApp, ReadWriteDocument permissions |

---

## Porting Matrix (from TactonUtil)

| TactonUtil Module | DocGen Target | Notes |
|-------------------|---------------|-------|
| `auth.js` (OAuth client credentials) | F1 Connection | 3-tier token flow, deep-merge save |
| `api.js` (configured product model) | F2/F3 Ticket + Starting Object | Ticket-scoped v2.2 API |
| `xmlParser.js` (BOM XML parsing) | F6/F7 Filter + Coverage | Flat BOM item extraction |
| Panel architecture pattern | App shell | Zone/view switching pattern |

---

## Phasing Strategy

1. **Phase 1 — Application Shell** ✅ Complete
   - Scaffold, state bus, storage, CSS design system, tabs, zone placeholders

2. **Phase 2 — Connection & Setup**
   - Auth port from TactonUtil, ticket management, starting object lock, document identity

3. **Phase 3 — Data Catalogue**
   - Variable CRUD, filter builder, coverage visualization, expression generator

4. **Future — Builder & Preview**
   - Formula sections, live preview (wait for core data pipeline to be solid)

---

## Key Design Decisions

1. **Variables = Data Catalogue**: No separate "data set" abstraction. A variable IS a named expression that resolves data. Simpler mental model.

2. **`$define{}$` syntax**: Introduces computed variables that partition the flat data space. These get resolved at document generation time.

3. **Production grade**: Not a prototype. Proper error handling, storage persistence, graceful degradation, clean architecture.

4. **Independence from prototype**: Fresh codebase at `DocgenPluginV2/`, not patching the old prototype.

5. **Port, don't rewrite**: TactonUtil's auth and API modules are proven — port them with minimal changes rather than rewriting from scratch.
