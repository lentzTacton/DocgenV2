/**
 * Tacton API Client
 *
 * Ported from TactonUtil background.js — adapted for Word Add-in.
 *
 * Two endpoint scopes:
 *   Admin    — {baseUrl}/api/...       (client_credentials token)
 *   Ticket   — {baseUrl}/!tickets~{id}/api-v2.2/... (ticket-scoped token)
 *
 * CORS strategy:
 *   In dev, data API calls route through /tacton-proxy with X-Proxy-Target
 *   header (see proxy.js). Token fetches go through server-side Express
 *   endpoints (see auth.js).
 */

import { ensureAdminToken, getTicketToken, clearTicketTokenCache } from './auth.js';
import { apiUrl, proxyHeaders } from './proxy.js';

// ─── Core Fetch Wrappers ────────────────────────────────────────────────

/**
 * Fetch with auth headers + proxy routing.
 * @param {string} instanceUrl - Base instance URL (for proxy header)
 * @param {string} path - API path, e.g. '/api/ticket/list'
 * @param {string} token - Bearer token
 * @param {Object} [opts] - Additional fetch options
 * @returns {Promise<Response>}
 */
async function authFetch(instanceUrl, path, token, opts = {}) {
  const url = apiUrl(instanceUrl, path);
  const headers = {
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/xml, application/json',
    ...proxyHeaders(instanceUrl),
    ...opts.headers,
  };

  return fetch(url, {
    ...opts,
    headers,
    credentials: 'omit',
  });
}

/**
 * Admin-scoped API call (uses client_credentials token).
 *
 * @param {Object} instance - { url, admin: { clientId, clientSecret } }
 * @param {string} path - API path, e.g. '/api/ticket/list'
 * @param {Object} [opts] - { method, body, headers }
 * @returns {Promise<{ok: boolean, status: number, body: string, contentType: string}>}
 */
export async function adminFetch(instance, path, opts = {}) {
  const token = await ensureAdminToken(instance);

  const fetchOpts = { method: opts.method || 'GET' };
  if (opts.body) {
    fetchOpts.headers = { 'Content-Type': 'application/json' };
    fetchOpts.body = JSON.stringify(opts.body);
  }

  const res = await authFetch(instance.url, path, token, fetchOpts);
  const body = await res.text();

  return {
    ok: res.ok,
    status: res.status,
    body,
    contentType: res.headers.get('content-type') || '',
  };
}

/**
 * Ticket-scoped API call (uses 3-tier ticket token).
 *
 * @param {Object} instance
 * @param {string} ticketId
 * @param {string} path - Path after /!tickets~{id}/, e.g. 'api-v2.2/describe'
 * @param {Object} [opts]
 * @returns {Promise<{ok: boolean, status: number, body: string, needsAuth: boolean}>}
 */
export async function ticketFetch(instance, ticketId, path, opts = {}) {
  const { token, diag } = await getTicketToken(instance, ticketId);

  if (!token) {
    return {
      ok: false,
      status: 0,
      body: '',
      needsAuth: true,
      diag,
    };
  }

  const fullPath = `/!tickets~${ticketId}/${path}`;
  const fetchOpts = { method: opts.method || 'GET' };
  if (opts.body) {
    fetchOpts.headers = { 'Content-Type': 'application/json' };
    fetchOpts.body = JSON.stringify(opts.body);
  }

  const res = await authFetch(instance.url, fullPath, token, fetchOpts);

  // Auto-retry on 401/403: clear cached token and get a fresh one via refresh flow
  // Tacton returns 403 (not just 401) for expired/invalid tokens
  if ((res.status === 401 || res.status === 403) && !opts._retried) {
    console.log(`[api] ${res.status} on ticket fetch — clearing cache and retrying…`);
    clearTicketTokenCache(ticketId);
    const { token: freshToken } = await getTicketToken(instance, ticketId);
    if (freshToken && freshToken !== token) {
      const retryRes = await authFetch(instance.url, fullPath, freshToken, fetchOpts);
      const retryBody = await retryRes.text();
      return {
        ok: retryRes.ok,
        status: retryRes.status,
        body: retryBody,
        needsAuth: retryRes.status === 401 || retryRes.status === 403,
        diag: [...diag, `${res.status} retry: ` + (retryRes.ok ? 'succeeded' : 'failed')],
      };
    }
  }

  const body = await res.text();

  return {
    ok: res.ok,
    status: res.status,
    body,
    needsAuth: res.status === 401 || res.status === 403,
    diag,
  };
}

