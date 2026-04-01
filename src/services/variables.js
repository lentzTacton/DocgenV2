/**
 * Variable Service — CRUD, expression generation, coverage calculation.
 *
 * Works with Dexie storage + state bus.
 */

import state from '../core/state.js';
import { reverseParseSource } from './expression-parser.js';
import {
  getVariables,
  saveVariable as dbSave,
  deleteVariable as dbDelete,
  reorderVariables as dbReorder,
  getCatalogues, saveCatalogue as dbSaveCatalogue, deleteCatalogue as dbDeleteCatalogue,
  getSections, getAllSections, saveSection as dbSaveSection, deleteSection as dbDeleteSection,
  forceClearSection as dbForceClearSection,
} from '../core/storage.js';

// ─── In-memory caches ──────────────────────────────────────────────────

let modelCache = null;   // { ticketId, objects }
let recordCache = {};    // objectName → records[]

// ─── Helpers ────────────────────────────────────────────────────────────

/** Always return a usable project ID — fall back to '_default' if none set. */
function getProjectId() {
  return state.get('project.id') || '_default';
}

// ─── Variable CRUD ─────────────────────────────────────────────────────

export async function loadVariables() {
  const projectId = getProjectId();
  const vars = await getVariables(projectId);

  // ── Migrate legacy expressions ─────────────────────────────────
  // Blocks used to be wrapped in $define{…}$ or ${…}$. Now they
  // store raw source only. Re-generate any stale expressions.
  // Also back-fill sourceDefine for 'define'/'code' type vars missing it.
  let dirty = false;
  for (const v of vars) {
    // Migrate legacy 'raw' type → 'code'
    if (v.type === 'raw') {
      v.type = 'code';
      await dbSave(v);
      dirty = true;
    }
    // Back-fill sourceDefine for define/code types that don't have it yet
    if ((v.type === 'define' || v.type === 'code') && !v.sourceDefine && v.source) {
      const rp = reverseParseSource(v.source, v.type);
      if (rp) {
        if (rp.sourceDefine) {
          v.sourceDefine = rp.sourceDefine;
          v.transforms = rp.transforms || v.transforms || [];
        }
        if (rp.referencedDefines) {
          v.sourceDefine = rp.referencedDefines[0] || '';
        }
        await dbSave(v);
        dirty = true;
      }
    }
    const fresh = generateExpression(v);
    if (v.expression !== fresh) {
      v.expression = fresh;
      await dbSave(v);
      dirty = true;
    }
  }
  if (dirty) {
    // Re-fetch to ensure consistency
    const refreshed = await getVariables(projectId);
    state.set('variables', refreshed);
    return refreshed;
  }

  state.set('variables', vars);
  return vars;
}

export async function createVariable(data) {
  const projectId = getProjectId();
  const vars = state.get('variables') || [];
  const variable = {
    projectId,
    name: data.name,
    purpose: data.purpose || 'block',
    type: data.type || 'bom',
    description: data.description || '',
    source: (data.source != null && data.source !== '') ? data.source : (data.type === 'bom' ? '#this.flatbom' : ''),
    filters: data.filters || [],
    filterLogic: data.filterLogic || 'or',
    transforms: data.transforms || [],
    instanceMode: data.instanceMode || 'all',
    instanceId: data.instanceId || null,
    instanceLabel: data.instanceLabel || null,
    instanceSolution: data.instanceSolution || null,
    cpContext: data.cpContext || null,
    selectedCpId: data.selectedCpId || null,
    selectedCpDisplayId: data.selectedCpDisplayId || null,
    catchAll: data.catchAll || false,
    excludeVars: data.excludeVars || [],
    sectionId: data.sectionId || null,
    catalogueId: data.catalogueId || null,
    readonly: data.readonly || false,
    tags: data.tags || [],
    previewColumns: data.previewColumns || [],
    sourceDefine: data.sourceDefine || '',
    sourceDefineSource: data.sourceDefineSource || '',
    _singleFilter: data._singleFilter || null,
    _singleLeafField: data._singleLeafField || null,
    placeholder: data.placeholder || false,
    expression: '',
    order: vars.length,
    matchCount: 0,
  };
  variable.expression = generateExpression(variable);
  const saved = await dbSave(variable);
  await loadVariables();
  return saved;
}

