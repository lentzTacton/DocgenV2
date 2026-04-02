# Offline CSS — DONE

## File: `src/styles/components.css`

## Added sections

### Offline Mode (package list in connection card)
- `.offline-section` — border-top separator
- `.offline-package-list` — scrollable list container (max-height 200px)
- `.offline-pkg-row` — clickable package row (reuses ticket-row pattern)
- `.offline-pkg-icon` — database icon left of name
- `.row-action-active` — blue highlight for active action buttons

### Offline Wizard (5-step capture dialog)
- `.offline-wizard-overlay` — fixed backdrop
- `.offline-wizard` — centered modal container (420px max)
- `.wizard-header` — title + close button
- `.wizard-steps` — dot indicator bar with connectors
- `.wizard-body` — scrollable content area
- `.wizard-source-info` — instance/ticket info card (step 1)
- `.wizard-obj-list` + `.wizard-obj-item` — checkboxable object types (step 2)
- `.wizard-select-bar` — select all/none buttons
- `.wizard-options` + `.wizard-option` — toggle cards for BOM/CP/descriptions (step 3)
- `.wizard-progress-bar` + `.wizard-progress-fill` — animated progress bar (step 4)
- `.wizard-progress-log` + `.wizard-log-item` — per-item capture log
- `.wizard-summary-name` — package name input (step 5)
- `.wizard-stats-table` — summary stats table
- `.wizard-errors` — collapsible error details
- `.wizard-size-estimate` — size label
- `.wizard-footer` — action buttons (Back/Next/Save/Export)
