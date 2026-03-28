/**
 * Event Bus — Cross-module communication
 *
 * For events that aren't state changes (e.g., 'ticket:authorize',
 * 'variable:created', 'toast:show'). State changes go through state.js.
 *
 * Usage:
 *   import events from '../core/events.js';
 *   events.on('toast:show', ({ message, type }) => { ... });
 *   events.emit('toast:show', { message: 'Saved!', type: 'success' });
 */

const _handlers = new Map();

function on(event, handler) {
  if (!_handlers.has(event)) {
    _handlers.set(event, new Set());
  }
  _handlers.get(event).add(handler);
  return () => _handlers.get(event)?.delete(handler);
}

function once(event, handler) {
  const unsub = on(event, (...args) => {
    unsub();
    handler(...args);
  });
  return unsub;
}

function emit(event, data) {
  const set = _handlers.get(event);
  if (set) {
    for (const handler of set) {
      try { handler(data); }
      catch (e) { console.error(`[events] Error in handler for "${event}":`, e); }
    }
  }
}

function off(event, handler) {
  if (handler) {
    _handlers.get(event)?.delete(handler);
  } else {
    _handlers.delete(event);
  }
}

export default { on, once, emit, off };
