/**
 * Document Identity Service
 *
 * Manages persistent document identification via Word document Tags (keywords).
 * Each document gets an 8-character hex ID stored as `dg:XXXXXXXX` in the
 * document's built-in Tags property.
 *
 * Provides:
 *   - readDocumentTag()    — read the dg: tag from the active Word document
 *   - writeDocumentTag(id) — write a dg: tag into the active Word document
 *   - generateDocId()      — produce a fresh 8-char hex ID
 *   - initDocumentIdentity() — full first-open flow (detect, prompt, link)
 *   - getAllDocuments()     — list all known documents from DB
 *   - getDocumentById(id)  — lookup a single document by its 8-char tag ID
 *   - updateDocumentName() — update stored document name
 *   - deleteDocument(id)   — remove a document and optionally cascade
 *   - cloneDocumentCatalogues() — deep-copy document-scoped catalogues
 */

import state from '../core/state.js';
import {
  getProject,
  getProjectByDocumentId,
  saveProject,
  deleteProject,
  getAllProjects,
  getCatalogues,
  saveCatalogue,
  getSections,
  saveSection,
  getVariables,
  saveVariable,
  generateId,
} from '../core/storage.js';

// ─── Tag format ──────────────────────────────────────────────────────

const TAG_PREFIX = 'dg:';
const TAG_RE = /dg:([a-f0-9]{8})/;

