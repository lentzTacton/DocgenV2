/**
 * Offline Adapter — Intercept layer for data-api.js.
 *
 * When an offline package is active (`connection.offlinePackageId` is set),
 * data-api functions call into this adapter instead of hitting the live API.
 *
 * The adapter loads the package data once from IndexedDB, caches it in memory,
 * and serves all queries from that cache.
 */

import state from '../../core/state.js';
import { getPackage } from './offline-storage.js';

// ─── In-memory cache ────────────────────────────────────────────────────

let _loadedPackageId = null;
let _cachedData = null;

// ─── Public API ─────────────────────────────────────────────────────────

/** Check if we're currently in offline mode. */
export function isOfflineMode() {
  return !!state.get('connection.offlinePackageId');
}

/** Get the active offline package ID (or null). */
export function getOfflinePackageId() {
  return state.get('connection.offlinePackageId') || null;
}

/**
 * Ensure the package data is loaded into memory.
 * Called lazily by each accessor — loads from DB on first use,
 * then serves from memory until the package changes.
 */
async function ensureLoaded() {
  const pkgId = getOfflinePackageId();
  if (!pkgId) {
    _cachedData = null;
    _loadedPackageId = null;
    return null;
  }
  if (_loadedPackageId === pkgId && _cachedData) return _cachedData;

  const pkg = await getPackage(pkgId);
  if (!pkg || !pkg.data) {
    console.warn('[Offline] Package not found or has no data:', pkgId);
    _cachedData = null;
    _loadedPackageId = null;
    return null;
  }
  _cachedData = pkg.data;
  _loadedPackageId = pkgId;
  return _cachedData;
}

/** Clear the in-memory cache (e.g. when switching away from offline). */
export function clearOfflineCache() {
  _cachedData = null;
  _loadedPackageId = null;
}

// ─── Data accessors (mirror data-api.js signatures) ─────────────────────

/** Offline replacement for fetchModel(). */
export async function offlineFetchModel() {
  const data = await ensureLoaded();
  return data?.model || [];
}

/** Offline replacement for getObjectTypes(). */
export async function offlineGetObjectTypes() {
  const model = await offlineFetchModel();
  return model.map(m => m.name).sort();
}

/** Offline replacement for getObjectAttributes(objectName). */
export async function offlineGetObjectAttributes(objectName) {
  const model = await offlineFetchModel();
  const obj = model.find(m => m.name === objectName);
  return obj?.attributes || [];
}

/** Offline replacement for getRefAttributes(objectName). */
export async function offlineGetRefAttributes(objectName) {
  const attrs = await offlineGetObjectAttributes(objectName);
  return attrs.filter(a => a.refType);
}

/** Offline replacement for fetchRecords(objectName). */
export async function offlineFetchRecords(objectName) {
  const data = await ensureLoaded();
  return data?.records?.[objectName] || [];
}

/** Offline replacement for fetchBomRecords(). */
export async function offlineFetchBomRecords() {
  const data = await ensureLoaded();
  return data?.bomRecords || [];
}

/** Offline replacement for getBomFields(). */
export async function offlineGetBomFields() {
  const data = await ensureLoaded();
  if (data?.bomFields) return data.bomFields;
  // Fallback: derive from BOM records
  const recs = await offlineFetchBomRecords();
  if (recs.length === 0) return [];
  const skip = new Set(['_', 'id', 'href', 'self', 'url']);
  return Object.keys(recs[0]).filter(k => !skip.has(k)).sort();
}

/** Offline replacement for getBomFieldValues(fieldName). */
export async function offlineGetBomFieldValues(fieldName) {
  const recs = await offlineFetchBomRecords();
  const values = [...new Set(recs.map(r => r[fieldName]).filter(v => v != null && v !== ''))];
  return values.sort();
}

/** Offline replacement for getBomSources(). */
export async function offlineGetBomSources() {
  const data = await ensureLoaded();
  return data?.bomSources || [];
}

