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

import { ensureAdminToken, getTicketToken } from './auth.js';
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
  const body = await res.text();

  return {
    ok: res.ok,
    status: res.status,
    body,
    needsAuth: res.status === 401,
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
 *   1. Ticket token → ticket-scoped describe
 *   2. Admin token → unscoped describe
 *   3. Admin token → ticket-scoped describe
 *
 * @param {Object} instance
 * @param {string} ticketId
 * @returns {Promise<{ok: boolean, objects?: Array, xml?: string, needsAuth?: boolean, error?: string}>}
 */
export async function getModel(instance, ticketId) {
  const attempts = [];

  // Helper: try a describe call
  async function tryDescribe(label, instanceUrl, path, token) {
    try {
      const res = await authFetch(instanceUrl, path, token);
      const body = await res.text();
      const isHtml = body.trimStart().startsWith('<!DOCTYPE') || body.trimStart().startsWith('<html');
      attempts.push(`${label}: ${res.status} (${body.length}b${isHtml ? ', HTML' : ''})`);
      if (res.ok && !isHtml && body.includes('<resource')) return body;
    } catch (e) {
      attempts.push(`${label}: ERROR ${e.message}`);
    }
    return null;
  }

  // 1. Ticket-scoped token
  const { token: ttk, diag } = await getTicketToken(instance, ticketId);
  if (ttk) {
    const xml = await tryDescribe(
      'ticket-token',
      instance.url,
      `/!tickets~${ticketId}/api-v2.2/describe`,
      ttk,
    );
    if (xml) {
      return { ok: true, objects: parseModelXml(xml), xml };
    }
  }

  // 2. Admin token — unscoped
  try {
    const adminToken = await ensureAdminToken(instance);
    let xml = await tryDescribe(
      'admin-unscoped',
      instance.url,
      '/api-v2.2/describe',
      adminToken,
    );
    if (xml) return { ok: true, objects: parseModelXml(xml), xml };

    // 3. Admin token — ticket-scoped
    xml = await tryDescribe(
      'admin-ticket',
      instance.url,
      `/!tickets~${ticketId}/api-v2.2/describe`,
      adminToken,
    );
    if (xml) return { ok: true, objects: parseModelXml(xml), xml };
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
  const { token } = await getTicketToken(instance, ticketId);
  if (!token) return { ok: false, needsAuth: true, error: 'No token for this ticket' };

  let path;
  if (listUrl && (listUrl.startsWith('http://') || listUrl.startsWith('https://'))) {
    // Absolute URL — extract path portion relative to instance
    try {
      const parsed = new URL(listUrl);
      path = parsed.pathname + parsed.search;
    } catch {
      path = `/!tickets~${ticketId}/api-v2.2/${encodeURIComponent(objectName)}/list`;
    }
  } else if (listUrl) {
    path = `/!tickets~${ticketId}${listUrl}`;
  } else {
    path = `/!tickets~${ticketId}/api-v2.2/${encodeURIComponent(objectName)}/list`;
  }

  try {
    const res = await authFetch(instance.url, path, token);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, needsAuth: res.status === 401 };
    }
    const body = await res.text();
    const records = parseRecordsXml(body);
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
  const { token } = await getTicketToken(instance, ticketId);
  if (!token) return { ok: false, needsAuth: true, error: 'No token' };

  try {
    const fromPath = `/!tickets~${ticketId}/api-v2.2/${encodeURIComponent(fromObject)}/list`;
    const toPath = `/!tickets~${ticketId}/api-v2.2/${encodeURIComponent(toObject)}/list`;

    const [fromRes, toRes] = await Promise.all([
      authFetch(instance.url, fromPath, token),
      authFetch(instance.url, toPath, token),
    ]);

    if (!fromRes.ok || !toRes.ok) {
      return { ok: false, error: 'HTTP error loading records' };
    }

    const fromRecords = parseRecordsXml(await fromRes.text());
    const toRecords = parseRecordsXml(await toRes.text());

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

// Export parsers for testing
export { parseTicketListXml, parseModelXml, parseRecordsXml };
