/**
 * Storage Layer — Dexie.js (IndexedDB wrapper)
 *
 * All persistent data goes through here. Structured, survives cache clearing,
 * handles megabytes. Keyed by project where appropriate.
 *
 * Sensitive fields (OAuth tokens, client secrets, AI API keys) are encrypted
 * at rest using AES-GCM via the Web Crypto API (see core/crypto.js).
 * Encrypted values carry an "enc:" prefix; legacy plaintext is decrypted
 * transparently and will be re-encrypted on next write.
 *
 * Tables:
 *   instances  — Named Tacton connections (URL, creds — secrets encrypted)
 *   tokens     — OAuth token cache (values encrypted)
 *   projects   — Document projects (ties a Word doc to a saved state)
 *   tickets    — Included tickets per project
 *   variables  — Define variables per project (Phase 3)
 *   settings   — Key-value pairs (AI apiKey encrypted)
 */

import Dexie from 'dexie';
import { encrypt, decrypt, isEncrypted } from './crypto.js';

const db = new Dexie('TactonDocGen');

// Schema versioning — add new versions for migrations, never modify existing
db.version(1).stores({
  instances:  '++id, name, url',
  tokens:     'key',
  projects:   'id, documentId, instanceId, updatedAt',
  tickets:    '[projectId+ticketId], projectId',
  variables:  '++id, projectId, name, type, order',
});

db.version(2).stores({
  instances:  '++id, name, url',
  tokens:     'key',
  projects:   'id, documentId, instanceId, updatedAt',
  tickets:    '[projectId+ticketId], projectId',
  variables:  '++id, projectId, name, type, order',
  settings:   'key',
});

db.version(3).stores({
  instances:  '++id, name, url',
  tokens:     'key',
  projects:   'id, documentId, instanceId, updatedAt',
  tickets:    '[projectId+ticketId], projectId',
  variables:  '++id, projectId, name, type, order, sectionId, catalogueId',
  settings:   'key',
  catalogues: '++id, projectId, scope, name, order',
  sections:   '++id, catalogueId, projectId, name, order',
});

// NOTE: Dexie doesn't support changing primary keys, so we keep ++id (auto-increment)
// but always supply a UUID string as the id for new records. Dexie accepts user-supplied
// ids even with ++id schema — auto-increment only kicks in when id is absent.
// Old records retain their integer ids; new records get UUID strings.
// All ID comparisons should use String() coercion for safety.

/** Generate a UUID for new entities. */
export function generateId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

// ─── Instance CRUD ───────────────────────────────────────────────────────

export async function getInstances() {
  const rows = await db.instances.toArray();
  return Promise.all(rows.map(_decryptInstanceSecrets));
}

export async function getInstance(id) {
  const row = await db.instances.get(id);
  return row ? _decryptInstanceSecrets(row) : undefined;
}

export async function saveInstance(instance) {
  const secured = await _encryptInstanceSecrets(instance);
  if (secured.id) {
    const existing = await db.instances.get(secured.id);
    if (existing) {
      const merged = _deepMerge(existing, secured);
      merged.updatedAt = Date.now();
      await db.instances.put(merged);
      return _decryptInstanceSecrets(merged);
    }
  }
  secured.createdAt = Date.now();
  secured.updatedAt = Date.now();
  const id = await db.instances.add(secured);
  return _decryptInstanceSecrets({ ...secured, id });
}

export async function deleteInstance(id) {
  return db.instances.delete(id);
}

// ─── Token Cache ─────────────────────────────────────────────────────────

export async function getToken(key) {
  const row = await db.tokens.get(key);
  if (!row?.value) return null;
  return decrypt(row.value);
}

export async function setToken(key, value) {
  const secured = await encrypt(value);
  return db.tokens.put({ key, value: secured, updatedAt: Date.now() });
}

export async function deleteToken(key) {
  return db.tokens.delete(key);
}

export async function clearTokens() {
  return db.tokens.clear();
}

