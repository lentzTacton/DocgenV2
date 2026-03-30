/**
 * Catalogue Import/Export — JSON format for sharing data catalogues between users.
 *
 * Export format:
 *   {
 *     version: 1,
 *     exportedAt: ISO timestamp,
 *     catalogue: { name, description, scope, tags },
 *     sections: [ { name, description, tags, order } ],
 *     variables: [ { name, purpose, type, source, description, filters, ... sectionName } ],
 *   }
 *
 * Variables reference their section by name (not ID) for portability.
 */

import state from '../core/state.js';
import {
  createCatalogue, createSection, loadCatalogues, loadSections, loadVariables,
} from './variables.js';
import { createVariable } from './variables.js';

// ─── Export ─────────────────────────────────────────────────────────────

/**
 * Export a catalogue (or all user catalogues) to a JSON object.
 * @param {number|null} catalogueId — specific catalogue, or null for all user catalogues
 * @returns {object} Portable JSON representation
 */
export function exportCatalogue(catalogueId) {
  const catalogues = state.get('catalogues') || [];
  const sections = state.get('sections') || [];
  const variables = state.get('variables') || [];

  if (catalogueId) {
    // Single catalogue export
    const cat = catalogues.find(c => c.id === catalogueId);
    if (!cat) throw new Error(`Catalogue ${catalogueId} not found`);
    return buildExportPayload(cat, sections, variables);
  }

  // Multi-catalogue export (all catalogues including readonly/cookbook)
  const userCats = catalogues;
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    catalogues: userCats.map(cat => buildExportPayload(cat, sections, variables)),
  };
}

function buildExportPayload(cat, allSections, allVariables) {
  const catSections = allSections.filter(s => s.catalogueId === cat.id);
  const catVariables = allVariables.filter(v => v.catalogueId === cat.id);

  // Build section name lookup
  const secById = {};
  catSections.forEach(s => { secById[s.id] = s.name; });

  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    catalogue: {
      name: cat.name,
      description: cat.description || '',
      scope: cat.scope || 'ticket',
      tags: cat.tags || [],
    },
    sections: catSections.map(s => ({
      name: s.name,
      description: s.description || '',
      tags: s.tags || [],
      order: s.order || 0,
    })),
    variables: catVariables.map(v => ({
      name: v.name,
      purpose: v.purpose || 'block',
      type: v.type || 'bom',
      description: v.description || '',
      source: v.source || '',
      filters: v.filters || [],
      filterLogic: v.filterLogic || 'or',
      transforms: v.transforms || [],
      catchAll: v.catchAll || false,
      excludeVars: v.excludeVars || [],
      instanceMode: v.instanceMode || 'all',
      sectionName: v.sectionId ? (secById[v.sectionId] || null) : null,
      order: v.order || 0,
    })),
  };
}

/**
 * Trigger a JSON file download in the browser.
 */
export function downloadJson(data, filename) {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'data-catalogue.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Import ─────────────────────────────────────────────────────────────

/**
 * Import a catalogue from a JSON payload.
 * Creates a new catalogue with all sections and variables.
 * @param {object} payload — Parsed JSON from export
 * @returns {object} { catalogue, sectionCount, variableCount }
 */
export async function importCatalogue(payload) {
  // Validate
  if (!payload.version || !payload.catalogue) {
    throw new Error('Invalid catalogue format — missing version or catalogue data');
  }

  // Handle multi-catalogue import
  if (payload.catalogues && Array.isArray(payload.catalogues)) {
    const results = [];
    for (const p of payload.catalogues) {
      results.push(await importSingleCatalogue(p));
    }
    return results;
  }

  return [await importSingleCatalogue(payload)];
}

async function importSingleCatalogue(payload) {
  const { catalogue, sections = [], variables = [] } = payload;

  // Deduplicate catalogue name
  const existing = (state.get('catalogues') || []);
  let catName = catalogue.name;
  if (existing.find(c => c.name === catName)) {
    catName = `${catName} (copy)`;
  }

  // Create catalogue
  const cat = await createCatalogue({
    name: catName,
    description: catalogue.description || '',
    scope: catalogue.scope || 'ticket',
    tags: catalogue.tags || [],
  });

  // Create sections (build name → id mapping)
  const sectionIdByName = {};
  for (const sec of sections) {
    const created = await createSection({
      catalogueId: cat.id,
      name: sec.name,
      description: sec.description || '',
      tags: sec.tags || [],
    });
    sectionIdByName[sec.name] = created.id;
  }

  // Create variables
  let varCount = 0;
  const existingVars = (state.get('variables') || []);

  for (const v of variables) {
    // Deduplicate variable names
    let name = v.name;
    if (existingVars.find(ev => ev.name === name)) {
      name = `${name}_imported`;
    }

    await createVariable({
      name,
      purpose: v.purpose || 'block',
      type: v.type || 'bom',
      description: v.description || '',
      source: v.source || '',
      filters: v.filters || [],
      filterLogic: v.filterLogic || 'or',
      transforms: v.transforms || [],
      catchAll: v.catchAll || false,
      excludeVars: v.excludeVars || [],
      instanceMode: v.instanceMode || 'all',
      catalogueId: cat.id,
      sectionId: v.sectionName ? (sectionIdByName[v.sectionName] || null) : null,
    });
    varCount++;
  }

  // Refresh state
  await loadCatalogues();
  await loadSections();
  await loadVariables();

  return { catalogue: cat, sectionCount: sections.length, variableCount: varCount };
}

/**
 * Read a JSON file from a File input event.
 * @param {File} file
 * @returns {Promise<object>} Parsed JSON
 */
export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        resolve(JSON.parse(e.target.result));
      } catch (err) {
        reject(new Error('Invalid JSON file'));
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
