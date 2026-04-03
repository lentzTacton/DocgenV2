/**
 * Ticket Card — Ticket Selection & Authorization
 *
 * Features:
 *   - Search / filter tickets by ID, summary, or owner
 *   - Star favorites — persisted to Dexie, always sorted to top
 *   - Status badges with "In Progress" priority sorting
 *   - Inline token badge per selected row (with hover diagnostics tooltip)
 *   - Inline actions: Get token, Test, Re-authorize
 *   - Re-authorize opens auth form below the list
 */

import { el, qs, clear } from '../../core/dom.js';
import { iconEl, icon } from '../../components/icon.js';
import { STEP_ICONS, renderDiagnosticSteps } from '../../components/diagnostic-steps.js';
import { toggleTokenVisibility } from '../../components/auth-form.js';
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
  authorizeTicket,
} from '../../services/auth.js';
import { ticketFetch } from '../../services/api.js';
import { getInstance, loadFavorites, saveFavorites, setToken } from '../../core/storage.js';

let favs = new Set();

// Token status cache: ticketId → 'ok' | 'none' | 'checking' | 'error'
let tokenStatus = {};

// Visually highlighted ticket (not yet confirmed via token)
let highlightedTicketId = null;

// Whether the auth form below the list is showing
let authFormOpen = false;

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

// STEP_ICONS imported from shared diagnostic-steps.js

/**
 * Create the ticket management card.
 * @param {HTMLElement} container
 */
