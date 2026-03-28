# Tacton DocGen Template Syntax Reference

> Extracted from real production templates (GAPump, changeOrderDocumentCP)

---

## Token Syntax

All tokens use `$keyword{...}$` delimiters.

### Inline Expression
```
${expression}$
```
Evaluates expression and inserts the result inline.
```
${solution.opportunity.account.name}$
${getConfigurationAttribute("node.field").valueDescription}$
${#myVar}$
```

### Define Variable
```
$define{#varName=expression}$
```
Creates a local variable accessible as `#varName` in subsequent tokens.
```
$define{#pumpWeight=getConfigurationAttribute("nonfire_pump_node-1.splitCase_nonFire_assy.pumpWeight").value}$
$define{#contact=solution.opportunity.account.related("Contact","account")}$
$define{#listCurrent = flatbom}$
$define{#added = #listCurrent.{? (positionPath + name) not in #listPrevious.{positionPath + name}}}$
```

### Conditional
```
$if{condition}$
  ...content...
$elseif{condition}$
  ...content...
$else$
  ...content...
$endif$
```
```
$if{pumpDrawing}$
  $image{{pumpDrawing.gaDrawingFile,432,300}}$
$else$
  No GA Drawing available.
$endif$
```

### For Loop
```
$for{#item in collection}$
  ...content using ${#item.field}$...
$endfor$
```
```
$for{#item in #added}$
  ${#item.name}$ ${#item.description}$
$endfor$
```

### Image
```
$image{{expression, width, height}}$
```
```
$image{{pumpDrawing.gaDrawingFile,432,300}}$
```

### Import (external template file)
```
$import{"./filename.docx"}$
```
Includes another template file inline. Used for modular template composition.

### Fragment Definition
```
$fragment:fragmentName(param1, param2)$
  ...template content...
```
Defines a reusable fragment that can be called with `$insert{}$`.

### Fragment Insert
```
$insert{"fragmentName", arg1, arg2, arg3}$
```
Calls a previously imported fragment with arguments.
```
$insert{"pumpDataTables", pumpProductLine, node, solution}$
```

---

## Expression Language (Spring EL)

### Data Access

| Pattern | Description | Example |
|---------|-------------|---------|
| `fieldName` | Direct field on starting object | `${summary}$` |
| `object.field` | Dot-walk navigation | `${solution.opportunity.account.name}$` |
| `getConfigurationAttribute("path")` | Get configured attribute | `.value`, `.valueDescription` |
| `flatbom` | Full flat BOM list | `$define{#list = flatbom}$` |
| `related('type','field')` | Reverse relationship lookup | `solution.opportunity.account.related("Contact","account")` |
| `#varName` | Local variable reference | `${#pumpWeight}$` |

### Collection Filtering (Spring EL)
```
collection.{? condition }
```
Returns items matching condition.
```
flatbom.{? (positionPath + name) not in #listPrevious.{positionPath + name}}
#listCurrent.{? material != null}
```

### Collection Projection
```
collection.{expression}
```
Maps each item to the expression result.
```
#listCurrent.{positionPath + name}
#listCurrent.{? material != null}.{material}
```

### Methods

| Method | Description | Example |
|--------|-------------|---------|
| `.value` | Raw value of attribute | `getConfigurationAttribute("x").value` |
| `.valueDescription` | Display label | `getConfigurationAttribute("x").valueDescription` |
| `.size()` | Collection count | `#added.size() > 0` |
| `.sum()` | Sum numeric collection | `#list.{material}.sum()` |
| `.price()` | Format as price | `#total.price()` |
| `.price(decimals)` | Price with decimals | `.price(0)` |
| `.round(places)` | Round number | `.round(-2)` |
| `.replace(a, b)` | String replace | `#str.replace(":",",")` |
| `.split(sep)` | Split string to array | `#str.split(",")` |
| `.trim()` | Trim whitespace | `#str.trim()` |

### Operators

| Operator | Example |
|----------|---------|
| `+` (concat/add) | `positionPath + name`, `#totalWeight - 0` |
| `-` (subtract) | `#current - #previous` |
| `*` (multiply) | `#val * 1` |
| `==` | `pumpType == "blue"` |
| `!=` | `#field != null` |
| `>`, `<`, `>=`, `<=` | `#tableLength == 5` |
| `not in` | `name not in #otherList.{name}` |
| `matches` | `#this.ref matches '^HYD.*'` |
| `? :` (ternary) | `#val != null ? #val.valueDescription : "N/A"` |
| `&&`, `\|\|` | `#added.size() > 0 \|\| #deleted.size() > 0` |

### Null Safety Pattern
```
${getConfigurationAttribute("x") != null ? getConfigurationAttribute("x").valueDescription : "N/A"}$
```
or with variables:
```
$define{#v=getConfigurationAttribute("x")}$
${(#v != null && #v.value != null) ? #v.valueDescription : "N/A"}$
```

---

## Template File Structure

### document.properties
```
main:GAPumpTemplate.docx
```
Declares the entry-point template file.

### Multi-file Composition
```
GAPumpTemplate.docx          ← main template
├── $import{"./tableTemplates.docx"}$
│   └── $fragment:cadTable$
└── $import{"./pumpDataTableTemplates.docx"}$
    ├── $fragment:pumpDataTables(...)$
    ├── $fragment:pumpDataNotes(...)$
    └── $fragment:pumpDataQuoteInformation(...)$
```

---

## Relevance to DocGen Plugin

### Data Catalogue (Phase 3)
The `$define{}$` variables map directly to our variable system:
- **BOM type**: `$define{#list = flatbom.{? condition }}$`
- **Object type**: `$define{#val = getConfigurationAttribute("path")}$` or `$define{#contact = solution.opportunity.account.related(...)}`
- **List type**: Not commonly seen in templates (used for UI-driven value sets)

### Builder Zone (Future)
- `$if{}$` / `$for{}$` / `$fragment:` / `$insert{}$` / `$import{}$` → formula sections
- Table generation patterns → repeating block builder
- Null-safety ternaries → conditional content helpers

### Expression Complexity
Real templates use deeply nested expressions with method chaining, arithmetic, null checks, and collection operations. The expression editor needs to support this full syntax, not just simple field references.
