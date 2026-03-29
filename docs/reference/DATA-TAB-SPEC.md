# Data Tab — Implementation Specification

> Phase 3 of DocGen Plugin V2
> Input sources: Sam Bell feedback session, 6 customer template sets (90 files, 5,331 patterns), 7 UI mockups, Product Plan v2

---

## Purpose

The Data tab is the **variable catalogue** — the place where users define named data expressions that the Builder and Preview tabs consume. Each variable maps a human-readable name (`#pump`, `#motor`, `#contact`) to a Tacton expression that resolves live data from the connected ticket.

Variables ARE the data catalogue. There is no separate "data set" abstraction.

---

## What We Learned from Customer Templates

### Pattern Distribution (5,331 instances across 90 files)

| Pattern | Count | Share | Priority |
|---------|-------|-------|----------|
| Inline `${}$` | 2,759 | 51.8% | Tier 1 |
| Conditionals `$if{}$` | 1,539 | 28.9% | Tier 1 |
| Loops `$for{}$` | 340 | 6.4% | Tier 1 |
| Collection projection `.{}` | 184 | 3.5% | Tier 2 |
| Collection filter `.{?}` | 148 | 2.8% | Tier 2 |
| Variable definitions `$define{}$` | 140 | 2.6% | Tier 1 |
| Related navigation `.related()` | 65 | 1.2% | Tier 2 |
| Images `$image{}` | 51 | 1.0% | Tier 3 |
| getConfigurationAttribute() | 40 | 0.8% | Tier 2 |
| Fragments/import/insert | 65 | 1.2% | Tier 3 |

### Customer Complexity Spectrum

- **PARKER_LIFTS** — Most sophisticated: 1,674 patterns, 225 inline + 56 loops in a single template, fragment modularity, multi-language (en/ja)
- **TRUCTON** — Investment/config calculations: 692 patterns, multi-language (en/de/ja), collection filtering
- **SANDVIK** — Model variants: 414 patterns, model-specific templates (CH420, LH517i, LH621i, MT720), heavy image use
- **TECE** — Highest per-file complexity: 336 patterns in 2 files, BOM filtering with `{?mbom_qty && mbom_qty>0}`, JSON parsing
- **Cytiva** — BOM-focused: unique item filtering
- **Pentair/GAPump** — Simple modular: fragment-based composition with `$import{}$` and `$insert{}`

### Key Insight: Two Distinct Variable Families

Templates consistently split into two patterns:

**1. Object Variables** — Single-value lookups from the object model
```
$define{#contact = solution.opportunity.account.related("Contact","account")}$
$define{#pumpWeight = getConfigurationAttribute("node.field").value}$
${solution.opportunity.account.name}$
```

**2. BOM Variables** — Filtered subsets of the flat bill of materials
```
$define{#pump = #this.flatbom.{?jdeSegmentGroup=="411SEG" || jdeSegmentGroup=="420SEG"}}$
$define{#motor = #this.flatbom.{?jdeSegmentGroup=="driver" || jdeSegmentGroup=="MOTOR411"}}$
$define{#otherItems = #this.flatbom.{? NOT IN #pump, #motor, #firePumpCtrl}}$
```

This matches the auto-tagging concept: detect from expression syntax whether a variable is Object or BOM, then offer different downstream tools for each.

---

## What Sam Bell Told Us

### Core Concepts (from transcript)

1. **Variables = Data Catalogue**: "You kind of based on your ticket and your object selection, you create a data set." Variables partition the data space into named groups used throughout the document.

2. **Two modes — Object vs Modelling**: "Based on what you select there, you get the option of working in object mode or in modelling." Object mode = dot-walk single values. Modelling = BOM/list operations with filtering.

3. **Starting object is locked once set**: "It shouldn't be changeable once you set it." The starting object drives everything downstream — changing it invalidates all variables.

4. **Real workflows use 6+ variables**: The Pentair Internal Price Sheet defines pump, motor, controller, jockey controller, alarm panel, and catch-all variables. Each slices the flat BOM by segment group.

5. **Catch-all pattern is essential**: A final variable that captures "everything NOT IN" the other variables, ensuring 100% BOM coverage.

