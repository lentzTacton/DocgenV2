/**
 * Auth Service — OAuth2 Token Resolution
 *
 * Ported from TactonUtil background.js — adapted for Word Add-in:
 *   Chrome storage  →  Dexie/IndexedDB (storage.js)
 *   Chrome identity →  Manual OAuth flow (auth URL + code paste)
 *   Service Worker  →  In-page module (same lifetime as taskpane)
 *
 * Two token scopes:
 *   Admin   — instance-level, uses client_credentials grant
 *   Ticket  — ticket-scoped, uses 3-tier resolution:
 *             1. In-memory cache
 *             2. Refresh token exchange
 *             3. Stored access token fallback
 *
 * CORS strategy (dev):
 *   All OAuth token fetches go through server-side Express endpoints
 *   (/verify-connection, /ticket-token, etc.) which call Tacton directly
 *   from Node.js, avoiding browser CORS entirely.
 */

import { getToken, setToken, deleteToken } from '../core/storage.js';
import { isDevMode, apiUrl, proxyHeaders } from './proxy.js';

// ─── In-Memory Token Caches ─────────────────────────────────────────────

/** @type {Object.<string, {token: string, expiry: number}>} keyed by instance URL */
const adminTokens = {};

/** @type {Object.<string, {token: string, expiry: number}>} keyed by ticketId */
const ticketTokens = {};

/**
 * Per-ticket refresh mutex — prevents concurrent refresh token exchanges.
 * Tacton rotates refresh tokens (single-use), so if two callers both read
 * the same stored refresh token and try to exchange it, the second gets 400.
 * This map stores an in-flight refresh promise keyed by ticketId; concurrent
 * callers await the same promise instead of making a duplicate request.
 * @type {Map<string, Promise<{token: string, refreshToken: string|null, expiry: number}|null>>}
 */
const refreshInFlight = new Map();

/**
 * Per-ticket token resolution mutex — prevents concurrent callers from
 * each probing/refreshing independently. Multiple concurrent getTicketToken
 * calls for the same ticket piggyback on the same resolution promise.
 * @type {Map<string, Promise<{token: string|null, diag: string[]}>>}
 */
const resolveInFlight = new Map();

/**
 * Admin token resolution mutex — prevents concurrent ensureAdminToken calls
 * from each fetching a new client_credentials grant independently.
 * Keyed by instance URL.
 * @type {Map<string, Promise<string>>}
 */
const adminInFlight = new Map();

// ─── Admin Token (Client Credentials Grant) ─────────────────────────────

/**
 * Fetch an admin token via the dev server's /verify-connection endpoint.
 * Node.js calls Tacton directly, avoiding CORS.
 */
async function getAdminTokenViaServer(instance) {
  const res = await fetch(`${window.location.origin}/verify-connection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instanceUrl: instance.url,
      clientId: instance.admin.clientId,
      clientSecret: instance.admin.clientSecret,
    }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    // If the response isn't JSON, the dev server likely isn't running
    throw new Error(
      text.includes('<!DOCTYPE')
        ? 'Dev server endpoints not available — make sure you run "npm run dev"'
        : `Unexpected response: ${text.substring(0, 100)}`
    );
  }

  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Auth failed (${res.status})`);
  }

  return {
    token: data.token,
    expiry: Date.now() + (data.expiresIn - 60) * 1000,
  };
}

/**
 * Fetch an admin token directly from Tacton (production path).
 * Only works when the add-in origin is whitelisted in Tacton CORS.
 */
