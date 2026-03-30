/**
 * Data API — Fetches live BOM/object data for the Data Catalogue.
 *
 * Bridges the ticket connection (from Setup) with the variable wizard.
 * Caches model and record data per session to avoid repeated fetches.
 */

import state from '../core/state.js';
import { getModel, listRecords, fetchConfiguredProduct, parseConfiguredProductXml } from './api.js';
import { getInstance } from '../core/storage.js';

// ─── Caches ─────────────────────────────────────────────────────────

let cachedModel = null;       // { ticketId, objects: [...] }
let cachedRecords = {};       // objectName → records[]
let cachedBomFields = null;   // string[]  (field names from flatbom)
let cachedBomRecords = null;  // record[]
let cachedConfigProducts = {}; // cpId → { model, bom } parsed XML tree

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
  const objects = await fetchModel();
  if (!objects) return [];
  return objects.map(o => o.name).sort();
}

/**
 * Get attributes for a specific object type.
 * Returns [{name, type, refType}]
 */
export async function getObjectAttributes(objectName) {
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

  return { name: objectName, forwardRefs, reverseRefs, attributes };
}

/**
 * Resolve the current object name after walking a path.
 */
export async function resolveCurrentObject(pathSegments) {
  const objects = await fetchModel();
  if (!objects) return getStartingObject();

  let current = getStartingObject();
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
  const objects = await fetchModel();
  if (!objects) { console.warn('[config] getConfiguredProductList: no model objects'); return []; }

  console.log('[config] Object types:', objects.map(o => o.name).join(', '));

  // Find the ConfiguredProduct object type
  const cpObj = objects.find(o =>
    o.name.toLowerCase().includes('configuredproduct') ||
    o.name.toLowerCase().includes('configured_product')
  );
  if (!cpObj) {
    console.warn('[config] No ConfiguredProduct object type found in model');
    return [];
  }

  // Fetch CP records
  console.log(`[config] Found CP object: ${cpObj.name}, fetching records…`);
  const records = await fetchRecords(cpObj.name);
  console.log(`[config] ConfiguredProduct records:`, records.length, records.map(r => ({
    id: r.id, _uuid: r._uuid, _resourceId: r._resourceId, name: r.name, solution: r.solution,
  })));

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

  function walkPositions(positions, parentPath, depth) {
    if (!positions) return;
    for (const pos of positions) {
      const posName = pos.name || pos.id;
      const displayName = pos.name.replace(/-\d+$/, '');
      const posPath = parentPath ? `${parentPath} > ${displayName}` : displayName;

      // Position-level attributes
      if (pos.attrs?.length) processAttrs(pos.attrs, posName, 'position', depth, posPath, false);

      // Assembly child (recursive)
      if (pos.assembly) {
        const assy = pos.assembly;
        const assyName = assy.name || assy.id;
        const assyPath = `${posPath} > ${assy.name}`;
        if (assy.attrs?.length) processAttrs(assy.attrs, `${posName}.${assyName}`, 'assembly', depth + 1, assyPath, false);
        if (assy.calcAttrs?.length) processAttrs(assy.calcAttrs, `${posName}.${assyName}`, 'assembly', depth + 1, assyPath, true);
        // Recurse into sub-positions
        if (assy.positions?.length) walkPositions(assy.positions, assyPath, depth + 2);
      }

      // Module child (leaf with variant)
      if (pos.module) {
        const mod = pos.module;
        const modName = mod.name || mod.id;
        const modPath = `${posPath} > ${mod.name}`;
        // Module may have a variant with attributes
        if (mod.variant) {
          const v = mod.variant;
          const vPath = `${modPath} > ${v.name}`;
          if (v.attrs?.length) processAttrs(v.attrs, `${posName}.${modName}`, 'variant', depth + 2, vPath, false);
          if (v.calcAttrs?.length) processAttrs(v.calcAttrs, `${posName}.${modName}`, 'variant', depth + 2, vPath, true);
        }
      }
    }
  }

  // Model-level attributes
  const m = productTree.model;
  if (m.attrs?.length) processAttrs(m.attrs, m.name || m.id, 'model', 0, m.name, false);
  if (m.calcAttrs?.length) processAttrs(m.calcAttrs, m.name || m.id, 'model', 0, m.name, true);

  // Walk positions
  walkPositions(m.positions, '', 1);

  return index;
}

// ─── Cache management ───────────────────────────────────────────────

export function clearDataCache() {
  cachedModel = null;
  cachedRecords = {};
  cachedBomFields = null;
  cachedBomRecords = null;
  cachedConfigProducts = {};
}
