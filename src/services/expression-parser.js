/**
 * Expression Parser — recognises and decomposes DocGen template expressions.
 *
 * Supported syntax:
 *   $define{#name=expr}$         → define (variable or block)
 *   ${#name}                     → inline variable reference
 *   $for{item in #source}$      → for-loop start
 *   $endfor{}$                   → for-loop end
 *   solution.opportunity.name    → raw dot-path (object walk)
 *   #this.flatbom               → raw source reference
 *
 * Each parse result has:
 *   { type, raw, name?, source?, varName?, loopVar?, path? }
 */

// ─── Main parser ────────────────────────────────────────────────────

/**
 * Normalise Word quirks: smart/curly quotes → straight, non-breaking spaces → regular.
 * Word often replaces " with \u201C/\u201D and ' with \u2018/\u2019,
 * and inserts non-breaking spaces (\u00A0) in expressions.
 */
function normaliseWordText(str) {
  return str
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')   // smart double → straight
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")   // smart single → straight
    .replace(/\u00A0/g, ' ')                                     // non-breaking space → space
    .replace(/\u2260/g, '!=');                                   // ≠ → !=
}

/**
 * Parse a selected text string and return a structured result, or null if
 * it doesn't look like a recognisable expression.
 *
 * @param {string} text — raw text from the Word selection (trimmed)
 * @returns {ParseResult|null}
 *
 * ParseResult shape:
 *   type:      'define' | 'inline' | 'for' | 'endfor' | 'dotpath'
 *   raw:       the original trimmed text
 *   name:      variable name  (e.g. '#accountName')   — for define, inline
 *   source:    RHS expression (e.g. 'solution.opportunity.account.name') — for define
 *   loopVar:   iteration variable (e.g. 'item') — for for-loops
 *   loopSource: source expression (e.g. '#bomItems') — for for-loops
 *   path:      dot-path segments (e.g. ['solution','opportunity','name']) — for dotpath
 *   purpose:   'variable' | 'block' — inferred from structure
 *   dataType:  'bom' | 'object' | 'list' — inferred from source content
 */