export function createTicketCard(container) {
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

  // Auth form section (below list — shown on re-auth or first auth)
  const authSection = el('div', {
    id: 'ticket-auth-section',
    class: 'ticket-auth-section',
    style: { display: 'none' },
  }, [
    el('div', { class: 'ticket-auth-header' }, [
      el('span', { class: 'ticket-auth-title', id: 'ticket-auth-title' }, 'Authorize Ticket'),
      el('button', {
        class: 'ticket-inline-btn',
        id: 'ticket-auth-open-btn',
        html: `Get token ${icon('externalLink', 10)}`,
        onclick: handleOpenAuthUrl,
      }),
    ]),
    el('div', { class: 'ticket-auth-fields' }, [
      el('div', { class: 'ticket-auth-field' }, [
        el('label', { class: 'ticket-auth-label', for: 'ticket-auth-code' }, 'Access Token'),
        el('div', { class: 'input-with-toggle' }, [
          el('input', {
            class: 'input',
            id: 'ticket-auth-code',
            type: 'password',
            placeholder: 'Paste access token',
          }),
          el('button', {
            class: 'token-visibility-toggle',
            type: 'button',
            title: 'Show / hide token',
            html: icon('eye', 14),
            onclick: (e) => toggleTokenVisibility(e.currentTarget),
          }),
        ]),
      ]),
      el('div', { class: 'ticket-auth-field' }, [
        el('label', { class: 'ticket-auth-label', for: 'ticket-auth-refresh' }, [
          'Refresh Token',
          el('span', { class: 'ticket-auth-label-hint' }, '(for auto-renewal)'),
        ]),
        el('div', { class: 'input-with-toggle' }, [
          el('input', {
            class: 'input',
            id: 'ticket-auth-refresh',
            type: 'password',
            placeholder: 'Paste refresh token',
          }),
          el('button', {
            class: 'token-visibility-toggle',
            type: 'button',
            title: 'Show / hide token',
            html: icon('eye', 14),
            onclick: (e) => toggleTokenVisibility(e.currentTarget),
          }),
        ]),
      ]),
    ]),
    el('div', { class: 'ticket-auth-input-row' }, [
      el('button', {
        class: 'btn btn-sm btn-primary',
        id: 'ticket-auth-submit-btn',
        onclick: handleSubmitAuth,
      }, 'Authorize'),
      el('button', {
        class: 'btn btn-sm btn-ghost',
        onclick: () => hideAuthSection(),
      }, 'Cancel'),
    ]),
  ]);

  const statusMsg = el('div', {
    class: 'status-message',
    id: 'ticket-status',
    style: { display: 'none' },
  });

  // Offline read-only banner
  const offlineTicketBanner = el('div', {
    class: 'offline-readonly-banner',
    id: 'offline-ticket-banner',
    style: { display: 'none' },
  });

  const normalTicketBody = el('div', { class: 'card-body', id: 'ticket-normal-body' }, [
    searchRow,
    ticketList,
    authSection,
    statusMsg,
    el('div', { class: 'card-actions', id: 'ticket-card-actions' }),
  ]);

  const card = el('div', { class: 'card', id: 'ticket-card' }, [
    el('div', { class: 'card-header' }, [
      el('div', { class: 'card-header-left' }, [
        iconEl('file', 20),
        el('div', {}, [
          el('div', { class: 'card-title' }, 'Tickets'),
          el('div', { class: 'card-subtitle' }, 'Select a ticket and authorize access'),
        ]),
      ]),
      refreshBtn,
    ]),
    offlineTicketBanner,
    normalTicketBody,
  ]);

  container.appendChild(card);

  // Offline mode: swap normal body with read-only banner
  state.on('connection.offlinePackageId', (pkgId) => {
    if (pkgId) {
      normalTicketBody.style.display = 'none';
      offlineTicketBanner.style.display = '';
      const ticketId = state.get('tickets.selected') || 'No ticket';
      const tickets = state.get('tickets.list') || [];
      const ticket = tickets.find(t => t.id === ticketId);
      clear(offlineTicketBanner);
      offlineTicketBanner.append(
        el('div', { class: 'offline-banner-row' }, [
          el('span', { class: 'icon', style: { color: 'var(--tacton-blue)' }, html: icon('database', 16) }),
          el('span', { class: 'offline-banner-label' }, 'Offline — Ticket from captured data'),
        ]),
        el('div', { class: 'offline-banner-detail' }, [
          el('span', { class: 'offline-banner-key' }, 'Ticket'),
          el('span', { class: 'offline-banner-val' }, ticketId + (ticket?.summary ? ` — ${ticket.summary}` : '')),
        ]),
      );
    } else {
      normalTicketBody.style.display = '';
      offlineTicketBanner.style.display = 'none';
    }
  });

  loadFavorites('tickets').then(f => { favs = f; });

  state.on('config.locked', (locked) => {
    if (!locked && state.get('connection.status') === 'connected') {
      handleRefreshTickets();
    }
  });

  state.on('connection.status', async (status) => {
    const btn = qs('#ticket-refresh-btn');
    const search = qs('#ticket-search-row');
    const searchInput = qs('#ticket-search');
    if (status === 'connected') {
      if (btn) btn.style.display = '';

      // IMPORTANT: await handleRefreshTickets so that checkAllTokens finishes
      // before we run the health check. Previously these ran concurrently,
      // causing duplicate probes/refreshes for the same ticket token that
      // would race and invalidate each other.
      await handleRefreshTickets();

      // Now that checkAllTokens has validated tokens (and cached them in
      // memory), the health check can run cheaply — it will hit the in-memory
      // cache instead of probing Tacton again.
      const preSelected = state.get('tickets.selected');
      if (preSelected) {
        await runTicketTokenHealthCheck(preSelected);
      }
    } else {
      if (btn) btn.style.display = 'none';
      if (search) search.style.display = 'none';
      if (searchInput) searchInput.value = '';
      highlightedTicketId = null;
      authFormOpen = false;
      tokenStatus = {};
      hideAuthSection();
      clear(qs('#ticket-list'));
      qs('#ticket-list').appendChild(
        el('div', { class: 'empty-state' }, 'Connect to an instance first')
      );
    }
  });

  // When the instance changes (even if status stays 'connected'), reset
  // the ticket list and re-fetch from the new instance.
  state.on('connection.instanceId', async (instanceId) => {
    if (!instanceId) return;
    // Only act if already connected — the status listener handles the
    // initial connect flow.
    if (state.get('connection.status') !== 'connected') return;

    // Guard: verify the instance has admin credentials before attempting
    // to fetch tickets. During import/restore the instanceId may be set
    // before credentials are fully available in storage.
    const instance = await getInstance(instanceId);
    if (!instance?.admin?.clientId || !instance?.admin?.clientSecret) return;

    // Reset ticket state for the new instance
    highlightedTicketId = null;
    authFormOpen = false;
    tokenStatus = {};
    hideAuthSection();
    const searchInput = qs('#ticket-search');
    if (searchInput) searchInput.value = '';

    // Re-fetch tickets from the new instance
    await handleRefreshTickets();

    const preSelected = state.get('tickets.selected');
    if (preSelected) {
      await runTicketTokenHealthCheck(preSelected);
    }
  });

  state.on('tickets.selected', async (ticketId) => {
    if (!ticketId) {
      state.set('tickets.tokenHealth', null);
      return;
    }
    // Only run health check if connection is established.
    // During loadLockedConfig, tickets.selected is restored before
    // the connection is re-established — running a health check then
    // would race with the connection.status listener's own health check.
    if (state.get('connection.status') !== 'connected') return;
    await runTicketTokenHealthCheck(ticketId);
  });

  // Re-render rows when token health changes (updates inline badges)
  state.on('tickets.tokenHealth', (health) => {
    if (!health || !health.ticketId) return;

    // If the selected ticket just became authorized, close the auth form
    if (health.status === 'ok' && health.ticketId === highlightedTicketId) {
      showTicketStatus('', '');
      hideAuthSection();
    }

    // Update token status cache
    if (health.status) tokenStatus[health.ticketId] = health.status;

    // Try to update badge in-place (keeps tooltip open)
    const row = document.querySelector(`.ticket-row[data-ticket-id="${health.ticketId}"]`);
    if (row) {
      const rightSide = row.querySelector('.ticket-row-right');
      if (rightSide && health.steps?.length) {
        const oldBadge = rightSide.querySelector('.ticket-token-badge-wrap');
        const oldDot = rightSide.querySelector('.ticket-token-dot');
        const newBadge = buildTokenBadge(health, health.ticketId);

        if (oldBadge) {
          // Check if tooltip was visible before replacing
          const wasVisible = oldBadge.classList.contains('tooltip-visible');
          oldBadge.replaceWith(newBadge);
          if (wasVisible) {
            // Re-open tooltip on the new badge element
            const rect = newBadge.getBoundingClientRect();
            const tip = newBadge.querySelector('.conn-tooltip');
            if (tip) {
              tip.style.top = `${rect.bottom + 6}px`;
              tip.style.right = `${window.innerWidth - rect.right}px`;
              tip.style.left = 'auto';
            }
            newBadge.classList.add('tooltip-visible');
          }
        } else if (oldDot) {
          oldDot.replaceWith(newBadge);
        }
        // Also update the dot via data-token-dot for consistency
        updateTokenDot(health.ticketId);
        return; // Done — no full re-render needed
      }
    }

    // Fallback: full re-render if the row wasn't found
    const si = qs('#ticket-search');
    renderTicketList(state.get('tickets.list') || [], si?.value || '');
  });
}

