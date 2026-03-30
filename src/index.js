// Import styles
import './styles/variables.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';

// Import app
import { initApp } from './core/app.js';
import { clearAllDataRecords } from './core/storage.js';
import state from './core/state.js';

// Dev helper: window.resetData() clears all variables/catalogues/sections and reloads
window.resetData = async () => {
  await clearAllDataRecords();
  window.location.reload();
};

// ─── Browser Dev Panel (state inspector) ────────────────────────────────
// Only active when body has class "browser-dev".
// Toggle with Ctrl+Shift+D (or Cmd+Shift+D on Mac).
function initBrowserDevPanel() {
  if (!document.body.classList.contains('browser-dev')) return;

  const panel = document.createElement('div');
  panel.className = 'browser-dev-panel';
  panel.innerHTML = `<div class="panel-title">State Inspector  (F2 to toggle)</div><pre id="dev-state-json"></pre>`;
  document.body.appendChild(panel);

  function refresh() {
    const pre = document.getElementById('dev-state-json');
    if (pre) pre.textContent = JSON.stringify(state.get(), null, 2);
  }

  // Refresh whenever any top-level key changes
  ['activeZone', 'connection', 'tickets', 'startingObject', 'project', 'ai', 'variables', 'activeVariable', 'dataView', 'config']
    .forEach(key => state.on(key, () => setTimeout(refresh, 0)));

  document.addEventListener('keydown', (e) => {
    // F2 or Ctrl+Shift+S toggles the state inspector
    const isToggle = e.key === 'F2' || ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S');
    if (isToggle) {
      e.preventDefault();
      panel.classList.toggle('is-open');
      if (panel.classList.contains('is-open')) refresh();
    }
  });
}

// Boot: Office.js ready or standalone (for dev without Word)
if (window.Office) {
  Office.onReady(() => initApp());
} else {
  // Browser dev mode — no Office.js
  document.addEventListener('DOMContentLoaded', () => {
    initApp();
    initBrowserDevPanel();
  });
}