// ─── High-Level API Methods ─────────────────────────────────────────────

/**
 * List all tickets from the admin API.
 * Returns parsed ticket objects: [{ id, summary, status }]
 *
 * @param {Object} instance
 * @returns {Promise<{ok: boolean, tickets?: Array, error?: string}>}
 */
export async function listTickets(instance) {
  const res = await adminFetch(instance, '/api/ticket/list');
  if (!res.ok) {
    return { ok: false, error: `HTTP ${res.status}: ${res.body.substring(0, 200)}` };
  }
  const tickets = parseTicketListXml(res.body);
  return { ok: true, tickets };
}

/**
 * Fetch the object model (describe) for a ticket.
 * Tries multiple token/endpoint combinations like TactonUtil:
 *   1. Ticket token → ticket-scoped describe (via ticketFetch, with built-in 403 retry)
 *   2. Admin token → unscoped describe
 *   3. Admin token → ticket-scoped describe
 *
 * @param {Object} instance
 * @param {string} ticketId
 * @returns {Promise<{ok: boolean, objects?: Array, xml?: string, needsAuth?: boolean, error?: string}>}
 */
export async function getModel(instance, ticketId) {
  const attempts = [];

  // Helper for admin-token attempts (no retry needed — admin tokens don't expire as fast)
  async function tryAdminDescribe(label, path, token) {
    try {
      const res = await authFetch(instance.url, path, token);
      const body = await res.text();
      const isHtml = body.trimStart().startsWith('<!DOCTYPE') || body.trimStart().startsWith('<html');
      attempts.push(`${label}: ${res.status} (${body.length}b${isHtml ? ', HTML' : ''})`);
      if (res.ok && !isHtml && body.includes('<resource')) return body;
      return null;
    } catch (e) {
      attempts.push(`${label}: ERROR ${e.message}`);
      return null;
    }
  }

  // 1. Ticket-scoped token — delegates retry to ticketFetch
  const res = await ticketFetch(instance, ticketId, 'api-v2.2/describe');
  if (res.ok && res.body) {
    const isHtml = res.body.trimStart().startsWith('<!DOCTYPE') || res.body.trimStart().startsWith('<html');
    if (!isHtml && res.body.includes('<resource')) {
      return { ok: true, objects: parseModelXml(res.body), xml: res.body };
    }
    attempts.push(`ticket-token: ${res.status} (${res.body.length}b${isHtml ? ', HTML' : ''})`);
  } else if (res.needsAuth) {
    attempts.push(`ticket-token: needs auth`);
  } else {
    attempts.push(`ticket-token: ${res.status}`);
  }

  // 2. Admin token — unscoped
  try {
    const adminToken = await ensureAdminToken(instance);
    const xml = await tryAdminDescribe('admin-unscoped', '/api-v2.2/describe', adminToken);
    if (xml) return { ok: true, objects: parseModelXml(xml), xml };

    // 3. Admin token — ticket-scoped
    const xml2 = await tryAdminDescribe('admin-ticket', `/!tickets~${ticketId}/api-v2.2/describe`, adminToken);
    if (xml2) return { ok: true, objects: parseModelXml(xml2), xml: xml2 };
  } catch (e) {
    attempts.push(`admin: ${e.message}`);
  }

  return {
    ok: false,
    needsAuth: true,
    error: `No valid token for this ticket.\n\nAttempts:\n${attempts.join('\n')}`,
  };
}

/**
 * List records of a given object type within a ticket.
 *
 * @param {Object} instance
 * @param {string} ticketId
 * @param {string} objectName
 * @param {string} [listUrl] - Custom list URL from model, if available
 * @returns {Promise<{ok: boolean, records?: Array, error?: string, needsAuth?: boolean}>}
 */
