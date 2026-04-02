# Offline Mode — Architecture Analysis

## Current Connection Flow

1. **Instance** (connection-card.js) — User adds Tacton CPQ instance with URL + OAuth creds
2. **Ticket** (ticket-card.js) — User selects ticket, authorizes with token
3. **Starting Object** (starting-object-card.js) — User picks root object type (Solution, etc.)
4. **AI** (optional) — API key for AI-assisted generation

State keys:
- `connection.instanceId`, `connection.url`, `connection.status`
- `tickets.list`, `tickets.selected`, `tickets.tokenHealth`
- `startingObject.type`

## Data API Functions (data-api.js)

All functions read from `connection.instanceId` + `tickets.selected` state keys.

| Function | Returns | Capturable |
|----------|---------|-----------|
| `fetchModel()` | `[{name, attributes: [{name,type,refType}], listUrl}]` | Yes — object tree |
| `getObjectTypes()` | `string[]` | Yes — derived from model |
| `getObjectAttributes(objectName)` | `[{name,type,refType}]` | Yes — from model |
| `fetchRecords(objectName)` | `[]` records | Yes — actual data rows |
| `fetchBomRecords()` | `[]` BOM line items | Yes — BOM data |
| `getBomFields()` | `string[]` field names | Yes — derived from BOM |
| `getBomSources()` | `[{name, expression, count, objectName, category, description}]` | Yes — discovery |
| `describeObject(objectName)` | `{forwardRefs, reverseRefs, attributes}` | Yes — object structure |
| `getConfiguredProductList()` | CP list | Yes — configured products |
| `fetchConfiguredProductData(cpId)` | parsed CP XML tree | Yes — CP attribute data |
| `indexConfigAttributes()` | `{cpId: {attrName: value}}` | Yes — flattened CP attrs |

## Storage Schema (storage.js — Dexie)

Current tables (v3):
- `instances` — `++id, name, url`
- `tokens` — `key` (encrypted)
- `projects` — `id, documentId, instanceId, updatedAt`
- `tickets` — `[projectId+ticketId], projectId`
- `variables` — `++id, projectId, name, type, order, sectionId, catalogueId`
- `catalogues` — `++id, projectId, scope, name, order`
- `sections` — `++id, catalogueId, projectId, name, order`
- `settings` — `key`

## Offline Package — Proposed New Table

```
offlinePackages: '++id, name, instanceUrl, ticketId, capturedAt'
```

Each row stores:
```javascript
{
  id,                    // auto-increment
  name,                  // user-supplied label
  instanceUrl,           // source instance URL
  instanceName,          // source instance display name
  ticketId,              // ticket it was captured from
  ticketSummary,         // ticket display name
  startingObject,        // root object type at capture time
  capturedAt,            // timestamp
  capturedBy,            // optional user identifier
  version,               // schema version for forward compat
  data: {
    model,               // fetchModel() result
    records: {},         // { objectName: [...records] }
    bomRecords,          // fetchBomRecords() result
    bomFields,           // getBomFields() result
    bomSources,          // getBomSources() result
    descriptions: {},    // { objectName: describeObject() result }
    configuredProducts,  // getConfiguredProductList() result
    cpData: {},          // { cpId: fetchConfiguredProductData() result }
    cpAttributes: {},    // indexConfigAttributes() result
  }
}
```

## Integration Points

### As a "connection type" in setup-view
- Shows alongside real instances in connection-card
- Read-only — can't edit URL/creds
- Selecting an offline package sets `connection.status = 'connected'` (offline)
- data-api.js needs an offline adapter that returns cached data instead of API calls

### In ticket-card
- Offline package has a fixed ticket — no selection needed
- Token health: always "offline" badge (no token check)

### Delete flow
- Same as normal instance delete — remove from DB, cascade cleanup

### Export/Import
- Export: JSON download of the full package row
- Import: parse JSON, insert into offlinePackages table
