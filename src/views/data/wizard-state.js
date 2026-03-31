/**
 * Wizard Shared State
 *
 * Centralized mutable state object and initialization functions for the variable wizard.
 * All sub-modules import from this module to read/write shared state.
 */

import state from '../../core/state.js';

/**
 * Main wizard state object.
 * Contains the variable definition being created/edited.
 */
export const wizState = {
  // Current variable definition
  purpose: 'block',  // 'block' | 'variable'
  type: 'object',    // 'bom' | 'object' | 'single' | 'list' | 'define' | 'code'
  name: '',
  description: '',
  source: '#this.flatbom',
  filters: [],
  filterLogic: 'or', // 'or' | 'and'
  transforms: [],
  instanceMode: 'all',    // 'all' | 'single'
  instanceId: null,
  instanceLabel: null,
  instanceSolution: null,
  catchAll: false,
  placeholder: false,
  // loopVarName removed — the child block's own name (with #) IS the loop variable
  excludeVars: [],
  catalogueId: null,
  sectionId: null,
  cpContext: null,
  matchCount: 0,
  tags: [],

  // Linked define state (type === 'define')
  sourceDefine: '',           // name of the referenced define (e.g. '#headUomV')
  sourceDefineSource: '',     // the original source of the referenced define (for two-define generation)

  // Parent-child block state (for loop iteration context)
  parentBlock: '',            // name of the parent block variable (e.g. '#listOfAlternativeToPrimary')
  parentLoopVar: '',          // the loop variable name (e.g. '#currentAlternative')
  parentObjectType: '',       // resolved object type of the loop variable (e.g. 'ConfiguredProduct')

  // Object explorer state
  objectPath: [],      // [{name, refType, reverse?, fromObject?}]
  explorerTab: 'all',  // 'all' | 'fav' | 'ref'
  explorerSearch: '',   // search/filter text for object explorer
  explorerFavs: new Set(),
  currentObjDesc: null, // result of describeObject()

  // Data state
  bomRecords: [],
  bomFields: [],
  bomSources: [],
  modelObjects: [],
  objectRecords: [],    // cached records for current object type (loaded async)
  previewColumns: [],   // user-selected columns for data preview (persisted with variable)

  // Single type: source mode toggle ('object' | 'config')
  _singleSourceMode: 'object',

  // Config explorer state (getConfigurationAttribute sources)
  _configTab: 'all',            // 'all' | 'calc' | 'search'
  _selectedConfigPath: null,     // e.g. "nonfire_pump_node-1.pumpSeries"
  _selectedConfigNodeKey: null,
  _selectedConfigAttr: null,
  _selectedConfigIsCalc: false,
  _configFallback: 'N/A',

  // Edit mode flag
  isEditMode: false,
  existingVariable: null,
};

/**
 * Reset the wizard state for a new or existing variable.
 * @param {Object} existing - existing variable to edit, or null for new
 */
