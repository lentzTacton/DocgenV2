/**
 * CORS Proxy Helpers
 *
 * In development (localhost), all requests to Tacton instances hit CORS.
 * Two strategies are used:
 *
 *   1. OAuth token fetches — routed to server-side Express endpoints
 *      (/verify-connection, /ticket-token, etc.) which call Tacton directly
 *      from Node.js, completely avoiding browser CORS.
 *
 *   2. Data API calls — routed through webpack-dev-server's built-in proxy
 *      at /tacton-proxy/* with an X-Proxy-Target header that tells the proxy
 *      where to forward the request.
 *
 * In production (deployed Word Add-in), requests go direct since the add-in
 * origin will be whitelisted in Tacton's CORS config.
 */

const isDev = typeof window !== 'undefined' &&
  window.location.hostname === 'localhost';

/**
 * Whether we're running in development mode (localhost).
 * @returns {boolean}
 */
export function isDevMode() {
  return isDev;
}

/**
 * Build a URL for data API calls that routes through the proxy in dev.
 *
 * In dev: /tacton-proxy/api/ticket/list  (proxy strips prefix, forwards to target)
 * In prod: https://instance.tacton.com/api/ticket/list
 *
 * @param {string} instanceUrl - The Tacton instance base URL
 * @param {string} path - API path, e.g. '/api/ticket/list'
 * @returns {string} The URL to fetch
 */
export function apiUrl(instanceUrl, path) {
  if (isDev) {
    return `${window.location.origin}/tacton-proxy${path}`;
  }
  return `${instanceUrl}${path}`;
}

/**
 * Get extra headers needed for proxied requests in dev.
 * The X-Proxy-Target header tells the proxy which instance to forward to.
 *
 * @param {string} instanceUrl - The Tacton instance base URL
 * @returns {Object} Headers object (empty in production)
 */
export function proxyHeaders(instanceUrl) {
  if (isDev) {
    return { 'X-Proxy-Target': instanceUrl };
  }
  return {};
}