// ─── Ticket Token Health Check ───────────────────────────────────────────

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

// ─── Handlers ───────────────────────────────────────────────────────────

async function handleTestTicketToken(ticketId) {
  if (!ticketId) return;

  const btn = document.querySelector(`[data-test-btn="${ticketId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Testing…';
  }

  await runTicketTokenHealthCheck(ticketId);

  // After health check, the badge may have been replaced in-place.
  // Find the new button and reset it (if it wasn't already replaced).
  const newBtn = document.querySelector(`[data-test-btn="${ticketId}"]`);
  if (newBtn) {
    newBtn.disabled = false;
    newBtn.textContent = 'Test token';
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

  const search = qs('#ticket-search-row');
  if (search) search.style.display = result.tickets.length > 0 ? '' : 'none';

  favs = await loadFavorites('tickets');

  tokenStatus = {};
  renderTicketList(result.tickets);

  // IMPORTANT: await checkAllTokens so that all ticket tokens are fully
  // resolved (probed/refreshed/cached) before any other code runs.
  // Previously this was fire-and-forget, causing races with testTicketToken
  // and getModel — each would independently probe/refresh the same token,
  // and each refresh invalidates the previous token, causing cascading 403s.
  await checkAllTokens(instance, result.tickets);

  if (!state.get('tickets.selected') && result.tickets.length > 0) {
    const firstFav = result.tickets.find(t => favs.has(t.id));
    const autoSelect = firstFav || result.tickets[0];
    if (autoSelect) {
      handleSelectTicket(autoSelect);
    }
  }
}

async function checkAllTokens(instance, tickets) {
  for (const ticket of tickets) {
    const hasToken = await hasStoredToken(ticket.id);
    if (!hasToken) {
      tokenStatus[ticket.id] = 'none';
      updateTokenDot(ticket.id);
      continue;
    }

    tokenStatus[ticket.id] = 'checking';
    updateTokenDot(ticket.id);

    try {
      // getTicketToken already validates the stored token via probeTicketToken
      // (Tier 2 in _resolveTicketToken), so no need for a second describe call.
      // The redundant ticketFetch was causing extra API chatter and — when racing
      // with other callers — could trigger unnecessary 403-retry refresh flows.
      const { token } = await getTicketToken(instance, ticket.id);
      tokenStatus[ticket.id] = token ? 'ok' : 'none';
    } catch {
      tokenStatus[ticket.id] = 'error';
    }
    updateTokenDot(ticket.id);

    // If this highlighted ticket now has a valid token
    if (ticket.id === highlightedTicketId && tokenStatus[ticket.id] === 'ok') {
      hideAuthSection(); // close any open auth form
      if (!state.get('tickets.selected')) {
        confirmTicketSelection(ticket.id);
      }
      // Re-render to show the authorized inline actions
      const si = qs('#ticket-search');
      renderTicketList(state.get('tickets.list') || [], si?.value || '');
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

// ─── Render ─────────────────────────────────────────────────────────────

function renderTicketList(tickets, filter) {
  const listEl = qs('#ticket-list');
  clear(listEl);

  if (!tickets.length) {
    listEl.appendChild(el('div', { class: 'empty-state' }, 'No tickets found'));
    return;
  }

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
  const hasFavs = sorted.some(t => favs.has(t.id));
  let separatorAdded = false;

  for (const ticket of sorted) {
    const isFav = favs.has(ticket.id);
    const isSelected = ticket.id === selected;

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

    const tokenDot = el('span', {
      class: `ticket-token-dot token-${tkStatus}`,
      'data-token-dot': ticket.id,
      title: TOKEN_TITLES[tkStatus] || 'No token',
    });

    // Build main row content
    const mainRow = el('div', { class: 'ticket-row-main' }, [
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

    // Build inline actions (only for selected ticket)
    let actionsRow = null;
    if (isSelected) {
      actionsRow = buildInlineActions(ticket);
    }

    const row = el('div', {
      class: `ticket-row ${isSelected ? 'ticket-row-selected' : ''}`,
      'data-ticket-id': ticket.id,
      onclick: () => handleSelectTicket(ticket),
    }, [
      mainRow,
      actionsRow,
    ]);

    // If selected and has health data, replace dot with badge+tooltip
    if (isSelected && (tkStatus === 'ok' || tkStatus === 'error')) {
      const health = state.get('tickets.tokenHealth');
      if (health && health.ticketId === ticket.id && health.steps?.length) {
        const badgeWrap = row.querySelector('.ticket-row-right');
        if (badgeWrap) {
          const tokenBadge = buildTokenBadge(health, ticket.id);
          const existingDot = badgeWrap.querySelector('.ticket-token-dot');
          if (existingDot) existingDot.replaceWith(tokenBadge);
        }
      }
    }

    listEl.appendChild(row);
  }
}

/**
 * Build the token badge with hover tooltip.
 * Tooltip includes diagnostic steps + action buttons (Test, Re-authorize).
 * The tooltip stays open while the mouse is inside it.
 */
function buildTokenBadge(health, ticketId) {
  const status = health.status || 'none';

  const BADGE_LABELS = {
    ok: 'Authorized',
    warn: 'Partial',
    expired: 'Expired',
    none: 'No Token',
    error: 'Error',
  };
  const BADGE_CLASS = {
    ok: 'badge-success',
    warn: 'badge-warning',
    expired: 'badge-danger',
    none: 'badge-warning',
    error: 'badge-danger',
  };

  const label = BADGE_LABELS[status] || 'Unknown';
  const cls = BADGE_CLASS[status] || 'badge-muted';

  const wrap = el('span', { class: 'ticket-token-badge-wrap' });
  const badgeSpan = el('span', { class: `badge badge-sm ${cls}` }, label);
  wrap.appendChild(badgeSpan);

  // "Get token" icon button — sits next to the badge
  const getTokenBtn = el('button', {
    class: 'ticket-get-token-icon',
    title: 'Get token from Tacton',
    html: icon('externalLink', 11),
    onclick: (e) => { e.stopPropagation(); handleOpenAuthUrl(ticketId); },
  });
  wrap.appendChild(getTokenBtn);

  // Build tooltip
  const tooltip = el('div', { class: 'conn-tooltip ticket-badge-tooltip' });

  const tooltipBadge = status === 'ok' ? 'ok' : status === 'warn' ? 'warn' : 'error';
  const tooltipLabel = status === 'ok' ? 'All Good'
    : status === 'warn' ? 'Partial'
    : status === 'expired' ? 'Expired'
    : status === 'none' ? 'No Token'
    : 'Error';

  tooltip.appendChild(el('div', { class: 'conn-tooltip-header' }, [
    el('span', { class: 'conn-tooltip-title' }, `Token (${health.ticketId})`),
    el('span', { class: `conn-tooltip-badge ${tooltipBadge}` }, tooltipLabel),
  ]));

  const stepsEl = el('div', { class: 'conn-tooltip-steps' });
  renderDiagnosticSteps(stepsEl, health.steps);
  tooltip.appendChild(stepsEl);

  // Action buttons inside tooltip
  const tooltipActions = el('div', { class: 'tooltip-actions' }, [
    el('button', {
      class: 'tooltip-action-btn',
      'data-test-btn': ticketId,
      onclick: (e) => { e.stopPropagation(); handleTestTicketToken(ticketId); },
    }, 'Test token'),
    el('button', {
      class: 'tooltip-action-btn',
      onclick: (e) => { e.stopPropagation(); openAuthForm(ticketId); },
    }, 'Re-authorize'),
  ]);
  tooltip.appendChild(tooltipActions);
  wrap.appendChild(tooltip);

  // ── Hover logic: stay open while mouse is in badge OR tooltip ──
  let hideTimer = null;
  function showTooltip() {
    clearTimeout(hideTimer);
    const rect = wrap.getBoundingClientRect();
    tooltip.style.top = `${rect.bottom + 6}px`;
    tooltip.style.right = `${window.innerWidth - rect.right}px`;
    tooltip.style.left = 'auto';
    wrap.classList.add('tooltip-visible');
  }
  function scheduleHide() {
    hideTimer = setTimeout(() => wrap.classList.remove('tooltip-visible'), 150);
  }
  wrap.addEventListener('mouseenter', showTooltip);
  wrap.addEventListener('mouseleave', scheduleHide);
  tooltip.addEventListener('mouseenter', showTooltip);
  tooltip.addEventListener('mouseleave', scheduleHide);

  return wrap;
}

/**
 * Build inline actions row for the selected ticket.
 * Returns null — the gray dot communicates "not authorized" and the
 * auth form opens below the list automatically. Authorized tickets
 * show everything in the badge + tooltip instead.
 */
function buildInlineActions(ticket) {
  return null;
}

// toggleTokenVisibility imported from shared auth-form.js

// ─── Auth Form (below list) ─────────────────────────────────────────────

async function openAuthForm(ticketId) {
  authFormOpen = true;

  const section = qs('#ticket-auth-section');
  section.style.display = '';
  section.dataset.ticketId = ticketId;

  const title = qs('#ticket-auth-title');
  if (title) title.textContent = `Authorize ${ticketId}`;

  const codeInput = qs('#ticket-auth-code');
  if (codeInput) { codeInput.value = ''; codeInput.type = 'password'; }
  const refreshInput = qs('#ticket-auth-refresh');
  if (refreshInput) { refreshInput.value = ''; refreshInput.type = 'password'; }

  // Reset eye toggles back to "show" state
  section.querySelectorAll('.token-visibility-toggle').forEach(btn => {
    btn.innerHTML = icon('eye', 14);
    btn.title = 'Show / hide token';
  });

  showTicketStatus('', '');

  const instanceId = state.get('connection.instanceId');
  if (!instanceId) return;
  const instance = await getInstance(instanceId);
  if (instance) {
    try {
      const authUrl = getTicketAuthUrl(instance, ticketId);
      section.dataset.authUrl = authUrl;
    } catch (_) {
      section.dataset.authUrl = '';
    }
  }

  const openBtn = qs('#ticket-auth-open-btn');
  if (openBtn) openBtn.style.display = section.dataset.authUrl ? '' : 'none';
}

function hideAuthSection() {
  authFormOpen = false;
  const section = qs('#ticket-auth-section');
  if (section) section.style.display = 'none';
}

async function handleOpenAuthUrl(ticketId) {
  // If called from inline button (with ticketId) or from auth section
  let instanceId = state.get('connection.instanceId');
  if (!instanceId) return;
  const instance = await getInstance(instanceId);
  if (!instance) return;

  const tid = ticketId || qs('#ticket-auth-section')?.dataset.ticketId;
  if (!tid) return;

  try {
    const authUrl = getTicketAuthUrl(instance, tid);
    if (authUrl) window.open(authUrl, '_blank');
  } catch (_) { /* ignore */ }
}

async function handleSubmitAuth() {
  const section = qs('#ticket-auth-section');
  const ticketId = section?.dataset.ticketId;
  const accessInput = qs('#ticket-auth-code');
  const refreshInput = qs('#ticket-auth-refresh');
  const rawAccess = accessInput?.value.trim();
  const rawRefresh = refreshInput?.value.trim();

  if ((!rawAccess && !rawRefresh) || !ticketId) {
    showTicketStatus('Access token is required', 'error');
    return;
  }

  const instanceId = state.get('connection.instanceId');
  if (!instanceId) return;
  const instance = await getInstance(instanceId);
  if (!instance) return;

  // Clear any previous error status before starting
  showTicketStatus('', '');

  const btn = qs('#ticket-auth-submit-btn');
  if (btn) {
    btn.style.minWidth = `${btn.offsetWidth}px`;
    btn.textContent = 'Authorizing…';
    btn.disabled = true;
  }

  // ── Use shared authorization flow (validates before storing) ──
  const result = await authorizeTicket(instance, ticketId, rawAccess, rawRefresh);

  if (btn) {
    btn.textContent = 'Authorize';
    btn.disabled = false;
  }

  if (result.ok) {
    tokenStatus[ticketId] = 'ok';
    // Clear inputs only on success
    if (accessInput) accessInput.value = '';
    if (refreshInput) refreshInput.value = '';
    showTicketStatus('', '');
    hideAuthSection();

    const wasAlreadySelected = state.get('tickets.selected') === ticketId;
    confirmTicketSelection(ticketId);
    if (wasAlreadySelected) {
      await runTicketTokenHealthCheck(ticketId);
    }
  } else {
    tokenStatus[ticketId] = 'error';
    showTicketStatus(result.error || 'Token not accepted — check the value', 'error');
    // Auth failed — run health check so the error badge+tooltip show diagnostics
    await runTicketTokenHealthCheck(ticketId);
  }

  // tokenHealth listener already handles in-place badge update + dot
}

// ─── Toggle & Select ────────────────────────────────────────────────────

async function toggleFavorite(ticketId) {
  if (favs.has(ticketId)) {
    favs.delete(ticketId);
  } else {
    favs.add(ticketId);
  }
  await saveFavorites('tickets', favs);

  const si = qs('#ticket-search');
  renderTicketList(state.get('tickets.list') || [], si?.value || '');
}

async function handleSelectTicket(ticket) {
  highlightedTicketId = ticket.id;

  // If the newly selected ticket is authorized, close any auth form
  if (tokenStatus[ticket.id] === 'ok') {
    hideAuthSection();
  } else {
    // Not authorized — auto-open the auth form
    openAuthForm(ticket.id);
  }

  const si = qs('#ticket-search');
  renderTicketList(state.get('tickets.list') || [], si?.value || '');

  if (tokenStatus[ticket.id] === 'ok') {
    confirmTicketSelection(ticket.id);
  }
}

function confirmTicketSelection(ticketId) {
  state.set('tickets.selected', ticketId);
  events.emit('ticket:selected', { ticketId, hasToken: true });
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
