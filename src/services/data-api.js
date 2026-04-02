/**
 * Data API — Fetches live BOM/object data for the Data Catalogue.
 *
 * Bridges the ticket connection (from Setup) with the variable wizard.
 * Caches model and record data per session to avoid repeated fetches.
 */

import state from '../core/state.js';
import { getModel, listRecords, fetchConfiguredProduct, parseConfiguredProductXml, ticketFetch } from './api.js';
import { getInstance } from '../core/storage.js';
import {
  isOfflineMode,
  offlineFetchModel,
  offlineGetObjectTypes,
  offlineGetObjectAttributes,
  offlineGetRefAttributes,
  offlineFetchRecords,
  offlineFetchBomRecords,
  offlineGetBomFields,
  offlineGetBomFieldValues,
  offlineGetBomSources,
  offlineDescribeObject,
  offlineDescribeObjectWithData,
  offlineGetConfiguredProductList,
  offlineFetchConfiguredProductData,
  offlineIndexConfigAttributes,
  offlineGetObjectRecordCount,
  offlineGetObjectSampleValues,
  offlineResolveCurrentObject,
} from './offline/offline-adapter.js';

// ─── Caches ─────────────────────────────────────────────────────────

let cachedModel = null;       // { ticketId, objects: [...] }
let cachedRecords = {};       // objectName → records[]
let cachedBomFields = null;   // string[]  (field names from flatbom)
let cachedBomRecords = null;  // record[]
let cachedConfigProducts = {}; // cpId → { model, bom } parsed XML tree
let cachedDescriptions = {};  // objectName → { forwardRefs, reverseRefs, attributes }

// ─── Connection helpers ─────────────────────────────────────────────

/** Get the active instance + ticket from Setup state. */
function getConnection() {
  const instanceId = state.get('connection.instanceId');
  const ticketId = state.get('tickets.selected')
    || (state.get('tickets.included') || [])[0]
    || null;
  const connected = state.get('connection.status') === 'connected';
  return { instanceId, ticketId, connected };
}

/** Is the Data tab able to make API calls? */
export function isConnected() {
  if (isOfflineMode()) return true;
  const { instanceId, ticketId, connected } = getConnection();
  return !!(connected && instanceId && ticketId);
}

/** Get basic connection info for display. */
export function connectionInfo() {
  const { ticketId, connected } = getConnection();
  return { ticketId, connected };
}

// ─── Model (Object Types + Attributes) ──────────────────────────────

/**
 * Fetch the object model for the current ticket.
 * Returns array of { name, attributes: [{name, type, refType}], listUrl }
 */
export async function fetchModel() {
  if (isOfflineMode()) return offlineFetchModel();
  const { instanceId, ticketId, connected } = getConnection();
  if (!connected || !instanceId || !ticketId) return null;

  // Cache hit
  if (cachedModel && cachedModel.ticketId === ticketId) {
    return cachedModel.objects;
  }

  const instance = await getInstance(instanceId);
  if (!instance) return null;

  const res = await getModel(instance, ticketId);
  if (!res.ok || !res.objects) return null;

  cachedModel = { ticketId, objects: res.objects };
  return res.objects;
}

/**
 * Get all object type names from the model.
 */
export async function getObjectTypes() {
  if (isOfflineMode()) return offlineGetObjectTypes();
  const objects = await fetchModel();
  if (!objects) return [];
  return objects.map(o => o.name).sort();
}

/**
 * Get attributes for a specific object type.
 * Returns [{name, type, refType}]
 */
export async function getObjectAttributes(objectName) {
  if (isOfflineMode()) return offlineGetObjectAttributes(objectName);
  const objects = await fetchModel();
  if (!objects) return [];
  const obj = objects.find(o => o.name.toLowerCase() === objectName.toLowerCase());
  return obj ? obj.attributes : [];
}

/**
 * Get reference attributes for a specific object type.
 * Returns [{name, refType}] — only attributes that point to other objects.
 */
export async function getRefAttributes(objectName) {
  if (isOfflineMode()) return offlineGetRefAttributes(objectName);
  const attrs = await getObjectAttributes(objectName);
  return attrs.filter(a => a.refType);
}

// ─── Records ────────────────────────────────────────────────────────

/**
 * Fetch records for an object type.
 * @param {string} objectName
 * @returns {Promise<Array>}
 */
export async function fetchRecords(objectName) {
  if (isOfflineMode()) return offlineFetchRecords(objectName);
  const { instanceId, ticketId, connected } = getConnection();
  if (!connected || !instanceId || !ticketId) return [];

  // Cache hit
  const cacheKey = `${ticketId}:${objectName}`;
  if (cachedRecords[cacheKey]) return cachedRecords[cacheKey];

  const instance = await getInstance(instanceId);
  if (!instance) return [];

  const objects = await fetchModel();
  const objDef = objects?.find(o => o.name === objectName);
  const listUrl = objDef?.listUrl || null;

  const res = await listRecords(instance, ticketId, objectName, listUrl);
  if (!res.ok || !res.records) return [];

  cachedRecords[cacheKey] = res.records;
  return res.records;
}

