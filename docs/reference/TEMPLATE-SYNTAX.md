# Tacton DocGen Template Syntax Reference

> Extracted from real production templates (GAPump, changeOrderDocumentCP, Parker Lifts elevator suite)

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

### Expression Root Context

All expressions in a Tacton Word template are evaluated relative to a **root context object**.
At the document top level, the root context provides access to named attributes — most importantly `solution` — which is the entry point for all object model navigation.

**Key rule**: dot-walk expressions always start with a **lowercase attribute name** (e.g. `solution`), not the PascalCase object type name (`Solution`). The attribute name is a forward ref on the root context object that points to the Solution object.

```
solution.opportunity.account.name          ← starts with attribute 'solution'
solution.related('ConfiguredProduct','solution')
solution.currency.isoCode||""
solution.installationSiteName
```

Inside a `$for` loop, the root context shifts to the loop variable:
```
$for{#cp in solution.related('ConfiguredProduct','solution')}$
  ${#cp.name}$                              ← #cp is now the context
  ${#cp.flatbom}$
  ${#cp.integrationAttributes.totalCostOfOwnershipPerYear.thousands("en")}$
$endfor$
```

### Data Access

| Pattern | Description | Example |
|---------|-------------|---------|
| `solution.field` | Dot-walk from root | `${solution.installationSiteName}$` |
| `solution.ref.ref.field` | Deep dot-walk | `${solution.opportunity.account.name}$` |
| `solution.related('Type','attr')` | Reverse ref collection | `solution.related('ConfiguredProduct','solution')` |
| `solution.ref.related('Type','attr')` | Reverse ref after dot-walk | `solution.opportunity.account.related('Contact','account')` |
| `getConfigurationAttribute("path")` | Get configured attribute | `.value`, `.valueDescription` |
| `flatbom` / `#cp.flatbom` | Full flat BOM list | `$define{#list = flatbom}$` |
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
| `.thousands("locale")` | Format with thousands separator | `#val.thousands("en")` |
| `.groupBy('field')` | Group collection by field | `#cp.flatbom.groupBy('segmentGroup')` |
| `.sort('field')` | Sort collection by field | `#cp.flatbom.sort('variantName')` |
| `.flatten()` | Flatten nested collections | `#grouped.flatten()` |

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

### Data Catalogue — Variables vs Blocks

The plugin distinguishes two purposes for data set definitions:

**Variables** (purpose = `variable`) use `$define{}$` syntax — named scalar values:
- `$define{#accountName=solution.opportunity.account.name}$`
- `$define{#pumpWeight=getConfigurationAttribute("nonfire_pump_node-1.splitCase_nonFire_assy.pumpWeight").value}$`
- `$define{#currency=solution.currency.isoCode||""}$`
- `$define{#names={"Anna","Björn","Benny","Agneta"}}$`

**Blocks** (purpose = `block`) are raw source expressions — they feed into template constructs:
The catalogue stores just the source (e.g. `solution.related('ConfiguredProduct','solution')`). Real templates use three patterns to consume them:

1. **Direct in `$for`** (cleanest — Parker, TECE):
   `$for{#cp: #status in solution.related('ConfiguredProduct','solution').{?name=="Elevator solution"}}$`
   `$for{#cp: #status in related('ConfiguredProduct','parentItem')}$`

2. **Direct in `$rowgroup` / `$group`** (Sandvik, Parker, Cytiva):
   `$rowgroup{#cp.bom.{?netPrice},2}$`
   `$group{#uniqueItems}$`

3. **Inline assignment when reused** (Cytiva):
   `${#filteredBom=bom.{?mbom_qty && mbom_qty>0}}$` then `$for{#item in #filteredBom}$`

### Data Set Types

| Type | Icon | Purpose | Example sources |
|------|------|---------|----------------|
| **single** | target (green) | Scalar value | `solution.opportunity.account.name`, `getConfigurationAttribute("x").value`, `related('CP','solution')[0]` |
| **bom** | box (orange) | BOM collection | `#cp.flatbom`, `bom.{?mbom_qty>0}`, `#filteredBom.sort("name")` |
| **object** | cube (purple) | Object model collection | `related('ConfiguredProduct','solution')`, `#this.related('Contact','account')` |
| **list** | list (blue) | Hardcoded list | `{"Anna","Björn","Benny"}` |

### Real-World Patterns (from Parker Lifts elevator templates)

**Document-level expressions** (root context → solution):
```
$define{#currency=solution.currency.isoCode||""}$
${solution.installationSiteName}$
$!{solution.installationCountry.name}$
$!{solution.opportunity.responsibleSalesPerson.fullName}$
$!{solution.opportunity.responsibleSalesPerson.organization.name}$
${solution.owner.fullName}$
${solution.owner.email}$
$if{solution.totalDealDiscount>0}$ ... $endif$
$if{solution.unitOfMeasurements.name=="Metric"}$ ... $endif$
```

**Iteration over ConfiguredProducts** (most common block pattern):
```
$rowgroup{solution.related('ConfiguredProduct','solution')}$
$for{#cp: #status in solution.related('ConfiguredProduct','solution').{?name=="Elevator solution"}}$
$for{#CS: #status in solution.related('ConfiguredSERVICE','solution')}$
```

**Inside a CP loop** (context is #cp):
```
${#cp.name}$  ${#cp.id}$
${#cp.localListPriceOneTime.price()}$
${#cp.dealDiscount.round(-2)}$
${#cp.netPrice.price()}$
${#cp.integrationAttributes.totalCostOfOwnershipPerYear.thousands("en")}$
$rowgroup{#cp.bom.{?netPrice},2}$
$rowgroup{subItems}$
${subItems.{localListPrice}.sum().price()}$
```

**Nested data** (inside rowgroup, context is the BOM item):
```
${artNo}$  ${description}$  ${qty}$
${localListPrice.price()}$
${netPrice.price()}$
${dealDiscount.round(-2)}$
```

**Solution-level totals**:
```
$!{solution.totalLocalListPrice.price()}$
$!{solution.totalDealDiscount.round(-2)}$
$!{solution.totalNetPrice.price()}$
$!{solution.totalMonthlyNetPrice.price()}$
```

### Builder Zone (Future)
- `$if{}$` / `$for{}$` / `$fragment:` / `$insert{}$` / `$import{}$` → formula sections
- Table generation patterns → repeating block builder
- Null-safety ternaries → conditional content helpers

### Expression Complexity
Real templates use deeply nested expressions with method chaining, arithmetic, null checks, and collection operations. The expression editor needs to support this full syntax, not just simple field references.