export async function updateVariable(id, updates) {
  const vars = state.get('variables') || [];
  const existing = vars.find(v => v.id === id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  updated.expression = generateExpression(updated);
  const saved = await dbSave(updated);
  await loadVariables();
  return saved;
}

export async function removeVariable(id) {
  await dbDelete(id);
  await loadVariables();
}

export async function reorderVars(orderedIds) {
  const projectId = getProjectId();
  await dbReorder(projectId, orderedIds);
  await loadVariables();
}

// ─── Catalogue CRUD ─────────────────────────────────────────────────────

export async function loadCatalogues() {
  const projectId = getProjectId();
  const cats = await getCatalogues(projectId);
  state.set('catalogues', cats);
  return cats;
}

export async function createCatalogue(data) {
  const projectId = getProjectId();
  const existing = state.get('catalogues') || [];
  const catalogue = {
    projectId,
    name: data.name || 'Untitled catalogue',
    description: data.description || '',
    scope: data.scope || 'ticket',   // 'instance' | 'ticket' | 'shared'
    tags: data.tags || [],
    readonly: data.readonly || false,
    order: existing.length,
    collapsed: false,
  };
  const saved = await dbSaveCatalogue(catalogue);
  await loadCatalogues();
  return saved;
}

export async function updateCatalogue(id, updates) {
  const cats = state.get('catalogues') || [];
  const existing = cats.find(c => c.id === id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  const saved = await dbSaveCatalogue(updated);
  await loadCatalogues();
  return saved;
}

export async function removeCatalogue(id) {
  await dbDeleteCatalogue(id);
  await loadCatalogues();
  await loadVariables();  // variables may have been deleted
}

// ─── Section CRUD ───────────────────────────────────────────────────────

export async function loadSections() {
  const projectId = getProjectId();
  const secs = await getAllSections(projectId);
  state.set('sections', secs);
  return secs;
}

export async function loadSectionsForCatalogue(catalogueId) {
  return getSections(catalogueId);
}

export async function createSection(data) {
  const projectId = getProjectId();
  const existingInCat = (state.get('sections') || []).filter(s => s.catalogueId === data.catalogueId);
  const section = {
    projectId,
    catalogueId: data.catalogueId,
    name: data.name || 'Untitled section',
    description: data.description || '',
    tags: data.tags || [],
    order: existingInCat.length,
    collapsed: false,
  };
  const saved = await dbSaveSection(section);
  await loadSections();
  return saved;
}

export async function updateSection(id, updates) {
  const secs = state.get('sections') || [];
  const existing = secs.find(s => s.id === id);
  if (!existing) return null;
  const updated = { ...existing, ...updates };
  const saved = await dbSaveSection(updated);
  await loadSections();
  return saved;
}

export async function removeSection(id) {
  await dbDeleteSection(id);
  await loadSections();
  await loadVariables();  // variables get unassigned
}

// ─── Force-delete (cascade, bypasses guards) ────────────────────────────

/**
 * Force-delete a catalogue + all its sections + all its variables.
 * The storage layer already cascades; this just skips canDeleteCatalogue().
 */
export async function forceRemoveCatalogue(id) {
  await dbDeleteCatalogue(id);
  await loadCatalogues();
  await loadSections();
  await loadVariables();
}

/**
 * Force-delete a section + all its variables (hard delete, not unassign).
 */
export async function forceRemoveSection(id) {
  await dbForceClearSection(id);
  await loadSections();
  await loadVariables();
}

/**
 * Force-delete a single variable, ignoring reference checks.
 */
export async function forceRemoveVariable(id) {
  await dbDelete(id);
  await loadVariables();
}

/**
 * Count what a force-delete would remove.
 * Returns { sections, variables } counts.
 */
export function countCascadeItems(level, id) {
  const sections = state.get('sections') || [];
  const variables = state.get('variables') || [];
  if (level === 'catalogue') {
    const secs = sections.filter(s => s.catalogueId === id);
    const vars = variables.filter(v => v.catalogueId === id);
    return { sections: secs.length, variables: vars.length };
  }
  if (level === 'section') {
    const vars = variables.filter(v => v.sectionId === id);
    return { sections: 0, variables: vars.length };
  }
  // variable level — count dependents that will break
  const target = variables.find(v => v.id === id);
  if (!target) return { sections: 0, variables: 0 };
  const deps = getDependents(id);
  return { sections: 0, variables: deps.length };
}

export async function assignVariableToSection(variableId, sectionId, catalogueId) {
  const vars = state.get('variables') || [];
  const v = vars.find(v => v.id === variableId);
  if (!v) return;
  await updateVariable(variableId, { sectionId, catalogueId });
}

// ─── Expression Generator ──────────────────────────────────────────────

export function generateExpression(variable) {
  if (!variable) return '';
  const { type, name, purpose, source, filters, filterLogic, catchAll, excludeVars } = variable;

  // ── Build the raw source expression (RHS) ───────────────────────

  let expr;

  if (type === 'object') {
    // Object = collection (related(), dot-walk to collection)
    const { transforms } = variable;
    expr = source || '';

    // Placeholder: append .{?false} to produce an empty collection
    if (variable.placeholder) {
      expr += '.{?false}';
      // Skip all other filters/transforms — placeholder overrides everything
    } else {
      // Append collection filter if present
      if (filters && filters.length > 0) {
        const logic = filterLogic === 'and' ? ' && ' : ' || ';
        const conditions = filters.map(f => {
          if (f.op === 'is null') return `${f.field}==null`;
          if (f.op === 'not null') return `${f.field} != null`;
          if (f.op === 'contains') return `${f.field} matches '.*${f.value}.*'`;
          // Variable references: emit without quotes (e.g. ==#varName)
          if (f.isVariableRef) return `${f.field}${f.op}${f.value}`;
          const val = typeof f.value === 'string' && !f.value.match(/^[0-9.]+$/) && f.op !== '>' && f.op !== '<' && f.op !== '>=' && f.op !== '<='
            ? `"${f.value}"`
            : f.value;
          return `${f.field}${f.op}${val}`;
        }).join(logic);
        expr += `.{?${conditions}}`;
      }

      // Append transform chain
      if (transforms && transforms.length > 0) {
        for (const t of transforms) {
          switch (t.type) {
            case 'fieldExtract': expr += `.{${t.field || 'field'}}`; break;
            case 'groupBy':      expr += `.groupBy('${t.field || 'field'}')`; break;
            case 'flatten':      expr += '.flatten()'; break;
            case 'sum':          expr += '.sum()'; break;
            case 'size':         expr += '.size()'; break;
            case 'sort':         expr += `.sort('${t.field || 'field'}')`; break;
          }
        }
      }
    }
  } else if (type === 'single') {
    // Single = scalar value (dot-walk, getConfigurationAttribute, narrowed collection)
    const { transforms } = variable;
    const singleFilter = variable._singleFilter;
    const leafField = variable._singleLeafField;
    expr = source || '';

    // Placeholder: append .{?false} to produce an empty collection
    if (variable.placeholder) {
      expr += '.{?false}';
    } else {
    // Insert collection filter BEFORE the leaf field (not at the end)
    // e.g. solution.opportunity.name → solution.opportunity.{?name=="X"}.name
    if (singleFilter) {
      let filterPart = '';
      if (singleFilter.mode === 'field') {
        // Build conditions — supports new multi-condition format and legacy single-condition
        const conds = singleFilter.conditions || (singleFilter.field ? [{ field: singleFilter.field, op: singleFilter.op, value: singleFilter.value }] : []);
        const validConds = conds.filter(c => c.field && (c.value || c.op === 'is null' || c.op === 'not null'));
        if (validConds.length > 0) {
          const logic = singleFilter.logic === 'or' ? ' || ' : ' && ';
          const parts = validConds.map(c => {
            if (c.op === 'is null') return `${c.field}==null`;
            if (c.op === 'not null') return `${c.field} != null`;
            if (c.op === 'contains') return `${c.field} matches '.*${c.value}.*'`;
            if (c.op === 'matches') return `${c.field} matches '${c.value}'`;
            if (c.isVariableRef) return `${c.field}${c.op}${c.value}`;
            const val = typeof c.value === 'string' && !c.value.match(/^[0-9.]+$/)
              && c.op !== '>' && c.op !== '<' && c.op !== '>=' && c.op !== '<='
              ? `"${c.value}"` : c.value;
            return `${c.field}${c.op}${val}`;
          });
          filterPart = `.{?${parts.join(logic)}}`;
        }
      } else if (singleFilter.mode === 'first') {
        filterPart = '[0]';
      } else if (singleFilter.mode === 'index') {
        filterPart = `[${singleFilter.index || 0}]`;
      }

      if (filterPart) {
        if (leafField && expr.endsWith(`.${leafField}`)) {
          const collectionPath = expr.slice(0, expr.length - leafField.length - 1);
          expr = `${collectionPath}${filterPart}.${leafField}`;
        } else {
          expr += filterPart;
        }
      }
    }

    // Legacy: append collection filter if present (for related().{?...} patterns)
    if (filters && filters.length > 0 && !singleFilter) {
      const logic = filterLogic === 'and' ? ' && ' : ' || ';
      const conditions = filters.map(f => {
        if (f.op === 'is null') return `${f.field}==null`;
        if (f.op === 'not null') return `${f.field} != null`;
        if (f.op === 'contains') return `${f.field} matches '.*${f.value}.*'`;
        if (f.isVariableRef) return `${f.field}${f.op}${f.value}`;
        const val = typeof f.value === 'string' && !f.value.match(/^[0-9.]+$/) && f.op !== '>' && f.op !== '<' && f.op !== '>=' && f.op !== '<='
          ? `"${f.value}"`
          : f.value;
        return `${f.field}${f.op}${val}`;
      }).join(logic);
      expr += `.{?${conditions}}`;
    }

    // Append accessor method (e.g. .value, .valueDescription, .price(0))
    if (transforms && transforms.length > 0) {
      const nullSafe = transforms.find(t => t.type === 'nullSafe');
      const accessor = transforms.find(t => t.type === 'accessor');

      if (nullSafe) {
        // Null-safe single: generates the inline ternary pattern matching production templates.
        //   ${source!=null?source.accessor:"fallback"}$  (inline output)
        //   $define{#name=source!=null?source.accessor:"fallback"}$  (named variable)
        //
        // The expression stored is the full ternary — the wrapper section
        // adds $define{} or ${} depending on purpose.
        const fallback = nullSafe.fallback || 'N/A';
        const accessorMethod = accessor?.method || '.valueDescription';
        const baseExpr = source || '';
        // Null-check pattern: check the object itself (most common in templates)
        // Variant A: source!=null ? source.accessor : "fallback"
        // Variant B: source.value!=null ? source.accessor : "fallback" (used for .value checks)
        const nullCheckField = nullSafe.nullCheckField || null; // e.g. '.value'
        let nullCheck, outputExpr;
        if (nullCheckField) {
          // e.g. getConfigurationAttribute("...").value!=null
          nullCheck = `${baseExpr}${nullCheckField}!=null`;
        } else {
          nullCheck = `${baseExpr}!=null`;
        }
        outputExpr = `${baseExpr}${accessorMethod}`;
        expr = `${nullCheck}?${outputExpr}:"${fallback}"`;
      } else if (accessor && accessor.method) {
        // Simple accessor without null-safe
        expr += accessor.method;
      }

      // Append other transforms (size, sum, etc.)
      for (const t of transforms) {
        if (t.type === 'accessor' || t.type === 'nullSafe') continue;
        switch (t.type) {
          case 'fieldExtract': expr += `.{${t.field || 'field'}}`; break;
          case 'groupBy':      expr += `.groupBy('${t.field || 'field'}')`; break;
          case 'flatten':      expr += '.flatten()'; break;
          case 'sum':          expr += '.sum()'; break;
          case 'size':         expr += '.size()'; break;
          case 'sort':         expr += `.sort('${t.field || 'field'}')`; break;
        }
      }
    }
    } // end placeholder else
  } else if (type === 'define') {
    // Linked define — references another define variable.
    // The source define (e.g. #headUomV) is a SEPARATE variable —
    // this variable only emits its own single $define{} line.
    const { transforms } = variable;
    const sourceDefine = variable.sourceDefine || source || '';

    // Null-safe: emit only THIS define's ternary (no _nullSafeLines)
    const nullSafe = transforms?.find(t => t.type === 'nullSafe');
    if (nullSafe && sourceDefine) {
      const fallback = nullSafe.fallback || 'N/A';
      const accessor = transforms.find(t => t.type === 'accessor');
      const accessorMethod = accessor?.method || '.value';
      const vName = sourceDefine.startsWith('#') ? sourceDefine : `#${sourceDefine}`;
      const nullCheck = `(${vName}!=null && ${vName}${accessorMethod}!=null)`;
      const outputExpr = `${vName}${accessorMethod}`;
      expr = `${nullCheck} ? ${outputExpr}: "${fallback}"`;
    } else if (sourceDefine) {
      // Simple accessor on another define
      const accessor = transforms?.find(t => t.type === 'accessor');
      if (accessor?.method) {
        expr = `${sourceDefine}${accessor.method}`;
      } else {
        expr = sourceDefine;
      }
    } else {
      expr = source || '';
    }
  } else if (type === 'config') {
    // Config = getConfigurationAttribute() with optional accessor + null-safe
    const { transforms } = variable;
    expr = source || '';

    if (transforms && transforms.length > 0) {
      const nullSafe = transforms.find(t => t.type === 'nullSafe');
      const accessor = transforms.find(t => t.type === 'accessor');

      if (nullSafe) {
        const fallback = nullSafe.fallback || 'N/A';
        const accessorMethod = accessor?.method || '.value';
        const baseExpr = source || '';
        expr = `${baseExpr}!=null?${baseExpr}${accessorMethod}:"${fallback}"`;
      } else if (accessor && accessor.method) {
        expr += accessor.method;
      }
    }
  } else if (type === 'code') {
    // Raw formula expression — store as-is
    expr = source || '';
  } else if (type === 'list') {
    expr = source || '{""}';
  } else {
    // BOM type
    const { transforms, instanceMode, instanceId, cpContext } = variable;

    if (cpContext && source?.startsWith('#cp.')) {
      const bomPart = source.replace('#cp.', '');
      if (instanceMode === 'single' && instanceId) {
        expr = `${cpContext.expression}.{?id=="${instanceId}"}[0].${bomPart}`;
      } else {
        expr = source;
      }
    } else {
      expr = source || '#this.flatbom';
      if (instanceMode === 'single' && instanceId) {
        expr += `.{?id=="${instanceId}"}[0]`;
      }
    }

    if (catchAll && excludeVars && excludeVars.length > 0) {
      const excluded = excludeVars.join(', ');
      expr += `.{?NOT IN ${excluded}}`;
    } else if (filters && filters.length > 0) {
      const logic = filterLogic === 'and' ? ' && ' : ' || ';
      const conditions = filters.map(f => {
        const val = typeof f.value === 'string' && !f.value.match(/^[0-9.]+$/) && f.op !== '>' && f.op !== '<' && f.op !== '>=' && f.op !== '<='
          ? `"${f.value}"`
          : f.value;

        if (f.op === 'contains') return `${f.field} matches '.*${f.value}.*'`;
        if (f.op === 'not null') return `${f.field} != null`;
        return `${f.field}${f.op}${val}`;
      }).join(logic);
      expr += `.{?${conditions}}`;
    }

    // Append transform chain
    if (transforms && transforms.length > 0) {
      for (const t of transforms) {
        switch (t.type) {
          case 'fieldExtract': expr += `.{${t.field || 'field'}}`; break;
          case 'groupBy':      expr += `.groupBy('${t.field || 'field'}')`; break;
          case 'flatten':      expr += '.flatten()'; break;
          case 'sum':          expr += '.sum()'; break;
          case 'size':         expr += '.size()'; break;
          case 'sort':         expr += `.sort('${t.field || 'field'}')`; break;
        }
      }
    }
  }

  // ── Universal accessor / null-safe fallback ─────────────────────
  // Types 'single', 'config', and 'define' handle accessor/nullSafe inline above.
  // For all other types (code, list, object, bom), apply transforms here if present.
  if (type !== 'single' && type !== 'config' && type !== 'define') {
    const transforms = variable.transforms || [];
    const nullSafe = transforms.find(t => t.type === 'nullSafe');
    const accessor = transforms.find(t => t.type === 'accessor');
    if (nullSafe && expr) {
      const fallback = nullSafe.fallback || 'N/A';
      const accessorMethod = accessor?.method || '';
      const baseExpr = expr;
      expr = `${baseExpr}!=null?${baseExpr}${accessorMethod}:"${fallback}"`;
    } else if (accessor && accessor.method && expr) {
      expr += accessor.method;
    }
  }

  // ── Prepend parent loop variable for child blocks ────────────────
  // When this dataset lives inside a for-loop, prefix the expression
  // with the loop variable (e.g. #currentAlternative.flatbom)
  if (variable.parentLoopVar && expr) {
    const loopVar = variable.parentLoopVar.startsWith('#') ? variable.parentLoopVar : `#${variable.parentLoopVar}`;
    expr = `${loopVar}.${expr}`;
  }

  // ── Wrap based on purpose ────────────────────────────────────────
  //
  // Variables → $define{#name=expr}$
  //   Stores a named value for later use.
  //
  // Blocks → raw source expression (NO wrapper)
  //   The source goes directly into template constructs:
  //     $for{#item in SOURCE}$          — Parker, TECE pattern
  //     $rowgroup{SOURCE}$              — Sandvik, Parker pattern
  //     $group{SOURCE}$                 — Cytiva pattern
  //   Or via inline assignment when expression is complex / reused:
  //     ${#name=SOURCE}$                — Cytiva pattern
  //
  // The builder will decide HOW to insert a block. The expression
  // stored on the dataset is just the raw source.

  if (purpose === 'block') {
    return expr;
  }

  // Inline purpose → ${expr}$ (direct output, no named define)
  if (purpose === 'inline') {
    return `\${${expr}}$`;
  }

  // Default: variable → $define{…}$
  return `$define{${name}=${expr}}$`;
}

// ─── Coverage Calculation ──────────────────────────────────────────────

export function calculateCoverage(variables, bomItems) {
  if (!bomItems || bomItems.length === 0) return { total: 0, segments: [], unassigned: 0 };

  const total = bomItems.length;
  const assigned = new Set();
  const segments = [];

  // Color palette for coverage segments
  const colors = ['#E8713A', '#D4A015', '#8250DF', '#0A6DC2', '#1A7F37', '#CF222E', '#6E40C9', '#0969DA'];

  const bomVars = variables.filter(v => v.type === 'bom');

  bomVars.forEach((v, idx) => {
    const matchIds = new Set();
    if (v.catchAll) {
      // Catch-all: everything not yet assigned
      bomItems.forEach((item, i) => {
        if (!assigned.has(i)) { matchIds.add(i); assigned.add(i); }
      });
    } else if (v.filters && v.filters.length > 0) {
      bomItems.forEach((item, i) => {
        if (matchesFilters(item, v.filters, v.filterLogic)) {
          matchIds.add(i);
          assigned.add(i);
        }
      });
    }

    segments.push({
      name: v.name,
      count: matchIds.size,
      color: v.catchAll ? '#ABB4BD' : colors[idx % colors.length],
      catchAll: v.catchAll || false,
    });
  });

  return {
    total,
    segments,
    assigned: assigned.size,
    unassigned: total - assigned.size,
  };
}

// ─── Filter Matching (client-side) ─────────────────────────────────────

export function matchesFilters(record, filters, logic = 'or') {
  if (!filters || filters.length === 0) return true;

  const test = (f) => {
    // Case-insensitive field lookup
    const fieldKey = Object.keys(record).find(k => k.toLowerCase() === f.field.toLowerCase()) || f.field;
    const val = record[fieldKey];
    const cmp = f.value;

    switch (f.op) {
      case '==': return String(val) === String(cmp);
      case '!=': return String(val) !== String(cmp);
      case '>': return parseFloat(val) > parseFloat(cmp);
      case '<': return parseFloat(val) < parseFloat(cmp);
      case '>=': return parseFloat(val) >= parseFloat(cmp);
      case '<=': return parseFloat(val) <= parseFloat(cmp);
      case 'contains': return String(val || '').toLowerCase().includes(String(cmp).toLowerCase());
      case 'not null': return val != null && val !== '';
      default: return false;
    }
  };

  return logic === 'and'
    ? filters.every(test)
    : filters.some(test);
}

// ─── Auto-detect variable type ─────────────────────────────────────────

export function detectType(expression) {
  if (!expression) return 'bom';

  // ── Check if a collection narrows to one record → single ───────
  // e.g. related('ConfiguredProduct','solution').{?id=="abc"}[0]
  const narrowsToOne = expression.includes('[0]');

  // ── Collection types ────────────────────────────────────────────

  // BOM collection (unless narrowed to single)
  if (expression.includes('flatbom')) return narrowsToOne ? 'single' : 'bom';
  if (expression.includes('.sort(')) return 'bom';           // sort = collection
  if (expression.includes('.groupBy(')) return 'bom';        // groupBy = collection
  if (expression.includes('.flatten(')) return 'bom';        // flatten = collection

  // Filter on a collection — but first check if the base path is a related() call
  if (expression.includes('.{?')) {
    // Strip all filters to get the base path for type inference
    const basePath = expression.replace(/\.\{\?[^}]*\}/g, '');
    // .{?false} is a placeholder (empty collection) — infer from base
    if (expression.includes('.{?false}') && basePath.match(/\.?related\s*\(/)) return 'object';
    if (narrowsToOne) return 'single';
    // If base path is a related() call → object collection, not bom
    if (basePath.match(/\.?related\s*\(/)) return 'object';
    return 'bom';
  }

  // .size() / .sum() → these produce a scalar number
  if (expression.includes('.size()') || expression.includes('.sum()')) return 'single';

  // Object model collection (related() returns a list)
  // But if narrowed to [0], it's a single record
  if (expression.match(/\.?related\s*\(/)) return narrowsToOne ? 'single' : 'object';

  // Explicit list literal
  if (/^\{".+"\}$/.test(expression)) return 'list';

  // ── Scalar types ────────────────────────────────────────────────

  // Single scalar value from configuration attribute
  if (expression.includes('getConfigurationAttribute(')) return 'single';

  // Clean dot-walk without collection ops → single scalar value
  if (/^[\w.#]+$/.test(expression) && !expression.includes('.{')) return 'single';

  // ── Linked define types ────────────────────────────────────────

  // Null-safe ternary referencing another define
  if (/^[\(]?#\w+!=null/.test(expression) && expression.includes('?') && expression.includes(':')) return 'define';

  // Simple accessor on another define
  if (/^#\w+\.\w+$/.test(expression)) return 'define';

  // Arithmetic formula referencing defines
  if (/[+\-*/]/.test(expression) && /#\w+/.test(expression)) return 'code';

  // Generic ternary referencing defines
  if (expression.includes('?') && expression.includes(':') && /#\w+/.test(expression)) return 'define';

  // Parenthesised with define refs
  if (/^\(.*#\w+/.test(expression)) return 'code';

  return 'bom';
}

// ─── Name validation ───────────────────────────────────────────────────

/**
 * Validate a variable name.
 * @param {string} name
 * @param {Array} existingVars — list to check duplicates against
 * @param {number|null} excludeId — skip this id when checking dupes
 * @param {number|null} catalogueId — scope duplicate check to this catalogue (null = global)
 * @returns {null|string|{level:'warn',message:string}} — null if valid, string if error, object if warning
 */
export function validateName(name, existingVars, excludeId, catalogueId) {
  if (!name) return 'Name is required';
  if (!name.startsWith('#')) return 'Name must start with #';
  if (name.length < 2) return 'Name too short';
  if (/\s/.test(name)) return 'Name cannot contain spaces';
  if (!/^#[a-zA-Z_]\w*$/.test(name)) return 'Invalid characters — use letters, numbers, underscore';

  // Scope duplicate check to the same catalogue (use == to handle number/string mismatch from Dexie)
  const scopedVars = catalogueId != null
    ? existingVars.filter(v => v.catalogueId != null && String(v.catalogueId) === String(catalogueId))
    : existingVars;
  const dupe = scopedVars.find(v => v.name === name && (excludeId == null || String(v.id) !== String(excludeId)));
  if (dupe) return { level: 'warn', message: `"${name}" already exists in this catalogue` };
  return null;
}

// ─── Delete Validation ──────────────────────────────────────────────────

/**
 * Check whether a catalogue can be deleted.
 * Returns { ok: boolean, reason?: string, details?: string[] }
 */
export function canDeleteCatalogue(catalogueId) {
  const sections = (state.get('sections') || []).filter(s => s.catalogueId === catalogueId);
  const variables = (state.get('variables') || []).filter(v => v.catalogueId === catalogueId);

  if (sections.length > 0 || variables.length > 0) {
    const details = [];
    if (sections.length > 0) details.push(`${sections.length} section${sections.length !== 1 ? 's' : ''}: ${sections.map(s => s.name).join(', ')}`);
    if (variables.length > 0) details.push(`${variables.length} dataset${variables.length !== 1 ? 's' : ''}: ${variables.map(v => v.name).join(', ')}`);
    return {
      ok: false,
      reason: 'Cannot delete a catalogue that still contains sections or datasets. Remove or move them first.',
      details,
    };
  }
  return { ok: true };
}

/**
 * Check whether a section can be deleted.
 * Returns { ok: boolean, reason?: string, details?: string[] }
 */
export function canDeleteSection(sectionId) {
  const variables = (state.get('variables') || []).filter(v => v.sectionId === sectionId);

  if (variables.length > 0) {
    return {
      ok: false,
      reason: 'Cannot delete a section that still contains datasets. Remove or move them first.',
      details: [`${variables.length} dataset${variables.length !== 1 ? 's' : ''}: ${variables.map(v => v.name).join(', ')}`],
    };
  }
  return { ok: true };
}

/**
 * Check whether a variable/data block can be deleted.
 * Returns { ok: boolean, reason?: string, usages?: { type, name, id }[] }
 *
 * Currently checks for:
 *  - Builder block references (future — returns empty for now)
 *  - Other variables that reference this one via excludeVars (catch-all)
 */
export function canDeleteVariable(variableId) {
  const variables = state.get('variables') || [];
  const target = variables.find(v => v.id === variableId);
  if (!target) return { ok: true };

  const usages = [];

  // Check if other catch-all variables reference this one in their excludeVars
  for (const v of variables) {
    if (v.id === variableId) continue;
    if (v.excludeVars && v.excludeVars.includes(target.name)) {
      usages.push({ type: 'catch-all', name: v.name, id: v.id });
    }
  }

  // Check if other define-type variables use this as their source
  const targetRef = target.name.startsWith('#') ? target.name : `#${target.name}`;
  for (const v of variables) {
    if (v.id === variableId) continue;
    if (v.type === 'define' && v.sourceDefine) {
      const srcRef = v.sourceDefine.startsWith('#') ? v.sourceDefine : `#${v.sourceDefine}`;
      if (srcRef === targetRef) {
        usages.push({ type: 'linked define', name: v.name, id: v.id });
      }
    }
    if (v.type === 'code' && v.source && v.source.includes(targetRef)) {
      usages.push({ type: 'raw expression', name: v.name, id: v.id });
    }
    // Check if child blocks reference this as their parent block
    if (v.parentBlock) {
      const parentRef = v.parentBlock.startsWith('#') ? v.parentBlock : `#${v.parentBlock}`;
      if (parentRef === targetRef) {
        usages.push({ type: 'child block', name: v.name, id: v.id });
      }
    }
    // Check if child blocks use this variable's name as their loop variable source
    if (v.parentLoopVar) {
      const loopRef = v.parentLoopVar.startsWith('#') ? v.parentLoopVar : `#${v.parentLoopVar}`;
      // The loop variable itself isn't stored as a variable — but the parent block IS
      // So we check if any variable's expression references this as a for-loop source
    }
  }

  // Future: check builder blocks
  // const builderBlocks = state.get('builderBlocks') || [];
  // for (const block of builderBlocks) {
  //   if (block.dataBlockRef === target.name) {
  //     usages.push({ type: 'builder', name: block.name, id: block.id });
  //   }
  // }

  if (usages.length > 0) {
    return {
      ok: false,
      reason: 'This item is referenced by other definitions. Remove those references first.',
      usages,
    };
  }
  return { ok: true };
}

/**
 * Return list of variables that depend on the given variable as a source.
 * Used by the list view to show a SOURCE badge and by delete protection.
 */
export function getDependents(variableId) {
  const variables = state.get('variables') || [];
  const target = variables.find(v => v.id === variableId);
  if (!target) return [];
  const targetRef = target.name.startsWith('#') ? target.name : `#${target.name}`;
  const deps = [];
  for (const v of variables) {
    if (v.id === variableId) continue;
    if (v.type === 'define' && v.sourceDefine) {
      const srcRef = v.sourceDefine.startsWith('#') ? v.sourceDefine : `#${v.sourceDefine}`;
      if (srcRef === targetRef) deps.push(v);
    }
    if (v.type === 'code' && v.source && v.source.includes(targetRef)) {
      deps.push(v);
    }
    // Child blocks that reference this as their parent block
    if (v.parentBlock) {
      const parentRef = v.parentBlock.startsWith('#') ? v.parentBlock : `#${v.parentBlock}`;
      if (parentRef === targetRef) deps.push(v);
    }
  }
  return deps;
}

// ─── Dataset Validation ─────────────────────────────────────────────

/**
 * Validate a dataset definition and return resolvability status.
 *
 * Checks performed:
 *  - Name is valid (#prefix, no dupes)
 *  - Expression is non-empty
 *  - Source is a known BOM source (for bom type) or valid dot-walk (for object type)
 *  - Filter fields exist in available BOM fields
 *  - Match count > 0 when live data is available (warning, not error)
 *  - Transforms reference valid fields
 *
 * @param {object} variable — The dataset definition
 * @param {object} opts — { bomSources, bomFields, bomRecords, modelObjects }
 * @returns {{ status: 'valid'|'warning'|'error', issues: {level, message}[] }}
 */
export function validateDataSet(variable, opts = {}) {
  const issues = [];
  const { bomSources = [], bomFields = [], bomRecords = [], modelObjects = [], configAttrPaths = new Set() } = opts;

  // 1. Name check
  if (!variable.name) {
    issues.push({ level: 'error', message: 'Name is required' });
  } else if (!variable.name.startsWith('#')) {
    issues.push({ level: 'error', message: 'Name must start with #' });
  } else if (!/^#[a-zA-Z_]\w*$/.test(variable.name)) {
    issues.push({ level: 'error', message: 'Name contains invalid characters' });
  }

  // 2. Expression check
  // For variables: expression is $define{#name=source}$
  // For blocks: expression is just the raw source
  const expr = variable.expression || generateExpression(variable);
  if (!expr || expr === '$define{=}$') {
    issues.push({ level: 'error', message: 'Expression is empty — no source defined' });
  }

  // 3. Type-specific checks
  if (variable.type === 'bom') {
    // Source known?
    if (bomSources.length > 0 && variable.source) {
      const knownSource = bomSources.find(
        s => s.expression === variable.source || s.name === variable.source
      );
      if (!knownSource) {
        issues.push({ level: 'warning', message: `Source "${variable.source}" not found in available BOM sources` });
      }
    }

    // Filter fields exist?
    if (bomFields.length > 0 && variable.filters && variable.filters.length > 0) {
      const fieldSet = new Set(bomFields.map(f => f.toLowerCase()));
      for (const f of variable.filters) {
        if (f.field && !fieldSet.has(f.field.toLowerCase())) {
          issues.push({ level: 'warning', message: `Filter field "${f.field}" not found in BOM schema` });
        }
        if (f.op && f.op !== 'not null' && (f.value === undefined || f.value === '')) {
          issues.push({ level: 'warning', message: `Filter on "${f.field}" has no value` });
        }
      }
    }

    // Transform field references
    if (bomFields.length > 0 && variable.transforms && variable.transforms.length > 0) {
      const fieldSet = new Set(bomFields.map(f => f.toLowerCase()));
      for (const t of variable.transforms) {
        if (t.field && (t.type === 'fieldExtract' || t.type === 'groupBy' || t.type === 'sort')) {
          if (!fieldSet.has(t.field.toLowerCase())) {
            issues.push({ level: 'warning', message: `Transform references unknown field "${t.field}"` });
          }
        }
      }
    }

    // Filter value existence check — does the value actually appear in the data?
    if (bomRecords.length > 0 && variable.filters && variable.filters.length > 0) {
      for (const f of variable.filters) {
        if (f.op === 'not null' || !f.field || !f.value) continue;
        // Find field in records (case-insensitive)
        const sampleRecord = bomRecords[0];
        const fieldKey = Object.keys(sampleRecord).find(k => k.toLowerCase() === f.field.toLowerCase());
        if (fieldKey) {
          const allValues = new Set(bomRecords.map(r => String(r[fieldKey] || '').toLowerCase()));
          if (f.op === '==' && !allValues.has(String(f.value).toLowerCase())) {
            issues.push({ level: 'warning', message: `Filter value "${f.value}" not found in field "${f.field}" on this ticket` });
          } else if (f.op === 'contains') {
            const needle = String(f.value).toLowerCase();
            const anyMatch = [...allValues].some(v => v.includes(needle));
            if (!anyMatch) {
              issues.push({ level: 'warning', message: `No "${f.field}" values contain "${f.value}" on this ticket` });
            }
          }
        }
      }
    }

    // Match count (only if we have live data)
    if (bomRecords.length > 0 && !variable.catchAll) {
      if (variable.filters && variable.filters.length > 0) {
        const matchCount = bomRecords.filter(r => matchesFilters(r, variable.filters, variable.filterLogic)).length;
        if (matchCount === 0) {
          issues.push({ level: 'warning', message: 'No BOM items match current filters — result will be empty' });
        }
      }
    }
  } else if (variable.type === 'single') {
    // Single: must resolve to exactly one value/record.
    // Can be a simple dot-walk (solution.opportunity.account.name)
    // or a filtered collection that narrows to one (related(...).{?id=="x"}[0])
    if (!variable.source) {
      issues.push({ level: 'error', message: 'No value path defined' });
    } else {
      // Validate source path against model or config attribute index
      if (variable.source.includes('getConfigurationAttribute(')) {
        // Config attribute: validate path against the configured product attribute index
        if (configAttrPaths.size > 0) {
          const pathMatch = variable.source.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
          if (pathMatch) {
            const attrPath = pathMatch[1];
            if (!configAttrPaths.has(attrPath)) {
              issues.push({ level: 'warning', message: `Configuration attribute "${attrPath}" not found in any configured product on this ticket` });
            }
          }
        }
      } else if (modelObjects.length > 0) {
        const parts = variable.source.split('.');
        if (parts.length > 0) {
          const startObj = parts[0].toLowerCase();
          const knownObj = modelObjects.find(o => o.name.toLowerCase() === startObj);
          if (!knownObj && startObj !== 'solution' && startObj !== '#this' && !variable.sourceDefine && !startObj.startsWith('#')) {
            issues.push({ level: 'warning', message: `Starting object "${parts[0]}" not found in model` });
          }
        }
      }

      // If it uses a collection source (filter, related) it MUST narrow to a single value
      // e.g. via [0], .size(), or a unique filter — otherwise it's not truly "single"
      const hasCollectionOp = variable.source.includes('.{?') || variable.source.match(/\.?related\s*\(/);
      if (hasCollectionOp) {
        const narrowsToOne = variable.source.includes('[0]')
          || variable.source.includes('.size()')
          || variable.source.includes('.sum()')
          || (variable.filters && variable.filters.length > 0 && variable.instanceMode === 'single');
        if (!narrowsToOne) {
          issues.push({ level: 'warning', message: 'Single type expects one result — add a [0] index or unique filter to narrow the collection' });
        }
      }
    }
  } else if (variable.type === 'object') {
    // Object model collection (related() etc.)
    if (!variable.source) {
      issues.push({ level: 'error', message: 'No object source defined' });
    }
  } else if (variable.type === 'define') {
    // Linked define — derives status from its source define
    if (!variable.source && !variable.sourceDefine) {
      issues.push({ level: 'error', message: 'No source define selected' });
    } else {
      const allVars = state.get('variables') || [];
      const refName = variable.sourceDefine || variable.source;
      if (refName && refName.startsWith('#')) {
        const refVar = allVars.find(v => v.name === refName);
        if (!refVar) {
          issues.push({ level: 'error', message: `Source define "${refName}" does not exist` });
        } else {
          const refResult = validateDataSet(refVar, opts);
          // Derive: inherit source status (including 'unchecked')
          if (refResult.status === 'error') {
            issues.push({ level: 'error', message: `Source "${refName}": ${refResult.issues.filter(i => i.level === 'error').map(i => i.message).join('; ')}` });
          } else if (refResult.status === 'warning') {
            issues.push({ level: 'warning', message: `Source "${refName}": ${refResult.issues.filter(i => i.level === 'warning').map(i => i.message).join('; ')}` });
          } else if (refResult.status === 'unchecked') {
            // Mark as derived-unchecked so the final status propagates
            issues.push({ level: 'unchecked', message: `Source "${refName}" not verified` });
          }
        }
      }
    }
  } else if (variable.type === 'code') {
    // Code formula — derives status from referenced defines + syntax
    if (!variable.source) {
      issues.push({ level: 'error', message: 'Expression is empty' });
    } else {
      const allVars = state.get('variables') || [];
      const allNames = new Set(allVars.map(v => v.name));
      const refs = [...new Set(variable.source.match(/#\w+/g) || [])];

      if (refs.length === 0) {
        issues.push({ level: 'warning', message: 'No defines referenced — consider Single type' });
      }

      for (const ref of refs) {
        if (!allNames.has(ref)) {
          issues.push({ level: 'error', message: `"${ref}" does not exist` });
        } else {
          const refVar = allVars.find(v => v.name === ref);
          if (refVar) {
            const refResult = validateDataSet(refVar, opts);
            if (refResult.status === 'error') {
              issues.push({ level: 'error', message: `"${ref}": ${refResult.issues.filter(i => i.level === 'error').map(i => i.message).join('; ')}` });
            } else if (refResult.status === 'warning') {
              issues.push({ level: 'warning', message: `"${ref}": ${refResult.issues.filter(i => i.level === 'warning').map(i => i.message).join('; ')}` });
            } else if (refResult.status === 'unchecked') {
              issues.push({ level: 'unchecked', message: `"${ref}" not verified` });
            }
          }
        }
      }

      // Syntax: balanced parentheses
      const opens = (variable.source.match(/\(/g) || []).length;
      const closes = (variable.source.match(/\)/g) || []).length;
      if (opens !== closes) {
        issues.push({ level: 'error', message: `Unbalanced parentheses: ${opens} open, ${closes} close` });
      }
    }
  } else if (variable.type === 'list') {
    // List: check syntax
    if (!variable.source || variable.source === '{""}') {
      issues.push({ level: 'warning', message: 'List is empty — no values defined' });
    } else if (!variable.source.startsWith('{') || !variable.source.endsWith('}')) {
      issues.push({ level: 'warning', message: 'List values should be wrapped in { } brackets' });
    }
  }

  // Determine overall status
  const hasError = issues.some(i => i.level === 'error');
  const hasWarning = issues.some(i => i.level === 'warning');
  const hasUnchecked = issues.some(i => i.level === 'unchecked');
  const hasLiveData = bomSources.length > 0 || bomFields.length > 0 || modelObjects.length > 0;
  // Priority: error > warning > unchecked (from sources or no live data) > valid
  const status = hasError ? 'error'
    : hasWarning ? 'warning'
    : (hasUnchecked || !hasLiveData) ? 'unchecked'
    : 'valid';

  // Filter out 'unchecked' pseudo-issues from the displayed issues list
  const displayIssues = issues.filter(i => i.level !== 'unchecked');

  return { status, issues: displayIssues };
}

/**
 * Batch-validate all datasets in state and return a map of id → validation result.
 * @param {object} opts — { bomSources, bomFields, bomRecords, modelObjects }
 * @returns {Map<number, {status, issues}>}
 */
export function validateAllDataSets(opts = {}) {
  const variables = state.get('variables') || [];
  const results = new Map();
  for (const v of variables) {
    results.set(v.id, validateDataSet(v, opts));
  }
  return results;
}

export { modelCache, recordCache };
