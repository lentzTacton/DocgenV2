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
 * Caches in memory; refreshes automatically when expired.
 * In dev, routes through server-side endpoint to avoid CORS.
 *
 * @param {Object} instance - { url, admin: { clientId, clientSecret } }
 * @returns {Promise<string>} Access token
 */
export async function ensureAdminToken(instance) {
  const cached = adminTokens[instance.url];
  if (cached && Date.now() < cached.expiry) {
    return cached.token;
  }

  if (!instance.admin?.clientId || !instance.admin?.clientSecret) {
    throw new Error('No admin credentials configured for this instance');
  }

  const result = isDevMode()
    ? await getAdminTokenViaServer(instance)
    : await getAdminTokenDirect(instance);

  adminTokens[instance.url] = result;
  return result.token;
}

/**
 * Test whether admin credentials are valid by attempting a token exchange.
 * @param {Object} instance
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function testAdminCredentials(instance) {
  try {
    await ensureAdminToken(instance);
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
 * Resolve a ticket-scoped access token using 3-tier fallback.
 *
 * Tier 1: In-memory cache (fastest, survives taskpane lifetime)
 * Tier 2: Refresh token exchange (persistent via Dexie)
 * Tier 3: Stored access token fallback (may be expired server-side)
 *
 * @param {Object} instance - { url, admin, frontend? }
 * @param {string} ticketId - e.g. "T-00001"
 * @returns {Promise<{token: string|null, diag: string[]}>}
 */
export async function getTicketToken(instance, ticketId) {
  const diag = [];

  // ── Tier 1: In-memory cache ──
  const cached = ticketTokens[ticketId];
  if (cached && Date.now() < cached.expiry) {
    diag.push('In-memory cache hit');
    return { token: cached.token, diag };
  }
  diag.push('No valid in-memory token');

  // ── Tier 2: Refresh token exchange ──
  const refreshKey = `refresh:${ticketId}`;
  const savedRefresh = await getToken(refreshKey);

  if (savedRefresh) {
    diag.push('Attempting refresh token exchange…');
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

      diag.push('Refresh token exchange succeeded');
      return { token: result.token, diag };
    } catch (e) {
      diag.push(`Refresh failed: ${e.message}`);
    }
  } else {
    diag.push('No refresh token stored');
  }

  // ── Tier 3: Stored access token ──
  const storedAccess = await getToken(`access:${ticketId}`);
  if (storedAccess) {
    diag.push('Using stored access token (may be expired)');
    ticketTokens[ticketId] = {
      token: storedAccess,
      expiry: Date.now() + 5 * 60 * 1000, // Re-check in 5 min
    };
    return { token: storedAccess, diag };
  }

  diag.push('No token available — authorization required');
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

    // Verify the new access token actually works
    const probe = await probeTicketToken(instance, ticketId, result.token);
    if (!probe.ok) {
      return { ok: false, error: 'Refreshed token failed validation' };
    }

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
 * Full 5-step ticket token health check — mirrors TactonUtil TEST_TICKET_TOKEN.
 *
 * Steps:
 *   1. Check stored tokens (access + refresh)
 *   2. Validate current access token against describe endpoint
 *   3. Refresh token exchange
 *   4. Validate refreshed token
 *   5. Persist new tokens if valid
 *
 * @param {Object} instance - { url, admin, frontend? }
 * @param {string} ticketId
 * @returns {Promise<{status: string, steps: Array<{label: string, status: string, detail: string}>}>}
 */