// ─── Project CRUD ────────────────────────────────────────────────────────

export async function getProject(id) {
  return db.projects.get(id);
}

export async function getProjectByDocumentId(documentId) {
  return db.projects.where('documentId').equals(documentId).first();
}

export async function saveProject(project) {
  project.updatedAt = Date.now();
  if (!project.createdAt) project.createdAt = Date.now();
  await db.projects.put(project);
  return project;
}

export async function deleteProject(id) {
  await db.transaction('rw', [db.projects, db.tickets, db.variables, db.sections, db.catalogues], async () => {
    await db.variables.where('projectId').equals(id).delete();
    await db.sections.where('projectId').equals(id).delete();
    await db.catalogues.where('projectId').equals(id).delete();
    await db.tickets.where('projectId').equals(id).delete();
    await db.projects.delete(id);
  });
}

// ─── Ticket Inclusion (per project) ──────────────────────────────────────

export async function getIncludedTickets(projectId) {
  return db.tickets.where('projectId').equals(projectId).toArray();
}

export async function includeTicket(projectId, ticketId, meta = {}) {
  return db.tickets.put({
    projectId,
    ticketId,
    ...meta,
    includedAt: Date.now(),
  });
}

export async function excludeTicket(projectId, ticketId) {
  return db.tickets.delete([projectId, ticketId]);
}

// ─── Variables (Phase 3) ─────────────────────────────────────────────────

export async function getVariables(projectId) {
  return db.variables.where('projectId').equals(projectId).sortBy('order');
}

export async function getVariable(id) {
  return db.variables.get(id);
}

export async function saveVariable(variable) {
  variable.updatedAt = Date.now();
  if (!variable.createdAt) variable.createdAt = Date.now();
  if (!variable.id) variable.id = generateId();
  await db.variables.put(variable);
  return variable;
}

export async function deleteVariable(id) {
  return db.variables.delete(id);
}

export async function reorderVariables(projectId, orderedIds) {
  return db.transaction('rw', db.variables, async () => {
    for (let i = 0; i < orderedIds.length; i++) {
      await db.variables.update(orderedIds[i], { order: i });
    }
  });
}

// ─── Catalogues (Phase 3 — scoped data catalogues) ──────────────────────

export async function getCatalogues(projectId) {
  return db.catalogues.where('projectId').equals(projectId).sortBy('order');
}

export async function saveCatalogue(catalogue) {
  catalogue.updatedAt = Date.now();
  if (!catalogue.createdAt) catalogue.createdAt = Date.now();
  if (!catalogue.id) catalogue.id = generateId();
  await db.catalogues.put(catalogue);
  return catalogue;
}

export async function deleteCatalogue(id) {
  return db.transaction('rw', [db.catalogues, db.sections, db.variables], async () => {
    await db.variables.where('catalogueId').equals(id).delete();
    await db.sections.where('catalogueId').equals(id).delete();
    await db.catalogues.delete(id);
  });
}

// ─── Sections (within catalogues) ───────────────────────────────────────

export async function getSections(catalogueId) {
  return db.sections.where('catalogueId').equals(catalogueId).sortBy('order');
}

export async function getAllSections(projectId) {
  return db.sections.where('projectId').equals(projectId).sortBy('order');
}

export async function saveSection(section) {
  section.updatedAt = Date.now();
  if (!section.createdAt) section.createdAt = Date.now();
  if (!section.id) section.id = generateId();
  await db.sections.put(section);
  return section;
}

export async function deleteSection(id) {
  return db.transaction('rw', [db.sections, db.variables], async () => {
    // Unassign variables from this section (set sectionId to null)
    const vars = await db.variables.where('sectionId').equals(id).toArray();
    for (const v of vars) {
      await db.variables.update(v.id, { sectionId: null });
    }
    await db.sections.delete(id);
  });
}

