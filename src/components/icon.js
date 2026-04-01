/**
 * SVG Icon Registry
 *
 * Feather/Lucide style icons used throughout the DocGen plugin.
 * All icons use stroke-based rendering with stroke-width="2".
 * Default viewBox is "0 0 24 24" and size parameter defaults to 16.
 */

/**
 * Icon factory function - creates SVG icon functions
 * @param {string} paths - SVG path/shape elements as string
 * @returns {function} Icon function that accepts optional size parameter
 */
function createIcon(paths) {
  return function(size = 16) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  };
}

/**
 * Icon factory for filled icons (e.g., starFilled, drag)
 * @param {string} paths - SVG path/shape elements as string
 * @returns {function} Icon function that accepts optional size parameter
 */
function createFilledIcon(paths) {
  return function(size = 16) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" stroke="none">${paths}</svg>`;
  };
}

// Gear/settings icon
export const settings = createIcon(`
  <circle cx="12" cy="12" r="3"/>
  <path d="M12 1v6m0 6v6M4.22 4.22l4.24 4.24m5.08 5.08l4.24 4.24M1 12h6m6 0h6M4.22 19.78l4.24-4.24m5.08-5.08l4.24-4.24M19.78 19.78l-4.24-4.24m-5.08-5.08l-4.24-4.24"/>
`);

// Angle brackets for code
export const code = createIcon(`
  <polyline points="16 18 22 12 16 6"/>
  <polyline points="8 6 2 12 8 18"/>
`);

// Pen for edit
export const edit = createIcon(`
  <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
  <path d="M18.375 2.625a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4Z"/>
`);

// Eye for preview
export const eye = createIcon(`
  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
  <circle cx="12" cy="12" r="3"/>
`);

// Eye off / hidden
export const eyeOff = createIcon(`
  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
  <path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/>
  <line x1="1" y1="1" x2="23" y2="23"/>
`);

// Database cylinder
export const database = createIcon(`
  <ellipse cx="12" cy="5" rx="9" ry="3"/>
  <path d="M3 5v12a9 3 0 0 0 18 0V5"/>
  <path d="M3 12a9 3 0 0 0 18 0"/>
`);

// Document/file
export const file = createIcon(`
  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
  <polyline points="14 2 14 8 20 8"/>
  <line x1="12" y1="13" x2="8" y2="13"/>
  <line x1="12" y1="17" x2="8" y2="17"/>
`);

// Checkmark
export const check = createIcon(`
  <polyline points="20 6 9 17 4 12"/>
`);

// Check circle / verified
export const checkCircle = createIcon(`
  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
  <polyline points="22 4 12 14.01 9 11.01"/>
`);

// Plus / add
export const plus = createIcon(`
  <line x1="12" y1="5" x2="12" y2="19"/>
  <line x1="5" y1="12" x2="19" y2="12"/>
`);

// X / close
export const x = createIcon(`
  <line x1="18" y1="6" x2="6" y2="18"/>
  <line x1="6" y1="6" x2="18" y2="18"/>
`);

// Chevron right
export const chevronRight = createIcon(`
  <polyline points="9 18 15 12 9 6"/>
`);

// Chevron left
export const chevronLeft = createIcon(`
  <polyline points="15 18 9 12 15 6"/>
`);

// Chevron down
export const chevronDown = createIcon(`
  <polyline points="6 9 12 15 18 9"/>
`);

// Folder
export const folder = createIcon(`
  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
`);

// Folder with plus (new catalogue)
export const folderPlus = createIcon(`
  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
  <line x1="12" y1="11" x2="12" y2="19"/>
  <line x1="8" y1="15" x2="16" y2="15"/>
`);

// Folder open
export const folderOpen = createIcon(`
  <path d="M5 19a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4l2 3h9a2 2 0 0 1 2 2v1M5 19h14a2 2 0 0 0 2-2l1-7H8l-1 7a2 2 0 0 1-2 2z"/>
`);

// Tag
export const tag = createIcon(`
  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
  <line x1="7" y1="7" x2="7.01" y2="7"/>
`);

// Globe (shared)
export const globe = createIcon(`
  <circle cx="12" cy="12" r="10"/>
  <line x1="2" y1="12" x2="22" y2="12"/>
  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
`);

// Search / magnifying glass
export const search = createIcon(`
  <circle cx="11" cy="11" r="8"/>
  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
`);

// Lock
export const lock = createIcon(`
  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
  <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
`);