export async function testTicketToken(instance, ticketId) {
  const steps = [];

  // ── Step 1: Check stored tokens ──
  const storedAccess = await getToken(`access:${ticketId}`);
  const storedRefresh = await getToken(`refresh:${ticketId}`);
  const hasFrontend = !!(instance.frontend?.clientId && instance.frontend?.clientSecret);

  steps.push({
    label: 'Stored Access Token',
    status: storedAccess ? 'pass' : 'fail',
    detail: storedAccess ? storedAccess.substring(0, 12) + '…' : 'None stored',
  });
  steps.push({
    label: 'Stored Refresh Token',
    status: storedRefresh ? 'pass' : 'fail',
    detail: storedRefresh ? storedRefresh.substring(0, 12) + '…' : 'None stored',
  });
  steps.push({
    label: 'Frontend Credentials',
    status: hasFrontend ? 'pass' : 'skip',
    detail: hasFrontend
      ? `Client ID: ${instance.frontend.clientId.substring(0, 12)}…`
      : 'Not configured (using admin)',
  });

  // ── Step 2: Validate current access token ──
  let currentTokenValid = false;
  if (storedAccess) {
    try {
      const probe = await probeTicketToken(instance, ticketId, storedAccess);
      currentTokenValid = probe.ok;
      steps.push({
        label: 'Validate Current Token',
        status: probe.ok ? 'pass' : 'fail',
        detail: probe.ok
          ? `${probe.status} (${probe.length}b)`
          : `HTTP ${probe.status} (${probe.length}b${probe.isHtml ? ', HTML redirect' : ''})`,
      });
    } catch (e) {
      steps.push({ label: 'Validate Current Token', status: 'fail', detail: e.message });
    }
  } else {
    steps.push({ label: 'Validate Current Token', status: 'skip', detail: 'No token to test' });
  }

  // ── Step 3: Refresh token exchange ──
  let refreshedToken = null;
  let newRefreshToken = null;
  if (storedRefresh) {
    try {
      const result = isDevMode()
        ? await refreshTicketTokenViaServer(instance, ticketId, storedRefresh)
        : await refreshTicketTokenDirect(instance, ticketId, storedRefresh);

      refreshedToken = result.token;
      newRefreshToken = result.refreshToken || null;
      const expiryMin = Math.round((result.expiry - Date.now()) / 60000);
      steps.push({
        label: 'Refresh Token Exchange',
        status: 'pass',
        detail: `New access token (expires: ${expiryMin}min)${newRefreshToken ? ', refresh rotated' : ''}`,
      });
    } catch (e) {
      steps.push({ label: 'Refresh Token Exchange', status: 'fail', detail: e.message });
    }
  } else {
    steps.push({ label: 'Refresh Token Exchange', status: 'skip', detail: 'No refresh token stored' });
  }

  // ── Step 4: Validate refreshed token ──
  let refreshedTokenValid = false;
  if (refreshedToken) {
    try {
      const probe = await probeTicketToken(instance, ticketId, refreshedToken);
      refreshedTokenValid = probe.ok;
      steps.push({
        label: 'Validate New Token',
        status: probe.ok ? 'pass' : 'fail',
        detail: probe.ok
          ? `${probe.status} (${probe.length}b)`
          : `HTTP ${probe.status} (${probe.length}b)`,
      });
    } catch (e) {
      steps.push({ label: 'Validate New Token', status: 'fail', detail: e.message });
    }
  } else {
    steps.push({ label: 'Validate New Token', status: 'skip', detail: 'No refreshed token to test' });
  }

  // ── Step 5: Persist if the refreshed token works ──
  if (refreshedTokenValid) {
    try {
      // Update in-memory cache
      ticketTokens[ticketId] = {
        token: refreshedToken,
        expiry: Date.now() + 3500000, // ~58 min
      };
      // Persist access token
      await setToken(`access:${ticketId}`, refreshedToken);
      // Persist new refresh token if rotated
      if (newRefreshToken) {
        await setToken(`refresh:${ticketId}`, newRefreshToken);
      }
      steps.push({
        label: 'Persist New Tokens',
        status: 'pass',
        detail: `Access token updated${newRefreshToken ? ', refresh token rotated' : ''}`,
      });
    } catch (e) {
      steps.push({ label: 'Persist New Tokens', status: 'fail', detail: e.message });
    }
  } else if (refreshedToken) {
    steps.push({ label: 'Persist New Tokens', status: 'fail', detail: 'Refreshed token invalid — kept old tokens' });
  } else {
    steps.push({ label: 'Persist New Tokens', status: 'skip', detail: 'Nothing to persist' });
  }

  // ── Overall status ──
  const overallStatus = refreshedTokenValid ? 'ok'
    : currentTokenValid ? 'warn'
    : storedRefresh ? 'expired'
    : storedAccess ? 'expired'
    : 'none';

  return { status: overallStatus, steps };
}

// ─── Cache Management ───────────────────────────────────────────────────

/**
 * Clear all cached tokens (in-memory + Dexie).
 * Useful on disconnect or instance switch.
 */
export function clearAdminTokenCache(instanceUrl) {
  if (instanceUrl) {
    delete adminTokens[instanceUrl];
  } else {
    Object.keys(adminTokens).forEach(k => delete adminTokens[k]);
  }
}

export function clearTicketTokenCache(ticketId) {
  if (ticketId) {
    delete ticketTokens[ticketId];
  } else {
    Object.keys(ticketTokens).forEach(k => delete ticketTokens[k]);
  }
}