// ─── BOM-specific helpers ───────────────────────────────────────────

/**
 * Fetch flatbom records (the most common BOM source).
 * Tries 'FlatBomItem', 'FlatBom', 'flatbom', 'BomItem' etc.
 */
export async function fetchBomRecords() {
  if (isOfflineMode()) return offlineFetchBomRecords();
  if (cachedBomRecords) return cachedBomRecords;

  const objects = await fetchModel();
  if (!objects) return [];

  // Try likely BOM object names
  const bomNames = ['FlatBomItem', 'FlatBom', 'flatbom', 'BomItem', 'BomLineItem', 'ConfiguredProduct'];
  const allNames = objects.map(o => o.name);

  let bomObjName = null;
  for (const candidate of bomNames) {
    const match = allNames.find(n => n.toLowerCase() === candidate.toLowerCase());
    if (match) { bomObjName = match; break; }
  }

  // Fallback: find anything with 'bom' or 'flatbom' in name
  if (!bomObjName) {
    bomObjName = allNames.find(n => n.toLowerCase().includes('bom')) || null;
  }

  if (!bomObjName) return [];

  const records = await fetchRecords(bomObjName);
  cachedBomRecords = records;
  return records;
}

/**
 * Get field names available on BOM records.
 * Returns array of field name strings.
 */
export async function getBomFields() {
  if (isOfflineMode()) return offlineGetBomFields();
  if (cachedBomFields) return cachedBomFields;

  const records = await fetchBomRecords();
  if (records.length === 0) {
    // Fallback: try model attributes
    const objects = await fetchModel();
    if (!objects) return [];
    const bomObj = objects.find(o => o.name.toLowerCase().includes('bom'));
    if (bomObj) {
      cachedBomFields = bomObj.attributes.map(a => a.name).filter(n => !n.startsWith('_'));
      return cachedBomFields;
    }
    return [];
  }

  // Extract unique field names from first few records (skip internal fields)
  const fieldSet = new Set();
  const sample = records.slice(0, 10);
  for (const rec of sample) {
    for (const key of Object.keys(rec)) {
      if (!key.startsWith('_') && key !== 'id' && key !== 'href' && key !== 'self' && key !== 'url') {
        fieldSet.add(key);
      }
    }
  }
  cachedBomFields = [...fieldSet].sort();
  return cachedBomFields;
}

/**
 * Get unique values for a specific BOM field.
 * Returns sorted array of distinct values.
 */
export async function getBomFieldValues(fieldName) {
  if (isOfflineMode()) return offlineGetBomFieldValues(fieldName);
  const records = await fetchBomRecords();
  const vals = new Set();
  for (const rec of records) {
    const key = Object.keys(rec).find(k => k.toLowerCase() === fieldName.toLowerCase());
    if (key && rec[key] != null && rec[key] !== '') {
      vals.add(String(rec[key]));
    }
  }
  return [...vals].sort();
}

/**
 * Get available data sources — BOM collections, related objects, and
 * entity references discovered from the Tacton object model.
 *
 * Sources are categorised so the wizard can group them meaningfully:
 *   category: 'bom' | 'related' | 'solution'
 *
 * Returns [{name, expression, count, objectName, category, description, cpContext?}]
 *   cpContext (on BOM sources): { objectName, refAttr, expression } — the parent CP info
 */