export function resetWiz(existing) {
  // Preserve pre-set catalogueId and sectionId (set by "New dataset" menu)
  const presetCatalogueId = wizState.catalogueId;
  const presetSectionId = wizState.sectionId;

  wizState.isEditMode = !!existing;
  wizState.existingVariable = existing;

  if (existing) {
    // Deep copy existing variable
    const copy = JSON.parse(JSON.stringify(existing));
    wizState.purpose = copy.purpose || inferPurpose(copy);
    wizState.type = copy.type || 'bom';
    wizState.name = copy.name || '';
    wizState.description = copy.description || '';
    wizState.source = copy.source || '#this.flatbom';
    wizState.filters = copy.filters || [];
    wizState.filterLogic = copy.filterLogic || 'or';
    wizState.transforms = copy.transforms || [];
    wizState.instanceMode = copy.instanceMode || 'all';
    wizState.instanceId = copy.instanceId ?? null;
    wizState.instanceLabel = copy.instanceLabel ?? null;
    wizState.instanceSolution = copy.instanceSolution ?? null;
    wizState.catchAll = copy.catchAll || false;
    wizState.placeholder = copy.placeholder || false;
    wizState.excludeVars = copy.excludeVars || [];
    wizState.catalogueId = copy.catalogueId ?? null;
    wizState.sectionId = copy.sectionId ?? null;
    wizState.cpContext = copy.cpContext || null;
    wizState.matchCount = copy.matchCount ?? 0;
    wizState.tags = copy.tags || [];
    wizState.previewColumns = copy.previewColumns || [];
    wizState.sourceDefine = copy.sourceDefine || '';
    wizState.sourceDefineSource = copy.sourceDefineSource || '';
    wizState.parentBlock = copy.parentBlock || '';
    wizState.parentLoopVar = copy.parentLoopVar || '';
    wizState.parentObjectType = copy.parentObjectType || '';
    wizState._singleFilter = copy._singleFilter || null;
    wizState._singleLeafField = copy._singleLeafField || null;
    wizState.id = copy.id;

    // Auto-detect placeholder from source if not explicitly saved
    // (backward compat: older variables may have .{?false} in source but no placeholder flag)
    if (!wizState.placeholder && wizState.source && wizState.source.includes('.{?false}')) {
      wizState.placeholder = true;
      // Strip .{?false} from source so the object path explorer works correctly
      wizState.source = wizState.source.replace(/\.\{\?false\}$/, '');
      wizState.filters = [];
      wizState.transforms = [];
    }

    // Auto-detect config type: if a 'single' variable uses getConfigurationAttribute,
    // switch to 'config' type so the Config Explorer loads directly on edit.
    if (wizState.type === 'single' && wizState.source && wizState.source.includes('getConfigurationAttribute(')) {
      wizState.type = 'config';
      wizState._singleSourceMode = 'config';
    }

    // Auto-detect parent-child block relationship from source
    // If source starts with #loopVar. (e.g. #currentAlternative.flatbom), link to parent
    if (!wizState.parentLoopVar && wizState.source) {
      const loopVarMatch = wizState.source.match(/^(#\w+)\./);
      if (loopVarMatch) {
        const loopVarName = loopVarMatch[1];
        // Find the for-loop that uses this variable — look for a block whose source
        // is iterated by a $for{loopVarName in parentBlock}$ construct.
        // We can infer this from existing variables: find one where the expression
        // would produce this loop variable. For now, store the loop var and resolve
        // the parent block & object type later when the model is loaded.
        wizState.parentLoopVar = loopVarName;
        // Strip the loop var prefix from source for the explorer
        wizState.source = wizState.source.slice(loopVarName.length + 1); // strip "#var."
      }
    }
  } else {
    // New variable defaults
    wizState.purpose = 'block';
    wizState.type = 'object';
    wizState.name = '';
    wizState.description = '';
    wizState.source = '';
    wizState.filters = [];
    wizState.filterLogic = 'or';
    wizState.transforms = [];
    wizState.instanceMode = 'all';
    wizState.instanceId = null;
    wizState.instanceLabel = null;
    wizState.instanceSolution = null;
    wizState.catchAll = false;
    wizState.placeholder = false;
    wizState.excludeVars = [];
    wizState.catalogueId = presetCatalogueId || null;
    wizState.sectionId = presetSectionId || null;
    wizState.cpContext = null;
    wizState.matchCount = 0;
    wizState.tags = [];
    wizState.previewColumns = [];
    wizState.sourceDefine = '';
    wizState.sourceDefineSource = '';
    wizState.parentBlock = '';
    wizState.parentLoopVar = '';
    wizState.parentObjectType = '';
    wizState.id = null;
  }

  // Reset data state
  wizState.bomRecords = [];
  wizState.bomFields = [];
  wizState.bomSources = [];
  wizState.modelObjects = [];
  wizState.objectRecords = [];

  // Reset object explorer state (objectPath rebuilt later by rebuildObjectPath)
  wizState.objectPath = [];
  wizState.explorerTab = 'all';
  wizState.explorerSearch = '';
  wizState.explorerFavs = new Set();
  wizState.currentObjDesc = null;

  // Only reset single-filter state for NEW variables — in edit mode these
  // were already restored from the saved variable above (lines 107-108).
  // rebuildObjectPath() will also re-extract _singleLeafField from the source.
  if (!existing) {
    wizState._singleLeafField = null;
    wizState._singleFilter = null;
  }

  // Reset source mode — auto-detect from existing source
  if (existing && existing.source && existing.source.includes('getConfigurationAttribute(')) {
    wizState._singleSourceMode = 'config';
  } else {
    wizState._singleSourceMode = 'object';
  }


  // Reset config explorer state
  wizState._configTab = 'all';
  wizState._selectedConfigNodeKey = null;
  wizState._selectedConfigAttr = null;
  wizState._selectedConfigIsCalc = false;
  wizState._configFallback = 'N/A';

  // Extract config path from existing source so the drawer can load immediately
  if (wizState._singleSourceMode === 'config' && wizState.source) {
    const pathMatch = wizState.source.match(/getConfigurationAttribute\s*\(\s*"([^"]+)"\s*\)/);
    wizState._selectedConfigPath = pathMatch ? pathMatch[1] : null;
  } else {
    wizState._selectedConfigPath = null;
  }
}

/**
 * Infer purpose from existing variable data (for backwards compatibility).
 * @param {Object} v - variable to infer from
 * @returns {string} 'variable' or 'block'
 */
export function inferPurpose(v) {
  if (v.purpose) return v.purpose;
  // Single type = always a variable (scalar value or uniquely-filtered record)
  if (v.type === 'single') return 'variable';
  // List literal → variable
  if (v.type === 'list') return 'variable';
  // Linked define → always variable (scalar from another define)
  if (v.type === 'define') return 'variable';
  // Code formula → always variable (computed scalar)
  if (v.type === 'code') return 'variable';
  // BOM/object with transforms ending in .sum() or .size() → scalar result → variable
  if (v.transforms?.length > 0) {
    const last = v.transforms[v.transforms.length - 1];
    if (last.type === 'sum' || last.type === 'size') return 'variable';
  }
  // Default: block (collection for iteration)
  return 'block';
}

/**
 * Rebuild objectPath from a source expression + model objects.
 *
 * Given an expression like "solution.opportunity.currency.name" and the model,
 * walks the ref chain to reconstruct the objectPath segments the explorer needs
 * for breadcrumb navigation. Also strips the leaf field from wizState.source
 * so the explorer shows the correct object with the leaf highlighted.
 *
 * Call this after the model is loaded (in bootAsync edit-mode path).
 *
 * @param {Array} modelObjects — array of {name, attributes: [{name, refType}]}
 */
export function rebuildObjectPath(modelObjects) {
  if (!wizState.isEditMode || !wizState.source || !modelObjects?.length) return;
  // Don't rebuild for non-object/single types or config sources
  if (wizState.type !== 'object' && wizState.type !== 'single') return;
  if (wizState._singleSourceMode === 'config') return;

  // Use parent object type as root when in child block context
  const startObj = wizState.parentObjectType || state.get('startingObject.type') || 'Solution';
  const root = startObj.charAt(0).toLowerCase() + startObj.slice(1);
  const source = wizState.source;

  // For child blocks, source is relative to parent type (e.g. 'flatbom' not 'configuredProduct.flatbom')
  // Skip the root prefix check if in parent context — source starts directly with attributes
  if (!wizState.parentObjectType && !source.startsWith(root)) return;

  // Tokenise: split on dots but keep .related('X','Y') as single tokens
  const tokens = [];
  // For child blocks, source is relative — don't strip root prefix
  let rest = wizState.parentObjectType ? (source.startsWith('.') ? source : '.' + source) : source.slice(root.length);
  while (rest.length > 0) {
    if (rest.startsWith('.related(')) {
      // Parse .related('FromObject','attribute')
      const m = rest.match(/^\.related\(\s*'([^']+)'\s*,\s*'([^']+)'\s*\)/);
      if (m) {
        tokens.push({ type: 'reverse', fromObject: m[1], name: m[2] });
        rest = rest.slice(m[0].length);
      } else {
        break; // malformed — bail
      }
    } else if (rest.startsWith('.')) {
      // Forward segment
      const dotRest = rest.slice(1); // strip leading dot
      const nextDot = dotRest.search(/[.]/);
      const seg = nextDot === -1 ? dotRest : dotRest.slice(0, nextDot);
      if (!seg) break;
      tokens.push({ type: 'forward', name: seg });
      rest = nextDot === -1 ? '' : dotRest.slice(nextDot);
    } else {
      break;
    }
  }

  if (tokens.length === 0) return;

  // Walk the model to determine which forward tokens are refs vs the leaf field.
  // Reverse tokens are always path segments (never the leaf).
  const path = [];
  let currentObj = startObj;

  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.type === 'reverse') {
      path.push({ name: tok.name, reverse: true, fromObject: tok.fromObject });
      currentObj = tok.fromObject;
      continue;
    }
    // Forward token — check if it's a ref on the current object
    const objDef = modelObjects.find(o => o.name === currentObj);
    if (!objDef) break;
    const attr = objDef.attributes.find(a => a.name === tok.name);
    if (attr && attr.refType) {
      // It's a reference — add as path segment
      path.push({ name: tok.name, refType: attr.refType });
      currentObj = attr.refType;
    } else {
      // Not a ref — this is the leaf field (and everything after it like .trim())
      wizState._singleLeafField = tok.name;
      break;
    }
  }

  if (path.length > 0) {
    wizState.objectPath = path;
  }
}