6. **Coverage visualization needed**: Users need to see what percentage of BOM items are "covered" by their variable definitions, with gaps clearly highlighted.

7. **Nested complexity is real**: For-loops containing for-loops, if-statements inside for-loops, row-groups inside for-loops. "This is where stuff kind of gets tricky."

8. **Favorites / frequently used**: "These are the four that I work the most with" — star/favorite attributes and fields for quick access.

9. **Builder is separate from Data**: The Data tab defines WHAT data is available. The Builder tab defines HOW it's used in the document (for-loops, if-statements, sections). Keep them separate.

---

## UI Architecture

### Layout: Variable List + Detail Panel

The Data tab has two views:

**List View** (default) — All defined variables as compact cards
```
┌─────────────────────────────────────┐
│ Data Catalogue                  [+] │
│ "Define named building blocks"      │
├─────────────────────────────────────┤
│ ┌─────────────────────────────────┐ │
│ │ BOM  #pump           14 items  │ │
│ │ jdeSegmentGroup == "411SEG" ... │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ BOM  #motor            8 items │ │
│ │ jdeSegmentGroup == "driver" ... │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ BOM  #otherItems      14 items │ │
│ │ catch-all  NOT IN #pump, ...   │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ OBJ  #contact                  │ │
│ │ solution.opportunity.account... │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ BOM Coverage                        │
│ [████████░░░░░░░░░░░░░████████████] │
│ #pump 14  #motor 8  ... #other 14  │
└─────────────────────────────────────┘
```

**Detail View** — Edit a single variable (replaces list)
```
┌─────────────────────────────────────┐
│ ← Back           #pump        BOM  │
├─────────────────────────────────────┤
│ NAME                                │
│ [#pump                           ]  │
│                                     │
│ DESCRIPTION                         │
│ [Pump segment line items         ]  │
│                                     │
│ SOURCE                              │
│ #this.flatbom                       │
│                                     │
│ FILTER CONDITIONS          [+ Add]  │
│ ┌─────────────────────────────────┐ │
│ │ jdeSegmentGroup  ==  "411SEG"  │ │
│ │         or                     │ │
│ │ jdeSegmentGroup  ==  "420SEG"  │ │
│ │         or                     │ │
│ │ jdeSegmentGroup  ==  "430SEG"  │ │
│ └─────────────────────────────────┘ │
│                                     │
│ MATCH PREVIEW           14/42 items │
│ ┌─────────────────────────────────┐ │
│ │ Part#    Description    Segment │ │
│ │ P-001    Fire Pump      411SEG  │ │
│ │ P-002    Split Case     420SEG  │ │
│ │ ...      + 12 more              │ │
│ └─────────────────────────────────┘ │
│                                     │
│ GENERATED EXPRESSION                │
│ ┌─────────────────────────────────┐ │
│ │ $define{#pump=#this.flatbom.    │ │
│ │ {?jdeSegmentGroup=="411SEG"||   │ │
│ │ jdeSegmentGroup=="420SEG"||...}}│ │
│ └─────────────────────────────────┘ │
│                                     │
│ [Cancel]                    [Save]  │
└─────────────────────────────────────┘
```

---

## Variable Card Component

Each variable in the list view renders as a compact card:

### Structure
```
.var-card
  .var-head
    .var-icon          — type-specific icon
    .var-info
      .var-name        — "#pump"
      .var-meta        — badges + description
  .var-expr            — expression preview (monospace, truncated)
  .var-stats           — "14 items · $45,400 net · 4 conditions"
```