/** Force-delete a section AND all its variables (hard cascade). */
export async function forceClearSection(id) {
  return db.transaction('rw', [db.sections, db.variables], async () => {
    await db.variables.where('sectionId').equals(id).delete();
    await db.sections.delete(id);
  });
}

// ─── Settings (key-value pairs) ─────────────────────────────────────────

export async function getSetting(key) {
  const row = await db.settings.get(key);
  return row?.value ?? null;
}

export async function setSetting(key, value) {
  return db.settings.put({ key, value, updatedAt: Date.now() });
}

export async function deleteSetting(key) {
  return db.settings.delete(key);
}

/**
 * Clear all data catalogue records (variables, sections, catalogues) and reset
 * the cookbook seed flag so it regenerates on next load.
 * Does NOT touch instances, projects, tickets, or tokens.
 */
export async function clearAllDataRecords() {
  await db.transaction('rw', [db.variables, db.sections, db.catalogues, db.settings], async () => {
    await db.variables.clear();
    await db.sections.clear();
    await db.catalogues.clear();
    // Remove all cookbook-seeded-* settings so they re-seed
    const allSettings = await db.settings.toArray();
    for (const s of allSettings) {
      if (s.key.startsWith('cookbook-seeded-')) {
        await db.settings.delete(s.key);
      }
    }
  });
  console.log('[storage] Cleared all variables, sections, catalogues, and cookbook seed flags');
}

/**
 * Load Claude AI settings from persistent storage.
 * Returns { apiKey, model, maxTokens }
 */
export async function loadAiSettings() {
  const stored = await getSetting('ai-settings');
  if (!stored) return { apiKey: '', model: 'claude-sonnet-4-5-20250514', maxTokens: 2048 };
  if (stored.apiKey) stored.apiKey = await decrypt(stored.apiKey);
  return stored;
}

/**
 * Save Claude AI settings to persistent storage.
 * The API key is encrypted before writing.
 */
export async function saveAiSettings(settings) {
  const copy = { ...settings };
  if (copy.apiKey && !isEncrypted(copy.apiKey)) {
    copy.apiKey = await encrypt(copy.apiKey);
  }
  return setSetting('ai-settings', copy);
}

// ─── Favorites ───────────────────────────────────────────────────────

/**
 * Load favorite IDs for a given category ('tickets' or 'starting-objects').
 * Returns a Set of string IDs.
 */
export async function loadFavorites(category) {
  const stored = await getSetting(`favorites-${category}`);
  try { return new Set(stored || []); }
  catch { return new Set(); }
}

/**
 * Save favorites Set for a given category.
 */
export async function saveFavorites(category, favSet) {
  return setSetting(`favorites-${category}`, [...favSet]);
}

// ─── Instance secret encryption helpers ─────────────────────────────────

async function _encryptInstanceSecrets(instance) {
  const copy = { ...instance };
  if (copy.admin?.clientSecret && !isEncrypted(copy.admin.clientSecret)) {
    copy.admin = { ...copy.admin, clientSecret: await encrypt(copy.admin.clientSecret) };
  }
  if (copy.frontend?.clientSecret && !isEncrypted(copy.frontend.clientSecret)) {
    copy.frontend = { ...copy.frontend, clientSecret: await encrypt(copy.frontend.clientSecret) };
  }
  return copy;
}

async function _decryptInstanceSecrets(instance) {
  const copy = { ...instance };
  if (copy.admin?.clientSecret) {
    copy.admin = { ...copy.admin, clientSecret: await decrypt(copy.admin.clientSecret) };
  }
  if (copy.frontend?.clientSecret) {
    copy.frontend = { ...copy.frontend, clientSecret: await decrypt(copy.frontend.clientSecret) };
  }
  return copy;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function _deepMerge(target, source) {
  const out = { ...target };
  for (const key of Object.keys(source)) {
    if (
      source[key] &&
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      target[key] &&
      typeof target[key] === 'object'
    ) {
      out[key] = _deepMerge(target[key], source[key]);
    } else if (source[key] !== undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

export default db;
