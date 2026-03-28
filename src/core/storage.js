/**
 * Storage Layer — Dexie.js (IndexedDB wrapper)
 *
 * All persistent data goes through here. Structured, survives cache clearing,
 * handles megabytes. Keyed by project where appropriate.
 *
 * Tables:
 *   instances  — Named Tacton connections (URL, creds)
 *   tokens     — OAuth token cache (access, refresh, per ticket)
 *   projects   — Document projects (ties a Word doc to a saved state)
 *   tickets    — Included tickets per project
 *   variables  — Define variables per project (Phase 3)
 */

import Dexie from 'dexie';

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

// ─── Instance CRUD ───────────────────────────────────────────────────────

export async function getInstances() {
  return db.instances.toArray();
}

export async function getInstance(id) {
  return db.instances.get(id);
}

export async function saveInstance(instance) {
  if (instance.id) {
    // Deep-merge: preserve existing fields not in update
    const existing = await db.instances.get(instance.id);
    if (existing) {
      const merged = _deepMerge(existing, instance);
      merged.updatedAt = Date.now();
      await db.instances.put(merged);
      return merged;
    }
  }
  instance.createdAt = Date.now();
  instance.updatedAt = Date.now();
  const id = await db.instances.add(instance);
  return { ...instance, id };
}

export async function deleteInstance(id) {
  return db.instances.delete(id);
}

// ─── Token Cache ─────────────────────────────────────────────────────────

export async function getToken(key) {
  const row = await db.tokens.get(key);
  return row?.value ?? null;
}

export async function setToken(key, value) {
  return db.tokens.put({ key, value, updatedAt: Date.now() });
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
  await db.transaction('rw', [db.projects, db.tickets, db.variables], async () => {
    await db.projects.delete(id);
    await db.tickets.where('projectId').equals(id).delete();
    await db.variables.where('projectId').equals(id).delete();
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
  if (variable.id) {
    await db.variables.put(variable);
    return variable;
  }
  const id = await db.variables.add(variable);
  return { ...variable, id };
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
 * Load Claude AI settings from persistent storage.
 * Returns { apiKey, model, maxTokens }
 */
export async function loadAiSettings() {
  const stored = await getSetting('ai-settings');
  return stored || { apiKey: '', model: 'claude-sonnet-4-5-20250514', maxTokens: 2048 };
}

/**
 * Save Claude AI settings to persistent storage.
 */
export async function saveAiSettings(settings) {
  return setSetting('ai-settings', settings);
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
