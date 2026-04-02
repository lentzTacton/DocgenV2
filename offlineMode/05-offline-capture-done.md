# Offline Capture Service — DONE

## File: `src/services/offline/offline-capture.js`

## Discovery (wizard step 2)
- `discoverObjectTypes()` — returns `[{name, attributeCount, recordCount}]` sorted
- `hasBomData()` — bool check for BOM availability
- `hasCpData()` — bool check for CP availability

## Capture (wizard step 4)
- `runCapture(config)` — sequential API calls with progress callback
  - config: `{ objectTypes[], captureBom, captureCp, captureDescriptions, onProgress }`
  - onProgress: `(step, total, label, status)` where status = 'fetching'|'done'|'error'
  - returns: `{ data, errors[] }`
  - Captures: model → records → descriptions → BOM → CP (all with error handling)

## Save (wizard step 5)
- `saveCapture(capturedData, meta)` — packages data + metadata, saves to IndexedDB
  - Auto-derives instanceUrl, ticketId, ticketSummary from state if not provided
  - Returns saved package with ID
