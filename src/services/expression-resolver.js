/**
 * Expression Resolver — resolves parsed DocGen expressions against the Tacton API.
 *
 * Extracted from selection-panel.js for maintainability.
 * Each resolution strategy is a focused function:
 *   - resolveConfigAttribute: getConfigurationAttribute() paths
 *   - resolveArithmetic: code expressions with #var arithmetic
 *   - resolveDefineChain: #variable → #otherVar → configAttr chain walking
 *   - resolveModelPath: dot-path walks against the object model
 */

import state from '../core/state.js';
import {
  isConnected,
  fetchRecords,
  fetchModel,
  getSelectedInstance,
  getStartingObject,
} from './data-api.js';
import { parseSourceFilters } from './expression-parser.js';
import { resolveConfigAttrAcrossCPs } from './config-resolver.js';

// ═════════════════════════════════════════════════════════════════════
//  MAIN ENTRY POINT
// ═════════════════════════════════════════════════════════════════════

/**
 * Try to resolve the parsed expression against the Tacton API.
 * Returns { records, fields, totalCount, objectName } or { value } or { error }.
 */
export async function resolveExpression(parsed) {
  const source = parsed.source || parsed.loopSource || '';

  // 1. Config attributes → Solution API
  if (source.includes('getConfigurationAttribute(')) {
    return resolveConfigAttribute(source);
  }

  // 2. Code expressions with arithmetic
  const varRefs = [...new Set(source.match(/#\w+/g) || [])];
  if (varRefs.length > 0 && /[+\-*/]/.test(source)) {
    return resolveArithmetic(source, varRefs);
  }

  // 3. Linked defines / inline #variable references
  if (varRefs.length > 0 && varRefs.length <= 2) {
    return resolveDefineChain(parsed, varRefs);
  }

  // 4. Model dot-paths (solution.opportunity.account.name)
  return resolveModelPath(parsed, source);
}

// ═════════════════════════════════════════════════════════════════════
//  STRATEGY 1: Config Attributes
// ═════════════════════════════════════════════════════════════════════

async function resolveConfigAttribute(source) {
  const pathMatch = source.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
  if (!pathMatch) return { error: 'Could not parse config attribute path' };

  const attrPath = pathMatch[1];
  try {
    const results = await resolveConfigAttrAcrossCPs(attrPath);
    if (results.length > 0) {
      const hasValue = results.some(r => r.value && r.value !== '(error)');
      if (hasValue) {
        return {
          records: results,
          totalCount: results.length,
          objectName: 'ConfiguredProduct',
          fields: ['cpDisplayId', 'solutionName', 'value'],
        };
      }
      return { error: `Attribute "${attrPath}" not found in any configured product` };
    }
    return { error: 'No configured products found on this ticket' };
  } catch (e) {
    return { error: `Config resolve failed: ${e.message}` };
  }
}

// ═════════════════════════════════════════════════════════════════════
//  STRATEGY 2: Arithmetic / Code Expressions
// ═════════════════════════════════════════════════════════════════════

async function resolveArithmetic(source, varRefs) {
  const allVars = state.get('variables') || [];
  const depResults = [];
  let allResolved = true;

  for (const ref of varRefs) {
    const refVar = allVars.find(v => v.name === ref);
    if (!refVar) {
      depResults.push({ name: ref, status: 'missing', value: '—' });
      allResolved = false;
      continue;
    }
    const refSource = refVar.source || '';
    if (refSource.includes('getConfigurationAttribute(')) {
      const pm = refSource.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
      if (pm) {
        try {
          const r = await resolveConfigAttrAcrossCPs(pm[1]);
          const val = r.find(x => x.value && x.value !== '(error)');
          depResults.push({ name: ref, status: val ? 'resolved' : 'no value', value: val?.value || '—' });
          if (!val) allResolved = false;
        } catch {
          depResults.push({ name: ref, status: 'error', value: '—' });
          allResolved = false;
        }
      } else {
        depResults.push({ name: ref, status: 'unknown', value: '—' });
        allResolved = false;
      }
    } else {
      depResults.push({ name: ref, status: 'exists', value: refVar.expression || refSource || '—' });
    }
  }

  // Try to compute the final value if all deps resolved to numbers
  let computedValue = null;
  if (allResolved) {
    try {
      let expr = source;
      for (const dep of depResults) {
        const numVal = parseFloat(dep.value);
        if (!isNaN(numVal)) {
          expr = expr.split(dep.name).join(String(numVal));
        }
      }
      // Safety: only evaluate if expression contains only numbers, operators, parens, spaces
      if (/^[\d.+\-*/() \t]+$/.test(expr)) {
        computedValue = Function('"use strict"; return (' + expr + ')')();
        if (typeof computedValue === 'number') {
          computedValue = Math.round(computedValue * 100) / 100;
        }
      }
    } catch (e) {
      console.warn('[resolveArithmetic] Eval failed:', e.message);
    }
  }

  return {
    records: depResults,
    totalCount: depResults.length,
    objectName: 'Dependencies',
    fields: ['name', 'status', 'value'],
    computedValue: computedValue != null ? String(computedValue) : null,
  };
}

// ═════════════════════════════════════════════════════════════════════
//  STRATEGY 3: Define Chain Walking
// ═════════════════════════════════════════════════════════════════════

async function resolveDefineChain(parsed, varRefs) {
  const allVars = state.get('variables') || [];

  const foundVars = varRefs.filter(ref => allVars.some(v => v.name === ref));
  const missingVars = varRefs.filter(ref => !allVars.some(v => v.name === ref));

  // All referenced #vars exist — follow the chain
  if (missingVars.length === 0) {
    const chain = [];
    let current = allVars.find(v => v.name === varRefs[0]);
    const visited = new Set();

    while (current && chain.length < 5) {
      chain.push(current.name);
      visited.add(current.name);
      const curSource = current.sourceDefine || current.source || '';

      // Found a config attribute — resolve it
      if (curSource.includes('getConfigurationAttribute(')) {
        const result = await resolveExpression({ ...parsed, source: curSource });
        if (result && !result.error) {
          result.objectName = `${chain.join(' → ')} → ConfiguredProduct`;
        }
        return result;
      }

      // Source is another #variable — follow the chain
      const nextRef = curSource.match(/^#(\w+)$/)?.[0]
        || (curSource.match(/#(\w+)/g) || []).find(r => !visited.has(r));
      if (nextRef && !visited.has(nextRef)) {
        current = allVars.find(v => v.name === nextRef);
      } else {
        break;
      }
    }

    // Non-config source — show dependency info
    return {
      records: varRefs.map(ref => {
        const v = allVars.find(x => x.name === ref);
        return { name: ref, type: v?.type || '—', source: v?.source?.substring(0, 60) || '—' };
      }),
      totalCount: varRefs.length,
      objectName: 'Dependencies',
      fields: ['name', 'type', 'source'],
    };
  }

  // Some or all #vars are missing
  return {
    records: varRefs.map(ref => {
      const v = allVars.find(x => x.name === ref);
      return {
        name: ref,
        status: v ? 'exists' : 'missing',
        type: v?.type || '—',
        source: v?.source?.substring(0, 60) || '— not defined yet —',
      };
    }),
    totalCount: varRefs.length,
    objectName: 'Dependencies',
    fields: ['name', 'status', 'type', 'source'],
    hasMissing: true,
    missingVars,
  };
}

// ═════════════════════════════════════════════════════════════════════
//  STRATEGY 4: Model Dot-Path Resolution
// ═════════════════════════════════════════════════════════════════════

async function resolveModelPath(parsed, source) {
  const model = await fetchModel();
  if (!model) return { error: 'Model not loaded' };

  const selectedInst = getSelectedInstance();
  const startObj = state.get('startingObject.type') || 'Solution';

  // Resolve #this. alias
  const resolvedSource = source.replace(/^#this\./, `${startObj.toLowerCase()}.`);

  // Parse source into clean segments, extracting filters & indices
  const { cleanSource, filters, filterLogic, indexAccess } = parseSourceFilters(resolvedSource);
  const cleanSegments = cleanSource.replace(/^#(this|cp)\./, '').split('.');
  const rootName = cleanSegments[0];

  let objMatch = model.find(o => o.name.toLowerCase() === rootName.toLowerCase());
  if (!objMatch && rootName.toLowerCase() === startObj.toLowerCase()) {
    objMatch = model.find(o => o.name.toLowerCase() === startObj.toLowerCase());
  }

  // BOM sources
  if (source.includes('flatbom') || source.includes('.bom') || parsed.dataType === 'bom') {
    const bomObj = model.find(o => o.name.toLowerCase().includes('bom') || o.name.toLowerCase().includes('flatbom'));
    if (bomObj) {
      let records = await fetchRecords(bomObj.name);
      records = scopeToInstance(records, bomObj.name, model, selectedInst, startObj);
      records = applyFiltersAndIndex(records, filters, filterLogic, indexAccess);
      return {
        records,
        totalCount: records.length,
        objectName: bomObj.name,
        fields: bomObj.attributes.map(a => a.name).filter(n => !n.startsWith('_')).slice(0, 6),
        filters: filters.length > 0 ? filters : undefined,
        filterLogic: filters.length > 1 ? filterLogic : undefined,
        indexAccess,
        instanceScoped: !!selectedInst,
      };
    }
  }

  // Object-type dot-walks
  if (objMatch && cleanSegments.length > 1) {
    let currentObj = objMatch;
    for (let i = 1; i < cleanSegments.length - 1; i++) {
      const seg = cleanSegments[i];
      const attr = currentObj.attributes.find(a => a.name.toLowerCase() === seg.toLowerCase());
      if (attr && attr.refType) {
        const nextObj = model.find(o => o.name === attr.refType);
        if (nextObj) { currentObj = nextObj; continue; }
      }
      break;
    }

    let records = await fetchRecords(currentObj.name);
    records = scopeToInstance(records, currentObj.name, model, selectedInst, startObj);
    const unfilteredCount = records.length;
    records = applyFiltersAndIndex(records, filters, filterLogic, indexAccess);
    const lastSeg = cleanSegments[cleanSegments.length - 1];

    // If last segment is a field, extract values
    const isField = currentObj.attributes.some(a => a.name.toLowerCase() === lastSeg.toLowerCase());
    if (isField && records.length > 0) {
      const fieldKey = Object.keys(records[0]).find(k => k.toLowerCase() === lastSeg.toLowerCase());
      if (fieldKey) {
        const values = records.map(r => r[fieldKey]).filter(v => v != null);
        if (values.length === 1) {
          return {
            value: values[0],
            totalCount: unfilteredCount,
            objectName: currentObj.name,
            filters: filters.length > 0 ? filters : undefined,
            filterLogic: filters.length > 1 ? filterLogic : undefined,
            indexAccess,
            instanceScoped: !!selectedInst,
          };
        }
        return {
          records: records.slice(0, 5),
          totalCount: records.length,
          unfilteredCount,
          objectName: currentObj.name,
          fields: [fieldKey],
          filters: filters.length > 0 ? filters : undefined,
          filterLogic: filters.length > 1 ? filterLogic : undefined,
          indexAccess,
          instanceScoped: !!selectedInst,
        };
      }
    }

    return {
      records: records.slice(0, 5),
      totalCount: records.length,
      unfilteredCount,
      objectName: currentObj.name,
      fields: currentObj.attributes.map(a => a.name).filter(n => !n.startsWith('_')).slice(0, 6),
      filters: filters.length > 0 ? filters : undefined,
      filterLogic: filters.length > 1 ? filterLogic : undefined,
      indexAccess,
      instanceScoped: !!selectedInst,
    };
  }

  // Fallback: fetch root object directly
  if (objMatch) {
    let records = await fetchRecords(objMatch.name);
    records = scopeToInstance(records, objMatch.name, model, selectedInst, startObj);
    return {
      records: records.slice(0, 5),
      totalCount: records.length,
      objectName: objMatch.name,
      fields: objMatch.attributes.map(a => a.name).filter(n => !n.startsWith('_')).slice(0, 6),
      instanceScoped: !!selectedInst,
    };
  }

  return { error: `Could not resolve "${source}" in the model` };
}

// ═════════════════════════════════════════════════════════════════════
//  HELPERS
// ═════════════════════════════════════════════════════════════════════

/**
 * Instance-scoped filtering.
 * When a specific starting-object instance is selected, filter child records
 * to only those referencing that instance via a foreign key.
 */
function scopeToInstance(records, objectName, model, selectedInst, startObj) {
  if (!selectedInst || !records.length) return records;

  if (objectName.toLowerCase() === startObj.toLowerCase()) {
    return records.filter(r => {
      const rid = r._uuid || r._resourceId || r.id || r.Id || r.ID;
      return rid === selectedInst.id;
    });
  }

  const objDef = model.find(o => o.name === objectName);
  if (objDef) {
    const refAttr = objDef.attributes.find(a => a.refType === startObj);
    if (refAttr) {
      return records.filter(r => {
        const fk = r[refAttr.name] || '';
        return fk === selectedInst.id || fk === selectedInst.displayId;
      });
    }
  }
  return records;
}

/**
 * Apply parsed filter conditions and index access to a records array.
 * Mirrors the Spring EL semantics: .{?cond} filters, [n] picks by index.
 */
export function applyFiltersAndIndex(records, filters, filterLogic, indexAccess) {
  if (!records || records.length === 0) return records;

  if (filters.length > 0) {
    const literalFilter = filters.find(f => f.field === '_literal');
    if (literalFilter) {
      if (literalFilter.value === 'false') return [];
    } else {
      records = records.filter(r => {
        const results = filters.map(f => {
          if (f.op === 'is null') return r[f.field] == null || r[f.field] === '';
          if (f.op === 'not null') return r[f.field] != null && r[f.field] !== '';
          if (f.isVariableRef) return true;
          const val = String(r[f.field] ?? '');
          const target = f.value;
          switch (f.op) {
            case '==': return val === target;
            case '!=': return val !== target;
            case '>':  return parseFloat(val) > parseFloat(target);
            case '<':  return parseFloat(val) < parseFloat(target);
            case '>=': return parseFloat(val) >= parseFloat(target);
            case '<=': return parseFloat(val) <= parseFloat(target);
            case 'contains': return val.toLowerCase().includes(target.toLowerCase());
            case 'matches':  try { return new RegExp(target).test(val); } catch { return false; }
            default: return val === target;
          }
        });
        return filterLogic === 'or' ? results.some(Boolean) : results.every(Boolean);
      });
    }
  }

  if (indexAccess != null && indexAccess >= 0 && records.length > indexAccess) {
    records = [records[indexAccess]];
  }

  return records;
}