export async function listRecords(instance, ticketId, objectName, listUrl) {
  // Build the relative path (after /!tickets~{id}/) for ticketFetch.
  // listUrl from the model may be:
  //   - Full URL: "https://instance.com/!tickets~T-00001/api-v2.2/solution/list"
  //   - Ticket-prefixed path: "/!tickets~T-00001/api-v2.2/solution/list"
  //   - URL-encoded prefix: "/!tickets%7ET-00001/api-v2.2/solution/list"
  //   - Bare relative path: "/api-v2.2/solution/list"
  //   - null/empty → construct from objectName
  // ticketFetch always prepends /!tickets~{id}/, so we must strip that prefix.

  /**
   * Strip the ticket path prefix from a URL/path string.
   * Handles both unencoded (~) and URL-encoded (%7E/%7e) tilde variants.
   */
  function stripTicketPrefix(path) {
    // Match /!tickets~{id}/ or /!tickets%7E{id}/ (case-insensitive %7e)
    const re = new RegExp(`/!tickets(?:~|%7[Ee])${ticketId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`);
    const match = path.match(re);
    if (match) {
      return path.slice(match.index + match[0].length);
    }
    // No ticket prefix found — strip leading slash only
    return path.replace(/^\//, '');
  }

  let relPath;
  if (listUrl && (listUrl.startsWith('http://') || listUrl.startsWith('https://'))) {
    try {
      const parsed = new URL(listUrl);
      relPath = stripTicketPrefix(parsed.pathname + parsed.search);
    } catch {
      relPath = `api-v2.2/${encodeURIComponent(objectName)}/list`;
    }
  } else if (listUrl) {
    relPath = stripTicketPrefix(listUrl);
  } else {
    relPath = `api-v2.2/${encodeURIComponent(objectName)}/list`;
  }

  try {
    const res = await ticketFetch(instance, ticketId, relPath);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, needsAuth: res.needsAuth };
    }
    const records = parseRecordsXml(res.body);
    return { ok: true, records };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Get related records by traversing a reference.
 *
 * @param {Object} instance
 * @param {string} ticketId
 * @param {Object} params - { fromObject, toObject, via, direction, recordId }
 * @returns {Promise<{ok: boolean, records?: Array, error?: string}>}
 */
export async function getRelated(instance, ticketId, params) {
  const { fromObject, toObject, via, direction = 'forward', recordId } = params;

  try {
    const [fromRes, toRes] = await Promise.all([
      ticketFetch(instance, ticketId, `api-v2.2/${encodeURIComponent(fromObject)}/list`),
      ticketFetch(instance, ticketId, `api-v2.2/${encodeURIComponent(toObject)}/list`),
    ]);

    if (fromRes.needsAuth || toRes.needsAuth) {
      return { ok: false, needsAuth: true, error: 'No token' };
    }
    if (!fromRes.ok || !toRes.ok) {
      return { ok: false, error: 'HTTP error loading records' };
    }

    const fromRecords = parseRecordsXml(fromRes.body);
    const toRecords = parseRecordsXml(toRes.body);

    let result;
    if (direction === 'forward') {
      const refIds = new Set();
      for (const rec of fromRecords) {
        if (recordId && rec.id !== recordId) continue;
        if (rec[via]) refIds.add(rec[via]);
      }
      result = toRecords.filter(r => refIds.has(r.id));
    } else {
      const fromIds = new Set();
      for (const rec of fromRecords) {
        if (recordId && rec.id !== recordId) continue;
        fromIds.add(rec.id);
      }
      result = toRecords.filter(r => fromIds.has(r[via]));
    }

    return { ok: true, records: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── XML Parsers ────────────────────────────────────────────────────────

/**
 * Parse ticket list XML from /api/ticket/list.
 * @param {string} xml
 * @returns {Array<{id: string, summary: string, status: string}>}
 */
function parseTicketListXml(xml) {
  const tickets = [];
  const re = /<ticket\b([^>]*?)(?:\/>|>[\s\S]*?<\/ticket>)/gi;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const attrs = m[1] || '';
    tickets.push({
      id: extractAttr(attrs, 'id') || '',
      summary: extractAttr(attrs, 'summary') || '',
      status: extractAttr(attrs, 'status') || '',
    });
  }
  return tickets;
}

/**
 * Parse object model from /api-v2.2/describe XML.
 * Returns array of object type definitions.
 *
 * @param {string} xml
 * @returns {Array<{name: string, listUrl: string, describeUrl: string, attributes: Array}>}
 */
function parseModelXml(xml) {
  const objects = [];
  const resRe = /<resource\b([^>]*?)(?:\/>|>([\s\S]*?)<\/resource>)/gi;
  let m;

  while ((m = resRe.exec(xml)) !== null) {
    const attrStr = m[1] || '';
    const inner = m[2] || '';
    const name = extractAttr(attrStr, 'name');
    if (!name) continue;

    const attrs = [];
    const attrRe = /<attribute\b([^>]*?)(?:\/>|>[\s\S]*?<\/attribute>)/gi;
    let am;
    while ((am = attrRe.exec(inner)) !== null) {
      const aStr = am[1] || '';
      attrs.push({
        name: extractAttr(aStr, 'name') || '',
        type: extractAttr(aStr, 'type') || 'string',
        mandatory: extractAttr(aStr, 'mandatory') === 'true',
        searchable: extractAttr(aStr, 'searchable') === 'true',
        refType: extractAttr(aStr, 'referencedType') || null,
      });
    }

    objects.push({
      name,
      listUrl: extractAttr(attrStr, 'list-url') || '',
      describeUrl: extractAttr(attrStr, 'describe-url') || '',
      attributes: attrs,
    });
  }

  return objects;
}

/**
 * Parse resource records from XML (list endpoint response).
 * Works with both attribute-based and child-tag based formats.
 *
 * @param {string} xml
 * @returns {Array<Object>}
 */
function parseRecordsXml(xml) {
  const records = [];
  const re = /<resource\b([^>]*?)\s*\/>|<resource\b([^>]*?)>([\s\S]*?)<\/resource>/gi;
  let m;

  while ((m = re.exec(xml)) !== null) {
    const attrStr = m[1] || m[2] || '';
    const inner = m[3] || '';
    const record = {};

    // Tag attributes
    const tagRe = /(\w[\w-]*)="([^"]*)"/g;
    let a;
    while ((a = tagRe.exec(attrStr)) !== null) {
      record[a[1]] = a[2];
    }

    // Resource ID
    if (record.id) record._resourceId = record.id;

    // Child <attribute> tags
    const childRe = /<attribute\b([^>]*?)(?:\/>|>[^<]*<\/attribute>)/gi;
    let ac;
    while ((ac = childRe.exec(inner)) !== null) {
      const acStr = ac[1] || '';
      const nm = extractAttr(acStr, 'name');
      const vl = extractAttr(acStr, 'value');
      if (nm) record[nm] = vl || '';
    }

    // Extract UUID from href
    const selfUrl = record.href || record.url || record.self || '';
    if (selfUrl) {
      const uuidMatch = selfUrl.match(/\/([a-f0-9]{16,})\/?$/i);
      if (uuidMatch) record._uuid = uuidMatch[1];
    }

    if (Object.keys(record).length > 0) records.push(record);
  }

  return records;
}

/**
 * Extract an XML attribute value by name from an attribute string.
 * @param {string} str - Attribute string like 'name="Foo" type="bar"'
 * @param {string} name - Attribute name to extract
 * @returns {string|null}
 */
function extractAttr(str, name) {
  const re = new RegExp(`${name}="([^"]*)"`, 'i');
  const m = str.match(re);
  return m ? m[1] : null;
}

// ─── Configured Product (Solution API) ────────────────────────────────────

/**
 * Fetch the full configured-product XML from the Solution API.
 * Tries solution-api, v1.3, v1.2 in order (different instances support different versions).
 *
 * @param {Object} instance
 * @param {string} ticketId
 * @param {string} cpId - ConfiguredProduct UUID (_uuid from v2.2 records)
 * @returns {Promise<{ok: boolean, xml?: string, error?: string}>}
 */
export async function fetchConfiguredProduct(instance, ticketId, cpId) {
  const apiVersions = ['solution-api-v1.3', 'solution-api', 'solution-api-v1.2'];

  for (const ver of apiVersions) {
    const res = await ticketFetch(instance, ticketId,
      `${ver}/configured-product/${cpId}?include-actual-value=true`
    );
    if (res.ok && res.body && res.body.includes('<')) {
      return { ok: true, xml: res.body };
    }
  }

  return { ok: false, error: 'Failed to load configured product from solution API' };
}

/**
 * Parse the configured-product XML into a structured tree.
 *
 * Returns:
 * {
 *   model: { name, id, attrs: [{id, name, value, type}], calcAttrs: [{id, name, value}],
 *            positions: [{ id, name, attrs, assembly?, module? }] },
 *   bom: [{ attrs: [{name, type, value}] }]
 * }
 *
 * The position/assembly tree is the source for getConfigurationAttribute paths.
 * E.g. getConfigurationAttribute("position-name.attrName")
 */
export function parseConfiguredProductXml(xml) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'application/xml');
  const result = { model: null, bom: [] };

  // ── Model (product-configuration > model) ──
  const modelEl = doc.querySelector('product-configuration > model');
  if (modelEl) {
    result.model = {
      id: modelEl.getAttribute('id') || '',
      name: modelEl.getAttribute('name') || '',
      origin: modelEl.getAttribute('origin') || '',
      attrs: cpParseAttrs(modelEl),
      calcAttrs: cpParseCalcAttrs(modelEl),
      positions: cpParsePositions(modelEl),
    };
  }

  // ── BOM ──
  const bomItems = doc.querySelectorAll('bom > items > item');
  for (const item of bomItems) {
    const attrs = [];
    const itemAttrs = item.querySelector('attributes');
    if (itemAttrs) {
      for (const a of itemAttrs.children) {
        if (a.tagName === 'attribute') {
          attrs.push({
            name: a.getAttribute('name') || '',
            type: a.getAttribute('type') || '',
            value: a.getAttribute('value') || '',
          });
        }
      }
    }
    result.bom.push({ attrs });
  }

  return result;
}

