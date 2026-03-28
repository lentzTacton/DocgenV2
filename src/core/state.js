/**
 * Reactive State Bus
 *
 * Centralized state with path-based subscriptions.
 * Modules subscribe to specific state paths and get notified on changes.
 *
 * Usage:
 *   import state from '../core/state.js';
 *   state.on('connection.status', (value, oldValue) => { ... });
 *   state.set('connection.status', 'connected');
 *   state.get('connection.status'); // 'connected'
 */

const _data = {
  // Zone navigation
  activeZone: 'setup',

  // Connection
  // Global config lock
  config: {
    locked: false,
    autoConnectPending: false, // set by splash to trigger connection-card reconnect
  },

  // Connection
  connection: {
    instanceId: null,
    url: '',
    status: 'disconnected', // disconnected | connecting | connected | restoring | error
    error: null,
  },

  // Tickets
  tickets: {
    list: [],
    included: [],      // IDs of included tickets
    selected: null,     // Currently selected ticket ID
    tokenMap: {},       // { ticketId: { access: bool, refresh: bool } }
    loading: false,
  },

  // Starting object
  startingObject: {
    type: null,         // 'Solution' | 'ConfiguredProduct' | 'Proposal'
    id: null,
    name: null,
    locked: false,
  },

  // Document project
  project: {
    id: null,
    name: null,
    documentId: null,   // Word custom property ID
    loaded: false,
  },

  // AI settings
  ai: {
    apiKey: '',
    apiKeyValid: false,   // true after successful test
    model: 'claude-sonnet-4-5-20250514',
    maxTokens: 2048,
    mode: 'manual',       // 'manual' | 'assisted'
  },

  // Data catalogue (Phase 3)
  variables: [],
  activeVariable: null,
  dataView: 'list',    // 'list' | 'detail' | 'new'
};

const _listeners = new Map();

/**
 * Get a value by dot-path.
 * @param {string} path - e.g. 'connection.status'
 * @returns {*}
 */
function get(path) {
  if (!path) return _data;
  return path.split('.').reduce((obj, key) => {
    return obj != null ? obj[key] : undefined;
  }, _data);
}

/**
 * Set a value by dot-path, notifying subscribers.
 * @param {string} path - e.g. 'connection.status'
 * @param {*} value
 */
function set(path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((obj, key) => {
    if (obj[key] == null) obj[key] = {};
    return obj[key];
  }, _data);

  const oldValue = target[last];
  if (oldValue === value) return; // No change

  target[last] = value;
  _notify(path, value, oldValue);

  // Also notify parent paths (e.g. 'connection' when 'connection.status' changes)
  let partial = '';
  for (const key of path.split('.').slice(0, -1)) {
    partial = partial ? `${partial}.${key}` : key;
    _notify(partial, get(partial), undefined);
  }
}

/**
 * Batch-update multiple paths at once, deferring notifications.
 * @param {Object} updates - { 'connection.status': 'connected', 'connection.url': '...' }
 */
function batch(updates) {
  const changes = [];
  for (const [path, value] of Object.entries(updates)) {
    const keys = path.split('.');
    const last = keys.pop();
    const target = keys.reduce((obj, key) => {
      if (obj[key] == null) obj[key] = {};
      return obj[key];
    }, _data);
    const oldValue = target[last];
    if (oldValue !== value) {
      target[last] = value;
      changes.push([path, value, oldValue]);
    }
  }
  // Notify all at once
  for (const [path, value, oldValue] of changes) {
    _notify(path, value, oldValue);
  }
}

/**
 * Subscribe to changes at a path.
 * @param {string} path - e.g. 'connection.status' or 'connection' (for any child change)
 * @param {Function} callback - (newValue, oldValue) => void
 * @returns {Function} unsubscribe function
 */
function on(path, callback) {
  if (!_listeners.has(path)) {
    _listeners.set(path, new Set());
  }
  _listeners.get(path).add(callback);
  return () => _listeners.get(path)?.delete(callback);
}

/**
 * Subscribe once — automatically unsubscribes after first call.
 */
function once(path, callback) {
  const unsub = on(path, (val, old) => {
    unsub();
    callback(val, old);
  });
  return unsub;
}

function _notify(path, value, oldValue) {
  const set = _listeners.get(path);
  if (set) {
    for (const cb of set) {
      try { cb(value, oldValue); }
      catch (e) { console.error(`[state] Error in listener for "${path}":`, e); }
    }
  }
}

/**
 * Reset state to defaults (for testing / project switch).
 */
function reset() {
  Object.assign(_data, {
    activeZone: 'setup',
    connection: { instanceId: null, url: '', status: 'disconnected', error: null },
    tickets: { list: [], included: [], selected: null, tokenMap: {}, loading: false },
    startingObject: { type: null, id: null, name: null, locked: false },
    project: { id: null, name: null, documentId: null, loaded: false },
    variables: [],
    activeVariable: null,
    dataView: 'list',
  });
}

export default { get, set, batch, on, once, reset };
