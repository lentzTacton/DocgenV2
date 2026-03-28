/**
 * Ticket Card — Ticket Selection & Authorization
 *
 * Features:
 *   - Search / filter tickets by ID, summary, or owner
 *   - Star favorites — persisted to Dexie, always sorted to top
 *   - Status badges with "In Progress" priority sorting
 *   - Token status dot per ticket (green = token, gray = none)
 *   - Clicking a ticket shows the auth input for that ticket
 */

import { el, qs, clear } from '../../core/dom.js';
import { iconEl, icon } from '../../components/icon.js';
import state from '../../core/state.js';
import events from '../../core/events.js';
import { listTickets } from '../../services/api.js';
import {
  getTicketToken,
  getTicketAuthUrl,
  exchangeTicketCode,
  storeManualTicketToken,
} from '../../services/auth.js';
import { ticketFetch } from '../../services/api.js';
import { getInstance, loadFavorites, saveFavorites } from '../../core/storage.js';

let favs = new Set();

// Token status cache: ticketId → 'ok' | 'none' | 'checking' | 'error'
let tokenStatus = {};

// Visually highlighted ticket (not yet confirmed via token)
let highlightedTicketId = null;

// Map raw API status → display label + badge class
const STATUS_MAP = {
  'in-progress':  { label: 'In Progress', badge: 'badge-success' },
  'inprogress':   { label: 'In Progress', badge: 'badge-success' },
  'in progress':  { label: 'In Progress', badge: 'badge-success' },
  'open':         { label: 'Open',        badge: 'badge-info' },
  'new':          { label: 'New',         badge: 'badge-info' },
  'committed':    { label: 'Committed',   badge: 'badge-muted' },
  'done':         { label: 'Done',        badge: 'badge-muted' },
  'discarded':    { label: 'Discarded',   badge: 'badge-muted' },
  'closed':       { label: 'Closed',      badge: 'badge-muted' },
};

function resolveStatus(raw) {
  const key = (raw || '').toLowerCase().trim();
  return STATUS_MAP[key] || { label: raw || 'Open', badge: 'badge-info' };
}

const INACTIVE = new Set(['committed', 'done', 'discarded', 'closed']);

/**
 * Create the ticket management card.
 * @param {HTMLElement} container
 */
export function createTicketCard(container) {
  // ── Search input ──
  const searchInput = el('input', {
    class: 'input ticket-search-input',
    id: 'ticket-search',
    type: 'text',
    placeholder: 'Search tickets…',
    oninput: () => renderTicketList(state.get('tickets.list') || [], searchInput.value),
  });

  const searchRow = el('div', {
    class: 'ticket-search-row',
    id: 'ticket-search-row',
    style: { display: 'none' },
  }, [
    el('span', { class: 'ticket-search-icon', html: icon('search', 14) }),
    searchInput,
  ]);

  const ticketList = el('div', { class: 'ticket-list', id: 'ticket-list' }, [
    el('div', { class: 'empty-state' }, 'Connect to an instance first'),
  ]);

  const refreshBtn = el('button', {
    class: 'btn btn-sm btn-ghost',
    id: 'ticket-refresh-btn',
    html: `${icon('refresh', 14)} Refresh`,
    onclick: handleRefreshTickets,
    style: { display: 'none' },
  });

  const statusMsg = el('div', {
    class: 'status-message',
    id: 'ticket-status',
    style: { display: 'none' },
  });

  // Auth flow section (hidden until a ticket is clicked)
  const authSection = el('div', {
    id: 'ticket-auth-section',
    class: 'ticket-auth-section',
    style: { display: 'none' },
  }, [
    el('div', { class: 'ticket-auth-header' }, [
      el('span', { class: 'ticket-auth-title', id: 'ticket-auth-title' }, 'Authorize Ticket'),
      el('button', {
        class: 'ticket-auth-link',
        id: 'ticket-auth-open-btn',
        html: `Get token ${icon('externalLink', 12)}`,
        onclick: handleOpenAuthUrl,
      }),
    ]),
    el('div', { class: 'ticket-auth-input-row' }, [
      el('input', {
        class: 'input',
        id: 'ticket-auth-code',
        type: 'text',
        placeholder: 'Paste token or auth code',
      }),
      el('button', {
        class: 'btn btn-sm btn-primary',
        id: 'ticket-auth-submit-btn',
        onclick: handleSubmitAuth,
      }, 'Authorize'),
    ]),
  ]);

  const card = el('div', { class: 'card', id: 'ticket-card' }, [
    el('div', { class: 'card-header' }, [
      el('div', { class: 'card-header-left' }, [
        iconEl('file', 20),
        el('div', {}, [
          el('div', { class: 'card-title' }, 'Tickets'),
          el('div', { class: 'card-subtitle' }, 'Select a ticket and provide an access token'),
        ]),
      ]),
      refreshBtn,
    ]),
    el('div', { class: 'card-body' }, [
      searchRow,
      ticketList,
      authSection,
      statusMsg,
      el('div', { class: 'card-actions', id: 'ticket-card-actions' }),
    ]),
  ]);

  container.appendChild(card);

  // Load favorites from Dexie
  loadFavorites('tickets').then(f => { favs = f; });

  // When connection is established, load tickets
  events.on('connection:established', () => {
    handleRefreshTickets();
  });

  state.on('connection.status', (status) => {
    const btn = qs('#ticket-refresh-btn');
    const search = qs('#ticket-search-row');
    if (status === 'connected') {
      if (btn) btn.style.display = '';
      handleRefreshTickets();
    } else {
      if (btn) btn.style.display = 'none';
      if (search) search.style.display = 'none';
      highlightedTicketId = null;
      tokenStatus = {};
      hideAuthSection();
      clear(qs('#ticket-list'));
      qs('#ticket-list').appendChild(
        el('div', { class: 'empty-state' }, 'Connect to an instance first')
      );
    }
  });
}