/** Offline replacement for describeObject(objectName). */
export async function offlineDescribeObject(objectName) {
  const data = await ensureLoaded();
  if (data?.descriptions?.[objectName]) return data.descriptions[objectName];

  // Fallback: build from model
  const model = data?.model || [];
  const obj = model.find(m => m.name === objectName);
  if (!obj) return { name: objectName, forwardRefs: [], reverseRefs: [], attributes: [] };

  const forwardRefs = obj.attributes.filter(a => a.refType).map(a => ({
    name: a.name, refType: a.refType, type: a.type, mandatory: false,
  }));

  const reverseRefs = [];
  for (const other of model) {
    if (other.name === objectName) continue;
    for (const attr of other.attributes) {
      if (attr.refType === objectName) {
        reverseRefs.push({ fromObject: other.name, attribute: attr.name, fromAttrType: attr.type });
      }
    }
  }

  return {
    name: objectName,
    forwardRefs,
    reverseRefs,
    attributes: obj.attributes.map(a => ({ name: a.name, type: a.type, mandatory: false, searchable: false })),
  };
}

/** Offline replacement for getConfiguredProductList(). */
export async function offlineGetConfiguredProductList() {
  const data = await ensureLoaded();
  return data?.configuredProducts || [];
}

/** Offline replacement for fetchConfiguredProductData(cpId). */
export async function offlineFetchConfiguredProductData(cpId) {
  const data = await ensureLoaded();
  return data?.cpData?.[cpId] || null;
}

/** Offline replacement for indexConfigAttributes(). */
export async function offlineIndexConfigAttributes() {
  const data = await ensureLoaded();
  return data?.cpAttributes || {};
}

/** Offline replacement for describeObjectWithData(objectName). */
export async function offlineDescribeObjectWithData(objectName) {
  const desc = await offlineDescribeObject(objectName);
  const records = await offlineFetchRecords(objectName);
  const recordCount = records.length;

  // Add sample values for first 5 attributes
  const attrs = desc.attributes || [];
  for (let i = 0; i < Math.min(5, attrs.length); i++) {
    const attrName = attrs[i].name;
    const samples = [...new Set(records.slice(0, 50).map(r => r[attrName]).filter(v => v != null && v !== ''))].slice(0, 8);
    attrs[i].sampleValues = samples;
  }

  return { ...desc, recordCount };
}

/** Offline replacement for getObjectRecordCount(objectName). */
export async function offlineGetObjectRecordCount(objectName) {
  const records = await offlineFetchRecords(objectName);
  return records.length;
}

/** Offline replacement for getObjectSampleValues(objectName, attrName, max). */
export async function offlineGetObjectSampleValues(objectName, attrName, max = 8) {
  const records = await offlineFetchRecords(objectName);
  const values = [...new Set(records.map(r => r[attrName]).filter(v => v != null && v !== ''))];
  return values.slice(0, max);
}

/** Offline replacement for resolveCurrentObject(pathSegments, rootOverride). */
export async function offlineResolveCurrentObject(pathSegments, rootOverride) {
  const model = await offlineFetchModel();
  const root = rootOverride || state.get('startingObject.type') || 'Solution';
  let current = root;
  for (const seg of pathSegments) {
    const obj = model.find(m => m.name === current);
    if (!obj) return current;
    const attr = obj.attributes.find(a => a.name === seg);
    if (attr?.refType) {
      current = attr.refType;
    }
  }
  return current;
}

/** Get metadata about the loaded offline package (for display). */
export async function getOfflinePackageMeta() {
  const pkgId = getOfflinePackageId();
  if (!pkgId) return null;
  const pkg = await getPackage(pkgId);
  if (!pkg) return null;
  return {
    id: pkg.id,
    name: pkg.name,
    instanceUrl: pkg.instanceUrl,
    instanceName: pkg.instanceName,
    ticketId: pkg.ticketId,
    ticketSummary: pkg.ticketSummary,
    startingObject: pkg.startingObject,
    capturedAt: pkg.capturedAt,
  };
}
