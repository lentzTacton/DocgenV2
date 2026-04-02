# Offline Card — DONE

## File: `src/views/setup/offline-card.js`

## Purpose
Read-only connection cards for loaded offline packages in the setup view.

## Key exports
- `createOfflineCard(container)` — Creates the offline packages section
- `refreshPackageList()` — Reloads packages from IndexedDB and re-renders

## Features
- Lists all offline packages with: name, instance, ticket, date, record count, size
- Active package shown with green dot and checkmark
- Click to activate/deactivate a package
- Export as JSON button per package
- Delete with confirmation dialog (warns if active)
- Import from JSON file (upload button in header)
- Activating a package sets: offlinePackageId, connection.status='connected', tickets, startingObject
- Disconnecting clears all connection state back to defaults
- Listens to `connection.offlinePackageId` state changes to re-render

## State changes on activate
```js
connection.offlinePackageId = pkgId
connection.instanceId = null
connection.url = pkg.instanceUrl
connection.status = 'connected'
tickets.selected = pkg.ticketId
tickets.list = [{ id, summary }]
startingObject.type = pkg.startingObject
startingObject.locked = true
```