// ─── Handlers ───────────────────────────────────────────────────────────

async function handleRefreshTickets() {
  const instanceId = state.get('connection.instanceId');
  if (!instanceId) return;

  const instance = await getInstance(instanceId);
  if (!instance) return;

  const listEl = qs('#ticket-list');
  clear(listEl);
  listEl.appendChild(el('div', { class: 'loading-state' }, 'Loading tickets…'));

  state.set('tickets.loading', true);

  const result = await listTickets(instance);

  state.set('tickets.loading', false);

  if (!result.ok) {
    clear(listEl);
    listEl.appendChild(el('div', { class: 'error-state' }, `Failed: ${result.error}`));
    return;
  }

  state.set('tickets.list', result.tickets);

  // Show search bar once we have tickets
  const search = qs('#ticket-search-row');
  if (search) search.style.display = result.tickets.length > 0 ? '' : 'none';

  // Reload favorites
  favs = await loadFavorites('tickets');

  // Check token status for all tickets in the background
  tokenStatus = {};
  renderTicketList(result.tickets);
  checkAllTokens(instance, result.tickets);

  // Auto-select first favorite ticket (or first ticket if none favorited)
  // Only highlight — confirmTicketSelection happens inside handleSelectTicket
  // if the ticket already has a valid token
  if (!state.get('tickets.selected') && result.tickets.length > 0) {
    const firstFav = result.tickets.find(t => favs.has(t.id));
    const autoSelect = firstFav || result.tickets[0];
    if (autoSelect) {
      handleSelectTicket(autoSelect);
    }
  }
}

/**
 * Check token availability and validity for all tickets (background, non-blocking).
 * For each ticket:
 *   - No token → gray dot ('none')
 *   - Has token, API responds OK → green dot ('ok')
 *   - Has token, API fails (401/403/error) → red dot ('error')
 * Updates the token dot on each row as results come in.
 */
async function checkAllTokens(instance, tickets) {
  for (const ticket of tickets) {
    tokenStatus[ticket.id] = 'checking';
    updateTokenDot(ticket.id);

    try {
      const { token } = await getTicketToken(instance, ticket.id);
      if (!token) {
        tokenStatus[ticket.id] = 'none';
      } else {
        // Validate by hitting the describe endpoint
        const result = await ticketFetch(instance, ticket.id, 'api-v2.2/describe');
        tokenStatus[ticket.id] = result.ok ? 'ok' : 'error';
      }
    } catch {
      tokenStatus[ticket.id] = 'error';
    }
    // Update just the dot for this ticket
    updateTokenDot(ticket.id);

    // If this is the highlighted ticket and it now has a valid token, auto-confirm
    if (ticket.id === highlightedTicketId && tokenStatus[ticket.id] === 'ok' && !state.get('tickets.selected')) {
      confirmTicketSelection(ticket.id);
    }
  }
}

const TOKEN_TITLES = {
  ok: 'Token valid',
  none: 'No token',
  checking: 'Checking token…',
  error: 'Token invalid',
};

function updateTokenDot(ticketId) {
  const dot = document.querySelector(`[data-token-dot="${ticketId}"]`);
  if (!dot) return;
  const status = tokenStatus[ticketId] || 'none';
  dot.className = `ticket-token-dot token-${status}`;
  dot.title = TOKEN_TITLES[status] || 'No token';
}

