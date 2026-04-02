# Offline Adapter — DONE

## File: `src/services/offline/offline-adapter.js`

## Purpose
Drop-in replacement for data-api.js functions when offline package is active.

## Key functions
- `isOfflineMode()` — checks `connection.offlinePackageId` state
- `clearOfflineCache()` — flushes in-memory cache

## Mirrored data-api functions (all async, return cached data):
- `offlineFetchModel()`
- `offlineGetObjectTypes()` / `offlineGetObjectAttributes(name)` / `offlineGetRefAttributes(name)`
- `offlineFetchRecords(objectName)`
- `offlineFetchBomRecords()` / `offlineGetBomFields()` / `offlineGetBomFieldValues(field)` / `offlineGetBomSources()`
- `offlineDescribeObject(objectName)` / `offlineDescribeObjectWithData(objectName)`
- `offlineGetConfiguredProductList()` / `offlineFetchConfiguredProductData(cpId)` / `offlineIndexConfigAttributes()`
- `offlineGetObjectRecordCount(objectName)` / `offlineGetObjectSampleValues(objectName, attr, max)`
- `offlineResolveCurrentObject(pathSegments, rootOverride)`
- `getOfflinePackageMeta()` — package metadata for display

## Lazy loading
- Loads package from IndexedDB on first access
- Caches in memory until package ID changes
- Falls back to model-derived data where possible