/** Generate a fresh 8-char hex document ID. */
export function generateDocId() {
  if (crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
  }
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

// ─── Word Tag I/O ────────────────────────────────────────────────────

/**
 * Read the dg: tag from the current Word document's Keywords/Tags property.
 * Returns the 8-char ID string, or null if not found.
 * In browser-dev mode (no Office.js), falls back to localStorage.
 */
export async function readDocumentTag() {
  if (typeof Word !== 'undefined' && Word.run) {
    try {
      return await Word.run(async (ctx) => {
        const props = ctx.document.properties;
        props.load('keywords');
        await ctx.sync();
        const tags = props.keywords || '';
        const match = tags.match(TAG_RE);
        return match ? match[1] : null;
      });
    } catch (err) {
      console.warn('[doc-identity] Failed to read Word tags:', err.message);
      return null;
    }
  }
  // Browser dev fallback
  try {
    const stored = localStorage.getItem('docgen_dev_doc_tag');
    return stored || null;
  } catch { return null; }
}

/**
 * Write a dg: tag into the current Word document's Keywords/Tags property.
 * Appends to existing tags without overwriting.
 */
export async function writeDocumentTag(docId) {
  if (typeof Word !== 'undefined' && Word.run) {
    try {
      await Word.run(async (ctx) => {
        const props = ctx.document.properties;
        props.load('keywords');
        await ctx.sync();
        const existing = props.keywords || '';
        // Remove any old dg: tag first
        const cleaned = existing.replace(/,?\s*dg:[a-f0-9]{8}/g, '').replace(/^,\s*/, '').trim();
        props.keywords = cleaned ? `${cleaned}, ${TAG_PREFIX}${docId}` : `${TAG_PREFIX}${docId}`;
        await ctx.sync();
      });
    } catch (err) {
      console.warn('[doc-identity] Failed to write Word tag:', err.message);
    }
    return;
  }
  // Browser dev fallback
  try {
    localStorage.setItem('docgen_dev_doc_tag', docId);
  } catch { /* noop */ }
}

// ─── Document DB Operations ──────────────────────────────────────────

/** Get all documents (projects with a documentId) from the DB, sorted by updatedAt desc. */
export async function getAllDocuments() {
  return getAllProjects();
}

/** Look up a document by its 8-char tag ID. */
export async function getDocumentByTag(tagId) {
  return getProjectByDocumentId(tagId);
}

/** Create a new document record in the DB. */
export async function createDocumentRecord(docId, name) {
  const project = {
    id: generateId(),
    documentId: docId,
    name: name || `Document ${docId}`,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await saveProject(project);
  return project;
}

/** Update a document's display name. */
export async function updateDocumentName(docId, newName) {
  const doc = await getProjectByDocumentId(docId);
  if (doc) {
    doc.name = newName;
    doc.updatedAt = Date.now();
    await saveProject(doc);
  }
  return doc;
}

/** Delete a document and optionally its document-scoped catalogues. */
export async function deleteDocumentRecord(projectId) {
  await deleteProject(projectId);
}

// ─── Clone catalogues between documents ──────────────────────────────

/**
 * Deep-clone all document-scoped catalogues from one project into another.
 * Copies catalogues → sections → variables with new IDs.
 */
export async function cloneDocumentCatalogues(sourceProjectId, targetProjectId, targetDocId) {
  const cats = await getCatalogues(sourceProjectId);
  const docCats = cats.filter(c => c.scope === 'document');

  for (const cat of docCats) {
    // Clone catalogue
    const newCat = {
      ...cat,
      id: generateId(),
      projectId: targetProjectId,
      scopeRef: targetDocId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveCatalogue(newCat);

    // Clone sections
    const sections = await getSections(cat.id);
    const sectionIdMap = {};
    for (const sec of sections) {
      const newSecId = generateId();
      sectionIdMap[sec.id] = newSecId;
      await saveSection({
        ...sec,
        id: newSecId,
        catalogueId: newCat.id,
        projectId: targetProjectId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }

    // Clone variables
    const vars = await getVariables(sourceProjectId);
    const catVars = vars.filter(v => String(v.catalogueId) === String(cat.id));
    for (const v of catVars) {
      await saveVariable({
        ...v,
        id: generateId(),
        projectId: targetProjectId,
        catalogueId: newCat.id,
        sectionId: v.sectionId ? (sectionIdMap[v.sectionId] || null) : null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });
    }
  }
}

// ─── State helpers ───────────────────────────────────────────────────

/** Set the active document in app state.
 *  NOTE: We do NOT override project.id here — catalogues are still keyed to
 *  the current project ('_default' or whatever was set at startup). Document
 *  identity is an overlay for scope filtering, not a project switch.
 */
export function setActiveDocument(doc) {
  if (doc) {
    state.batch({
      'document.id': doc.documentId,
      'document.projectId': doc.id,
      'document.name': doc.name,
    });
  } else {
    state.batch({
      'document.id': null,
      'document.projectId': null,
      'document.name': null,
    });
  }
}

/** Get the active document info from state. */
export function getActiveDocument() {
  const id = state.get('document.id');
  if (!id) return null;
  return {
    id,
    projectId: state.get('document.projectId'),
    name: state.get('document.name'),
  };
}

// ─── Scope mode ──────────────────────────────────────────────────────

const SCOPE_MODE_KEY = 'docgen_scope_mode';

export function getScopeMode() {
  return state.get('scopeMode') || 'filter';
}

export function setScopeMode(mode) {
  state.set('scopeMode', mode);
  try { localStorage.setItem(SCOPE_MODE_KEY, mode); } catch { /* noop */ }
}

/** Load persisted scope mode on startup. */
export function loadScopeMode() {
  try {
    const saved = localStorage.getItem(SCOPE_MODE_KEY);
    if (saved && ['filter', 'badge', 'grouped'].includes(saved)) {
      state.set('scopeMode', saved);
    }
  } catch { /* noop */ }
}

// ─── Document bar visibility ─────────────────────────────────────────

const DOC_BAR_KEY = 'docgen_doc_bar_open';

export function isDocBarOpen() {
  return state.get('docBar.open') || false;
}

export function toggleDocBar() {
  const open = !isDocBarOpen();
  state.set('docBar.open', open);
  try { localStorage.setItem(DOC_BAR_KEY, open ? '1' : ''); } catch { /* noop */ }
}

export function loadDocBarState() {
  try {
    const saved = localStorage.getItem(DOC_BAR_KEY);
    if (saved === '1') state.set('docBar.open', true);
  } catch { /* noop */ }
}

// ─── Init flow ───────────────────────────────────────────────────────

/**
 * Full first-open flow. Called during app init.
 *
 * 1. Read tag from Word document
 * 2. If found → look up in DB → set as active
 * 3. If not found → set document state to null (user can tag via UI)
 *
 * Returns the active document record or null.
 */
export async function initDocumentIdentity() {
  loadScopeMode();
  loadDocBarState();

  const tagId = await readDocumentTag();

  if (tagId) {
    // Known tag — look up project
    let doc = await getProjectByDocumentId(tagId);
    if (doc) {
      console.log(`[doc-identity] Recognised document: "${doc.name}" (${tagId})`);
      doc.updatedAt = Date.now();
      await saveProject(doc);
      setActiveDocument(doc);
      return doc;
    }
    // Tag exists in Word but DB was wiped — recreate record
    console.log(`[doc-identity] Tag ${tagId} found but no DB record — creating fresh.`);
    doc = await createDocumentRecord(tagId, `Document ${tagId}`);
    setActiveDocument(doc);
    return doc;
  }

  // No tag — unlinked document
  console.log('[doc-identity] No document tag found.');
  setActiveDocument(null);
  return null;
}