function renderTicketList(tickets, filter) {
  const listEl = qs('#ticket-list');
  clear(listEl);

  if (!tickets.length) {
    listEl.appendChild(el('div', { class: 'empty-state' }, 'No tickets found'));
    return;
  }

  // Filter
  const lowerFilter = (filter || '').toLowerCase();
  const filtered = lowerFilter
    ? tickets.filter(t =>
        (t.id || '').toLowerCase().includes(lowerFilter) ||
        (t.summary || '').toLowerCase().includes(lowerFilter) ||
        (t.owner || '').toLowerCase().includes(lowerFilter))
    : tickets;

  if (!filtered.length) {
    listEl.appendChild(el('div', { class: 'empty-state' }, 'No matching tickets'));
    return;
  }

  // Sort: favorites first, then In Progress, then active before inactive, then by ID
  const sorted = [...filtered].sort((a, b) => {
    const aFav = favs.has(a.id) ? 0 : 1;
    const bFav = favs.has(b.id) ? 0 : 1;
    if (aFav !== bFav) return aFav - bFav;

    const aIP = resolveStatus(a.status).label === 'In Progress' ? 0 : 1;
    const bIP = resolveStatus(b.status).label === 'In Progress' ? 0 : 1;
    if (aIP !== bIP) return aIP - bIP;

    const aInactive = INACTIVE.has((a.status || '').toLowerCase()) ? 1 : 0;
    const bInactive = INACTIVE.has((b.status || '').toLowerCase()) ? 1 : 0;
    if (aInactive !== bInactive) return aInactive - bInactive;

    return (a.id || '').localeCompare(b.id || '');
  });

  const selected = highlightedTicketId;

  // Check if there are any favorites in the filtered list
  const hasFavs = sorted.some(t => favs.has(t.id));
  let separatorAdded = false;

  for (const ticket of sorted) {
    const isFav = favs.has(ticket.id);
    const isSelected = ticket.id === selected;

    // Add separator between favorites and non-favorites
    if (hasFavs && !isFav && !separatorAdded) {
      listEl.appendChild(el('div', { class: 'ticket-separator' }));
      separatorAdded = true;
    }

    const { label: statusLabel, badge: statusClass } = resolveStatus(ticket.status);
    const tkStatus = tokenStatus[ticket.id] || 'none';

    const starBtn = el('button', {
      class: `ticket-star ${isFav ? 'ticket-star-active' : ''}`,
      title: isFav ? 'Remove from favorites' : 'Add to favorites',
      html: isFav ? icon('starFilled', 14) : icon('star', 14),
      onclick: (e) => {
        e.stopPropagation();
        toggleFavorite(ticket.id);
      },
    });

    // Token status dot
    const tokenDot = el('span', {
      class: `ticket-token-dot token-${tkStatus}`,
      'data-token-dot': ticket.id,
      title: TOKEN_TITLES[tkStatus] || 'No token',
    });

    const row = el('div', {
      class: `ticket-row ${isSelected ? 'ticket-row-selected' : ''}`,
      'data-ticket-id': ticket.id,
      onclick: () => handleSelectTicket(ticket),
    }, [
      starBtn,
      el('div', { class: 'ticket-row-left' }, [
        el('span', { class: 'ticket-id' }, ticket.id),
        ticket.summary ? el('span', { class: 'ticket-summary' }, ticket.summary) : null,
      ]),
      el('div', { class: 'ticket-row-right' }, [
        tokenDot,
        el('span', { class: `badge ${statusClass}` }, statusLabel),
      ]),
    ]);

    listEl.appendChild(row);
  }
}

async function toggleFavorite(ticketId) {
  if (favs.has(ticketId)) {
    favs.delete(ticketId);
  } else {
    favs.add(ticketId);
  }
  await saveFavorites('tickets', favs);

  const searchInput = qs('#ticket-search');
  const filter = searchInput?.value || '';
  renderTicketList(state.get('tickets.list') || [], filter);
}

/**
 * Clicking a ticket: highlight it and show auth section.
 * Only confirms selection in state if the ticket already has a valid token.
 * Otherwise the user must authorize first.
 */