export async function getBomSources() {
  if (isOfflineMode()) return offlineGetBomSources();
  const objects = await fetchModel();
  if (!objects) return [{ name: 'flatbom', expression: '#this.flatbom', count: '?', objectName: null, category: 'bom', description: 'Flat BOM items' }];

  const sources = [];
  const allNames = objects.map(o => o.name);
  const startObj = getStartingObject(); // typically 'Solution'

  // ── 1. Find ConfiguredProduct relationship ──────────────────────────
  const startObjDef = objects.find(o => o.name === startObj);
  let cpObjectName = null;
  let cpRefAttr = null;

  for (const obj of objects) {
    for (const attr of obj.attributes) {
      if (attr.refType === startObj) {
        const lower = obj.name.toLowerCase();
        if (lower.includes('configuredproduct') || lower.includes('configured_product') || lower === 'cp') {
          cpObjectName = obj.name;
          cpRefAttr = attr.name;
        }
      }
    }
  }

  if (!cpObjectName) {
    cpObjectName = allNames.find(n =>
      n.toLowerCase().includes('configuredproduct') ||
      n.toLowerCase().includes('configured_product')
    ) || null;
  }

  // ── Collect all objects we need records for, then fetch in parallel ──
  // Each entry: { obj, category, meta } — we batch fetchRecords calls
  const fetchJobs = [];

  // ── 2. BOM sources (per ConfiguredProduct) ──────────────────────────
  if (cpObjectName) {
    const cpObj = objects.find(o => o.name === cpObjectName);
    if (cpObj) {
      const bomCandidates = ['flatbom', 'bom', 'bomitems', 'subitems', 'flatbomitem', 'bomlineitem'];

      for (const obj of objects) {
        const lower = obj.name.toLowerCase();
        const isBomLike = bomCandidates.some(c => lower.includes(c)) ||
                          lower.includes('bom') || lower.includes('lineitem');
        if (!isBomLike) continue;
        const hasRefToCP = obj.attributes.some(a => a.refType === cpObjectName);
        if (hasRefToCP || isBomLike) {
          let exprName;
          if (lower.includes('flatbom') || lower === 'flatbomitem') exprName = 'flatbom';
          else if (lower === 'bomitem' || lower === 'bomlineitem') exprName = 'bomItems';
          else if (lower === 'bom' || lower.endsWith('bom')) exprName = 'bom';
          else exprName = obj.name;
          fetchJobs.push({ objectName: obj.name, category: 'bom', exprName });
        }
      }
    }
  } else {
    for (const obj of objects) {
      const lower = obj.name.toLowerCase();
      if (lower.includes('bom') || lower.includes('flatbom') || lower.includes('lineitem')) {
        const exprName = lower.includes('flatbom') ? 'flatbom' : lower.includes('bom') ? 'bom' : obj.name;
        fetchJobs.push({ objectName: obj.name, category: 'bom-noCp', exprName });
      }
    }
  }

  // ── 3. Related object collections (per Solution) ────────────────────
  if (startObjDef) {
    for (const obj of objects) {
      if (obj.name === startObj) continue;
      if (obj.name === cpObjectName) continue;
      for (const attr of obj.attributes) {
        if (attr.refType === startObj) {
          fetchJobs.push({ objectName: obj.name, category: 'related', attr: attr.name });
        }
      }
    }
  }

  // ── 4. ConfiguredProduct itself as a source ─────────────────────────
  if (cpObjectName && cpRefAttr) {
    fetchJobs.push({ objectName: cpObjectName, category: 'cp-self' });
  }

  // ── Parallel fetch all records at once ──────────────────────────────
  const recordResults = await Promise.all(
    fetchJobs.map(job => fetchRecords(job.objectName).catch(() => []))
  );

  // ── Build sources from results ──────────────────────────────────────
  const cpCtx = cpObjectName && cpRefAttr ? {
    objectName: cpObjectName,
    refAttr: cpRefAttr,
    expression: `${startObj.toLowerCase()}.related('${cpObjectName}','${cpRefAttr}')`,
  } : null;

  fetchJobs.forEach((job, i) => {
    const records = recordResults[i];
    if (job.category === 'bom') {
      const description = job.exprName === 'flatbom' ? 'Flat BOM — all items at one level'
        : job.exprName === 'bom' ? 'Hierarchical BOM — nested levels'
        : job.exprName === 'bomItems' ? 'BOM line items'
        : `${job.objectName} items`;
      sources.push({
        name: job.exprName,
        expression: `#cp.${job.exprName}`,
        count: records.length,
        objectName: job.objectName,
        category: 'bom',
        description,
        cpContext: cpCtx,
      });
    } else if (job.category === 'bom-noCp') {
      sources.push({
        name: job.exprName,
        expression: `#this.${job.exprName}`,
        count: records.length,
        objectName: job.objectName,
        category: 'bom',
        description: `${job.objectName} items`,
      });
    } else if (job.category === 'related') {
      sources.push({
        name: job.objectName,
        expression: `${startObj.toLowerCase()}.related('${job.objectName}','${job.attr}')`,
        count: records.length,
        objectName: job.objectName,
        category: 'related',
        description: `${job.objectName} linked to ${startObj}`,
      });
    } else if (job.category === 'cp-self') {
      sources.push({
        name: cpObjectName,
        expression: `${startObj.toLowerCase()}.related('${cpObjectName}','${cpRefAttr}')`,
        count: records.length,
        objectName: cpObjectName,
        category: 'related',
        description: 'Configured products on this solution',
      });
    }
  });

  // Well-known fallback if no BOM objects found with CP context
  if (cpObjectName && cpRefAttr && !sources.some(s => s.category === 'bom')) {
    sources.push({
      name: 'flatbom',
      expression: '#cp.flatbom',
      count: '?',
      objectName: null,
      category: 'bom',
      description: 'Flat BOM — all items at one level',
      cpContext: cpCtx,
    });
    sources.push({
      name: 'bom',
      expression: '#cp.bom',
      count: '?',
      objectName: null,
      category: 'bom',
      description: 'Hierarchical BOM — nested levels',
      cpContext: cpCtx,
    });
  }

  // ── Fallback ────────────────────────────────────────────────────────
  if (sources.length === 0) {
    sources.push({
      name: 'flatbom',
      expression: '#this.flatbom',
      count: '?',
      objectName: null,
      category: 'bom',
      description: 'Flat BOM items (default)',
    });
  }

  return sources;
}

// ─── Object explorer helpers ────────────────────────────────────────

/**
 * Get the starting object type from Setup.
 * Returns the object type name (e.g., 'Solution', 'ConfiguredProduct').
 */
export function getStartingObject() {
  return state.get('startingObject.type') || 'Solution';
}

