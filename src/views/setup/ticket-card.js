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
  tryAsRefreshToken,
  testTicketToken,
  hasStoredToken,
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

  const ticketBadgeWrap = el('div', {
    class: 'card-header-right conn-badge-wrap',
    id: 'ticket-token-badge',
    style: { display: 'none' },
  });

  const card = el('div', { class: 'card', id: 'ticket-card' }, [
    el('div', { class: 'card-header' }, [
      el('div', { class: 'card-header-left' }, [
        iconEl('file', 20),
        el('div', {}, [
          el('div', { class: 'card-title' }, 'Tickets'),
          el('div', { class: 'card-subtitle' }, 'Select a ticket and authorize access'),
        ]),
      ]),
      ticketBadgeWrap,
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

  state.on('connection.status', async (status) => {
    const btn = qs('#ticket-refresh-btn');
    const search = qs('#ticket-search-row');
    if (status === 'connected') {
      if (btn) btn.style.display = '';
      handleRefreshTickets();

      // If a ticket was pre-selected (e.g. restored from config snapshot),
      // run the health check now — the tickets.selected listener won't fire
      // again since the value was already set before connection completed.
      const preSelected = state.get('tickets.selected');
      if (preSelected) {
        await runTicketTokenHealthCheck(preSelected);
      }
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

  // Run ticket token health check when a ticket is selected
  state.on('tickets.selected', async (ticketId) => {
    if (!ticketId) {
      state.set('tickets.tokenHealth', null);
      updateTicketBadge();
      return;
    }
    await runTicketTokenHealthCheck(ticketId);
  });

  // Update badge whenever token health changes
  state.on('tickets.tokenHealth', () => updateTicketBadge());
}

// ─── Ticket Token Health Check ───────────────────────────────────────────

/**
 * Run the full 5-step ticket token diagnostic and publish results to state.
 * Called when a ticket is selected and after successful authorization.
 */
async function runTicketTokenHealthCheck(ticketId) {
  const instanceId = state.get('connection.instanceId');
  if (!instanceId) return;

  const instance = await getInstance(instanceId);
  if (!instance) return;

  try {
    const result = await testTicketToken(instance, ticketId);
    state.set('tickets.tokenHealth', {
      status: result.status,
      steps: result.steps,
      ticketId,
    });
  } catch (e) {
    state.set('tickets.tokenHealth', {
      status: 'error',
      steps: [{ label: 'Token Test', status: 'fail', detail: e.message }],
      ticketId,
    });
  }
}

// ─── Ticket Token Badge ──────────────────────────────────────────────────

const BADGE_LABELS = {
  ok: 'Token Valid',
  warn: 'Token Partial',
  expired: 'Token Expired',
  none: 'No Token',
  error: 'Token Error',
};

const BADGE_CLASS = {
  ok: 'badge-success',
  warn: 'badge-warning',
  expired: 'badge-danger',
  none: 'badge-warning',
  error: 'badge-danger',
};

const STEP_ICONS = { pass: '✓', fail: '✗', skip: '–', warn: '!' };

/**
 * Update the ticket token health badge in the card header.
 * Shows a colored badge + hover tooltip with 5-step diagnostic.
 */
function updateTicketBadge() {
  const badge = qs('#ticket-token-badge');
  if (!badge) return;

  const health = state.get('tickets.tokenHealth');
  clear(badge);

  if (!health || !health.steps?.length) {
    badge.style.display = 'none';
    return;
  }

  badge.style.display = '';

  const status = health.status || 'none';
  const label = BADGE_LABELS[status] || 'Unknown';
  const cls = BADGE_CLASS[status] || 'badge-muted';

  const badgeSpan = el('span', { class: `badge ${cls}` }, label);
  badge.appendChild(badgeSpan);

  // Build tooltip (same style as connection-card admin tooltip)
  const tooltip = el('div', { class: 'conn-tooltip' });

  const tooltipBadge = status === 'ok' ? 'ok'
    : status === 'warn' ? 'warn'
    : 'error';
  const tooltipLabel = status === 'ok' ? 'All Good'
    : status === 'warn' ? 'Partial'
    : status === 'expired' ? 'Expired'
    : status === 'none' ? 'No Token'
    : 'Error';

  const header = el('div', { class: 'conn-tooltip-header' }, [
    el('span', { class: 'conn-tooltip-title' }, `Ticket Token (${health.ticketId})`),
    el('span', { class: `conn-tooltip-badge ${tooltipBadge}` }, tooltipLabel),
  ]);
  tooltip.appendChild(header);

  const stepsEl = el('div', { class: 'conn-tooltip-steps' });
  for (const step of health.steps) {
    stepsEl.appendChild(el('div', { class: 'conn-tooltip-step' }, [
      el('span', { class: `conn-tooltip-icon tt-${step.status}` }, STEP_ICONS[step.status] || '–'),
      el('div', { class: 'conn-tooltip-body' }, [
        el('div', { class: 'conn-tooltip-label' }, step.label),
        el('div', { class: 'conn-tooltip-detail' }, step.detail),
      ]),
    ]));
  }
  tooltip.appendChild(stepsEl);
  badge.appendChild(tooltip);
}

// ─── Handlers ───────────────────────────────────────────────────────────

async function handleTestTicketToken() {
  const ticketId = state.get('tickets.selected') || highlightedTicketId;
  if (!ticketId) return;

  const btn = qs('#ticket-test-inline-btn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = `${icon('refresh', 12)} Testing…`;
  }

  await runTicketTokenHealthCheck(ticketId);

  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `${icon('refresh', 12)} Test`;
  }
}

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
    // Only check tickets that have a stored token — skip the rest to avoid
    // hammering the server with client_credentials calls that will fail.
    const hasToken = await hasStoredToken(ticket.id);
    if (!hasToken) {
      tokenStatus[ticket.id] = 'none';
      updateTokenDot(ticket.id);
      continue;
    }

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

  // Reset authorized state
  section.classList.remove('is-authorized');
  const prevStatus = section.querySelector('.ticket-auth-authorized-status');
  if (prevStatus) prevStatus.remove();

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

  // If the ticket already has a valid token, show authorized state immediately
  if (tokenStatus[ticketId] === 'ok') {
    showAuthorizedState(ticketId, '');
  }
}

function hideAuthSection() {
  const section = qs('#ticket-auth-section');
  if (section) {
    section.style.display = 'none';
    section.classList.remove('is-authorized');
    // Remove authorized status row if present
    const statusRow = section.querySelector('.ticket-auth-authorized-status');
    if (statusRow) statusRow.remove();
  }
}

/**
 * Show compact authorized state — hides input row, shows "Authorized ✓" with re-auth link.
 */
function showAuthorizedState(ticketId, method) {
  const section = qs('#ticket-auth-section');
  if (!section) return;

  section.classList.add('is-authorized');

  // Remove any previous authorized status row
  const prev = section.querySelector('.ticket-auth-authorized-status');
  if (prev) prev.remove();

  const methodLabel = method ? ` (${method})` : '';
  const statusRow = el('div', { class: 'ticket-auth-authorized-status' }, [
    el('span', { class: 'ticket-auth-check-icon', html: icon('check', 14) }),
    el('span', { class: 'ticket-auth-check-label' }, `Authorized ${ticketId}${methodLabel}`),
    el('div', { class: 'ticket-auth-actions' }, [
      el('button', {
        class: 'ticket-auth-action-link',
        id: 'ticket-test-inline-btn',
        onclick: handleTestTicketToken,
        html: `${icon('refresh', 12)} Test`,
      }),
      el('button', {
        class: 'ticket-auth-action-link',
        onclick: () => {
          section.classList.remove('is-authorized');
          statusRow.remove();
          const codeInput = qs('#ticket-auth-code');
          if (codeInput) codeInput.value = '';
        },
      }, 'Re-authorize'),
    ]),
  ]);

  // Insert after the header
  const header = section.querySelector('.ticket-auth-header');
  if (header && header.nextSibling) {
    section.insertBefore(statusRow, header.nextSibling);
  } else {
    section.appendChild(statusRow);
  }
}

async function handleOpenAuthUrl() {
  const section = qs('#ticket-auth-section');
  const authUrl = section?.dataset.authUrl;
  if (authUrl) {
    window.open(authUrl, '_blank');
  }
}

/**
 * Handle pasted token / auth code submission.
 *
 * Try order (mirrors TactonUtil SAVE_TICKET_TOKEN):
 *   1. Try as access token — probe describe endpoint directly
 *   2. Try as refresh token — exchange for access token, validate, persist both
 *   3. Try as authorization code — exchange via OAuth code grant
 */
async function handleSubmitAuth() {
  const section = qs('#ticket-auth-section');
  const ticketId = section?.dataset.ticketId;
  const codeInput = qs('#ticket-auth-code');
  const raw = codeInput?.value.trim();

  if (!raw || !ticketId) {
    showTicketStatus('Please enter a token or authorization code', 'error');
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
  let authMethod = '';

  // ── 1. Try as direct access token ──
  await storeManualTicketToken(ticketId, raw);
  const accessProbe = await ticketFetch(instance, ticketId, 'api-v2.2/describe');
  if (accessProbe.ok) {
    tokenStatus[ticketId] = 'ok';
    authMethod = 'access token';
    authorized = true;

    // Also try to store it as a refresh token so future sessions can refresh.
    // The raw value might be a refresh token that also works as access — store it.
    tryAsRefreshToken(instance, ticketId, raw).catch(() => {});
  } else {
    // ── 2. Try as refresh token ──
    const refreshResult = await tryAsRefreshToken(instance, ticketId, raw);
    if (refreshResult.ok) {
      tokenStatus[ticketId] = 'ok';
      authMethod = 'refresh token';
      authorized = true;
    } else {
      // ── 3. Try as authorization code ──
      const codeResult = await exchangeTicketCode(instance, ticketId, raw);
      if (codeResult.ok) {
        const validation = await ticketFetch(instance, ticketId, 'api-v2.2/describe');
        tokenStatus[ticketId] = validation.ok ? 'ok' : 'error';
        if (validation.ok) {
          authMethod = 'auth code';
          authorized = true;
        } else {
          showTicketStatus(`Token for ${ticketId} failed validation`, 'error');
        }
      } else {
        tokenStatus[ticketId] = 'error';
        showTicketStatus(
          'Not accepted as access token, refresh token, or auth code',
          'error',
        );
      }
    }
  }

  codeInput.value = '';
  btn.textContent = 'Authorize';
  btn.disabled = false;

  // If authorization succeeded, confirm this ticket and show authorized state
  if (authorized) {
    showTicketStatus('', ''); // clear any previous error
    showAuthorizedState(ticketId, authMethod);

    const wasAlreadySelected = state.get('tickets.selected') === ticketId;
    confirmTicketSelection(ticketId);
    // If the ticket was already selected, the state listener won't fire —
    // run the health check explicitly so the badge updates.
    if (wasAlreadySelected) {
      await runTicketTokenHealthCheck(ticketId);
    }
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
