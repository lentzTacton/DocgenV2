# Offline Mode — Design Plan

## New Files

### Services
- `src/services/offline/offline-storage.js` — Dexie table, CRUD, export/import JSON
- `src/services/offline/offline-capture.js` — Wizard logic: discover, fetch, validate, package
- `src/services/offline/offline-adapter.js` — Drop-in adapter for data-api.js when offline

### Views
- `src/views/setup/offline-wizard.js` — Guided capture wizard UI
- `src/views/setup/offline-card.js` — Read-only connection card for loaded packages

### Styles
- `src/styles/offline.css` — Wizard + card styles (imported in main CSS)

## Wizard Flow (5 steps)

### Step 1: Source Selection
- Pick from connected instances (must be online to capture)
- Pick ticket from that instance
- Shows instance URL + ticket ID + summary

### Step 2: Data Discovery
- Fetches model tree from API
- Shows all object types with checkboxes
- Auto-checks objects referenced by existing document expressions
- "Select all" / "Select none" buttons
- Shows record count next to each object type

### Step 3: Capture Options
- BOM data: checkbox (auto-checked if BOM objects found)
- Configured Products: checkbox (auto-checked if CP references found)
- Object descriptions: checkbox (always on, lightweight)
- BOM sources discovery: checkbox (recommended)

### Step 4: Capture Progress
- Sequential API calls with progress bar
- Per-item status: pending → fetching → done / error
- Retry button for failed items
- Shows total records captured + estimated size

### Step 5: Summary & Save
- Package name (auto-generated: "{instance} — {ticket} — {date}")
- Table of captured data: object types, record counts, BOM fields, CP count
- Total size estimate
- "Save Package" button → stores in IndexedDB
- "Export JSON" button → downloads .json file
- "Save & Export" button → both

## Offline Adapter (offline-adapter.js)

When an offline package is active, data-api.js routes through the adapter:

```javascript
// Intercept pattern in data-api.js:
import { isOfflineMode, getOfflineData } from './offline/offline-adapter.js';

// In each function:
export async function fetchModel() {
  if (isOfflineMode()) return getOfflineData().model;
  // ... existing API call
}
```

The adapter reads from state:
- `connection.offlinePackageId` — if set, we're in offline mode
- Loads the package data from IndexedDB once, caches in memory

## Connection Card Integration

### Package display in instance list
- Offline packages shown in a separate section: "Offline Packages"
- Each row shows: name, instance URL, ticket, capture date
- Badge: "OFFLINE" in gray
- Actions: Select, Export, Delete (no Edit)

### Selecting an offline package
Sets state:
```javascript
connection.instanceId = `offline:${package.id}`
connection.url = package.instanceUrl
connection.status = 'connected'
connection.offlinePackageId = package.id
tickets.selected = package.ticketId
startingObject.type = package.startingObject
```

### Locked summary shows
- "Offline: {packageName}"
- Source: {instanceUrl}
- Ticket: {ticketId}
- Captured: {date}
- Read-only badge

## State Changes

Add to default state:
```javascript
connection: {
  ...existing,
  offlinePackageId: null,  // set when using offline data
}
```

## DB Migration

Bump Dexie version to 4:
```javascript
db.version(4).stores({
  ...existing v3 tables,
  offlinePackages: '++id, name, instanceUrl, ticketId, capturedAt',
});
```
