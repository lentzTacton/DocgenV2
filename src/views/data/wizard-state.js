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
  excludeVars: [],
  catalogueId: null,
  sectionId: null,
  cpContext: null,
  matchCount: 0,
  tags: [],

  // Linked define state (type === 'define')
  sourceDefine: '',           // name of the referenced define (e.g. '#headUomV')
  sourceDefineSource: '',     // the original source of the referenced define (for two-define generation)

  // Object explorer state
  objectPath: [],      // [{name, refType, reverse?, fromObject?}]
  explorerTab: 'all',  // 'all' | 'fav' | 'ref'
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
  // Preserve pre-set catalogueId (set by "New data set" menu on a catalogue)
  const presetCatalogueId = wizState.catalogueId;

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
    wizState.excludeVars = copy.excludeVars || [];
    wizState.catalogueId = copy.catalogueId ?? null;
    wizState.sectionId = copy.sectionId ?? null;
    wizState.cpContext = copy.cpContext || null;
    wizState.matchCount = copy.matchCount ?? 0;
    wizState.tags = copy.tags || [];
    wizState.previewColumns = copy.previewColumns || [];
    wizState.sourceDefine = copy.sourceDefine || '';
    wizState.sourceDefineSource = copy.sourceDefineSource || '';
    wizState.id = copy.id;
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
    wizState.excludeVars = [];
    wizState.catalogueId = presetCatalogueId || null;
    wizState.sectionId = null;
    wizState.cpContext = null;
    wizState.matchCount = 0;
    wizState.tags = [];
    wizState.previewColumns = [];
    wizState.sourceDefine = '';
    wizState.sourceDefineSource = '';
    wizState.id = null;
  }

  // Reset data state
  wizState.bomRecords = [];
  wizState.bomFields = [];
  wizState.bomSources = [];
  wizState.modelObjects = [];
  wizState.objectRecords = [];

  // Reset object explorer state
  wizState.objectPath = [];
  wizState.explorerTab = 'all';
  wizState.explorerFavs = new Set();
  wizState.currentObjDesc = null;

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
    excludeVars: wizState.excludeVars,
    catalogueId: wizState.catalogueId,
    sectionId: wizState.sectionId,
    cpContext: wizState.cpContext,
    matchCount: wizState.matchCount,
    tags: wizState.tags || [],
    previewColumns: wizState.previewColumns || [],
    sourceDefine: wizState.sourceDefine || '',
    sourceDefineSource: wizState.sourceDefineSource || '',
  };
}