/**
 * Get a snapshot of the current variable for saving.
 * @returns {Object} variable object
 */
export function getWizSnapshot() {
  return {
    ...(wizState.id ? { id: wizState.id } : {}),
    purpose: wizState.purpose,
    type: wizState.type,
    name: wizState.name,
    description: wizState.description,
    source: wizState.source,
    filters: wizState.filters,
    filterLogic: wizState.filterLogic,
    transforms: wizState.transforms,
    instanceMode: wizState.instanceMode,
    instanceId: wizState.instanceId,
    instanceLabel: wizState.instanceLabel,
    instanceSolution: wizState.instanceSolution,
    catchAll: wizState.catchAll,
    placeholder: wizState.placeholder,
    excludeVars: wizState.excludeVars,
    catalogueId: wizState.catalogueId,
    sectionId: wizState.sectionId,
    cpContext: wizState.cpContext,
    matchCount: wizState.matchCount,
    tags: wizState.tags || [],
    previewColumns: wizState.previewColumns || [],
    sourceDefine: wizState.sourceDefine || '',
    sourceDefineSource: wizState.sourceDefineSource || '',
    parentBlock: wizState.parentBlock || '',
    parentLoopVar: wizState.parentLoopVar || '',
    parentObjectType: wizState.parentObjectType || '',
    _singleFilter: wizState._singleFilter || null,
    _singleLeafField: wizState._singleLeafField || null,
  };
}