function cpParseAttrs(parentEl) {
  const attrs = [];
  const block = parentEl.querySelector(':scope > attributes');
  if (!block) return attrs;
  for (const a of block.children) {
    if (a.tagName === 'attribute') {
      attrs.push({
        id: a.getAttribute('id') || '',
        name: a.getAttribute('name') || '',
        domainId: a.getAttribute('domainId') || '',
        value: a.getAttribute('value') || '',
        type: a.getAttribute('type') || '',
      });
    }
  }
  return attrs;
}

function cpParseCalcAttrs(parentEl) {
  const attrs = [];
  const block = parentEl.querySelector(':scope > calculated-attributes');
  if (!block) return attrs;
  for (const a of block.children) {
    if (a.tagName === 'calculated-attribute') {
      attrs.push({
        id: a.getAttribute('id') || '',
        name: a.getAttribute('name') || '',
        value: a.getAttribute('value') || '',
      });
    }
  }
  return attrs;
}

function cpParsePositions(parentEl) {
  const positions = [];
  const posBlock = parentEl.querySelector(':scope > positions');
  if (!posBlock) return positions;
  for (const posEl of posBlock.children) {
    if (posEl.tagName !== 'position') continue;
    const pos = {
      id: posEl.getAttribute('id') || '',
      name: posEl.getAttribute('name') || '',
      origin: posEl.getAttribute('origin') || '',
      qty: posEl.getAttribute('qty') || '1',
      attrs: cpParseAttrs(posEl),
      assembly: null,
      module: null,
    };

    // Assembly child (recursive positions)
    const assyEl = posEl.querySelector(':scope > assembly');
    if (assyEl) {
      pos.assembly = {
        id: assyEl.getAttribute('id') || '',
        name: assyEl.getAttribute('name') || '',
        origin: assyEl.getAttribute('origin') || '',
        attrs: cpParseAttrs(assyEl),
        calcAttrs: cpParseCalcAttrs(assyEl),
        positions: cpParsePositions(assyEl),   // recursive
      };
    }

    // Module child (leaf — contains variant with attrs)
    const modEl = posEl.querySelector(':scope > module');
    if (modEl) {
      pos.module = {
        id: modEl.getAttribute('id') || '',
        name: modEl.getAttribute('name') || '',
        origin: modEl.getAttribute('origin') || '',
        variant: null,
      };
      const varEl = modEl.querySelector(':scope > variant');
      if (varEl) {
        pos.module.variant = {
          id: varEl.getAttribute('id') || '',
          name: varEl.getAttribute('name') || '',
          attrs: cpParseAttrs(varEl),
          calcAttrs: cpParseCalcAttrs(varEl),
        };
      }
    }

    positions.push(pos);
  }
  return positions;
}

// Export parsers for testing
export { parseTicketListXml, parseModelXml, parseRecordsXml };