export function parseExpression(text) {
  if (!text || typeof text !== 'string') return null;
  const raw = normaliseWordText(text.trim());
  if (!raw) return null;

  // 1. $define{#name=expr}$
  //    Use greedy match for the inner content to handle nested {} in list
  //    literals like {"Active","Inactive","Pending"}
  const defineMatch = raw.match(/^\$define\{(.+)\}\$$/);
  if (defineMatch) {
    const inner = defineMatch[1];
    const eqIdx = inner.indexOf('=');
    if (eqIdx > 0) {
      const name = inner.slice(0, eqIdx).trim();
      const source = inner.slice(eqIdx + 1).trim();
      return {
        type: 'define',
        raw,
        name,
        source,
        purpose: 'variable',
        dataType: inferDataType(source),
      };
    }
  }

  // 2. ${#name=expr}$ — inline block assignment (NOT a define)
  //    e.g. ${#filteredBom=bom.{?mbom_qty && mbom_qty>0}}$
  //    or   ${#bomList=#filteredBom.sort("variantName")}$
  //    Use greedy inner match to handle nested {} in filter/list expressions
  const inlineAssignOuter = raw.match(/^\$\{(.+)\}\$$/);
  if (inlineAssignOuter) {
    const inner = inlineAssignOuter[1];
    // Must have a bare '=' assignment (not !=, ==, >=, <=)
    const assignMatch = inner.match(/^([^=!<>]+?)(?<![!><=])=(?!=)(.+)$/);
    if (assignMatch) {
      const name = assignMatch[1].trim();
      const source = assignMatch[2].trim();
      return {
        type: 'inline-assign',
        raw,
        name,
        source,
        purpose: 'block',
        dataType: inferDataType(source),
      };
    }
  }

  // 2b. ${#name} or ${expression} — inline variable reference / expression
  //    Greedy inner match to handle nested {} in expressions
  const inlineMatch = raw.match(/^\$\{(.+)\}(\$?)$/);
  if (inlineMatch) {
    const inner = inlineMatch[1].trim();
    // Check for assignment: must have a bare '=' (not '!=', '==', '>=', '<=')
    const hasAssignment = /(?<![!><=])=(?!=)/.test(inner);
    if (!hasAssignment) {
      // Try to extract a name from inline null-safe patterns:
      //
      // Variant A (object null-check — most common):
      //   getConfigAttr("x")!=null ? getConfigAttr("x").accessor : "fallback"
      //
      // Variant B (.field null-check):
      //   getConfigAttr("x").value!=null ? getConfigAttr("x").accessor : "fallback"
      //
      // Variant C (null-safe on a #variable):
      //   #motorManufacturer.value!=null ? #motorManufacturer.valueDescription : "N/A"

      let inlineNullSafe = null;  // [_, source, accessor, fallback]
      let nullCheckField = null;  // e.g. '.value' for Variant B

      // Variant A: getConfigAttr("...")!=null ? getConfigAttr("...").accessor : "fallback"
      inlineNullSafe = inner.match(
        /^(getConfigurationAttribute\s*\([^)]+\))\s*!=\s*null\s*\?\s*getConfigurationAttribute\s*\([^)]+\)\.(\w+)\s*:\s*"([^"]*)"\s*$/
      );

      // Variant B: getConfigAttr("...").field!=null ? getConfigAttr("...").accessor : "fallback"
      if (!inlineNullSafe) {
        const variantB = inner.match(
          /^(getConfigurationAttribute\s*\([^)]+\))\.(\w+)\s*!=\s*null\s*\?\s*getConfigurationAttribute\s*\([^)]+\)\.(\w+)\s*:\s*"([^"]*)"\s*$/
        );
        if (variantB) {
          nullCheckField = `.${variantB[2]}`; // e.g. '.value'
          inlineNullSafe = [null, variantB[1], variantB[3], variantB[4]];
        }
      }

      // Variant C: #variable.field!=null ? #variable.accessor : "fallback"
      if (!inlineNullSafe) {
        const variantC = inner.match(
          /^(#\w+)\.(\w+)\s*!=\s*null\s*\?\s*#\w+\.(\w+)\s*:\s*"([^"]*)"\s*$/
        );
        if (variantC) {
          nullCheckField = `.${variantC[2]}`;
          inlineNullSafe = [null, variantC[1], variantC[3], variantC[4]];
        }
      }

      let suggestedName = inlineNullSafe
        ? (inlineNullSafe[1].startsWith('#') ? inlineNullSafe[1] : extractNameFromGetConfig(inlineNullSafe[1]))
        : null;
      // For bare getConfigurationAttribute() without null-safe, still extract a clean name
      if (!suggestedName && inner.includes('getConfigurationAttribute(')) {
        suggestedName = extractNameFromGetConfig(inner);
      }
      return {
        type: 'inline',
        raw,
        name: suggestedName || inner,
        source: inlineNullSafe ? inlineNullSafe[1] : inner,
        accessor: inlineNullSafe ? `.${inlineNullSafe[2]}` : null,
        nullSafeFallback: inlineNullSafe ? inlineNullSafe[3] : null,
        nullCheckField: nullCheckField,
        purpose: 'variable',
        dataType: inlineNullSafe ? 'single' : inferDataType(inner),
      };
    }
  }

  // 3. $for{var in source}$ — loop var may have # prefix (e.g. #currectPrimaryCP)
  const forMatch = raw.match(/^\$for\{([#]?\w+)\s+in\s+([^}]+)\}\$$/);
  if (forMatch) {
    const loopVar = forMatch[1].trim();
    const loopSource = forMatch[2].trim();
    return {
      type: 'for',
      raw,
      loopVar,
      loopSource,
      name: loopSource,
      purpose: 'block',
      dataType: inferDataType(loopSource),
    };
  }

  // 4. $endfor{}$
  if (/^\$endfor\{\}\$$/.test(raw)) {
    return { type: 'endfor', raw, purpose: null, dataType: null };
  }

  // 5. Full define without $ wrapper — e.g. define{#name=expr}
  const bareDefine = raw.match(/^define\{([^=}]+)=([^}]*)\}$/);
  if (bareDefine) {
    const name = bareDefine[1].trim();
    const source = bareDefine[2].trim();
    return {
      type: 'define',
      raw,
      name,
      source,
      purpose: inferPurpose(source),
      dataType: inferDataType(source),
    };
  }

  // 6. Raw dot-path or # reference (e.g. solution.opportunity.name, #this.flatbom)
  if (/^[#]?[\w]+([.]\w+)+$/.test(raw) || /^#\w+$/.test(raw)) {
    const segments = raw.split('.');
    return {
      type: 'dotpath',
      raw,
      path: segments,
      name: raw.startsWith('#') ? raw : null,
      source: raw,
      purpose: inferPurpose(raw),
      dataType: inferDataType(raw),
    };
  }

  // 7. Complex expression with filters/transforms — e.g. #this.flatbom.{?field=="val"}
  if (/^[#]?[\w]+[.\[{(]/.test(raw)) {
    return {
      type: 'dotpath',
      raw,
      path: null,
      name: null,
      source: raw,
      purpose: inferPurpose(raw),
      dataType: inferDataType(raw),
    };
  }

  return null;
}

/**
 * Extract a short variable name from getConfigurationAttribute("path.to.field")
 * e.g. getConfigurationAttribute("nonfire_pump_node-1.pumpSeries") → "pumpSeries"
 */
function extractNameFromGetConfig(expr) {
  const m = expr.match(/getConfigurationAttribute\("([^"]+)"\)/);
  if (!m) return null;
  const path = m[1];
  const segments = path.split('.');
  const last = segments[segments.length - 1];
  // Clean up: camelCase it, remove non-alphanumeric
  return `#${last.replace(/[^a-zA-Z0-9_]/g, '')}`;
}

// ─── Inference helpers ──────────────────────────────────────────────

function inferPurpose(source) {
  if (!source) return 'variable';
  // Placeholder (.{?false}) is always a variable, not a block
  if (source.includes('.{?false}')) return 'variable';
  // BOM-like sources that return collections are typically blocks
  if (source.includes('.flatbom') || source.includes('.bom')) return 'block';
  if (source.includes('$for{') || source.includes('.{?')) return 'block';
  // Lists
  if (/^\{".+"\}$/.test(source)) return 'block';
  return 'variable';
}

function inferDataType(source) {
  if (!source) return 'bom';

  // Check if collection narrows to one record → single
  // [0], [1], [n] — any index access narrows to a single record
  // .{?...} without index keeps it as a collection unless combined with [n]
  const narrowsToOne = /\[\d+\]/.test(source);

  // ── Collection types ────────────────────────────────────────────

  // BOM collection (unless narrowed)
  if (source.includes('flatbom')) return narrowsToOne ? 'single' : 'bom';
  if (source.includes('.sort(')) return 'bom';
  if (source.includes('.groupBy(')) return 'bom';
  if (source.includes('.flatten(')) return 'bom';

  // Filter — single if [n] or if followed by a leaf field (e.g. .{?cond}.fieldName)
  if (source.includes('.{?')) {
    // Strip all filters to get the base path for type inference
    const basePath = source.replace(/\.\{\?[^}]*\}/g, '');
    // .{?false} is a placeholder (empty collection) — infer type from the base path
    if (source.includes('.{?false}')) {
      return inferDataType(basePath) || 'object';
    }
    if (narrowsToOne) return 'single';
    // .{?...}.leafField → intends single scalar extraction
    if (/\.\{\?[^}]+\}\.\w+$/.test(source)) return 'single';
    // If the base path is a related() call → object, not bom
    if (basePath.match(/\.?related\s*\(/)) return 'object';
    // If the base path starts with # → filtered subset of another variable, not raw bom
    if (basePath.startsWith('#')) return 'object';
    return 'bom';
  }

  // .size() / .sum() → scalar number
  if (source.includes('.size()') || source.includes('.sum()')) return 'single';

  // Object model collection (related() returns a list)
  if (source.match(/\.?related\s*\(/)) return narrowsToOne ? 'single' : 'object';

  // Explicit list literal
  if (/^\{".+"\}$/.test(source)) return 'list';

  // ── Scalar types ────────────────────────────────────────────────

  // Single scalar value from configuration attribute
  if (source.includes('getConfigurationAttribute(')) return 'single';

  // Clean dot-walk without collection ops → single scalar value
  if (/^[#]?[\w.]+$/.test(source) && !source.includes('.{')) return 'single';

  // ── Linked define types ────────────────────────────────────────────

  // Ternary null-safe pattern referencing another define → 'define'
  // e.g. (#nameV!=null && #nameV.value!=null) ? #nameV.value: "N/A"
  if (/^[\(]?#\w+!=null/.test(source) && source.includes('?') && source.includes(':')) return 'define';

  // Simple accessor on another define → 'define'
  // e.g. #nameV.value, #nameV.valueDescription
  if (/^#\w+\.\w+$/.test(source)) return 'define';

  // Arithmetic / formula referencing multiple defines → 'code'
  // e.g. (#totalWeight-0)-(#pumpWeight-0)+(#baseTypeWeight-0)
  if (/[+\-*/]/.test(source) && /#\w+/.test(source)) return 'code';

  // Any ternary expression → 'define' (likely referencing another define)
  if (source.includes('?') && source.includes(':') && /#\w+/.test(source)) return 'define';

  // Parenthesised expression referencing # variables → 'code'
  if (/^\(.*#\w+/.test(source)) return 'code';

  // Other ternary/arithmetic without # refs → single scalar
  if (source.includes('?') && source.includes(':')) return 'single';
  if (/[+\-*/]/.test(source) && !source.includes('.{')) return 'single';

  // Any expression with index access [n] narrows to a single record
  if (narrowsToOne) return 'single';

  return 'bom';
}

// ─── Filter / index extraction from source expressions ──────────────

/**
 * Parse filter (.{?...}) and index ([n]) syntax from a source expression.
 * Returns { cleanSource, filters[], filterLogic, indexAccess }.
 *
 * Example:
 *   "solution.opportunity.{?name==\"Euro\"}.currency"
 *   → cleanSource: "solution.opportunity.currency"
 *     filters: [{ field: 'name', op: '==', value: 'Euro' }]
 *     indexAccess: null
 *
 *   "solution.opportunity[0].name"
 *   → cleanSource: "solution.opportunity.name"
 *     filters: []
 *     indexAccess: 0
 */
export function parseSourceFilters(source) {
  if (!source) return { cleanSource: source, filters: [], filterLogic: 'and', indexAccess: null };

  const rawSegments = source.replace(/^#(this|cp)\./, '').split('.');
  const prefix = source.startsWith('#this.') ? '#this.' : source.startsWith('#cp.') ? '#cp.' : '';
  const cleanSegments = [];
  const filters = [];
  let filterLogic = 'and';
  let indexAccess = null;

  for (const seg of rawSegments) {
    // Filter segment: {?field=="value"} or special {?false} / {?true}
    if (seg.startsWith('{?') && seg.endsWith('}')) {
      const inner = seg.slice(2, -1).trim();
      // Special boolean filters: {?false} returns empty collection, {?true} returns all
      if (inner === 'false' || inner === 'true') {
        filters.push({ field: '_literal', op: '==', value: inner });
        continue;
      }
      if (inner.includes(' || ')) filterLogic = 'or';
      const condParts = inner.split(/\s*(?:&&|\|\|)\s*/);
      for (const cp of condParts) {
        // Handle "not null" shorthand: field != null, field == null
        const nullMatch = cp.match(/^(\w+)\s*(==|!=)\s*null\s*$/);
        if (nullMatch) {
          filters.push({ field: nullMatch[1], op: nullMatch[2] === '==' ? 'is null' : 'not null', value: null });
          continue;
        }
        // Handle variable references: field == #varName
        const varRefMatch = cp.match(/^(\w+)\s*(==|!=|>=|<=|>|<)\s*(#\w+)\s*$/);
        if (varRefMatch) {
          filters.push({ field: varRefMatch[1], op: varRefMatch[2], value: varRefMatch[3], isVariableRef: true });
          continue;
        }
        const cm = cp.match(/^(\w+)\s*(==|!=|>=|<=|>|<|contains|matches)\s*"?([^"]*)"?\s*$/);
        if (cm) filters.push({ field: cm[1], op: cm[2], value: cm[3] });
      }
      continue;
    }
    // Index access: opportunity[0] → opportunity
    const idxMatch = seg.match(/^(\w+)\[(\d+)\]$/);
    if (idxMatch) {
      cleanSegments.push(idxMatch[1]);
      indexAccess = parseInt(idxMatch[2]);
      continue;
    }
    cleanSegments.push(seg);
  }

  return {
    cleanSource: prefix + cleanSegments.join('.'),
    filters,
    filterLogic,
    indexAccess,
  };
}

// ─── Human-readable description ─────────────────────────────────────

/**
 * Build a human-readable summary of a parsed expression.
 */
export function describeExpression(parsed) {
  if (!parsed) return 'Unrecognised expression';

  switch (parsed.type) {
    case 'define':
      return `Defines ${parsed.name} as ${parsed.dataType} variable`;

    case 'inline-assign':
      return `Block assignment: ${parsed.name} = ${parsed.source}`;

    case 'inline':
      if (parsed.nullSafeFallback != null) {
        return `Null-safe single: ${parsed.name}${parsed.accessor || ''} → fallback "${parsed.nullSafeFallback}"`;
      }
      // Clean filter/index syntax from the description
      return `Inline reference: ${parseSourceFilters(parsed.name).cleanSource}`;

    case 'for':
      return `For-loop: iterates "${parsed.loopVar}" over ${parsed.loopSource}`;

    case 'endfor':
      return 'End of for-loop';

    case 'dotpath': {
      const cleanName = parsed.name ? parseSourceFilters(parsed.name).cleanSource : null;
      if (cleanName) return `${parsed.dataType} reference: ${cleanName}`;
      return `${parsed.dataType} expression: ${parseSourceFilters(parsed.source).cleanSource}`;
    }

    default:
      return parsed.raw;
  }
}

/**
 * Check if a parsed expression could become a dataset.
 * (Only defines, dot-paths, and for-loops are meaningful as datasets.)
 */
export function canCreateDataSet(parsed) {
  return parsed && ['define', 'inline-assign', 'inline', 'dotpath', 'for'].includes(parsed.type);
}

// ─── Reverse-parse: decompose expression into wizard state ──────────

/**
 * Attempt to decompose an imported expression's source into structured
 * wizard-compatible state (sourceDefine, transforms, etc.).
 *
 * For 'define' type: extracts the referenced define name, accessor, null-safe config.
 * For 'code' type: extracts referenced define names for linking.
 * For others: returns null (already handled by existing wizard).
 *
 * @param {string} source — the RHS of a $define{#name=source}$
 * @param {string} dataType — inferred data type from inferDataType()
 * @returns {object|null} — structured state or null if not decomposable
 */
export function reverseParseSource(source, dataType) {
  if (!source || !dataType) return null;

  if (dataType === 'define') {
    // ── Null-safe ternary pattern ──────────────────────────────────
    // (#nameV!=null && #nameV.value!=null) ? #nameV.value: "fallback"
    const ternaryMatch = source.match(
      /^\(?([#]\w+)!=null\s*&&\s*\1\.(\w+)!=null\)?\s*\?\s*\1\.(\w+)\s*:\s*"([^"]*)"\s*$/
    );
    if (ternaryMatch) {
      const [, refName, checkField, accessorField, fallback] = ternaryMatch;
      return {
        sourceDefine: refName,
        transforms: [
          { type: 'accessor', method: `.${accessorField}` },
          { type: 'nullSafe', fallback },
        ],
      };
    }

    // ── Simple accessor on another define ──────────────────────────
    // #nameV.value, #nameV.valueDescription
    const accessorMatch = source.match(/^(#\w+)\.(\w+)$/);
    if (accessorMatch) {
      return {
        sourceDefine: accessorMatch[1],
        transforms: [
          { type: 'accessor', method: `.${accessorMatch[2]}` },
        ],
      };
    }

    // ── Generic ternary referencing a define ───────────────────────
    const genericTernary = source.match(/(#\w+)/);
    if (genericTernary) {
      return {
        sourceDefine: genericTernary[1],
        transforms: [],
        rawExpression: source,
      };
    }

    return null;
  }

  if (dataType === 'single') {
    // ── Inline null-safe patterns ─────────────────────────────────

    // Variant A: source!=null ? source.accessor : "fallback"
    let inlineNS = source.match(
      /^(getConfigurationAttribute\s*\([^)]+\))\s*!=\s*null\s*\?\s*getConfigurationAttribute\s*\([^)]+\)\.(\w+)\s*:\s*"([^"]*)"\s*$/
    );
    if (inlineNS) {
      return {
        source: inlineNS[1],
        transforms: [
          { type: 'accessor', method: `.${inlineNS[2]}` },
          { type: 'nullSafe', fallback: inlineNS[3] },
        ],
      };
    }

    // Variant B: source.field!=null ? source.accessor : "fallback"
    const variantB = source.match(
      /^(getConfigurationAttribute\s*\([^)]+\))\.(\w+)\s*!=\s*null\s*\?\s*getConfigurationAttribute\s*\([^)]+\)\.(\w+)\s*:\s*"([^"]*)"\s*$/
    );
    if (variantB) {
      return {
        source: variantB[1],
        transforms: [
          { type: 'accessor', method: `.${variantB[3]}` },
          { type: 'nullSafe', fallback: variantB[4], nullCheckField: `.${variantB[2]}` },
        ],
      };
    }

    // Direct .value or .valueDescription accessor (no null-safe)
    // e.g. getConfigurationAttribute("...").value
    const directAccessor = source.match(
      /^(getConfigurationAttribute\s*\([^)]+\))\.(\w+)$/
    );
    if (directAccessor) {
      return {
        source: directAccessor[1],
        transforms: [
          { type: 'accessor', method: `.${directAccessor[2]}` },
        ],
      };
    }

    return null;
  }

  if (dataType === 'code') {
    // ── Extract all referenced define names ────────────────────────
    const refs = [...new Set((source.match(/#\w+/g) || []))];
    return {
      referencedDefines: refs,
      rawExpression: source,
    };
  }

  return null;
}

/**
 * Detect multiple $define{…}$ statements in a block of selected text.
 * Returns an array of parsed results, or null if fewer than 2 found.
 *
 * Handles the two-define null-safe pattern as well as standalone defines.
 * Each match is parsed individually via parseExpression().
 */
export function parseMultipleDefines(text) {
  if (!text || typeof text !== 'string') return null;
  const raw = text.trim();
  if (!raw) return null;

  // Match all $define{…}$ patterns — non-greedy to stop at first }$
  const defineRegex = /\$define\{.+?\}\$/g;
  const matches = [];
  let m;
  while ((m = defineRegex.exec(raw)) !== null) {
    const parsed = parseExpression(m[0]);
    if (parsed) matches.push(parsed);
  }

  return matches.length >= 2 ? matches : null;
}

/**
 * Extract a suggested name and source from a parsed expression
 * for use when creating a new dataset.
 */
export function suggestDataSetFields(parsed) {
  if (!parsed) return { name: '', source: '', purpose: 'variable', type: 'bom' };

  switch (parsed.type) {
    case 'define':
      return {
        name: parsed.name.startsWith('#') ? parsed.name : `#${parsed.name}`,
        source: parsed.source,
        purpose: 'variable',
        type: parsed.dataType,
      };

    case 'inline-assign':
      return {
        name: parsed.name.startsWith('#') ? parsed.name : `#${parsed.name}`,
        source: parsed.source,
        purpose: 'block',
        type: parsed.dataType,
      };

    case 'for':
      return {
        name: parsed.loopSource.startsWith('#') ? parsed.loopSource : `#${parsed.loopSource}`,
        source: parsed.loopSource,
        purpose: 'block',
        type: parsed.dataType,
      };

    case 'inline': {
      // Inline expression — may have null-safe info from parser
      const result = {
        name: parsed.name && parsed.name.startsWith('#') ? parsed.name : `#${(parsed.name || 'value').replace(/^#/, '')}`,
        source: parsed.source || parsed.name,
        purpose: 'variable',
        type: parsed.dataType || 'single',
      };
      // Pass through null-safe / accessor info for the wizard
      if (parsed.accessor) result.accessor = parsed.accessor;
      if (parsed.nullSafeFallback != null) result.nullSafeFallback = parsed.nullSafeFallback;
      if (parsed.nullCheckField) result.nullCheckField = parsed.nullCheckField;
      return result;
    }

    case 'dotpath': {
      // Derive a name from the last segment
      const segments = (parsed.source || '').split('.');
      const lastSeg = segments[segments.length - 1] || 'item';
      const suggestedName = `#${lastSeg.replace(/[^a-zA-Z0-9_]/g, '')}`;
      return {
        name: parsed.name || suggestedName,
        source: parsed.source,
        purpose: parsed.purpose,
        type: parsed.dataType,
      };
    }

    default:
      return { name: '', source: '', purpose: 'variable', type: 'bom' };
  }
}
