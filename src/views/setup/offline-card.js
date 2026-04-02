/**
 * Offline Card — Read-Only Connection Cards for Offline Packages
 *
 * Displays loaded offline data packages in the setup view as read-only
 * connection cards. Each package shows:
 *   - Instance info (url, name)
 *   - Ticket it was captured from
 *   - Starting object, capture date, record count
 *   - Select (activate), Export, Delete actions
 *
 * When an offline package is selected as the active connection,
 * the adapter layer (offline-adapter.js) intercepts all data-api calls.
 */

import { el, qs, clear, show, hide } from '../../core/dom.js';
import { iconEl, icon } from '../../components/icon.js';
import state from '../../core/state.js';
import {
  getAllPackages,
  deletePackage,
  exportPackageAsJson,
  getPackage,
  importPackageFromFile,
  estimatePackageSize,
  countRecords,
} from '../../services/offline/offline-storage.js';
import { clearOfflineCache } from '../../services/offline/offline-adapter.js';

let allPackages = [];

/**
 * Create the offline packages section inside the connection card area.
 * @param {HTMLElement} container — Parent element to append into
 */
export function createOfflineCard(container) {
  const offlineHeader = el('div', { class: 'section-header-row', style: { marginTop: '16px' } }, [
    el('span', { class: 'field-label', style: { margin: '0' } }, 'Offline Packages'),
  ]);

  const packageList = el('div', { class: 'offline-package-list', id: 'offline-package-list' });

  const card = el('div', { class: 'offline-section', id: 'offline-section' }, [
    offlineHeader,
    packageList,
  ]);

  container.appendChild(card);

  // Load packages on init
  refreshPackageList();

  // React to offline package changes
  state.on('connection.offlinePackageId', () => {
    renderPackageList();
  });
}

// ─── Package List ──────────────────────────────────────────────────────

export async function refreshPackageList() {
  allPackages = await getAllPackages();
  renderPackageList();
}

function renderPackageList() {
  const listEl = qs('#offline-package-list');
  if (!listEl) return;
  clear(listEl);

  if (!allPackages.length) {
    listEl.appendChild(
      el('div', { class: 'empty-state', style: { fontSize: '12px', padding: '8px 0' } },
        'No offline packages loaded')
    );
    return;
  }

  for (const pkg of allPackages) {
    const isActive = state.get('connection.offlinePackageId') === pkg.id;

    // Status dot
    const dotClass = isActive ? 'token-ok' : 'token-none';
    const dotTitle = isActive ? 'Active offline source' : 'Not active';
    const statusDot = el('span', { class: `ticket-token-dot ${dotClass}`, title: dotTitle });

    // Info
    const instanceName = pkg.instanceName || pkg.instanceUrl || 'Unknown instance';
    const ticketLabel = pkg.ticketId
      ? `Ticket: ${truncate(pkg.ticketId, 16)}`
      : 'No ticket';
    const dateLabel = pkg.capturedAt
      ? new Date(pkg.capturedAt).toLocaleDateString()
      : '';
    const records = countRecords(pkg);
    const sizeLabel = estimatePackageSize(pkg);

    // Action buttons
    const selectBtn = el('button', {
      class: `row-action-btn ${isActive ? 'row-action-active' : ''}`,
      title: isActive ? 'Disconnect offline package' : 'Use this offline package',
      html: icon(isActive ? 'check' : 'database', 14),
      onclick: (e) => {
        e.stopPropagation();
        if (isActive) {
          disconnectOffline();
        } else {
          activatePackage(pkg.id);
        }
      },
    });

    const exportBtn = el('button', {
      class: 'row-action-btn',
      title: 'Export as JSON',
      html: icon('download', 14),
      onclick: (e) => {
        e.stopPropagation();
        handleExportPackage(pkg.id);
      },
    });

    const deleteBtn = el('button', {
      class: 'row-action-btn',
      title: 'Delete package',
      html: icon('trash', 14),
      onclick: (e) => {
        e.stopPropagation();
        handleDeletePackage(pkg.id, pkg.name || instanceName);
      },
    });

    // Package row
    const row = el('div', {
      class: `ticket-row offline-pkg-row ${isActive ? 'ticket-row-selected' : ''}`,
      onclick: () => {
        if (isActive) {
          disconnectOffline();
        } else {
          activatePackage(pkg.id);
        }
      },
    }, [
      el('div', { class: 'offline-pkg-icon', html: icon('database', 16) }),
      el('div', { class: 'ticket-row-left' }, [
        el('span', { class: 'ticket-id' }, pkg.name || instanceName),
        el('span', { class: 'ticket-summary' }, [
          ticketLabel,
          dateLabel ? ` · ${dateLabel}` : '',
          ` · ${records} records`,
          ` · ${sizeLabel}`,
        ].join('')),
      ]),
      el('div', { class: 'ticket-row-right' }, [
        statusDot,
        selectBtn,
        exportBtn,
        deleteBtn,
      ]),
    ]);

    listEl.appendChild(row);
  }
}

