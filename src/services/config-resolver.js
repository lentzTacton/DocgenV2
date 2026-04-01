/**
 * Config Resolver — resolves getConfigurationAttribute() paths against the Tacton Solution API.
 *
 * Extracted from wizard-config-explorer.js to break the circular dependency
 * where services/ imported from views/. This is a pure data service with
 * no view-layer dependencies.
 */

import {
  fetchConfiguredProductData, getConfiguredProductList, indexConfigAttributes,
} from './data-api.js';

// ─── Cached CP list (shared with config-explorer via resetConfigResolver) ──
let _cpList = null;

/**
 * Resolve a config attribute path across all configured products.
 * Returns an array of results, one per configured product.
 *
 * @param {string} attrPath — e.g. "nonfire_pump_node-1.pumpSeries"
 * @returns {Promise<Array<{cpDisplayId, cpName, solutionName, attribute, value, type, attrType}>>}
 */
export async function resolveConfigAttrAcrossCPs(attrPath) {
  if (!attrPath) return [];
  if (!_cpList || _cpList.length === 0) {
    try { _cpList = await getConfiguredProductList(); } catch { _cpList = null; return []; }
  }
  if (!_cpList?.length) return [];

  const results = [];
  for (const cp of _cpList) {
    try {
      const tree = await fetchConfiguredProductData(cp.id);
      if (!tree) continue;
      const index = indexConfigAttributes(tree);
      const match = index.find(a => a.path === attrPath);
      if (!match) {
        const leafName = attrPath.split('.').pop();
        const similar = index.filter(a => a.attrName === leafName).map(a => a.path);
        if (similar.length > 0) {
          console.warn(`[resolveConfigAttr] Path "${attrPath}" NOT in index. Similar paths:`, similar);
        }
      }
      results.push({
        cpDisplayId: cp.displayId || cp.id,
        cpName: (cp.name && cp.name !== cp.displayId) ? cp.name : '',
        solutionName: cp.solutionName || '',
        attribute: attrPath,
        value: match?.value || '',
        type: match?.type || '',
        attrType: match?.attrType || '',
      });
    } catch (e) {
      console.warn(`[config-resolver] Failed to resolve ${attrPath} on CP ${cp.id}:`, e.message);
      results.push({
        cpDisplayId: cp.displayId || cp.id,
        cpName: (cp.name && cp.name !== cp.displayId) ? cp.name : '',
        solutionName: cp.solutionName || '',
        attribute: attrPath,
        value: '(error)',
        type: '',
        attrType: '',
      });
    }
  }
  return results;
}

/**
 * Reset the cached CP list (e.g. when ticket changes).
 * Called by wizard-config-explorer's resetConfigExplorer().
 */
export function resetConfigResolverCache() {
  _cpList = null;
}
