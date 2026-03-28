# Word Template Tags — Official Reference

> Source: Tacton CPQ official documentation — Word Templates
> Saved: 2026-03-28

---

## Styling Rules

- **Tag styling**: Style the initial `$` sign (or the entire tag). The output value inherits that styling.
- **Static text**: Style freely in Word as normal.
- **Images**: Displayed at original size; styling the tag does not affect the image.
- **Snippets / Fragments**: Style the text _inside_ the included document. Styling the `$doc{}$`, `$includeDocument{}$`, or `$insert{}$` tag itself does **not** influence output text.
- **Snippet paragraph merging**: The first and last paragraph of a snippet inherit the paragraph style of the insertion point. Middle paragraphs keep their own style. Ensure snippet files use the same styles as the including template.

---

## Tags

### Insert Text

```
${ expression }$
```

- Evaluates the expression, inserts result in place of the tag.
- Missing value → **error**.
- Formatting taken from the leading `$` sign.
- Parts of the tag can use different styles (size, color) for technical or maintenance reasons.

### Optionally Insert Text

```
$!{ expression }$
```

- Same as `${}$` but if the value is missing, empty string, or `0`:
  - The **entire paragraph or table row** containing the tag is removed.
  - **Not** considered an error.

### Conditional Content

```
$if{ expression }$
$elseif{ expression }$
$else$
$endif$
```

- Expression evaluated as boolean.
- If block not included and paragraph becomes empty → paragraph removed. (Add a space before `$if` to prevent removal.)
- `$if$` and `$endif$` can be anywhere in paragraphs but **cannot span different table cells**.
- Any number of `$elseif$` allowed; one `$else$` allowed (must be last before `$endif$`).
- Once one branch matches, remaining `$elseif$` expressions are **not evaluated**.

### Repeat Any Content (For Loop)

```
$for{ #Variable in expression }$  ...  $endfor$
$for{ #Variable : #Status in expression }$  ...  $endfor$
```

- Expression must evaluate to a list.
- Content between `$for$` and `$endfor$` repeats per list item.
- Empty list → block removed.
- `$endfor$` must not be in a different table cell than `$for$`.

**Status variable attributes:**

| Attribute | Type    | Description |
|-----------|---------|-------------|
| `index`   | Number  | Current loop index (0-based) |
| `count`   | Number  | Current loop count (1-based) |
| `isFirst` | Boolean | True on first item |
| `isLast`  | Boolean | True on last item |
| `isOdd`   | Boolean | True on odd count (1st, 3rd, 5th…) |
| `isEven`  | Boolean | True on even count (2nd, 4th, 6th…) |
| `items`   | List    | The full list being iterated |

### Repeat Over Sub Items

```
$for{#var1 in bom}$
Name ${#var1.name}$
$for{#var2 in #var1.subItems}$
    Sub Name ${#var2.name}$
$endfor$
$endfor$
```

Nested loops are supported for hierarchical data.

### Repeat Paragraph (Group)

```
$group{ expression }$
$group{ expression, paragraphs }$
```

- Expression must evaluate to a list.
- `paragraphs` = number of paragraphs to repeat (default 1).
- Groups can be **nested** — track paragraph counts carefully.
- Inside the group, all expressions are **relative to the list item**.
- Use `#parent` to reference the outer scope: `${#parent.expression}$`.
- Status variable available via `#status`.

### Repeat Table Row (Row Group)

```
$rowgroup{ expression }$
$rowgroup{ expression, rows }$
```

- Only used **inside a table** in Word.
- `rows` = number of rows to repeat (default 1).
- Inside the rowgroup, expressions are **relative to the list item**.
- Use `#parent` for outer scope.
- Status variable available via `#status`.

### Insert Image

```
$image{ expression }$
$image{"./myFolder/myImage.jpg"}$
```

- Expression evaluates to a string → image file path.
- Supports GIF, JPG, PNG, etc.

**With size control:**

```
$image{{ expression, width, height }}$
$image{{"image.jpg", 100, 100}}$
```

- Width and height in **points**.
- Images from Module Variants can be inserted from BOM items.

### Insert Document

```
$doc{ expression }$
$doc{"./myFolder/myDocument.docx"}$
```

- Inserts all paragraphs from the referenced Word document.
- Supports `.doc` and `.docx`.
- Only the **first section** of the imported document is inserted.
- The entire paragraph containing the `$doc$` tag is removed.

### Insert Document Sections

```
$insertDocument{ expression }$
$insertDocument{ expression, forcePageBreaks }$
```

- Inserts full pages including **headers and footers**.
- Document inserted directly after the current paragraph.

**`forcePageBreaks` options:**

