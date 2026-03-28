# Original DocGen Plugin — Feature Analysis

> Source: /DocgenPlugin/src/taskpane/*.js (prototype v1)
> Analysed: 2026-03-28
> Purpose: Extract data-relevant features for V2 Data tab implementation

---

## Architecture Overview

The prototype combines data browsing, expression building, and Word insertion in a single flow.
No separation between "Data" and "Builder" — the user navigates the model, builds an expression,
and inserts it into the document in one pass. V2 separates these: **Data tab** defines variables,
**Builder tab** uses them in the document.

### File Responsibilities

| File | Function | V2 Mapping |
|------|----------|------------|
| expression-builder.js | Object/attribute browsing, breadcrumbs, reverse refs | **Data tab** — model browser |
| data-preview.js | Live data fetching, resolution, filter builder, preview | **Data tab** — match table, filter builder |
| formula.js | Tag synthesis, OOXML table generation, Word insertion | **Builder tab** |
| formula-preview.js | Preview UI, clipboard, inline editing | **Builder tab** |
| starting-point.js | Root object picker, model loading, OAuth, favorites | **Setup tab** (done) + **Data tab** |
| syntax-resolver.js | Tag parsing, condition eval, resolve banner | **Preview tab** |
| transforms.js | 40+ data transforms (.price, .date, .round, etc.) | **Data tab** + **Builder tab** |
| loop-columns.js | Column selection, branch management, transforms | **Builder tab** |
| typeahead.js | In-document autocomplete, loop context detection | **Builder tab** |
| cookbook.js | 30+ pre-built formula snippets | **Builder tab** |
| state.js | Centralized mutable state | **State store** (done) |
| storage.js | localStorage persistence | **Dexie DB** (done) |
| helpers.js | DOM utilities, toast, logging | **Shared utils** (done) |

---

## Data-Relevant Features (for V2 Data Tab)

### 1. Object Model Browser (expression-builder.js)

**Breadcrumb Navigation:**
- Clickable trail: `Solution → opportunity → account → name`
- Each segment is an object or attribute hop
- Click any breadcrumb to jump back to that level
- Shows current object type + attribute count

**Bidirectional Reference Traversal:**
- **Forward refs** (→): Clicking a ref-type attribute navigates into the referenced object
- **Reverse refs** (←): Computed by scanning ALL objects for attributes whose refType points to the current object
  - Example: Browsing `Solution` shows `← ConfiguredProduct.solution` (because ConfiguredProduct has a `solution` attribute pointing to Solution)
  - Generates `.related('ConfiguredProduct','solution')` expression

**Two Click Modes for Ref Attributes:**
- Click attribute **name** → select it as collection target (for loops)
- Click **arrow icon** → navigate deeper into the referenced object (for dot-walk)

**Filter Prefix Injection:**
- When browsing from a collection context, allows adding `{?field=="value"}` filter before navigation
- UI: attribute dropdown + value dropdown → generates filter prefix

**`#this` Context Awareness:**
- When the root object is the base document object, paths use `#this.related(...)` instead of `objectName.related(...)`
- Automatically determined from starting point selection

### 2. Live Data Preview (data-preview.js)

**Record Fetching & Caching:**
- Fetches records via ticket-scoped API on demand
- Cache key: `ticketId::objectName`
- Refresh button clears cache and re-fetches
- In-session deduplication prevents redundant API calls

**Expression Path Walking (Multi-Hop Resolution):**
- Single-hop: Direct attribute read from root records
- Multi-hop: Chains through reference IDs
  1. Fetch root records
  2. For each hop in path: collect ref IDs → fetch target object records → filter by ID
  3. For reverse hops (← prefix): fetch target records → filter by their forward-ref matching current IDs
- Full deep resolution for arbitrary path depth

**Filter Builder UI:**
- Triggered when multiple records exist at a path node
- Shows "N records — add a filter?" prompt
- **Attribute dropdown**: populated from object schema
- **Value dropdown**: populated from unique values in actual records
- **Apply/Clear** buttons
- Generates `{?attr=="value"}` prefix expression

**Preview Rendering:**
- **Scalar**: Shows resolved value + "X more records" count
- **Loop/collection**: Renders selected columns in table format
- **Raw debug table**: ALL columns, collapsed by default, horizontal scroll
- Drag-and-drop column reordering in table headers

**Case-Insensitive Field Fallback:**
- Handles schema casing mismatches between describe API and list API transparently
- Important: Tacton API may return `Name` in schema but `name` in records

### 3. Starting Point & Favorites (starting-point.js)

**Searchable Object Picker:**
- All available object types listed
- Keyboard search/filter
- **Star favorites**: Click star to favorite, favorites sorted first with separator
- Attribute count badge per object

**Model Loading:**
- `describeTicket(ticketId)` → full object model
- Cached in `modelCache` with metadata: objectCount, attributeCount
- OAuth2 dialog if token expired → auto-refresh

### 4. Data Transforms (transforms.js)

**40 Transform Definitions:**

| Category | Transforms |
|----------|-----------|
| Number | `price()`, `percent()`, `integer()`, `number()`, `round(N)`, `significants(N)`, `thousands()`, `signed()` |
| Date | `date("SHORT")`, `date("MEDIUM")`, `date("LONG")`, `date("FULL")`, `datetime("format")` |
| String | `trim()`, `replaceAll(old,new)`, `toUpperCase()`, `toLowerCase()`, `split(sep)` |
| Universal | `\|\|""` (fallback), `size()` |

**Transform Features:**
- Type-specific: `.price()` only shows for Price/Number fields
- Parametric: `.round({param})`, `.date("{param}")` with user input
- Chainable: multiple transforms in sequence
- Client-side preview matches server-side behavior

### 5. Loop Column Management (loop-columns.js)

**Column Types:**
- **Status columns** (@ prefix): @count, @index, @first, @last, @odd, @even
- **Regular columns**: Leaf attributes (non-reference) of the target object
- Toggle, select-all, select-none operations

**Branch Management (for conditional loops):**
- Main branch: selected columns without condition
- If/elseif/else branches: separate column sets per condition
- Active branch switching with save/load
- Tab bar showing condition expressions

**Per-Column Transform Config:**
- Each column stores: `{ key, param, param2 }`
- Rendered as dropdown picker per column
- Defaults based on attribute type

### 6. Cookbook / Recipe Library (cookbook.js)

**30+ Pre-Built Snippets by Category:**
- **BOM patterns**: hierarchical (nested for-loops), flat (single-level)
- **Filtering**: attribute filters, existence checks, null guards
- **Aggregation**: sum, groupBy
- **References**: .related(), reverse traversal
- **Conditional**: $if/$elseif/$else combinations
- **Variables**: $define{} for reuse
- **Status**: #Status.count, .isFirst, .isLast
- **Date formatting**: SHORT/MEDIUM/LONG/FULL
- **Null-safe**: ternary `expr != null ? expr : "N/A"`, fallback `|| ""`

### 7. Typeahead / In-Document Autocomplete (typeahead.js)

**Detection:**
- Polls paragraph text for unclosed `${ ` pattern
- Detects cursor position within tag

**Loop Context Inference:**
- Scans backward from cursor for enclosing `$for{...}$`
- Extracts loop variable name (`#item`) and target object
- When inside loop: suggests only target object attributes with loop var prefix
- When outside loop: suggests full model (all objects + attributes)

**Suggestions:**
- Flat list of `ObjectType.attribute` entries
- Type badges and ref arrows
- Selection inserts completed expression

### 8. Syntax Resolver (syntax-resolver.js)

**Tag Parsing:**
- Extracts object/attribute path from `${...}$` tags
- Handles `.related()`, `.flatten()`, `.groupBy()`, `.{?filter}` patterns
- Strips transform method calls from tail

**Condition Evaluation:**
- Parses conditions: `expr == val`, `expr && expr`, `expr != null`
- Operators: ==, !=, >, <, >=, <=, in, contains
- Evaluates against first record in data set

---

## Gaps in V2 DATA-TAB-SPEC.md (now addressed)

These features exist in the prototype but were missing or underspecified in the V2 spec:

| Feature | Prototype Location | V2 Impact |
|---------|-------------------|-----------|
| **Reverse reference browsing** | expression-builder.js | Model browser must compute incoming refs |
| **`#this` context awareness** | expression-builder.js | Expression generator must use `#this` vs object name |
| **Filter value dropdown from data** | data-preview.js | Filter builder should suggest values from actual records |
| **Multi-hop path resolution** | data-preview.js | Match table must chain through refs for deep paths |
| **Case-insensitive field fallback** | data-preview.js | API layer must handle schema/data casing mismatch |
| **Transform library (40 transforms)** | transforms.js | Expression generator + preview must support transforms |
| **Status column variables** | loop-columns.js | Builder concern, but Data tab should surface `#Status` |
| **Cookbook / recipe library** | cookbook.js | "Quick start" templates for common variable patterns |
| **Favorites for starting points** | starting-point.js | Star/favorite UI for frequently-used objects |
| **Typeahead loop context** | typeahead.js | Builder concern, but variable names feed into suggestions |
| **Drag-and-drop column reorder** | data-preview.js | Match table column ordering |

---

## Key Design Decisions from Prototype

1. **Model cache per ticket** — Don't re-describe on every navigation; cache the full model and serve locally.

2. **Record cache per object type** — `ticketId::objectName` key. Refresh on demand, not automatically.

3. **Reverse refs are computed, not stored** — Scan all objects in model to find incoming references. This is O(objects × attributes) but the model is small enough.

4. **Filter values come from actual data** — Don't just let users type filter values; populate a dropdown from the unique values in the fetched records. Much better UX.

5. **Transforms are type-aware** — Only show `.price()` for Number/Price fields, `.date()` for Date fields. Reduces clutter.

6. **`#this` is implicit** — When the starting object IS the base document object, use `#this` instead of repeating the object name. The expression builder handles this transparently.

7. **Two-click mode for refs** — Click name = select as target, click arrow = navigate deeper. This dual-mode was effective in the prototype.

8. **Status columns are opt-in** — Only add `#Status` to the `$for$` tag when the user actually selects status columns. Keeps expressions clean.