### Type Badges
| Type | Badge Class | Color | Icon |
|------|-------------|-------|------|
| BOM | `.badge-bom` | Orange (#FFF1E5 bg, #BC4C00 text) | box/container |
| Object | `.badge-obj` | Purple | circle |
| List | `.badge-list` | Blue | list |

### Special Badges
- `.badge-warn` — "catch-all" indicator for NOT IN exclusion variables
- Match count — "14 items"
- Condition count — "4 conditions"

### States
- Default — neutral border
- Hover — blue border tint
- Active/Selected — blue border + shadow, expanded detail
- Drag — elevated shadow during reorder

---

## Variable Types & Detection

### Auto-Detection Rules (from expression syntax)

| Pattern in Expression | Detected Type | Example |
|----------------------|---------------|---------|
| `.flatbom` | BOM | `#this.flatbom.{?...}` |
| `.{?` filter syntax | BOM | `collection.{?condition}` |
| `getConfigurationAttribute(` | Object | `getConfigurationAttribute("node.field")` |
| `.related(` | Object | `solution.opportunity.account.related(...)` |
| Direct dot-walk (no collection ops) | Object | `solution.opportunity.account.name` |
| `{"val1","val2"}` | List | Static enumeration |

### BOM Variable
- **Source**: BOM data is **per ConfiguredProduct**, not per Solution. The real pattern is:
  ```
  $for{#cp in solution.related('ConfiguredProduct','solution')}$
    $rowgroup{#cp.flatbom}$  ← BOM is scoped to each CP
  $endfor$
  ```
- **Source variants**: `#cp.flatbom` (flat BOM), `#cp.bom` (hierarchical BOM), `#cp.bomItems` (line items)
- **Source discovery**: The wizard discovers sources from the model by:
  1. Finding ConfiguredProduct via reverse-ref scan on the starting object
  2. Scanning CP's related objects for BOM-like collections
  3. Also discovering Solution-level related collections (non-BOM)
- **Instance selection**: When a source returns multiple instances (e.g., 3 ConfiguredProducts), the user can:
  - **Iterate all**: Generate `$for{#cp in solution.related('ConfiguredProduct','solution')}$` pattern
  - **Pick one**: Select a specific instance by identifying field to scope the expression
- **Filters**: One or more conditions on BOM item fields
- **Transforms**: Optional chain of `.groupBy()`, `.flatten()`, `.sum()`, `.size()`, `.sort()`, `.{field}` extract
- **Output**: Array of matching BOM line items (or aggregated result after transforms)
- **Downstream use**: `$for{#item in #pump}$`, row groups, sum/count aggregations
- **Fields available**: Depend on the ConfiguredProduct model (discovered via describe API)
- **Common fields** (from Pentair): `jdeSegmentGroup`, `jdePartNumber`, `material`, `description`, `positionPath`, `name`
- **Common fields** (from TECE): `mbom_qty`, `mbom_partNo`, `mbom_description`

### Object Variable
- **Source**: Dot-walk path from starting object
- **Filters**: None (single value)
- **Output**: Single object or scalar value
- **Downstream use**: `${#contact.name}$`, `$if{#pumpWeight > 100}$`
- **Subtypes**:
  - Field reference: `solution.opportunity.account.name`
  - Related entity: `solution.opportunity.account.related("Contact","account")`
  - Configuration attribute: `getConfigurationAttribute("node.field").value`

### List Variable (uncommon in templates)
- **Source**: Static enumeration or computed collection
- **Output**: Array of values
- **Downstream use**: Dropdowns, validation, UI-driven value sets

---

## Filter Builder (BOM Variables)

### Visual Filter Rows

Each filter condition renders as a row:
```
[field chip]  [operator]  [value chip]  [×]
```

- **Field chip**: Purple background, shows field name (e.g., `jdeSegmentGroup`)
- **Operator**: Text (==, !=, matches, etc.)
- **Value chip**: Blue background, shows compared value (e.g., `"411SEG"`)
- **Remove button**: × to delete the condition

### Logic Between Rows
- Default: **OR** (any match) — shown as "or" label between rows
- Support AND logic for multi-field conditions
- Display as `.filter-logic` element between rows

### Operators (from template analysis)
| Operator | Usage | Example |
|----------|-------|---------|
| `==` | Exact match | `jdeSegmentGroup == "411SEG"` |
| `!=` | Not equal | `material != null` |
| `>`, `<`, `>=`, `<=` | Numeric comparison | `mbom_qty > 0` |
| `matches` | Regex match | `#this.ref matches '^HYD.*'` |
| `not in` | Exclusion | `name not in #otherList.{name}` |
| `&&` | AND conjunction | `mbom_qty && mbom_qty > 0` |
| `\|\|` | OR disjunction | `group == "A" \|\| group == "B"` |

### Bidirectional Sync
The filter builder is bidirectional:
- **Visual → Expression**: Structured rows generate Spring EL: `#this.flatbom.{?jdeSegmentGroup=="411SEG"||jdeSegmentGroup=="420SEG"}`
- **Expression → Visual**: Parse a raw expression back into structured rows (for imported/pasted expressions)

### Catch-All Variable
A special variable type that captures everything NOT matched by other BOM variables:
- Expression: `#this.flatbom.{? NOT IN #pump, #motor, #firePumpCtrl, ...}`
- Badge: `.badge-warn` with "catch-all" label
- Auto-generates the exclusion list from all other BOM variable names
- Purpose: Ensures 100% BOM coverage

---

## Coverage Visualization

### Coverage Bar
A horizontal segmented bar at the bottom of the variable list showing BOM distribution:

```
BOM Coverage                        42 items
[████████░░░░░░░░░████████████████████████]
 #pump 14  #motor 8  #ctrl 3  #other 14  ⚠ 3 unassigned
```

### Segments
- Each BOM variable gets a colored segment proportional to its item count
- Segment colors are assigned in variable creation order
- Catch-all variable uses gray
- Unassigned items (not in ANY variable) shown as warning

### Legend
Below the bar, a row of labels:
```
● #pump 14   ● #motor 8   ● #firePumpCtrl 3   ● #other 14
```

### Statistics
- Total BOM items: from `flatbom.size()`
- Covered: sum of all BOM variable match counts
- Unassigned: total - covered
- Goal: 0 unassigned (100% coverage)

---

## Match Table (BOM Variable Detail)

When editing a BOM variable, a live preview table shows which items match the current filters:

### Columns
- Part number / ref
- Name / description
- Key filter fields (auto-detected from filter conditions)
- Price (right-aligned)

### Row States
- `.match` — green tint, item matches current filters
- `.no-match` — faded (opacity 0.4), item doesn't match
- Summary row: "+ N more matching items" if list is long

### Live Update
The table re-queries as filters change, showing real-time feedback on what the variable captures.

### Data Source
Fetched via the ticket-scoped v2.2 API — `flatbom` endpoint returns all BOM line items for the selected ConfiguredProduct/starting object.

---

## Expression Generator

### Output Format
For each variable, generate the complete `$define{}$` expression:

**BOM**:
```
$define{#pump=#this.flatbom.{?jdeSegmentGroup=="411SEG"||jdeSegmentGroup=="420SEG"||jdeSegmentGroup=="430SEG"}}$
```

**Object (field)**:
```
$define{#accountName=solution.opportunity.account.name}$
```

**Object (related)**:
```
$define{#contact=solution.opportunity.account.related("Contact","account")}$
```

**Object (config attribute)**:
```
$define{#pumpWeight=getConfigurationAttribute("nonfire_pump_node-1.splitCase_nonFire_assy.pumpWeight").value}$
```

**Catch-all**:
```
$define{#otherItems=#this.flatbom.{?NOT IN #pump, #motor, #firePumpCtrl, #jockeyCtrl, #alarmPanel}}$
```

### Copy to Clipboard
One-click copy button for pasting the generated expression into Word template tokens.

### Expression Display
- Monospace font, read-only textarea
- Syntax highlighted if feasible (field names in purple, values in blue)
- Full expression visible (scrollable for long expressions)

---

## Data Flow

```
┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐
│  SETUP   │────▶│   DATA   │────▶│ BUILDER  │────▶│ PREVIEW  │
│          │     │          │     │          │     │          │
│ Instance │     │ Variables│     │ Sections │     │ Rendered │
│ Ticket   │     │ Filters  │     │ For-loops│     │ Document │
│ Object   │     │ Coverage │     │ If-blocks│     │ Output   │
└──────────┘     └──────────┘     └──────────┘     └──────────┘
                       │
                       ▼
              ┌────────────────┐
              │ Tacton v2.2 API│
              │ describe model │
              │ list records   │
              │ flatbom data   │
              └────────────────┘
```

### State Paths (Data tab)
```
variables[]                    — Array of variable definitions
activeVariable                 — Currently selected variable ID
dataView                       — 'list' | 'detail'
data.bomItems                  — Cached flat BOM items (from API)
data.objectModel               — Cached object model describe (from API)
data.coverage                  — Computed coverage stats
```

### Dexie Schema
```javascript
variables: '++id, projectId, name, type, order'
```

Each variable record:
```javascript
{
  id: auto,
  projectId: 'proj-123',
  name: '#pump',
  type: 'bom',              // 'bom' | 'object' | 'list'
  description: 'Pump segment line items',
  source: '#this.flatbom',
  filters: [
    { field: 'jdeSegmentGroup', op: '==', value: '411SEG' },
    { field: 'jdeSegmentGroup', op: '==', value: '420SEG' },
    { field: 'jdeSegmentGroup', op: '==', value: '430SEG' },
  ],
  filterLogic: 'or',        // 'or' | 'and'
  catchAll: false,           // true for NOT IN variables
  excludeVars: [],           // ['#pump', '#motor'] for catch-all
  expression: '$define{#pump=#this.flatbom.{?jdeSegmentGroup=="411SEG"||...}}$',
  order: 0,
  matchCount: 14,            // cached from last preview
}
```

---

## File Structure (Phase 3)

```
src/views/data/
├── data-view.js             — Zone orchestrator, list/detail switching
├── variable-list.js         — Variable card list + reorder + coverage bar
├── variable-detail.js       — Single variable editor (name, type, filters, preview)
├── variable-wizard.js       — "New variable" creation flow
├── filter-builder.js        — Structured filter row builder (visual ↔ expression)
├── coverage-bar.js          — BOM coverage segmented bar + legend
├── match-table.js           — BOM item match preview table
└── expression-gen.js        — Expression generator + copy-to-clipboard

src/services/
└── variables.js             — Variable CRUD, expression generation, coverage calculation
```

---

## Template Bundle Structure (from document.properties)

Customer templates use a bundle format:
```
document.properties          — Entry point declaration
├── main=Template.docx       — Primary language template
├── main_ja=Template_ja.docx — Japanese variant
├── main_de=Template_de.docx — German variant
└── font files (.ttc, .ttf)  — Custom fonts for localization
```

Key observations:
- PARKER_LIFTS: en + ja (Japanese)
- TRUCTON: en + de (German) + ja (Japanese)
- SANDVIK: en + de (German)
- All use `main:` or `main=` as the entry point key
- Font bundles for non-Latin scripts (YuGoth for Japanese, msmincho for Japanese, Inter for Sandvik)

---

## Implementation Priority

### MVP (covers 89% of real-world usage)
1. Variable CRUD — create, edit, delete, reorder
2. BOM variable with filter builder (OR conditions on one field)
3. Object variable with dot-walk path input
4. Match table showing live BOM item preview
5. Expression generator with copy-to-clipboard
6. Variable type auto-detection from expression

### Phase 2 (covers remaining 8%)
7. Coverage bar visualization
8. Catch-all variable (NOT IN pattern)
9. AND logic in filters
10. Multi-field filter conditions
11. Field suggestions from object model describe API
12. Related entity navigation (.related())

### Phase 3 (advanced 3%)
13. Collection projection preview
14. getConfigurationAttribute() builder
15. Fragment/import awareness
16. Method chaining preview (.sum(), .price(), .round())

---

## Object Model Browser

> Ported from prototype `expression-builder.js` — the core navigation for building variable paths.

### Breadcrumb Navigation

The model browser shows a clickable breadcrumb trail as the user walks the object model:

```
Solution → opportunity → account → name
```

- Each segment is clickable to jump back to that level
- Current object type + attribute count shown
- Leaf attributes (non-reference) are selectable as expression targets

### Bidirectional Reference Traversal

**Forward refs (→):** Clicking a reference attribute navigates into the referenced object type. The breadcrumb grows: `Solution → opportunity → Opportunity`.

**Reverse refs (←):** Computed at render time by scanning ALL objects in the model for attributes whose `refType` points to the current object. Example: when browsing `Solution`, we show `← ConfiguredProduct.solution` because ConfiguredProduct has a `solution` attribute that references Solution. Selecting this generates `.related('ConfiguredProduct','solution')`.

### Two-Click Mode for Reference Attributes

For reference attributes, the prototype uses a dual interaction:
- **Click attribute name** → Select as collection target (for `$for{}$` loops)
- **Click arrow icon** → Navigate deeper into the referenced object (for dot-walk)

This distinction matters: clicking `solution.related('ConfiguredProduct','solution')` as a *name* creates a loop variable over all ConfiguredProducts, while clicking the *arrow* lets you browse ConfiguredProduct's attributes.

### `#this` Context Awareness

When the starting object IS the base document object, expressions use `#this` instead of repeating the object name:
- Base object = Solution → `#this.related('ConfiguredProduct','solution')`
- Base object = Proposal → `solution.related('ConfiguredProduct','solution')`

The expression generator handles this transparently based on the selected starting object.

### Filter Value Suggestions from Data

When browsing a path with multiple records, the prototype offers a filter builder with:
- **Attribute dropdown**: Populated from the object schema (describe API)
- **Value dropdown**: Populated from **unique values in the actual records** (list API)
- This is significantly better UX than free-text input — users see what values exist

---

## Data Transforms

There are two distinct levels of transforms in DocGen:

### 1. Pipeline Transforms (Data Tab — Built into Variable Definition)

These transforms are part of the `$define{}$` expression itself. They shape the *data structure* before it's used in templates. The wizard presents these as a visual chain after source + filter.

| Transform | Syntax | Purpose | Needs Field |
|-----------|--------|---------|-------------|
| Extract field | `.{field}` | Pick a single field from each item | Yes |
| Group by | `.groupBy('field')` | Group items by field value | Yes |
| Flatten | `.flatten()` | Flatten nested collections | No |
| Sum | `.sum()` | Sum numeric values | No |
| Count | `.size()` | Count items | No |
| Sort | `.sort('field')` | Sort by field | Yes |

**Chaining example:**
```
$define{#segmentTotals = #cp.flatbom.{?qty>0}.groupBy('segmentGroup').{netPrice}.sum()}$
```

The pipeline is visually rendered as numbered steps: Source → Filter → Transform₁ → Transform₂ → Result. Each step shows its syntax and can be removed independently.

### 2. Display Transforms (Builder Tab — Applied at Render Time)

> Ported from prototype `transforms.js` — 40+ transforms that modify how values display.

These append to `${}$` inline expressions: `${#pump.price.price(0)}$`, `${#item.date.date("SHORT")}$`

| Category | Transforms | Applies To |
|----------|-----------|------------|
| Number | `price(decimals)`, `percent()`, `integer()`, `number(decimals)`, `round(N)`, `significants(N)`, `thousands()`, `signed()` | Number, Price |
| Date | `date("SHORT")`, `date("MEDIUM")`, `date("LONG")`, `date("FULL")`, `datetime("format")` | Date, DateTime |
| String | `trim()`, `replaceAll(old,new)`, `toUpperCase()`, `toLowerCase()`, `split(separator)` | String |
| Universal | `\|\|""` (fallback if null), `size()` | Any |

### Key Behaviours

- **Type-aware**: Only show applicable transforms per field type (no `.price()` on a String)
- **Parametric**: Some transforms take user input: `.round(2)`, `.date("SHORT")`
- **Chainable**: Multiple transforms in sequence: `${expr.price(0).trim()}$`
- **Client-side preview**: Match table should apply transforms for preview

### Integration with Data Tab

Pipeline transforms are generated as part of the `$define{}$` expression by `generateExpression()` in variables.js. The transform chain is stored as an array on the variable object: `transforms: [{ type: 'groupBy', field: 'segmentGroup' }, { type: 'sum' }]`.

Display transforms are a Builder/Preview concern — they modify output formatting, not data structure.

---

## Quick-Start Recipes (Cookbook)

> Ported from prototype `cookbook.js` — 30+ pre-built expression patterns.

The Data tab should offer a "Quick Start" or "From Template" option when creating a new variable, seeded with common patterns:

### BOM Patterns
- **Flat BOM per CP**: `#cp.flatbom.{?field=="value"}` (within a `$for{#cp in ...}$`)
- **Legacy flat BOM**: `#this.flatbom.{?field=="value"}` (when starting object is CP)
- **Nested BOM** (sub-items): `#var.subItems`
- **Catch-all**: `#cp.flatbom.{?NOT IN #pump, #motor}`

### Object Patterns
- **Account name**: `solution.opportunity.account.name`
- **All ConfiguredProducts**: `solution.related('ConfiguredProduct','solution')`
- **Related entities**: `solution.opportunity.account.related("Contact","account")`
- **Config attribute**: `getConfigurationAttribute("node.field").value`

### Collection Operations (Transform Pipeline)
- **Sum**: `#bomVar.{price}.sum()`
- **Filter + project**: `#bomVar.{?qty>0}.{description}`
- **Sort**: `#bomVar.sort("name")`
- **Group by**: `#bomVar.groupBy('segmentGroup')`
- **Flatten**: `#grouped.flatten()`
- **Count**: `#bomVar.size()`
- **Chained**: `#cp.flatbom.{?qty>0}.groupBy('segmentGroup').flatten().sum()`

### Null Safety
- **Ternary**: `#v != null ? #v.value : "N/A"`
- **Fallback**: `#v.name || "Unknown"`

These recipes let new users start from a working pattern instead of building from scratch.

---

## Caching Strategy

> Ported from prototype `data-preview.js` and `starting-point.js`.

### Model Cache
- Key: `ticketId`
- Value: Full object model from describe API (all types, attributes, refs)
- Lifetime: Session (until explicit refresh)
- Why: Model rarely changes; avoid re-describing on every navigation

### Record Cache
- Key: `ticketId::objectName`
- Value: Array of records for that object type
- Lifetime: Until user clicks Refresh
- Why: Records can be large; cache to avoid re-fetching during filter changes

### Multi-Hop Resolution Cache
For deep dot-walk paths (e.g., `solution.opportunity.account.name`), the prototype chains through intermediate objects:
1. Fetch Solution records
2. Collect `opportunity` ref IDs → fetch Opportunity records
3. Collect `account` ref IDs → fetch Account records
4. Read `name` from Account

Each intermediate fetch is cached. The match table re-uses these caches when filters change.

### Case-Insensitive Field Fallback
The Tacton API may return `Name` in the describe schema but `name` in actual records. The data layer must handle this transparently with case-insensitive field lookup.

---

## API Integration Points

### Object Model Discovery
```
GET /!tickets~{id}/api-v2.2/describe
→ Returns all object types, attributes, data types, references
→ Used for: field suggestions in filter builder, dot-walk autocomplete
```

### Record Listing (BOM items)
```
GET /!tickets~{id}/api-v2.2/{objectType}
→ Returns all records of an object type
→ Used for: match table preview, coverage calculation, flatbom data
```

### Related Records
```
GET /!tickets~{id}/api-v2.2/{objectType}/{id}/related/{refField}
→ Traverse relationships
→ Used for: object variable preview, related() expression building
```

---

## Real-World Expression Patterns (from template analysis)

### Simple BOM filter
```
$define{#pump = #this.flatbom.{?jdeSegmentGroup == "411SEG"}}$
```

### Multi-condition BOM filter (OR)
```
$define{#pump = #this.flatbom.{?jdeSegmentGroup=="411SEG" || jdeSegmentGroup=="420SEG" || jdeSegmentGroup=="430SEG"}}$
```

### Cross-field BOM filter
```
$define{#firePumpCtrl = #this.flatbom.{?jdeSegmentGroup=="ELECTFPCONT" || jdePartNumber=="ELECT FP CONT"}}$
```

### TECE-style quantity filter
```
$define{#activeItems = flatbom.{?mbom_qty && mbom_qty > 0}}$
```

### Catch-all exclusion
```
$define{#otherItems = #this.flatbom.{?NOT IN #pump, #motor, #firePumpCtrl, #jockeyCtrl, #alarmPanel}}$
```

### Object field reference
```
$define{#accountName = solution.opportunity.account.name}$
```

### Related entity lookup
```
$define{#contact = solution.opportunity.account.related("Contact","account")}$
```

### Configuration attribute
```
$define{#pumpWeight = getConfigurationAttribute("nonfire_pump_node-1.splitCase_nonFire_assy.pumpWeight").value}$
```

### Chained projection
```
$define{#added = #listCurrent.{?(positionPath + name) not in #listPrevious.{positionPath + name}}}$
```

### Array arithmetic (PARKER_LIFTS)
```
${(#array[5]*1+0.0001).round(-2).price(0)}$
```

### Null-safe ternary
```
${#v != null ? #v.valueDescription : "N/A"}$
```

---

## Official Tag Inventory (from Tacton docs)

Cross-referenced against the official Word Templates documentation. Tags marked ★ are relevant to the Data tab variable system; others are Builder/Preview concerns.

### All Official Tags

| Tag | Purpose | Data Tab Relevance |
|-----|---------|-------------------|
| `${ expr }$` | Insert text | ★ Expression preview |
| `$!{ expr }$` | Optional insert (silent remove if empty) | ★ Users must choose `${}$` vs `$!{}$` |
| `$if/$elseif/$else/$endif` | Conditional | Builder concern |
| `$for{ #var in expr }$` | Loop with variable | ★ Uses defined variables |
| `$for{ #var : #status in expr }$` | Loop with status variable | Builder (status.index, isFirst, isLast, etc.) |
| `$group{ expr }$` | Repeat paragraphs (scoped) | Builder — uses `#parent`, `#status` |
| `$rowgroup{ expr }$` | Repeat table rows (scoped) | Builder — uses `#parent`, `#status` |
| `$define{ #var = expr }$` | Define variable | ★ **Core Data tab output** |
| `$image{ expr }$` | Insert image | Tier 3 |
| `$doc{ expr }$` | Insert document paragraphs | Builder/fragment |
| `$insertDocument{ expr }$` | Insert full document with headers/footers | Builder |
| `$fragment:NAME$` | Define reusable fragment | Builder/fragment |
| `$insert{ expr }$` | Insert fragment | Builder/fragment |
| `$import{ filename }$` | Import fragment file | Builder/fragment |
| `$html{ expr }$` | Insert HTML as Word content | Niche |
| `$link{ text, url }$` | Insert hyperlink | Niche |
| `$attachPDF{ expr }$` | Attach PDF to output | Niche |
| `$pagebreak$` | Insert page break | Builder |

### Key Rules for Variable System

1. **No redefinition**: Each `#variable` name can only be `$define$`d once per scope. The Data tab must enforce unique names and warn on duplicates.
2. **Scope**: Variables are available to all _following_ expressions in the current scope. Order matters — the variable list order in the Data tab determines expression order in the output.
3. **`#parent` scoping**: Inside `$group$`/`$rowgroup$`, expressions are relative to the list item. `#parent.expr` escapes up. Variables defined outside groups are still accessible.
4. **`#this` reference**: References the current base document object. Used in `#this.related(...)` and `#this.flatbom`.
5. **`#status` variable**: Available inside `$for$` (with `: #Status` syntax), `$group$`, and `$rowgroup$`. Provides `.index`, `.count`, `.isFirst`, `.isLast`, `.isOdd`, `.isEven`, `.items`.

### Object Methods (ConfiguredProduct)

These are callable on ConfiguredProduct/ShoppingCartItem objects and should be recognized by the expression builder:

- `customVisualizationImage('modelFieldName')` — returns image for a model field
- `cadDoc('outputType', 'fileType')` — returns CAD document
- `cadDocIndexed('outputType', 'fileType', 'index')` — indexed CAD document
- `cadPositions()` — list of assembly positions for CAD iteration
- `cadDocNamedPosition('outputType', 'fileType', position)` — positional CAD document

### `$!{}$` vs `${}$` Decision

The Data tab expression generator should offer a toggle or hint:

- **`${ expr }$`** — Error if value missing (use for required fields)
- **`$!{ expr }$`** — Silently remove paragraph/row if empty (use for optional fields)

This is especially relevant for Object variables where a field might be null.