| Value       | Before inserted | After inserted |
|-------------|----------------|----------------|
| (not set)   | Per section start setting | Per template section setting |
| `beginning` | Next Page break | Continuous |
| `end`       | Continuous | Next Page break |
| `none`      | Continuous | Continuous |
| `both`      | Next Page break | Next Page break |

- Case-insensitive, whitespace trimmed.
- For no page break (Continuous), inserted document must have same page format as current document.

### Document Fragments

#### Define a Fragment

```
$fragment:NAME$  ...  $endfragment$
$fragment:NAME( argument, argument )$  ...  $endfragment$
```

- Fragment definition is completely removed from output.
- NAME must be unique.
- No whitespace between argument names.
- Reference argument `X` inside fragment as `#X`.
- Word formatting of the fragment is preserved when inserted.
- Tip: Use names that contain Object model values for dynamic inclusion.

#### Insert a Fragment

```
$insert{ expression, argument ... }$
```

- Looks up a previously defined or imported fragment by name.
- If fragment not found, looks for `MISSING_FRAGMENT`:
  ```
  $insert{"MISSING_FRAGMENT", expression, Argument1, Argument2}$
  ```

#### Import Fragments

```
$import{ filename }$
$import{"./myFragments.docx"}$
```

- Reads a Word file and extracts all fragments (no output generated).
- One `$import$` per base document — gives access to all fragments in that file.
- **Cannot be conditional** — placing inside `$if$` block still imports regardless.
- Text between fragment definitions in a fragment file is ignored → useful for comments/maintenance.

### Insert HTML Content

```
$html{ expression }$
```

- Expression must evaluate to an HTML string.
- Converted to Word content, replaces the containing paragraph.
- Supported HTML elements include: `<b>`, `<i>`, `<h1>`–`<h6>`, `<ol>`, `<ul>`, `<table>`, `<img>`, inline styles for alignment, color, font.

### Insert Link

```
$link{'Link Text', 'https://www.tacton.com'}$
```

### Attach PDF

```
$attachPDF{ expression }$
$attachPDF{'./myFolder/myPDF.pdf'}$
```

- Attaches a static PDF as the last pages of the generated PDF output.

### Page Break

```
$pagebreak$
```

- Inserts a page break. Useful for conditional page breaks.
- Cannot be used in header/footer.

### Define a Variable

```
$define{ #variable = expression }$
```

- Result available in all following expressions in the current scope via `#variable`.
- Each variable name can only be defined **once** — redefinition is an error.
- Tag removed from output; if paragraph becomes empty, paragraph removed.

**List variable example:**

```
$define{#names={"Anna","Björn","Benny","Agneta"}}$
$for{#n in #names}$
Hello ${#n}$
$endfor$
```

### Load External Resources

```
$doc{"endpoint://endpoint-name/additional-path"}$
```

- Available for `$image$`, `$doc$`, `$insertDocument$`, and `$import$` tags.
- Dynamic path parts should be URL-encoded.

### Resources From Zip File

```
$doc{"resources/file.docx"}$
```

- For Proposal documents, prefix with `./`:
  ```
  $doc{"./resources/file.docx"}$
  ```

---

## Object Methods

### ConfiguredProduct

#### Custom Visualizer Image

```
customVisualizationImage('modelFieldName')
```

- Evaluates `modelFieldName` to get the associated image.
- Typically wrapped: `$if{exists()}$ $image{customVisualizationImage('field')}$ $endif$`

### ConfiguredProduct & ShoppingCartItem

#### CAD Documents

**Single assembly, single output:**

```
cadDoc('Drawing', 'jpg')
```

**Multiple outputs of same type (indexed):**

```
cadDocIndexed('Drawing', 'jpg', '0')
cadDocIndexed('Drawing', 'jpg', '1')
```

**Multiple assembly positions:**

```
$for{#cadPosition in cadPositions()}$
#cadPosition.cadDocNamedPosition('Assembly', 'jpg', #cadPosition)
#cadPosition.cadDocNamedPositionIndexed('Drawing', 'jpg', #cadPosition, '1')
$endfor$
```

- Generated PDFs can be attached with `$attachPDF{}$`.

---

## Common Expression Patterns

### Print Object Attributes (context matters)

```
${solution.opportunity.account.name}$   // base object: proposal
${opportunity.account.name}$            // base object: solution
${account.name}$                        // base object: opportunity
```

### List ConfiguredProducts from Proposal

```
// base object: proposal
$for{#cp in solution.related('ConfiguredProduct', 'solution')}$
${#cp.name}$
$endfor$
```

### List ConfiguredProducts from Solution

```
// base object: solution
$for{#cp in #this.related('ConfiguredProduct', 'solution')}$
${#cp.name}$ - ${#cp.summary}$
$endfor$
```

Note: `#this` references the current object itself.

### General Related Pattern

```
<parentReference>.related('<childObject>', '<childToParentReference>')
```