async function getAdminTokenDirect(instance) {
  const tokenUrl = `${instance.url}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: instance.admin.clientId,
    client_secret: instance.admin.clientSecret,
    scope: 'api',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    credentials: 'omit',
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Auth failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    token: data.access_token,
    expiry: Date.now() + (data.expires_in - 60) * 1000,
  };
}

/**
 * Get an admin-level token for an instance.
 *
 * Resolution order (avoids unnecessary client_credentials grants that
 * can invalidate ticket tokens on Tacton's side when both share the
 * same OAuth clientId):
 *
 *   1. In-memory cache (fastest)
 *   2. Stored token in Dexie (survives page reloads)
 *   3. Fresh client_credentials grant (last resort)
 *
 * Uses a per-instance mutex so concurrent callers piggyback on the same
 * resolution instead of each fetching independently.
 *
 * @param {Object} instance - { url, admin: { clientId, clientSecret } }
 * @param {Object} [opts]
 * @param {boolean} [opts.forceRefresh] - Skip cache/stored and do fresh grant
 * @returns {Promise<string>} Access token
 */
export async function ensureAdminToken(instance, opts = {}) {
  // ── Tier 1: In-memory cache ──
  if (!opts.forceRefresh) {
    const cached = adminTokens[instance.url];
    if (cached && Date.now() < cached.expiry) {
      return cached.token;
    }
  }

  // ── Tiers 2+3 require async work — serialize per instance ──
  if (adminInFlight.has(instance.url)) {
    return adminInFlight.get(instance.url);
  }

  const promise = _resolveAdminToken(instance, opts)
    .finally(() => adminInFlight.delete(instance.url));
  adminInFlight.set(instance.url, promise);
  return promise;
}

/**
 * Internal admin token resolution — called once per instance via mutex.
 */
async function _resolveAdminToken(instance, opts = {}) {
  if (!instance.admin?.clientId || !instance.admin?.clientSecret) {
    throw new Error('No admin credentials configured for this instance');
  }

  // ── Tier 2: Stored token in Dexie (survives page reloads) ──
  // Avoids a fresh client_credentials grant which can invalidate
  // ticket-scoped tokens when sharing the same OAuth clientId.
  if (!opts.forceRefresh) {
    const storageKey = `admin:${instance.url}`;
    const storedToken = await getToken(storageKey);
    const storedExpiry = await getToken(`${storageKey}:expiry`);
    if (storedToken && storedExpiry) {
      const expiry = Number(storedExpiry);
      if (Date.now() < expiry) {
        console.log('[auth] Admin token restored from Dexie (skipping client_credentials grant)');
        adminTokens[instance.url] = { token: storedToken, expiry };
        return storedToken;
      }
      console.log('[auth] Stored admin token expired — fetching fresh one');
    }
  }

  // ── Tier 3: Fresh client_credentials grant ──
  console.log('[auth] Fetching fresh admin token via client_credentials grant');
  const result = isDevMode()
    ? await getAdminTokenViaServer(instance)
    : await getAdminTokenDirect(instance);

  // Cache in memory
  adminTokens[instance.url] = result;

  // Persist to Dexie so we survive page reloads without re-granting
  const storageKey = `admin:${instance.url}`;
  await setToken(storageKey, result.token);
  await setToken(`${storageKey}:expiry`, String(result.expiry));

  return result.token;
}

/**
 * Test whether admin credentials are valid by attempting a token exchange.
 * @param {Object} instance
 * @param {Object} [opts]
 * @param {boolean} [opts.forceRefresh] - Force a fresh client_credentials grant
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function testAdminCredentials(instance, opts = {}) {
  try {
    await ensureAdminToken(instance, opts);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Ticket Token (3-Tier Resolution) ───────────────────────────────────

/**
 * Fetch a ticket-scoped token via the dev server's /ticket-token endpoint.
 */
async function getTicketTokenViaServer(instance, ticketId) {
  const creds = (instance.frontend?.clientId && instance.frontend?.clientSecret)
    ? instance.frontend
    : instance.admin;

  const res = await fetch(`${window.location.origin}/ticket-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instanceUrl: instance.url,
      ticketId,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Ticket token failed (${res.status})`);
  }

  return {
    token: data.token,
    refreshToken: data.refreshToken || null,
    expiry: Date.now() + (data.expiresIn - 60) * 1000,
  };
}

/**
 * Fetch a ticket-scoped token directly from Tacton (production path).
 */
async function getTicketTokenDirect(instance, ticketId) {
  const creds = (instance.frontend?.clientId && instance.frontend?.clientSecret)
    ? instance.frontend
    : instance.admin;

  const tokenUrl = `${instance.url}/!tickets~${ticketId}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: 'api',
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    credentials: 'omit',
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ticket token failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    token: data.access_token,
    refreshToken: data.refresh_token || null,
    expiry: Date.now() + (data.expires_in - 60) * 1000,
  };
}

/**
 * Refresh a ticket token via the dev server's /ticket-token-refresh endpoint.
 */
