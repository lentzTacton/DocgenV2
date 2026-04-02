# Integration — DONE

## Files modified

### `src/core/state.js`
- Added `connection.offlinePackageId: null` to default state and reset()

### `src/views/setup/setup-view.js`
- Imported `createOfflineCard` from `./offline-card.js`
- Called `createOfflineCard(connWrap)` after `createConnectionCard(connWrap)`

### `src/services/data-api.js`
- Imported all offline adapter functions from `./offline/offline-adapter.js`
- Added `if (isOfflineMode()) return offline*()` guard at the top of every data function:
  - `isConnected()` — returns true when offline
  - `fetchModel()` → `offlineFetchModel()`
  - `getObjectTypes()` → `offlineGetObjectTypes()`
  - `getObjectAttributes()` → `offlineGetObjectAttributes()`
  - `getRefAttributes()` → `offlineGetRefAttributes()`
  - `fetchRecords()` → `offlineFetchRecords()`
  - `fetchBomRecords()` → `offlineFetchBomRecords()`
  - `getBomFields()` → `offlineGetBomFields()`
  - `getBomFieldValues()` → `offlineGetBomFieldValues()`
  - `getBomSources()` → `offlineGetBomSources()`
  - `describeObject()` → `offlineDescribeObject()`
  - `describeObjectWithData()` → `offlineDescribeObjectWithData()`
  - `getObjectRecordCount()` → `offlineGetObjectRecordCount()`
  - `getObjectSampleValues()` → `offlineGetObjectSampleValues()`
  - `resolveCurrentObject()` → `offlineResolveCurrentObject()`
  - `getConfiguredProductList()` → `offlineGetConfiguredProductList()`
  - `fetchConfiguredProductData()` → `offlineFetchConfiguredProductData()`
- `clearDataCache()` now also clears offline cache when in offline mode

### `src/views/setup/offline-card.js` (NEW)
- Created in previous step (06-offline-card-done.md)
- Shows offline packages in connection card area
- Activate/deactivate, export, import, delete

## How it works
1. User captures data via wizard → saved to IndexedDB
2. Package appears in offline-card.js list
3. User clicks package → `activatePackage()` sets `connection.offlinePackageId`
4. All data-api.js functions check `isOfflineMode()` first
5. If offline, they delegate to offline-adapter.js which reads from cached package data
6. The rest of the app (variable list, explorer, etc.) works transparently