// Unlock
export const unlock = createIcon(`
  <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
  <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
`);

// Star (outlined)
export const star = createIcon(`
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
`);

// Star (filled)
export const starFilled = createFilledIcon(`
  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
`);

// List / menu lines
export const list = createIcon(`
  <line x1="8" y1="6" x2="21" y2="6"/>
  <line x1="8" y1="12" x2="21" y2="12"/>
  <line x1="8" y1="18" x2="21" y2="18"/>
  <circle cx="3" cy="6" r="1" fill="currentColor"/>
  <circle cx="3" cy="12" r="1" fill="currentColor"/>
  <circle cx="3" cy="18" r="1" fill="currentColor"/>
`);

// Filter funnel
export const filter = createIcon(`
  <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
`);

// Dollar sign
export const dollar = createIcon(`
  <line x1="12" y1="1" x2="12" y2="23"/>
  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
`);

// Bar chart
export const barChart = createIcon(`
  <line x1="12" y1="20" x2="12" y2="10"/>
  <line x1="18" y1="20" x2="18" y2="4"/>
  <line x1="6" y1="20" x2="6" y2="16"/>
`);

// Refresh / reload
export const refresh = createIcon(`
  <polyline points="17 1 21 5 17 9"/>
  <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
  <polyline points="7 23 3 19 7 15"/>
  <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
`);

// Arrow down
export const arrowDown = createIcon(`
  <line x1="12" y1="5" x2="12" y2="19"/>
  <polyline points="19 12 12 19 5 12"/>
`);

// Target / bullseye
export const target = createIcon(`
  <circle cx="12" cy="12" r="10"/>
  <circle cx="12" cy="12" r="3"/>
`);

// Cube / 3D box
export const cube = createIcon(`
  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
`);

// Box / container
export const box = createIcon(`
  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
`);

// Bell / notification
export const bell = createIcon(`
  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
  <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
`);

// Chip / microchip
export const chip = createIcon(`
  <rect x="4" y="4" width="16" height="16" rx="2" ry="2"/>
  <rect x="9" y="9" width="6" height="6" rx="1" ry="1"/>
  <line x1="6" y1="1" x2="6" y2="4"/>
  <line x1="18" y1="1" x2="18" y2="4"/>
  <line x1="6" y1="20" x2="6" y2="23"/>
  <line x1="18" y1="20" x2="18" y2="23"/>
`);

// Clock / time
export const clock = createIcon(`
  <circle cx="12" cy="12" r="10"/>
  <polyline points="12 6 12 12 16 14"/>
`);

// More horizontal / ellipsis
export const moreHorizontal = createIcon(`
  <circle cx="12" cy="12" r="1" fill="currentColor"/>
  <circle cx="5" cy="12" r="1" fill="currentColor"/>
  <circle cx="19" cy="12" r="1" fill="currentColor"/>
`);

// Info
export const info = createIcon(`
  <circle cx="12" cy="12" r="10"/>
  <line x1="12" y1="16" x2="12" y2="12"/>
  <line x1="12" y1="8" x2="12.01" y2="8"/>
`);

// Warning / alert triangle
export const warning = createIcon(`
  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
  <line x1="12" y1="9" x2="12" y2="13"/>
  <line x1="12" y1="17" x2="12.01" y2="17"/>
`);

// Link / chain
export const link = createIcon(`
  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/>
  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
`);

// Ticket
export const ticket = createIcon(`
  <line x1="2" y1="12" x2="7" y2="12"/>
  <line x1="17" y1="12" x2="22" y2="12"/>
  <path d="M7 5v14a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H9a2 2 0 0 0-2 2z"/>
`);

// Drag handle / dots grid
export const drag = createFilledIcon(`
  <circle cx="9" cy="5" r="2"/>
  <circle cx="15" cy="5" r="2"/>
  <circle cx="9" cy="12" r="2"/>
  <circle cx="15" cy="12" r="2"/>
  <circle cx="9" cy="19" r="2"/>
  <circle cx="15" cy="19" r="2"/>
`);

// Table / grid
export const table = createIcon(`
  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
  <line x1="3" y1="9" x2="21" y2="9"/>
  <line x1="3" y1="15" x2="21" y2="15"/>
  <line x1="9" y1="3" x2="9" y2="21"/>
  <line x1="15" y1="3" x2="15" y2="21"/>
`);

// Copy / clipboard
export const copy = createIcon(`
  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
`);

