/**
 * Offline Capture — Fetches data from live APIs and packages it for offline use.
 *
 * Used by the offline wizard. Requires an active connection + ticket.
 * The caller decides which object types to capture; this module
 * handles the actual API calls and packages the results.
 */

import state from '../../core/state.js';
import {
  fetchModel, fetchRecords, fetchBomRecords,
  getBomFields, getBomSources, describeObject,
  getConfiguredProductList, fetchConfiguredProductData,
  indexConfigAttributes, getObjectRecordCount,
} from '../data-api.js';
import { savePackage, generatePackageName } from './offline-storage.js';

// ─── Discovery (Step 2 of wizard) ──────────────────────────────────────

/**
 * Discover all available object types from the model (fast, no record fetches).
 * Returns the list immediately so the wizard can render checkboxes.
 * Record counts are populated later via fetchRecordCountsProgressive().
 *
 * @returns {Promise<Array<{name: string, attributeCount: number, recordCount: number|null}>>}
 */
export async function discoverObjectTypes() {
  const model = await fetchModel();
  if (!model) throw new Error('Could not fetch object model');

  return model
    .map(obj => ({
      name: obj.name,
      attributeCount: obj.attributes ? obj.attributes.length : 0,
      recordCount: null, // unknown — fetched progressively
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Progressively fetch record counts for discovered objects.
 * Calls onUpdate after each batch so the wizard can re-render.
 * Has per-request timeout (8s) and batch size (3 concurrent).
 *
 * @param {Array} objects — from discoverObjectTypes()
 * @param {Function} onUpdate — called after each object resolves: onUpdate(name, count)
 * @param {AbortSignal} [signal] — optional abort signal to cancel
 */
export async function fetchRecordCountsProgressive(objects, onUpdate, signal) {
  const BATCH_SIZE = 3;
  const TIMEOUT_MS = 8000;

  for (let i = 0; i < objects.length; i += BATCH_SIZE) {
    if (signal?.aborted) return;

    const batch = objects.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(
      batch.map(obj => {
        return withTimeout(
          getObjectRecordCount(obj.name),
          TIMEOUT_MS,
          `Timeout fetching ${obj.name}`,
        );
      })
    );

    for (let j = 0; j < batch.length; j++) {
      const obj = batch[j];
      const result = results[j];
      if (result.status === 'fulfilled') {
        obj.recordCount = result.value;
      } else {
        obj.recordCount = 0; // failed or timed out — treat as 0
      }
      onUpdate(obj.name, obj.recordCount);
    }
  }
}

/** Promise with timeout wrapper */
function withTimeout(promise, ms, msg) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    promise
      .then(v => { clearTimeout(timer); resolve(v); })
      .catch(e => { clearTimeout(timer); reject(e); });
  });
}

/**
 * Check if BOM data is available (any BOM-like object has records).
 */
export async function hasBomData() {
  try {
    const recs = await fetchBomRecords();
    return recs.length > 0;
  } catch { return false; }
}

/**
 * Check if Configured Product data is available.
 */
export async function hasCpData() {
  try {
    const list = await getConfiguredProductList();
    return list.length > 0;
  } catch { return false; }
}

// ─── Capture (Step 4 of wizard) ─────────────────────────────────────────

/**
 * @typedef {Object} CaptureConfig
 * @property {string[]}  objectTypes      — Object type names to capture records for
 * @property {boolean}   captureBom       — Capture BOM records + fields + sources
 * @property {boolean}   captureCp        — Capture Configured Products + attributes
 * @property {boolean}   captureDescriptions — Capture object descriptions (references)
 * @property {Function}  [onProgress]     — Callback: (step, total, label, status) => void
 */

/**
 * Run the full capture process.
 * Calls APIs sequentially, reports progress, returns packaged data.
 *
 * @param {CaptureConfig} config
 * @returns {Promise<Object>} — The `data` payload for an offline package
 */
export async function runCapture(config) {
  const {
    objectTypes = [],
    captureBom = true,
    captureCp = true,
    captureDescriptions = true,
    onProgress = () => {},
  } = config;

  // Calculate total steps
  let totalSteps = 1; // model (always)
  totalSteps += objectTypes.length; // records per object
  if (captureDescriptions) totalSteps += objectTypes.length; // descriptions per object
  if (captureBom) totalSteps += 3; // bomRecords + bomFields + bomSources
  if (captureCp) totalSteps += 2; // cpList + cpAttributes
  // Note: individual CP data fetches added dynamically

  let currentStep = 0;
  const report = (label, status = 'fetching') => {
    // Only increment on completion statuses, not on 'fetching' start
    if (status !== 'fetching') currentStep++;
    onProgress(currentStep, totalSteps, label, status);
  };

  const data = {
    model: [],
    records: {},
    bomRecords: [],
    bomFields: [],
    bomSources: [],
    descriptions: {},
    configuredProducts: [],
    cpData: {},
    cpAttributes: {},
    selectedObjects: objectTypes,
  };

  const errors = [];

  // ── 1. Model (always captured) ──
  try {
    report('Fetching object model…');
    data.model = await fetchModel();
    report('Object model', 'done');
  } catch (e) {
    errors.push({ step: 'model', error: e.message });
    report('Object model', 'error');
  }

  // ── 2. Records for selected objects ──
  for (const objName of objectTypes) {
    try {
      report(`Records: ${objName}…`);
      data.records[objName] = await fetchRecords(objName);
      report(`Records: ${objName} (${data.records[objName].length})`, 'done');
    } catch (e) {
      errors.push({ step: `records:${objName}`, error: e.message });
      data.records[objName] = [];
      report(`Records: ${objName}`, 'error');
    }
  }

  // ── 3. Descriptions for selected objects ──
  if (captureDescriptions) {
    for (const objName of objectTypes) {
      try {
        report(`Description: ${objName}…`);
        data.descriptions[objName] = await describeObject(objName);
        report(`Description: ${objName}`, 'done');
      } catch (e) {
        errors.push({ step: `describe:${objName}`, error: e.message });
        report(`Description: ${objName}`, 'error');
      }
    }
  }

  // ── 4. BOM data ──
  if (captureBom) {
    try {
      report('BOM records…');
      data.bomRecords = await fetchBomRecords();
      report(`BOM records (${data.bomRecords.length})`, 'done');
    } catch (e) {
      errors.push({ step: 'bomRecords', error: e.message });
      report('BOM records', 'error');
    }

    try {
      report('BOM fields…');
      data.bomFields = await getBomFields();
      report(`BOM fields (${data.bomFields.length})`, 'done');
    } catch (e) {
      errors.push({ step: 'bomFields', error: e.message });
      report('BOM fields', 'error');
    }

    try {
      report('BOM sources discovery…');
      data.bomSources = await getBomSources();
      report(`BOM sources (${data.bomSources.length})`, 'done');
    } catch (e) {
      errors.push({ step: 'bomSources', error: e.message });
      report('BOM sources', 'error');
    }
  }

  // ── 5. Configured Products ──
  if (captureCp) {
    try {
      report('Configured products list…');
      data.configuredProducts = await getConfiguredProductList();
      report(`Configured products (${data.configuredProducts.length})`, 'done');

      // Fetch each CP's data
      totalSteps += data.configuredProducts.length;
      for (const cp of data.configuredProducts) {
        const cpId = cp.id || cp.cpId || cp.name;
        try {
          report(`CP data: ${cpId}…`);
          data.cpData[cpId] = await fetchConfiguredProductData(cpId);
          report(`CP data: ${cpId}`, 'done');
        } catch (e) {
          errors.push({ step: `cpData:${cpId}`, error: e.message });
          report(`CP data: ${cpId}`, 'error');
        }
      }
    } catch (e) {
      errors.push({ step: 'configuredProducts', error: e.message });
      report('Configured products', 'error');
    }

    // Index CP attributes from all fetched product trees
    try {
      report('CP attributes index…');
      const allIndexed = {};
      for (const [cpId, tree] of Object.entries(data.cpData)) {
        if (tree) allIndexed[cpId] = indexConfigAttributes(tree);
      }
      data.cpAttributes = allIndexed;
      report('CP attributes index', 'done');
    } catch (e) {
      errors.push({ step: 'cpAttributes', error: e.message });
      report('CP attributes index', 'error');
    }
  }

  return { data, errors };
}

// ─── Save (Step 5 of wizard) ────────────────────────────────────────────

/**
 * Package captured data and save to IndexedDB.
 *
 * @param {Object}  capturedData  — The `data` from runCapture()
 * @param {Object}  meta          — Package metadata
 * @param {string}  meta.name     — User-supplied name
 * @param {string}  [meta.instanceUrl]
 * @param {string}  [meta.instanceName]
 * @param {string}  [meta.ticketId]
 * @param {string}  [meta.ticketSummary]
 * @param {string}  [meta.startingObject]
 * @returns {Promise<Object>} — Saved package with ID
 */
export async function saveCapture(capturedData, meta = {}) {
  const instanceUrl = meta.instanceUrl || state.get('connection.url') || '';
  const ticketId = meta.ticketId || state.get('tickets.selected') || '';
  const tickets = state.get('tickets.list') || [];
  const ticket = tickets.find(t => t.id === ticketId);

  const pkg = {
    name: meta.name || generatePackageName(meta.instanceName, ticketId),
    instanceUrl,
    instanceName: meta.instanceName || instanceUrl,
    ticketId,
    ticketSummary: meta.ticketSummary || ticket?.summary || '',
    startingObject: meta.startingObject || state.get('startingObject.type') || '',
    capturedAt: Date.now(),
    version: 1,
    data: capturedData,
  };

  return savePackage(pkg);
}