/**
 * Describe a single object type — returns forward refs, reverse refs,
 * value attributes, all sorted and categorized.
 *
 * @param {string} objectName
 * @returns {Promise<{
 *   name: string,
 *   forwardRefs: [{name, refType, type, mandatory}],
 *   reverseRefs: [{fromObject, attribute, fromAttrType}],
 *   attributes:  [{name, type, mandatory, searchable}],
 * }>}
 */
export async function describeObject(objectName) {
  if (isOfflineMode()) return offlineDescribeObject(objectName);
  // Cache hit — skip recomputation
  if (cachedDescriptions[objectName]) return cachedDescriptions[objectName];

  const objects = await fetchModel();
  if (!objects) return { name: objectName, forwardRefs: [], reverseRefs: [], attributes: [] };

  const obj = objects.find(o => o.name === objectName);
  if (!obj) return { name: objectName, forwardRefs: [], reverseRefs: [], attributes: [] };

  // Forward refs: attributes on THIS object that point to another
  const forwardRefs = obj.attributes
    .filter(a => a.refType)
    .map(a => ({ name: a.name, refType: a.refType, type: a.type, mandatory: a.mandatory }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Reverse refs: attributes on OTHER objects that point TO this object
  const reverseRefs = [];
  for (const other of objects) {
    if (other.name === objectName) continue;
    for (const a of other.attributes) {
      if (a.refType === objectName) {
        reverseRefs.push({ fromObject: other.name, attribute: a.name, fromAttrType: a.type });
      }
    }
  }
  reverseRefs.sort((a, b) => a.fromObject.localeCompare(b.fromObject));

  // Value attributes: non-reference fields
  const attributes = obj.attributes
    .filter(a => !a.refType)
    .sort((a, b) => {
      // Mandatory first, then alphabetical
      if (a.mandatory !== b.mandatory) return a.mandatory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const result = { name: objectName, forwardRefs, reverseRefs, attributes };
  cachedDescriptions[objectName] = result;
  return result;
}

/**
 * Clear the model and description caches, forcing a fresh fetch on next use.
 */
export function clearModelCache() {
  cachedModel = null;
  cachedDescriptions = {};
}

/**
 * Resolve the current object name after walking a path.
 */
export async function resolveCurrentObject(pathSegments, rootOverride) {
  if (isOfflineMode()) return offlineResolveCurrentObject(pathSegments, rootOverride);
  const objects = await fetchModel();
  if (!objects) return rootOverride || getStartingObject();

  let current = rootOverride || getStartingObject();
  for (const seg of pathSegments) {
    const obj = objects.find(o => o.name === current);
    if (!obj) break;
    const ref = obj.attributes.find(a => a.name === seg.name && a.refType);
    if (ref) current = ref.refType;
    // For reverse refs, the fromObject becomes the current context
    else if (seg.reverse && seg.fromObject) current = seg.fromObject;
  }
  return current;
}

// ─── Object explorer record helpers (beyond describe) ───────────────

/**
 * Get the record count for a given object type (uses list API, not describe).
 * Caches via fetchRecords.
 */
export async function getObjectRecordCount(objectName) {
  if (isOfflineMode()) return offlineGetObjectRecordCount(objectName);
  const records = await fetchRecords(objectName);
  return records.length;
}

/**
 * Get sample values for a specific attribute on an object type.
 * Returns up to `max` unique values found in actual records.
 * This goes beyond describe — it pulls live data.
 *
 * @param {string} objectName
 * @param {string} attrName
 * @param {number} [max=8]
 * @returns {Promise<string[]>}
 */
export async function getObjectSampleValues(objectName, attrName, max = 8) {
  if (isOfflineMode()) return offlineGetObjectSampleValues(objectName, attrName, max);
  const records = await fetchRecords(objectName);
  const vals = new Set();
  for (const rec of records) {
    const key = Object.keys(rec).find(k => k.toLowerCase() === attrName.toLowerCase());
    if (key && rec[key] != null && rec[key] !== '') {
      vals.add(String(rec[key]));
      if (vals.size >= max) break;
    }
  }
  return [...vals].sort();
}

/**
 * Enhanced describeObject that includes record count and sample values
 * for the first few attributes. This gives a richer view than describe alone.
 */
export async function describeObjectWithData(objectName) {
  if (isOfflineMode()) return offlineDescribeObjectWithData(objectName);
  const desc = await describeObject(objectName);
  const count = await getObjectRecordCount(objectName).catch(() => 0);

  // Fetch sample values for first 3 value attributes (don't overload)
  const enrichedAttrs = await Promise.all(
    desc.attributes.map(async (attr, i) => {
      if (i < 5) {
        const samples = await getObjectSampleValues(objectName, attr.name, 3).catch(() => []);
        return { ...attr, samples };
      }
      return attr;
    })
  );

  return { ...desc, attributes: enrichedAttrs, recordCount: count };
}

// ─── Explorer Favorites (persisted) ─────────────────────────────────

import { loadFavorites, saveFavorites } from '../core/storage.js';

let _explorerFavs = null; // Set of "objectName.attrName" keys

async function ensureFavs() {
  if (!_explorerFavs) {
    _explorerFavs = await loadFavorites('explorer');
  }
  return _explorerFavs;
}

export async function getExplorerFavorites() {
  return ensureFavs();
}

export async function toggleExplorerFavorite(objectName, attrName) {
  const favs = await ensureFavs();
  const key = `${objectName}.${attrName}`;
  if (favs.has(key)) favs.delete(key);
  else favs.add(key);
  await saveFavorites('explorer', favs);
  return favs;
}

export async function isExplorerFavorite(objectName, attrName) {
  const favs = await ensureFavs();
  return favs.has(`${objectName}.${attrName}`);
}

// ─── Configured Product (Solution API) ──────────────────────────────

/**
 * Fetch and parse a configured product from the Solution API.
 * Returns the parsed product tree: { model, bom }
 *
 * model: { name, id, origin, attrs, calcAttrs, positions }
 *   positions: [{ name, id, origin, qty, attrs, assembly?, module? }]
 *     assembly: { name, id, attrs, calcAttrs, positions (recursive) }
 *     module: { name, id, variants: [{ name, id, attrs, calcAttrs }] }
 *
 * @param {string} cpId — ConfiguredProduct ID
 * @returns {Promise<object|null>}
 */
export async function fetchConfiguredProductData(cpId) {
  if (isOfflineMode()) return offlineFetchConfiguredProductData(cpId);
  if (!cpId) { console.warn('[config] fetchConfiguredProductData: no cpId'); return null; }
  const { instanceId, ticketId, connected } = getConnection();
  if (!connected || !instanceId || !ticketId) {
    console.warn('[config] fetchConfiguredProductData: not connected', { connected, instanceId, ticketId });
    return null;
  }

  // Cache hit
  const cacheKey = `${ticketId}:${cpId}`;
  if (cachedConfigProducts[cacheKey]) return cachedConfigProducts[cacheKey];

  const instance = await getInstance(instanceId);
  if (!instance) { console.warn('[config] fetchConfiguredProductData: no instance'); return null; }

  console.log(`[config] Fetching configured product ${cpId} on ticket ${ticketId}…`);
  const res = await fetchConfiguredProduct(instance, ticketId, cpId);
  if (!res.ok || !res.xml) {
    console.warn('[config] fetchConfiguredProduct failed:', res.error || 'no XML returned');
    return null;
  }

  console.log(`[config] Parsing XML (${res.xml.length} chars)…`);
  const parsed = parseConfiguredProductXml(res.xml);
  if (!parsed || !parsed.model) {
    console.warn('[config] parseConfiguredProductXml: no model in result');
    return null;
  }

  console.log(`[config] Loaded ${parsed.model.name} with ${parsed.model.positions?.length || 0} positions`);
  cachedConfigProducts[cacheKey] = parsed;
  return parsed;
}

/**
 * Get all ConfiguredProduct IDs available on the current ticket.
 * Uses the object model to list ConfiguredProduct records.
 * Returns array of { id, name, summary }
 */
export async function getConfiguredProductList() {
  if (isOfflineMode()) return offlineGetConfiguredProductList();
  const objects = await fetchModel();
  if (!objects) { console.warn('[config] getConfiguredProductList: no model objects'); return []; }

  console.log('[config] Object types:', objects.map(o => o.name).join(', '));

  // ── Strategy 1: Find ConfiguredProduct in the object model ──
  const cpObj = objects.find(o =>
    o.name.toLowerCase().includes('configuredproduct') ||
    o.name.toLowerCase().includes('configured_product')
  );

  let records = [];
  if (cpObj) {
    console.log(`[config] Found CP object: ${cpObj.name}, fetching records…`);
    records = await fetchRecords(cpObj.name);
    console.log(`[config] ConfiguredProduct records:`, records.length);
  } else {
    console.warn('[config] No ConfiguredProduct object type in model — trying Solution.related lookup');
  }

  // ── Strategy 2 (fallback): Get CPs from Solution records' related references ──
  if (records.length === 0) {
    try {
      const solObj = objects.find(o => o.name === 'Solution');
      if (solObj) {
        const solRecords = await fetchRecords('Solution');
        // Solution records might have a 'configuredProducts' relation or similar
        for (const sol of solRecords) {
          // Check all fields for CP-like references
          for (const [key, value] of Object.entries(sol)) {
            if (key.toLowerCase().includes('configuredproduct') && value) {
              // Could be a single ID or comma-separated list
              const ids = String(value).split(',').map(s => s.trim()).filter(Boolean);
              for (const cpId of ids) {
                records.push({
                  _uuid: cpId,
                  id: cpId,
                  name: cpId,
                  solution: sol._uuid || sol._resourceId || sol.id,
                });
              }
            }
          }
        }
        console.log(`[config] Found ${records.length} CPs from Solution record fields`);
      }
    } catch (e) {
      console.warn('[config] Solution-based CP lookup failed:', e.message);
    }
  }

  // ── Strategy 3 (final fallback): Discover CPs via Solution API endpoints ──
  // The Solution API exposes configured-products either at the ticket level
  // or nested under individual solutions.
  if (records.length === 0) {
    try {
      const { instanceId, ticketId } = getConnection();
      const instance = await getInstance(instanceId);
      if (instance && ticketId) {
        const apiVersions = ['solution-api-v1.3', 'solution-api', 'solution-api-v1.2'];

        for (const ver of apiVersions) {
          // 3a: Try listing configured-products at ticket level
          console.log(`[config] Strategy 3a: trying ${ver}/configured-products …`);
          const res = await ticketFetch(instance, ticketId, `${ver}/configured-products`);
          if (res.ok && res.body) {
            const cpIds = _extractCpIdsFromResponse(res.body);
            if (cpIds.length > 0) {
              for (const cpId of cpIds) {
                records.push({ _uuid: cpId, id: cpId, name: cpId, solution: '' });
              }
              console.log(`[config] Found ${records.length} CPs from ${ver}/configured-products`);
              break;
            }
          }

          // 3b: Try listing solutions first, then get CPs from each solution
          console.log(`[config] Strategy 3b: trying ${ver}/solutions …`);
          const solRes = await ticketFetch(instance, ticketId, `${ver}/solutions`);
          if (solRes.ok && solRes.body) {
            const solIds = _extractIdsFromResponse(solRes.body, 'solution');
            console.log(`[config] Found ${solIds.length} solutions via ${ver}/solutions`);
            for (const solId of solIds) {
              // Try to get CPs for this solution
              const cpRes = await ticketFetch(instance, ticketId,
                `${ver}/solutions/${solId}/configured-products`);
              if (cpRes.ok && cpRes.body) {
                const cpIds = _extractCpIdsFromResponse(cpRes.body);
                for (const cpId of cpIds) {
                  records.push({ _uuid: cpId, id: cpId, name: cpId, solution: solId });
                }
              }
            }
            if (records.length > 0) {
              console.log(`[config] Found ${records.length} CPs from solution sub-endpoints`);
              break;
            }
          }

          // 3c: Try fetching solution detail which may embed CP references
          if (records.length === 0 && solRes.ok && solRes.body) {
            const solIds = _extractIdsFromResponse(solRes.body, 'solution');
            for (const solId of solIds) {
              const detailRes = await ticketFetch(instance, ticketId, `${ver}/solutions/${solId}`);
              if (detailRes.ok && detailRes.body) {
                const cpIds = _extractCpIdsFromResponse(detailRes.body);
                for (const cpId of cpIds) {
                  records.push({ _uuid: cpId, id: cpId, name: cpId, solution: solId });
                }
              }
            }
            if (records.length > 0) {
              console.log(`[config] Found ${records.length} CPs from solution detail responses`);
              break;
            }
          }
        }
      }
    } catch (e) {
      console.warn('[config] Solution API CP discovery failed:', e.message);
    }
  }

  // ── Strategy 4 (last resort): Brute-force — try fetching a known CP ID pattern ──
  // Some instances embed CP references in the ticket URL or use predictable resource IDs.
  // We can also try the `api-v2.2` object endpoint if it exposes ConfiguredProduct differently.
  if (records.length === 0) {
    try {
      const { instanceId, ticketId } = getConnection();
      const instance = await getInstance(instanceId);
      if (instance && ticketId) {
        // Try the admin-style object model listing for ConfiguredProduct
        const cpNames = ['ConfiguredProduct', 'Configured_Product', 'configuredProduct', 'CP'];
        for (const cpName of cpNames) {
          try {
            const recs = await fetchRecords(cpName);
            if (recs.length > 0) {
              for (const r of recs) {
                records.push({
                  _uuid: r._uuid || r._resourceId || r.id,
                  id: r.id || r.Id || r._uuid,
                  name: r.name || r.Name || r.id || r._uuid,
                  solution: r.solution || r.Solution || '',
                });
              }
              console.log(`[config] Found ${records.length} CPs via fetchRecords('${cpName}')`);
              break;
            }
          } catch { /* continue */ }
        }
      }
    } catch (e) {
      console.warn('[config] Strategy 4 failed:', e.message);
    }
  }

  if (records.length === 0) {
    console.warn('[config] No configured products found by any strategy');
    return [];
  }

  // Build a Solution ID → name map so we can label each CP with its parent Solution
  const solMap = {};
  try {
    const solObj = objects.find(o => o.name === 'Solution');
    if (solObj) {
      const solRecords = await fetchRecords('Solution');
      for (const s of solRecords) {
        const sId = s._uuid || s._resourceId || s.id || s.Id;
        const sDisplayId = s.id || s.Id || s.ID;
        const sName = s.name || s.Name || sDisplayId;
        if (sId) solMap[sId] = sName;
        if (sDisplayId && sDisplayId !== sId) solMap[sDisplayId] = sName;
      }
      console.log(`[config] Solution map:`, solMap);
    }
  } catch (e) {
    console.warn('[config] Could not load Solutions:', e.message);
  }

  // Solution API needs the internal UUID, not the display ID (e.g. CP-00001)
  return records.map(r => {
    const solRef = r.solution || r.Solution || '';
    // solRef may be a UUID, display ID, or name — resolve via the map
    const solutionName = solMap[solRef] || solRef || '';
    return {
      id: r._uuid || r._resourceId || r.id || r.Id || r.ID,
      displayId: r.id || r.Id || r.ID,
      name: r.name || r.Name || r.displayName || r.id,
      summary: r.summary || r.Summary || '',
      solutionName,
      solutionRef: solRef,
    };
  }).filter(r => r.id);
}

/**
 * Build a flat index of all getConfigurationAttribute paths from a
 * configured product tree. Each entry maps a "node.attr" path to its
 * position in the tree, making it easy to populate the explorer and
 * generate expressions.
 *
 * Returns: [{ path, nodeName, attrName, attrType, value, nodeType, depth, fullNodePath }]
 *   path: "position_name.attrName" — the argument to getConfigurationAttribute()
 *   nodeName: display name of the position/assembly/module
 *   attrName: the attribute name
 *   attrType: 'attribute' | 'calculated-attribute'
 *   value: current value (string or null)
 *   nodeType: 'model' | 'position' | 'assembly' | 'module' | 'variant'
 *   depth: nesting depth (0 = model, 1 = top position, etc.)
 *   fullNodePath: breadcrumb string e.g. "Model > Position > Assembly"
 */
export function indexConfigAttributes(productTree) {
  if (!productTree || !productTree.model) return [];
  const index = [];

  function processAttrs(attrs, nodeName, nodeType, depth, fullNodePath, isCalc) {
    for (const attr of attrs) {
      index.push({
        path: `${nodeName}.${attr.name}`,
        nodeName,
        attrName: attr.name,
        attrType: isCalc ? 'calculated-attribute' : 'attribute',
        value: attr.value || null,
        type: attr.type || null,
        domainId: attr.domainId || null,
        nodeType,
        depth,
        fullNodePath,
      });
    }
  }

  // posChain: dot-joined chain of position names built during traversal.
  // Tacton paths = pos1.pos2.attrName — only position names, assembly names are NOT in the path.
  // Assemblies are implicit containers accessed via their parent position.
  function walkPositions(positions, displayPath, depth, posChain) {
    if (!positions) return;
    for (const pos of positions) {
      const posName = pos.name || pos.id;
      const displayName = pos.name.replace(/-\d+$/, '');
      const posPath = displayPath ? `${displayPath} > ${displayName}` : displayName;

      // Build position chain: pos1.pos2.pos3...
      const currentChain = posChain ? `${posChain}.${posName}` : posName;

      // Position-level attributes
      if (pos.attrs?.length) processAttrs(pos.attrs, currentChain, 'position', depth, posPath, false);

      // Assembly child (recursive)
      if (pos.assembly) {
        const assy = pos.assembly;
        const assyPath = `${posPath} > ${assy.name || assy.id}`;
        // Assembly attributes use position chain — assembly name is NOT in the path
        if (assy.attrs?.length) processAttrs(assy.attrs, currentChain, 'assembly', depth + 1, assyPath, false);
        if (assy.calcAttrs?.length) processAttrs(assy.calcAttrs, currentChain, 'assembly', depth + 1, assyPath, true);
        // Recurse into assembly's sub-positions, carrying the position chain forward
        if (assy.positions?.length) walkPositions(assy.positions, assyPath, depth + 2, currentChain);
      }

      // Module child (leaf with variant)
      if (pos.module) {
        const mod = pos.module;
        const modPath = `${posPath} > ${mod.name || mod.id}`;
        if (mod.variant) {
          const v = mod.variant;
          const vPath = `${modPath} > ${v.name || v.id}`;
          // Variant attributes also use position chain
          if (v.attrs?.length) processAttrs(v.attrs, currentChain, 'variant', depth + 2, vPath, false);
          if (v.calcAttrs?.length) processAttrs(v.calcAttrs, currentChain, 'variant', depth + 2, vPath, true);
        }
      }
    }
  }

  // Model-level attributes
  const m = productTree.model;
  if (m.attrs?.length) processAttrs(m.attrs, m.name || m.id, 'model', 0, m.name, false);
  if (m.calcAttrs?.length) processAttrs(m.calcAttrs, m.name || m.id, 'model', 0, m.name, true);

  // Walk positions (posChain starts empty — each top-level position becomes its own root)
  walkPositions(m.positions, '', 1, '');

  return index;
}

// ─── CP Discovery Helpers ──────────────────────────────────────────

/**
 * Extract configured-product IDs from an API response (JSON or XML).
 * Handles multiple response formats.
 */
function _extractCpIdsFromResponse(body) {
  const ids = [];

  // Try JSON first
  try {
    const data = JSON.parse(body);
    const items = Array.isArray(data)
      ? data
      : data.items || data.configuredProducts || data['configured-products'] || [];
    for (const item of items) {
      const id = item.id || item._uuid || item.resourceId || item.reference;
      if (id) ids.push(id);
    }
    if (ids.length > 0) return ids;
  } catch { /* not JSON */ }

  // Try XML — look for <configured-product>, <configuredProduct>, <resource>, etc.
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(body, 'application/xml');
    if (!doc.querySelector('parsererror')) {
      // Check <configured-product reference="..."> or <configured-product id="...">
      const cpEls = doc.querySelectorAll(
        'configured-product, configuredProduct, product-configuration'
      );
      for (const el of cpEls) {
        const id = el.getAttribute('reference') || el.getAttribute('id')
                || el.getAttribute('resource-id') || el.getAttribute('resourceId');
        if (id) ids.push(id);
      }
      // Also check <resource> or <item> with type containing "configured"
      if (ids.length === 0) {
        const resources = doc.querySelectorAll('resource, item, entry');
        for (const r of resources) {
          const type = (r.getAttribute('type') || '').toLowerCase();
          if (type.includes('configured') || type.includes('cp')) {
            const id = r.getAttribute('id') || r.getAttribute('reference') || r.textContent?.trim();
            if (id) ids.push(id);
          }
        }
      }
      // Check for href attributes that contain configured-product IDs
      if (ids.length === 0) {
        const links = doc.querySelectorAll('[href*="configured-product"]');
        for (const link of links) {
          const href = link.getAttribute('href') || '';
          const match = href.match(/configured-product\/([a-f0-9-]+)/);
          if (match) ids.push(match[1]);
        }
      }
    }
  } catch { /* not XML */ }

  // Last resort: regex scan for UUID-like patterns after "configured-product"
  if (ids.length === 0) {
    const regex = /configured-product[\/\s"':=]+([a-f0-9]{32}|[a-f0-9-]{36})/gi;
    let m;
    while ((m = regex.exec(body)) !== null) {
      ids.push(m[1]);
    }
  }

  return [...new Set(ids)]; // deduplicate
}

/**
 * Extract solution/resource IDs from an API response.
 */
function _extractIdsFromResponse(body, resourceType) {
  const ids = [];

  // Try JSON
  try {
    const data = JSON.parse(body);
    const items = Array.isArray(data)
      ? data
      : data.items || data.solutions || data[resourceType + 's'] || [];
    for (const item of items) {
      const id = item.id || item._uuid || item.resourceId || item.reference;
      if (id) ids.push(id);
    }
    if (ids.length > 0) return ids;
  } catch { /* not JSON */ }

  // Try XML
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(body, 'application/xml');
    if (!doc.querySelector('parsererror')) {
      const els = doc.querySelectorAll(`${resourceType}, resource, item, entry`);
      for (const el of els) {
        const id = el.getAttribute('id') || el.getAttribute('reference')
                || el.getAttribute('resource-id');
        if (id) ids.push(id);
      }
    }
  } catch { /* not XML */ }

  return [...new Set(ids)];
}

// ─── Starting-Object Instance Helpers ──────────────────────────────

/**
 * Fetch available instances of the current starting object type.
 * Returns [{ id, displayId, name, summary }] — the records that represent
 * real documents a consultant would "Generate document" from.
 *
 * In production, a user opens e.g. a specific Solution and presses
 * "Generate document". This helper gives us that list so the plugin
 * can simulate the same context.
 */
export async function fetchStartingObjectInstances(objectType) {
  const type = objectType || getStartingObject();
  const records = await fetchRecords(type);
  if (!records || records.length === 0) return [];

  return records.map(r => {
    const id = r._uuid || r._resourceId || r.id || r.Id || r.ID;
    const displayId = r.id || r.Id || r.ID || '';
    const name = r.name || r.Name || r.displayName || displayId || id;
    const summary = r.summary || r.Summary || r.description || r.Description || '';
    return { id, displayId, name, summary };
  }).filter(r => r.id);
}

/**
 * Get the currently selected starting-object instance (for simulation).
 * Returns { id, displayId, name } or null.
 */
export function getSelectedInstance() {
  const id = state.get('startingObject.instanceId');
  if (!id) return null;
  return {
    id,
    displayId: state.get('startingObject.instanceDisplayId') || id,
    name: state.get('startingObject.instanceName') || id,
  };
}

/**
 * Set the active starting-object instance (for simulation).
 * Pass null to clear.
 */
export function setSelectedInstance(instance) {
  if (!instance) {
    state.batch({
      'startingObject.instanceId': null,
      'startingObject.instanceDisplayId': null,
      'startingObject.instanceName': null,
    });
  } else {
    state.batch({
      'startingObject.instanceId': instance.id,
      'startingObject.instanceDisplayId': instance.displayId || instance.id,
      'startingObject.instanceName': instance.name || instance.displayId || instance.id,
    });
  }
}

// ─── Cache management ───────────────────────────────────────────────

export function clearDataCache() {
  cachedModel = null;
  cachedRecords = {};
  cachedBomFields = null;
  cachedBomRecords = null;
  cachedConfigProducts = {};
  // Also clear offline cache when switching data sources
  if (isOfflineMode()) {
    import('./offline/offline-adapter.js').then(m => m.clearOfflineCache());
  }
}