// Trash / delete
export const trash = createIcon(`
  <polyline points="3 6 5 6 21 6"/>
  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
`);

// External link
export const externalLink = createIcon(`
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
  <polyline points="15 3 21 3 21 9"/>
  <line x1="10" y1="14" x2="21" y2="3"/>
`);

// Grid / squares
export const grid = createIcon(`
  <rect x="3" y="3" width="7" height="7"/>
  <rect x="14" y="3" width="7" height="7"/>
  <rect x="14" y="14" width="7" height="7"/>
  <rect x="3" y="14" width="7" height="7"/>
`);

// Arrow right
export const arrowRight = createIcon(`
  <line x1="5" y1="12" x2="19" y2="12"/>
  <polyline points="12 5 19 12 12 19"/>
`);

// Layers (stacked)
export const layers = createIcon(`
  <polygon points="12 2 2 7 12 12 22 7 12 2"/>
  <polyline points="2 17 12 22 22 17"/>
  <polyline points="2 12 12 17 22 12"/>
`);

// Minimize (compress)
export const minimize = createIcon(`
  <polyline points="4 14 10 14 10 20"/>
  <polyline points="20 10 14 10 14 4"/>
  <line x1="14" y1="10" x2="21" y2="3"/>
  <line x1="3" y1="21" x2="10" y2="14"/>
`);

// Hash (#)
export const hash = createIcon(`
  <line x1="4" y1="9" x2="20" y2="9"/>
  <line x1="4" y1="15" x2="20" y2="15"/>
  <line x1="10" y1="3" x2="8" y2="21"/>
  <line x1="16" y1="3" x2="14" y2="21"/>
`);

// Loader / spinner
export const loader = createIcon(`
  <line x1="12" y1="2" x2="12" y2="6"/>
  <line x1="12" y1="18" x2="12" y2="22"/>
  <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/>
  <line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
  <line x1="2" y1="12" x2="6" y2="12"/>
  <line x1="18" y1="12" x2="22" y2="12"/>
  <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/>
  <line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
`);

export const chevronUp = createIcon(`
  <polyline points="18 15 12 9 6 15"/>
`);

export const clipboard = createIcon(`
  <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
  <rect x="8" y="2" width="8" height="4" rx="1" ry="1"/>
`);

export const upload = createIcon(`
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
  <polyline points="17 8 12 3 7 8"/>
  <line x1="12" y1="3" x2="12" y2="15"/>
`);

export const download = createIcon(`
  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
  <polyline points="7 10 12 15 17 10"/>
  <line x1="12" y1="15" x2="12" y2="3"/>
`);

// Hamburger menu (three horizontal lines)
export const menu = createIcon(`
  <line x1="3" y1="6" x2="21" y2="6"/>
  <line x1="3" y1="12" x2="21" y2="12"/>
  <line x1="3" y1="18" x2="21" y2="18"/>
`);

export const zap = createIcon(`
  <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
`);

/**
 * Icon lookup helper - retrieves icon by name
 * @param {string} name - Icon name (e.g., 'settings', 'code', 'edit')
 * @param {number} size - Optional size in pixels (default: 16)
 * @returns {string} SVG HTML string, or empty string if icon not found
 */
export function icon(name, size = 16) {
  const iconMap = {
    settings,
    code,
    edit,
    eye,
    eyeOff,
    database,
    file,
    check,
    checkCircle,
    plus,
    x,
    chevronRight,
    chevronLeft,
    chevronDown,
    folder,
    folderPlus,
    folderOpen,
    tag,
    globe,
    search,
    lock,
    unlock,
    star,
    starFilled,
    list,
    filter,
    dollar,
    barChart,
    refresh,
    arrowDown,
    target,
    cube,
    box,
    bell,
    chip,
    clock,
    moreHorizontal,
    info,
    warning,
    link,
    ticket,
    drag,
    trash,
    table,
    copy,
    externalLink,
    grid,
    arrowRight,
    layers,
    minimize,
    hash,
    loader,
    chevronUp,
    clipboard,
    upload,
    download,
    menu,
    zap,
  };

  const iconFn = iconMap[name];
  return iconFn ? iconFn(size) : '';
}

/**
 * Icon element helper - creates a span with SVG icon
 * @param {string} name - Icon name
 * @param {number} size - Optional size in pixels (default: 16)
 * @returns {HTMLElement} Span element with icon SVG
 */
export function iconEl(name, size = 16) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = icon(name, size);
  return span;
}
