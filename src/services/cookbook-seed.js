/**
 * Cookbook Seed — Seeds a read-only "Cookbook Samples" catalogue with
 * common patterns from the DocGen template cookbook.
 *
 * Runs once per project. Uses the same createVariable/createCatalogue/createSection
 * code path as user actions, ensuring full DB persistence.
 *
 * The catalogue and its contents are marked with `readonly: true`.
 */

import state from '../core/state.js';
import { getSetting, setSetting } from '../core/storage.js';
import {
  createCatalogue, createSection, loadCatalogues, loadSections,
  removeCatalogue,
} from './variables.js';
import { createVariable } from './variables.js';

// Bump this when cookbook content changes to force a re-seed
const COOKBOOK_VERSION = 2;

// ─── Seed data ──────────────────────────────────────────────────────────

const COOKBOOK_CATALOGUE = {
  name: 'Cookbook Samples',
  description: 'Ready-made patterns — copy to your own catalogue',
  scope: 'shared',
  readonly: true,
  tags: ['samples', 'reference'],
};

const COOKBOOK_SEED = [
  // ── BOM Blocks ───────────────────────────────────────────────────────
  {
    section: { name: 'BOM Blocks', description: 'Collection data blocks for iteration (→ $for, $rowgroup, $group)', tags: ['bom', 'block'] },
    variables: [
      { name: '#allBomItems', purpose: 'block', type: 'bom', description: 'All flat BOM items — use in $for or $rowgroup',
        source: '#cp.flatbom', filters: [], filterLogic: 'or', transforms: [], catchAll: false },
      { name: '#pumps', purpose: 'block', type: 'bom', description: 'BOM items filtered to pumps',
        source: '#cp.flatbom', filters: [{ field: 'segmentGroup', op: '==', value: 'Pump' }],
        filterLogic: 'or', transforms: [], catchAll: false },
      { name: '#accessories', purpose: 'block', type: 'bom', description: 'BOM items filtered to accessories',
        source: '#cp.flatbom', filters: [{ field: 'segmentGroup', op: '==', value: 'Accessories' }],
        filterLogic: 'or', transforms: [], catchAll: false },
      { name: '#remainder', purpose: 'block', type: 'bom', description: 'Catch-all for unassigned BOM items',
        source: '#cp.flatbom', filters: [], filterLogic: 'or', transforms: [],
        catchAll: true, excludeVars: ['#pumps', '#accessories'] },
      { name: '#sortedBom', purpose: 'block', type: 'bom',
        description: 'BOM sorted by variant name (Cytiva pattern)',
        source: '#cp.flatbom', filters: [{ field: 'mbom_qty', op: '>', value: '0' }],
        filterLogic: 'or', transforms: [{ type: 'sort', field: 'variantName' }], catchAll: false },
      { name: '#groupedBySegment', purpose: 'block', type: 'bom', description: 'BOM grouped by segment — use in $rowgroup',
        source: '#cp.flatbom', filters: [], filterLogic: 'or',
        transforms: [{ type: 'groupBy', field: 'segmentGroup' }], catchAll: false },
    ],
  },

  // ── Object Model Collections ─────────────────────────────────────────
  {
    section: { name: 'Object Collections', description: 'Related object lists for iteration', tags: ['object', 'block'] },
    variables: [
      { name: '#configuredProducts', purpose: 'block', type: 'object',
        description: 'All configured products on the solution',
        source: "solution.related('ConfiguredProduct','solution')",
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
      { name: '#contacts', purpose: 'block', type: 'object',
        description: 'Related contacts on the account',
        source: "solution.opportunity.account.related('Contact','account')",
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
      { name: '#trucksOnly', purpose: 'block', type: 'object',
        description: 'Configured products filtered to trucks (Tructon pattern)',
        source: "solution.related('ConfiguredProduct','solution').{?productType==\"truck\"}",
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
    ],
  },

  // ── Single Values — Dot-Walk ─────────────────────────────────────────
  {
    section: { name: 'Single Values — Dot-Walk', description: 'Scalar values via object model navigation', tags: ['single', 'variable'] },
    variables: [
      { name: '#opportunityName', purpose: 'variable', type: 'single',
        description: 'Name from linked opportunity',
        source: 'solution.opportunity.name',
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
      { name: '#accountName', purpose: 'variable', type: 'single',
        description: 'Account name via opportunity',
        source: 'solution.opportunity.account.name',
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
      { name: '#currency', purpose: 'variable', type: 'single',
        description: 'Currency ISO code with fallback (Parker pattern)',
        source: 'solution.currency.isoCode||""',
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
      { name: '#offerDate', purpose: 'variable', type: 'single',
        description: 'Solution offer date',
        source: 'solution.offerDate',
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
      { name: '#solutionStatus', purpose: 'variable', type: 'single',
        description: 'Solution status field',
        source: 'solution.status',
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
    ],
  },

  // ── Single Values — Configuration Attributes ─────────────────────────
  {
    section: { name: 'Single Values — Config Attributes', description: 'Values from getConfigurationAttribute()', tags: ['single', 'variable'] },
    variables: [
      { name: '#pumpWeight', purpose: 'variable', type: 'single',
        description: 'Pump weight attribute (GAPump pattern)',
        source: 'getConfigurationAttribute("nonfire_pump_node-1.splitCase_nonFire_assy.pumpWeight").value',
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
      { name: '#motorType', purpose: 'variable', type: 'single',
        description: 'Motor type description via config attribute',
        source: 'getConfigurationAttribute("motorType").valueDescription',
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
    ],
  },

  // ── Single Values — Filtered to One ──────────────────────────────────
  {
    section: { name: 'Single Values — Filtered', description: 'Collection narrowed to one result via [0] index', tags: ['single', 'variable'] },
    variables: [
      { name: '#firstCP', purpose: 'variable', type: 'single',
        description: 'First configured product (safe access with [0])',
        source: "solution.related('ConfiguredProduct','solution')[0]",
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
      { name: '#elevatorSolution', purpose: 'variable', type: 'single',
        description: 'Specific CP by name filter + [0] (Parker pattern)',
        source: "solution.related('ConfiguredProduct','solution').{?name==\"Elevator solution\"}[0]",
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
    ],
  },

  // ── Single Values — Aggregations ─────────────────────────────────────
  {
    section: { name: 'Single Values — Aggregations', description: 'Computed scalar values from collections', tags: ['single', 'variable'] },
    variables: [
      { name: '#totalPrice', purpose: 'variable', type: 'bom', description: 'Sum of all net prices',
        source: '#cp.flatbom', filters: [], filterLogic: 'or',
        transforms: [{ type: 'fieldExtract', field: 'netPrice' }, { type: 'sum' }], catchAll: false },
      { name: '#itemCount', purpose: 'variable', type: 'bom', description: 'Total number of BOM items',
        source: '#cp.flatbom', filters: [], filterLogic: 'or',
        transforms: [{ type: 'size' }], catchAll: false },
    ],
  },

  // ── List Literals ────────────────────────────────────────────────────
  {
    section: { name: 'List Literals', description: 'Hardcoded value lists', tags: ['list', 'variable'] },
    variables: [
      { name: '#statusOptions', purpose: 'variable', type: 'list',
        description: 'Static list of status values',
        source: '{"Active","Inactive","Pending"}',
        filters: [], filterLogic: 'or', transforms: [], catchAll: false },
    ],
  },
];

// ─── Seed function ──────────────────────────────────────────────────────

/**
 * Seeds the cookbook catalogue if it hasn't been seeded yet for this project.
 * Call this once during app boot (after state is initialized with project ID).
 */
export async function seedCookbook() {
  const projectId = state.get('project.id') || '_default';
  const seedKey = `cookbook-seeded-${projectId}`;

  // Check if already seeded with current version
  const seeded = await getSetting(seedKey);
  if (seeded && seeded.version === COOKBOOK_VERSION) return;

  // Guard: also check if a cookbook catalogue already exists in state
  // (prevents duplicates when project ID changes or seed flag was lost)
  const existingCats = state.get('catalogues') || [];
  const existingCookbook = existingCats.find(c => c.name === COOKBOOK_CATALOGUE.name && c.readonly);
  if (existingCookbook) {
    // Catalogue exists but seed flag was missing — just record the flag and return
    await setSetting(seedKey, { seededAt: Date.now(), catalogueId: existingCookbook.id, version: COOKBOOK_VERSION });
    return;
  }

  // If old version exists, remove the old catalogue
  if (seeded && seeded.catalogueId) {
    try { await removeCatalogue(seeded.catalogueId); } catch (_) { /* ignore */ }
  }

  try {
    // Create the read-only catalogue
    const cat = await createCatalogue({
      ...COOKBOOK_CATALOGUE,
    });

    // Create sections and their variables
    for (const group of COOKBOOK_SEED) {
      const section = await createSection({
        catalogueId: cat.id,
        name: group.section.name,
        description: group.section.description,
        tags: group.section.tags,
      });

      for (const v of group.variables) {
        await createVariable({
          ...v,
          catalogueId: cat.id,
          sectionId: section.id,
          readonly: true,
        });
      }
    }

    // Mark as seeded
    await setSetting(seedKey, { seededAt: Date.now(), catalogueId: cat.id, version: COOKBOOK_VERSION });

    // Refresh state
    await loadCatalogues();
    await loadSections();
  } catch (e) {
    console.error('[cookbook-seed] Failed to seed cookbook:', e);
  }
}
