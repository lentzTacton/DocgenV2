/**
 * DOM Helpers — Lightweight utilities for building UI without a framework.
 *
 * Inspired by TactonUtil's panel pattern. Direct DOM manipulation,
 * but with clean helpers that keep code readable.
 *
 * Usage:
 *   import { el, qs, qsa, html, on, show, hide, toggle } from '../core/dom.js';
 *
 *   const card = el('div', { class: 'card' }, [
 *     el('div', { class: 'card-header' }, 'Title'),
 *     el('div', { class: 'card-body' }, 'Content'),
 *   ]);
 */

/**
 * Create a DOM element.
 * @param {string} tag - Tag name
 * @param {Object|string|null} attrs - Attributes object, or string for textContent
 * @param {Array|string|Element|null} children - Child elements, text, or HTML string
 * @returns {HTMLElement}
 */
export function el(tag, attrs, children) {
  const node = document.createElement(tag);

  // If attrs is a string, treat it as textContent (shorthand)
  if (typeof attrs === 'string') {
    node.textContent = attrs;
    return node;
  }

  // Apply attributes
  if (attrs) {
    for (const [key, val] of Object.entries(attrs)) {
      if (key === 'class' || key === 'className') {
        node.className = val;
      } else if (key === 'style' && typeof val === 'object') {
        Object.assign(node.style, val);
      } else if (key.startsWith('on') && typeof val === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), val);
      } else if (key === 'html') {
        node.innerHTML = val;
      } else if (val != null && val !== false) {
        node.setAttribute(key, val);
      }
    }
  }

  // Append children
  if (children != null) {
    if (typeof children === 'string') {
      node.textContent = children;
    } else if (children instanceof Node) {
      node.appendChild(children);
    } else if (Array.isArray(children)) {
      for (const child of children) {
        if (child == null) continue;
        if (typeof child === 'string') {
          node.appendChild(document.createTextNode(child));
        } else if (child instanceof Node) {
          node.appendChild(child);
        }
      }
    }
  }

  return node;
}

/**
 * Query selector shorthand.
 */
export function qs(selector, root = document) {
  return root.querySelector(selector);
}

/**
 * Query selector all shorthand — returns array.
 */
export function qsa(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

/**
 * Set innerHTML safely (use only with trusted content).
 */
export function html(element, htmlStr) {
  element.innerHTML = htmlStr;
  return element;
}

/**
 * Clear all children from an element.
 */
export function clear(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
  return element;
}

/**
 * Append multiple children to an element.
 */
export function append(parent, ...children) {
  for (const child of children) {
    if (child == null) continue;
    if (typeof child === 'string') {
      parent.appendChild(document.createTextNode(child));
    } else {
      parent.appendChild(child);
    }
  }
  return parent;
}

/**
 * Show/hide/toggle element visibility.
 */
export function show(element, display = '') {
  element.style.display = display;
}

export function hide(element) {
  element.style.display = 'none';
}

export function toggle(element, condition, display = '') {
  element.style.display = condition ? display : 'none';
}

/**
 * Add event listener with auto-cleanup tracking.
 * Returns an unsubscribe function.
 */
export function on(element, event, handler, options) {
  element.addEventListener(event, handler, options);
  return () => element.removeEventListener(event, handler, options);
}

/**
 * Debounce a function.
 */
export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/**
 * Escape HTML entities for safe text insertion.
 */
export function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