async function refreshTicketTokenViaServer(instance, ticketId, refreshToken) {
  const creds = (instance.frontend?.clientId && instance.frontend?.clientSecret)
    ? instance.frontend
    : instance.admin;

  const res = await fetch(`${window.location.origin}/ticket-token-refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instanceUrl: instance.url,
      ticketId,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      refreshToken,
    }),
  });

  const data = await res.json();
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `Refresh failed (${res.status})`);
  }

  return {
    token: data.token,
    refreshToken: data.refreshToken || refreshToken,
    expiry: Date.now() + (data.expiresIn - 60) * 1000,
  };
}

/**
 * Refresh a ticket token directly from Tacton (production path).
 */
async function refreshTicketTokenDirect(instance, ticketId, savedRefresh) {
  const creds = (instance.frontend?.clientId && instance.frontend?.clientSecret)
    ? instance.frontend
    : instance.admin;

  const tokenUrl = `${instance.url}/!tickets~${ticketId}/oauth2/token`;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: savedRefresh,
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    credentials: 'omit',
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Refresh failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  return {
    token: data.access_token,
    refreshToken: data.refresh_token || savedRefresh,
    expiry: Date.now() + (data.expires_in - 60) * 1000,
  };
}

/**
 * Serialized refresh token exchange — ensures only one refresh call per ticket
 * is in-flight at a time. Concurrent callers get the same result.
 *
 * Tacton rotates refresh tokens on exchange (single-use), so concurrent
 * exchange attempts with the same token cause 400 errors. This function
 * deduplicates them: the first caller starts the exchange, subsequent callers
 * await the same promise.
 *
 * On success, caches in memory AND persists both access + refresh to Dexie
 * so all callers get consistent state.
 *
 * @param {Object} instance
 * @param {string} ticketId
 * @returns {Promise<{token: string, refreshToken: string|null, expiry: number}|null>}
 */
async function refreshTicketTokenSerialized(instance, ticketId) {
  // If a refresh is already in-flight for this ticket, piggyback on it
  if (refreshInFlight.has(ticketId)) {
    return refreshInFlight.get(ticketId);
  }

  const doRefresh = async () => {
    const refreshKey = `refresh:${ticketId}`;
    const savedRefresh = await getToken(refreshKey);
    if (!savedRefresh) return null;

    try {
      const result = isDevMode()
        ? await refreshTicketTokenViaServer(instance, ticketId, savedRefresh)
        : await refreshTicketTokenDirect(instance, ticketId, savedRefresh);

      // Cache in memory
      ticketTokens[ticketId] = { token: result.token, expiry: result.expiry };

      // Persist tokens in Dexie
      await setToken(`access:${ticketId}`, result.token);
      if (result.refreshToken) {
        await setToken(refreshKey, result.refreshToken);
      }

      return result;
    } catch (e) {
      console.warn(`[auth] refresh failed for ${ticketId}:`, e.message);
      // Delete the consumed/invalid refresh token so we don't keep retrying it
      await deleteToken(refreshKey).catch(() => {});
      return null;
    }
  };

  const promise = doRefresh().finally(() => refreshInFlight.delete(ticketId));
  refreshInFlight.set(ticketId, promise);
  return promise;
}

/**
 * Resolve a ticket-scoped access token.
 *
 * Resolution order (critical — refresh MUST NOT run before validating
 * the stored token, because refresh invalidates the old token on
 * Tacton's side, causing 403s for any concurrent callers using it):
 *
 *   Tier 1: In-memory cache (fastest, survives taskpane lifetime)
 *   Tier 2: Stored access token — validate before trusting
 *   Tier 3: Refresh token exchange — only if stored token is invalid/missing
 *
 * @param {Object} instance - { url, admin, frontend? }
 * @param {string} ticketId - e.g. "T-00001"
 * @returns {Promise<{token: string|null, diag: string[]}>}
 */
export async function getTicketToken(instance, ticketId) {
  // ── Tier 1: In-memory cache (no mutex needed) ──
  const cached = ticketTokens[ticketId];
  if (cached && Date.now() < cached.expiry) {
    return {
      token: cached.token,
      diag: [{ key: 'cache-hit', status: 'pass', detail: 'Recently validated (in-memory cache)' }],
    };
  }

  // ── Tiers 2+3 require network — serialize per ticket ──
  // Multiple concurrent callers piggyback on the same resolution promise
  // to avoid duplicate probes/refreshes that would fight each other.
  if (resolveInFlight.has(ticketId)) {
    return resolveInFlight.get(ticketId);
  }

  const promise = _resolveTicketToken(instance, ticketId)
    .finally(() => resolveInFlight.delete(ticketId));
  resolveInFlight.set(ticketId, promise);
  return promise;
}

/**
 * Internal token resolution — called once per ticket via the mutex above.
 *
 * Returns structured `diag` entries that carry enough information for
 * `testTicketToken` to convert them into UI-friendly steps without
 * duplicating any probe/refresh logic.
 *
 * Each diag entry is either a plain string (for simple messages) or an
 * object: { key, status, detail, [extra] }
 */
async function _resolveTicketToken(instance, ticketId) {
  const diag = [];
  const hasFrontend = !!(instance.frontend?.clientId && instance.frontend?.clientSecret);

  // ── Check what's stored ──
  const storedAccess = await getToken(`access:${ticketId}`);
  const storedRefresh = await getToken(`refresh:${ticketId}`);

  diag.push({
    key: 'stored-access',
    status: storedAccess ? 'pass' : 'fail',
    detail: storedAccess ? storedAccess.substring(0, 12) + '…' : 'None stored',
  });
  diag.push({
    key: 'stored-refresh',
    status: storedRefresh ? 'pass' : 'fail',
    detail: storedRefresh ? storedRefresh.substring(0, 12) + '…' : 'None stored',
  });
  diag.push({
    key: 'frontend-creds',
    status: hasFrontend ? 'pass' : 'skip',
    detail: hasFrontend
      ? `Client ID: ${instance.frontend.clientId.substring(0, 12)}…`
      : 'Not configured (using admin)',
  });

  // ── Tier 2: Stored access token — validate before trusting ──
  if (storedAccess) {
    try {
      const probe = await probeTicketToken(instance, ticketId, storedAccess);
      if (probe.ok) {
        ticketTokens[ticketId] = {
          token: storedAccess,
          expiry: Date.now() + 55 * 60 * 1000,
        };
        diag.push({
          key: 'validate',
          status: 'pass',
          detail: `${probe.status} (${probe.length}b)`,
        });
        return { token: storedAccess, diag };
      }
      diag.push({
        key: 'validate',
        status: 'fail',
        detail: `HTTP ${probe.status} (${probe.length}b${probe.isHtml ? ', HTML redirect' : ''})`,
      });
    } catch (e) {
      diag.push({ key: 'validate', status: 'fail', detail: e.message });
    }
  } else {
    diag.push({ key: 'validate', status: 'skip', detail: 'No token to test' });
  }

  // ── Tier 3: Refresh token exchange — only if stored token is invalid/missing ──
  if (storedRefresh) {
    const result = await refreshTicketTokenSerialized(instance, ticketId);
    if (result) {
      const expiryMin = Math.round((result.expiry - Date.now()) / 60000);
      const rotated = !!(result.refreshToken);
      diag.push({
        key: 'refresh',
        status: 'pass',
        detail: `New access token (expires: ${expiryMin}min)${rotated ? ', refresh rotated' : ''}`,
      });
      diag.push({
        key: 'persist',
        status: 'pass',
        detail: `Access token updated${rotated ? ', refresh token rotated' : ''}`,
      });
      // Validate the refreshed token (informational)
      try {
        const probe = await probeTicketToken(instance, ticketId, result.token);
        diag.push({
          key: 'validate-new',
          status: probe.ok ? 'pass' : 'warn',
          detail: probe.ok
            ? `${probe.status} (${probe.length}b)`
            : `HTTP ${probe.status} (${probe.length}b) — token persisted, may need a moment`,
        });
      } catch (e) {
        diag.push({ key: 'validate-new', status: 'warn', detail: `${e.message} — token persisted anyway` });
      }
      return { token: result.token, diag };
    }
    diag.push({ key: 'refresh', status: 'fail', detail: 'Refresh exchange returned no result' });
    diag.push({ key: 'persist', status: 'skip', detail: 'Nothing to persist' });
    diag.push({ key: 'validate-new', status: 'skip', detail: 'No refreshed token to test' });
  } else {
    diag.push({ key: 'refresh', status: 'skip', detail: 'No refresh token stored' });
    diag.push({ key: 'persist', status: 'skip', detail: 'Nothing to persist' });
    diag.push({ key: 'validate-new', status: 'skip', detail: 'No refreshed token to test' });
  }

  // ── All tiers exhausted — clean up dead tokens ──
  if (storedAccess) {
    await deleteToken(`access:${ticketId}`).catch(() => {});
    delete ticketTokens[ticketId];
  }

  return { token: null, diag };
}

// ─── Ticket OAuth Flow (Authorization Code Grant) ───────────────────────

/**
 * Generate the authorization URL for ticket-scoped OAuth.
 * User opens this in their browser, authorizes, and pastes back the code.
 *
 * @param {Object} instance
 * @param {string} ticketId
 * @returns {string} Authorization URL
 */
export function getTicketAuthUrl(instance, ticketId) {
  const creds = (instance.frontend?.clientId && instance.frontend?.clientSecret)
    ? instance.frontend
    : instance.admin;

  if (!creds?.clientId) {
    throw new Error('No client credentials configured');
  }

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: creds.clientId,
    redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
  });

  return `${instance.url}/!tickets~${ticketId}/oauth2/authorize?${params}`;
}

/**
 * Exchange an authorization code for access + refresh tokens.
 * In dev, routes through /ticket-token-exchange server-side endpoint.
 *
 * @param {Object} instance
 * @param {string} ticketId
 * @param {string} code - Authorization code from browser
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function exchangeTicketCode(instance, ticketId, code) {
  const creds = (instance.frontend?.clientId && instance.frontend?.clientSecret)
    ? instance.frontend
    : instance.admin;

  let data;

  if (isDevMode()) {
    // Route through server-side endpoint
    const res = await fetch(`${window.location.origin}/ticket-token-exchange`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceUrl: instance.url,
        ticketId,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
        code: code.trim(),
        redirectUri: 'urn:ietf:wg:oauth:2.0:oob',
      }),
    });

    data = await res.json();
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.error || `Exchange failed (${res.status})` };
    }
  } else {
    // Production: call Tacton directly
    const tokenUrl = `${instance.url}/!tickets~${ticketId}/oauth2/token`;
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: code.trim(),
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      redirect_uri: 'urn:ietf:wg:oauth:2.0:oob',
    });

    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      credentials: 'omit',
      body: body.toString(),
    });

    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `Token exchange failed (${res.status}): ${text}` };
    }

    const raw = await res.json();
    data = {
      token: raw.access_token,
      refreshToken: raw.refresh_token || null,
      expiresIn: raw.expires_in ?? 3600,
    };
  }

  const expiry = Date.now() + (data.expiresIn - 60) * 1000;

  // Cache in memory
  ticketTokens[ticketId] = { token: data.token, expiry };

  // Persist in Dexie
  await setToken(`access:${ticketId}`, data.token);
  if (data.refreshToken) {
    await setToken(`refresh:${ticketId}`, data.refreshToken);
  }

  return { ok: true };
}

/**
 * Store a manually-provided access token (e.g., from Tacton Admin > Access Tokens).
 *
 * @param {string} ticketId
 * @param {string} accessToken
 */
export async function storeManualTicketToken(ticketId, accessToken) {
  ticketTokens[ticketId] = {
    token: accessToken,
    expiry: Date.now() + 55 * 60 * 1000,
  };
  await setToken(`access:${ticketId}`, accessToken);
}

/**
 * Quick check whether a ticket has any stored token (access or refresh).
 * Does NOT make network calls — just checks Dexie.
 */
export async function hasStoredToken(ticketId) {
  const access = await getToken(`access:${ticketId}`);
  if (access) return true;
  const refresh = await getToken(`refresh:${ticketId}`);
  return !!refresh;
}

// ─── Try Pasted Value as Refresh Token ───────────────────────────────────

/**
 * Try using a pasted value as a refresh token — exchange it, validate the
 * resulting access token, and persist both if valid.
 *
 * Mirrors TactonUtil SAVE_TICKET_TOKEN step 2: if the raw string fails as an
 * access token, attempt a grant_type=refresh_token exchange with it.
 *
 * @param {Object} instance - { url, admin, frontend? }
 * @param {string} ticketId
 * @param {string} rawToken - The pasted string to try as a refresh token
 * @returns {Promise<{ok: boolean, error?: string, note?: string}>}
 */
export async function tryAsRefreshToken(instance, ticketId, rawToken) {
  try {
    const result = isDevMode()
      ? await refreshTicketTokenViaServer(instance, ticketId, rawToken)
      : await refreshTicketTokenDirect(instance, ticketId, rawToken);

    // Trust the exchange result — Tacton may have a brief propagation delay
    // before the new token validates, so persist immediately (same approach
    // as testTicketToken step 4).

    // Cache in memory
    ticketTokens[ticketId] = { token: result.token, expiry: result.expiry };

    // Persist access + refresh tokens
    await setToken(`access:${ticketId}`, result.token);
    await setToken(`refresh:${ticketId}`, result.refreshToken || rawToken);

    return { ok: true, note: 'Refresh token exchanged for access token' };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── Ticket Token Health Check (5-step diagnostic) ──────────────────────

/**
 * Probe a bearer token against the ticket describe endpoint.
 * Returns whether the token is valid (200 + XML body with <resource).
 */
async function probeTicketToken(instance, ticketId, bearerToken) {
  const path = `/!tickets~${ticketId}/api-v2.2/describe`;
  const url = apiUrl(instance.url, path);
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${bearerToken}`,
      'Accept': 'application/xml',
      ...proxyHeaders(instance.url),
    },
    credentials: 'omit',
  });
  const body = await res.text();
  const isHtml = body.trimStart().startsWith('<!DOCTYPE') || body.trimStart().startsWith('<html');
  const ok = res.ok && !isHtml && body.includes('<resource');
  return { ok, status: res.status, length: body.length, isHtml };
}