async function handleSelectTicket(ticket) {
  highlightedTicketId = ticket.id;

  // Re-render to show highlight
  const searchInput = qs('#ticket-search');
  const filter = searchInput?.value || '';
  renderTicketList(state.get('tickets.list') || [], filter);

  // Show auth section for this ticket
  const instanceId = state.get('connection.instanceId');
  const instance = await getInstance(instanceId);
  if (!instance) return;

  showAuthSection(instance, ticket.id);

  // If the ticket already has a validated token, confirm selection immediately
  if (tokenStatus[ticket.id] === 'ok') {
    confirmTicketSelection(ticket.id);
  }
}

/**
 * Confirm a ticket as the active selection (set state, emit event).
 * Called when a ticket already has a token or after successful authorization.
 */
function confirmTicketSelection(ticketId) {
  state.set('tickets.selected', ticketId);
  events.emit('ticket:selected', { ticketId, hasToken: true });
}

function showAuthSection(instance, ticketId) {
  const section = qs('#ticket-auth-section');
  section.style.display = '';
  section.dataset.ticketId = ticketId;

  // Update the title to show which ticket
  const title = qs('#ticket-auth-title');
  if (title) title.textContent = `Authorize ${ticketId}`;

  // Clear previous input
  const codeInput = qs('#ticket-auth-code');
  if (codeInput) codeInput.value = '';

  // Clear previous status
  showTicketStatus('', '');

  try {
    const authUrl = getTicketAuthUrl(instance, ticketId);
    section.dataset.authUrl = authUrl;
  } catch (e) {
    // Auth URL generation may fail if frontend creds aren't set — that's ok
    section.dataset.authUrl = '';
  }

  // Hide "Open Auth URL" button if no URL available
  const openBtn = qs('#ticket-auth-open-btn');
  if (openBtn) openBtn.style.display = section.dataset.authUrl ? '' : 'none';
}

function hideAuthSection() {
  const section = qs('#ticket-auth-section');
  if (section) section.style.display = 'none';
}

async function handleOpenAuthUrl() {
  const section = qs('#ticket-auth-section');
  const authUrl = section?.dataset.authUrl;
  if (authUrl) {
    window.open(authUrl, '_blank');
  }
}

async function handleSubmitAuth() {
  const section = qs('#ticket-auth-section');
  const ticketId = section?.dataset.ticketId;
  const codeInput = qs('#ticket-auth-code');
  const code = codeInput?.value.trim();

  if (!code || !ticketId) {
    showTicketStatus('Please enter an authorization code or access token', 'error');
    return;
  }

  const instanceId = state.get('connection.instanceId');
  const instance = await getInstance(instanceId);
  if (!instance) return;

  const btn = qs('#ticket-auth-submit-btn');
  btn.style.minWidth = `${btn.offsetWidth}px`;
  btn.textContent = 'Authorizing…';
  btn.disabled = true;

  let authorized = false;

  // Try as authorization code first
  const result = await exchangeTicketCode(instance, ticketId, code);

  if (result.ok) {
    // Code exchange succeeded — validate the token against the API
    const validation = await ticketFetch(instance, ticketId, 'api-v2.2/describe');
    tokenStatus[ticketId] = validation.ok ? 'ok' : 'error';
    if (validation.ok) {
      showTicketStatus(`Authorized ${ticketId}`, 'success');
      authorized = true;
    } else {
      showTicketStatus(`Token for ${ticketId} failed validation`, 'error');
    }
    codeInput.value = '';
  } else {
    // Maybe it's a direct access token — store it and validate
    await storeManualTicketToken(ticketId, code);
    const validation = await ticketFetch(instance, ticketId, 'api-v2.2/describe');
    tokenStatus[ticketId] = validation.ok ? 'ok' : 'error';
    if (validation.ok) {
      showTicketStatus(`Token validated for ${ticketId}`, 'success');
      authorized = true;
    } else {
      showTicketStatus(`Token failed validation for ${ticketId}`, 'error');
    }
    codeInput.value = '';
  }

  btn.textContent = 'Authorize';
  btn.disabled = false;

  // If authorization succeeded, confirm this ticket as the active selection
  if (authorized) {
    confirmTicketSelection(ticketId);
  }

  // Update the dot and re-render
  updateTokenDot(ticketId);
  const searchInput = qs('#ticket-search');
  const filter = searchInput?.value || '';
  renderTicketList(state.get('tickets.list') || [], filter);
}

// ─── Helpers ────────────────────────────────────────────────────────────

function showTicketStatus(msg, type) {
  const statusEl = qs('#ticket-status');
  if (!msg) {
    if (statusEl) statusEl.style.display = 'none';
    return;
  }
  if (statusEl) {
    statusEl.style.display = '';
    statusEl.textContent = msg;
    statusEl.className = `status-message status-${type}`;
  }
}