// ─── Package Actions ───────────────────────────────────────────────────

async function activatePackage(pkgId) {
  const pkg = await getPackage(pkgId);
  if (!pkg) return;

  // Clear any live connection first
  clearOfflineCache();

  // Set the offline package as the active connection source
  // Instance + ticket become read-only (populated from package)
  // Starting object + AI remain editable
  state.batch({
    'connection.offlinePackageId': pkgId,
    'connection.instanceId': null,
    'connection.url': pkg.instanceUrl || '',
    'connection.status': 'connected',
    'connection.error': null,
    'tickets.selected': pkg.ticketId || null,
    'tickets.list': pkg.ticketId ? [{ id: pkg.ticketId, summary: pkg.ticketSummary || '' }] : [],
    'tickets.included': pkg.ticketId ? [pkg.ticketId] : [],
    'startingObject.type': pkg.startingObject || null,
    'startingObject.id': null,
    'startingObject.name': null,
    'startingObject.locked': false,
  });

  renderPackageList();
}

function disconnectOffline() {
  clearOfflineCache();

  state.batch({
    'connection.offlinePackageId': null,
    'connection.instanceId': null,
    'connection.url': '',
    'connection.status': 'disconnected',
    'connection.error': null,
    'tickets.selected': null,
    'tickets.list': [],
    'tickets.included': [],
    'tickets.tokenMap': {},
    'startingObject.type': null,
    'startingObject.id': null,
    'startingObject.name': null,
    'startingObject.locked': false,
  });

  renderPackageList();
}

async function handleExportPackage(pkgId) {
  const pkg = await getPackage(pkgId);
  if (!pkg) return;
  exportPackageAsJson(pkg);
}

function handleDeletePackage(pkgId, name) {
  const isActive = state.get('connection.offlinePackageId') === pkgId;

  // Confirmation dialog
  const dialog = el('div', { class: 'config-dialog-overlay', id: 'offline-delete-dialog' }, [
    el('div', { class: 'config-dialog' }, [
      el('div', { class: 'config-dialog-header' }, [
        el('span', { class: 'icon', html: icon('trash', 18) }),
        el('span', {}, 'Delete Offline Package'),
      ]),
      el('div', { class: 'config-dialog-body' }, [
        el('p', { style: { margin: '0 0 8px', fontSize: '13px', color: '#374151' } },
          `Delete "${truncate(name, 30)}"?`),
        isActive
          ? el('p', { style: { margin: '0', fontSize: '12px', color: '#dc2626' } },
              'This package is currently active. Deleting it will disconnect.')
          : el('p', { style: { margin: '0', fontSize: '12px', color: '#6b7280' } },
              'This action cannot be undone.'),
      ]),
      el('div', { class: 'config-dialog-actions' }, [
        el('button', { class: 'btn btn-secondary', onclick: () => dialog.remove() }, 'Cancel'),
        el('button', { class: 'btn btn-danger', onclick: async () => {
          dialog.remove();
          if (isActive) disconnectOffline();
          await deletePackage(pkgId);
          allPackages = await getAllPackages();
          renderPackageList();
        }}, 'Delete'),
      ]),
    ]),
  ]);

  (qs('.taskpane') || document.body).appendChild(dialog);
}

function handleImportPackage() {
  const input = el('input', {
    type: 'file',
    accept: '.json',
    style: { display: 'none' },
  });

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      const pkg = await importPackageFromFile(file);
      allPackages = await getAllPackages();
      renderPackageList();

      // Brief success feedback
      const listEl = qs('#offline-package-list');
      if (listEl) {
        const toast = el('div', {
          class: 'status-message status-success',
          style: { margin: '4px 0', fontSize: '12px' },
        }, `Imported "${truncate(pkg.name || 'package', 30)}"`);
        listEl.prepend(toast);
        setTimeout(() => toast.remove(), 3000);
      }
    } catch (e) {
      const listEl = qs('#offline-package-list');
      if (listEl) {
        const toast = el('div', {
          class: 'status-message status-error',
          style: { margin: '4px 0', fontSize: '12px' },
        }, `Import failed: ${e.message}`);
        listEl.prepend(toast);
        setTimeout(() => toast.remove(), 5000);
      }
    }
  });

  document.body.appendChild(input);
  input.click();
  input.remove();
}

// ─── Helpers ───────────────────────────────────────────────────────────

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}