/**
 * Diag key → UI-friendly step label mapping.
 * @type {Object.<string, string>}
 */
const DIAG_LABELS = {
  'cache-hit':       'Validate Current Token',
  'stored-access':   'Stored Access Token',
  'stored-refresh':  'Stored Refresh Token',
  'frontend-creds':  'Frontend Credentials',
  'validate':        'Validate Current Token',
  'refresh':         'Refresh Token Exchange',
  'persist':         'Persist New Tokens',
  'validate-new':    'Validate New Token',
};

/**
 * Full ticket token health check — thin wrapper around getTicketToken.
 *
 * Delegates ALL probe/refresh/cache logic to getTicketToken (single source
 * of truth), then converts its structured `diag` entries into the UI-friendly
 * `steps` array format for rendering by diagnostic-steps.js.
 *
 * @param {Object} instance - { url, admin, frontend? }
 * @param {string} ticketId
 * @returns {Promise<{status: string, steps: Array<{label: string, status: string, detail: string}>}>}
 */
export async function testTicketToken(instance, ticketId) {
  const { token, diag } = await getTicketToken(instance, ticketId);

  // Convert structured diag entries to UI steps
  const steps = [];
  let hasValidToken = false;
  let hasRefreshed = false;
  let hasStoredAccess = false;
  let hasStoredRefresh = false;

  for (const entry of diag) {
    if (typeof entry === 'string') continue; // Skip legacy plain strings

    const label = DIAG_LABELS[entry.key] || entry.key;
    steps.push({ label, status: entry.status, detail: entry.detail });

    // Track state for overall status
    if (entry.key === 'stored-access' && entry.status === 'pass') hasStoredAccess = true;
    if (entry.key === 'stored-refresh' && entry.status === 'pass') hasStoredRefresh = true;
    if (entry.key === 'validate' && entry.status === 'pass') hasValidToken = true;
    if (entry.key === 'cache-hit' && entry.status === 'pass') hasValidToken = true;
    if (entry.key === 'refresh' && entry.status === 'pass') hasRefreshed = true;
  }

  // If we got a cache hit, the diag only has the cache-hit entry.
  // Backfill the skipped steps so the UI still shows the full picture.
  if (diag.length === 1 && diag[0].key === 'cache-hit') {
    steps.push({ label: 'Refresh Token Exchange', status: 'skip', detail: 'Current token valid — skipping to avoid invalidating active token' });
    steps.push({ label: 'Persist New Tokens', status: 'skip', detail: 'No refresh needed' });
    steps.push({ label: 'Validate New Token', status: 'skip', detail: 'Current token already valid' });
  }

  // If validation passed, backfill the skipped refresh/persist/validate-new steps
  if (hasValidToken && !diag.some(e => e.key === 'cache-hit')) {
    if (!diag.some(e => e.key === 'refresh')) {
      steps.push({ label: 'Refresh Token Exchange', status: 'skip', detail: 'Current token valid — skipping to avoid invalidating active token' });
    }
    if (!diag.some(e => e.key === 'persist')) {
      steps.push({ label: 'Persist New Tokens', status: 'skip', detail: 'No refresh needed' });
    }
    if (!diag.some(e => e.key === 'validate-new')) {
      steps.push({ label: 'Validate New Token', status: 'skip', detail: 'Current token already valid' });
    }
  }

  // ── Overall status ──
  const overallStatus = (hasValidToken || hasRefreshed) ? 'ok'
    : hasStoredRefresh ? 'expired'
    : hasStoredAccess ? 'expired'
    : 'none';

  return { status: overallStatus, steps };
}

