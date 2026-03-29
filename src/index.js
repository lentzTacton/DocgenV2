// Import styles
import './styles/variables.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';

// Import app
import { initApp } from './core/app.js';
import { clearAllDataRecords } from './core/storage.js';

// Dev helper: window.resetData() clears all variables/catalogues/sections and reloads
window.resetData = async () => {
  await clearAllDataRecords();
  window.location.reload();
};

// Boot: Office.js ready or standalone (for dev without Word)
if (window.Office) {
  Office.onReady(() => initApp());
} else {
  // Dev mode — no Office.js, just init
  document.addEventListener('DOMContentLoaded', () => initApp());
}
