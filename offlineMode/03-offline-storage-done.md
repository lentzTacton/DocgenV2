# Offline Storage — DONE

## File: `src/services/offline/offline-storage.js`

## DB Schema (v4)
- Table: `offlinePackages` — `++id, name, instanceUrl, ticketId, capturedAt`
- Added in `src/core/storage.js` as Dexie v4 migration

## CRUD Functions
- `getAllPackages()` — all packages, newest first
- `getPackage(id)` — single by ID
- `savePackage(pkg)` — create or update
- `deletePackage(id)` — remove by ID

## Export/Import
- `exportPackageAsJson(pkg)` — triggers browser download of .json
- `importPackageFromFile(file)` — from File object (input[type=file])
- `importPackageFromJson(jsonString)` — from raw string

## Helpers
- `estimatePackageSize(pkg)` — human-readable size
- `countRecords(pkg)` — total record count across objects
- `generatePackageName(instanceName, ticketId)` — default name

## Format
- `_format: 'tacton-docgen-offline'` for validation
- `_version: 1` for forward compat
- ID stripped on export, new ID assigned on import