// ─── Shared Authorization Flow ─────────────────────────────────────────

/**
 * Unified ticket authorization — 3-tier attempt:
 *   1. Try raw value as direct access token
 *   2. Try as refresh token (dedicated field value, or fall back to raw)
 *   3. Try as authorization code
 *
 * Does NOT overwrite the existing working token until validation succeeds.
 * Both ticket-card and locked-summary auth forms should call this.
 *
 * @param {Object}  instance      - { url, admin, frontend? }
 * @param {string}  ticketId
 * @param {string}  accessValue   - Value from the access token input
 * @param {string}  [refreshValue] - Value from the dedicated refresh token input (optional)
 * @returns {Promise<{ok: boolean, method?: string, error?: string}>}
 */
export async function authorizeTicket(instance, ticketId, accessValue, refreshValue) {
  const raw = accessValue || refreshValue;
  if (!raw) {
    return { ok: false, error: 'No token or code provided' };
  }

  // ── 1. Try as direct access token (without clobbering existing stored token) ──
  // Probe using the raw value directly instead of storing first
  try {
    const probe = await probeTicketToken(instance, ticketId, raw);
    if (probe.ok) {
      // Validated — now persist
      await storeManualTicketToken(ticketId, raw);
      // If a separate refresh token was provided, store it; otherwise
      // try the raw value as a refresh token in the background
      const rt = refreshValue || raw;
      tryAsRefreshToken(instance, ticketId, rt).catch(() => {});
      return { ok: true, method: 'access token' };
    }
  } catch {
    // probe failed — continue to next tier
  }

  // ── 2. Try as refresh token ──
  const rtValue = refreshValue || raw;
  const refreshResult = await tryAsRefreshToken(instance, ticketId, rtValue);
  if (refreshResult.ok) {
    return { ok: true, method: 'refresh token' };
  }

  // ── 3. Try as authorization code ──
  const codeResult = await exchangeTicketCode(instance, ticketId, raw);
  if (codeResult.ok) {
    // Code exchange stores the tokens internally — validate
    const storedAccess = await getToken(`access:${ticketId}`);
    if (storedAccess) {
      const validation = await probeTicketToken(instance, ticketId, storedAccess);
      if (validation.ok) {
        return { ok: true, method: 'auth code' };
      }
      return { ok: false, error: 'Code exchanged but validation failed' };
    }
    // exchangeTicketCode succeeded and stored the token, trust it
    return { ok: true, method: 'auth code' };
  }

  return { ok: false, error: 'Not accepted as access token, refresh token, or auth code' };
}

// ─── Cache Management ───────────────────────────────────────────────────

/**
 * Clear all cached tokens (in-memory + Dexie).
 * Useful on disconnect or instance switch.
 */
export function clearAdminTokenCache(instanceUrl) {
  if (instanceUrl) {
    delete adminTokens[instanceUrl];
    // Also clear persisted tokens in Dexie
    deleteToken(`admin:${instanceUrl}`).catch(() => {});
    deleteToken(`admin:${instanceUrl}:expiry`).catch(() => {});
  } else {
    Object.keys(adminTokens).forEach(k => {
      deleteToken(`admin:${k}`).catch(() => {});
      deleteToken(`admin:${k}:expiry`).catch(() => {});
      delete adminTokens[k];
    });
  }
}

export function clearTicketTokenCache(ticketId) {
  if (ticketId) {
    delete ticketTokens[ticketId];
  } else {
    Object.keys(ticketTokens).forEach(k => delete ticketTokens[k]);
  }
}
