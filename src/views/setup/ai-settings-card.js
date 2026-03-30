/**
 * AI Settings Card — Claude API Configuration
 *
 * Manages the Claude AI API key and model settings:
 *   - API key input + save
 *   - Test connection button
 *   - Model selector (Sonnet / Opus / Haiku)
 *   - Max tokens setting
 *
 * The mode toggle in the header is disabled until:
 *   1. A valid API key is saved and tested
 *   2. A Tacton instance is connected
 */

import { el, qs } from '../../core/dom.js';
import { iconEl, icon } from '../../components/icon.js';
import state from '../../core/state.js';
import { loadAiSettings, saveAiSettings } from '../../core/storage.js';

/**
 * Create the AI settings card.
 * @param {HTMLElement} container - Parent element to append into
 */
export function createAiSettingsCard(container) {
  // ── Form fields ──
  const apiKeyInput = el('input', {
    class: 'input',
    id: 'ai-api-key',
    type: 'text',
    placeholder: 'sk-ant-api03-…',
  });

  const modelSelect = el('select', {
    class: 'input',
    id: 'ai-model',
  }, [
    el('option', { value: 'claude-sonnet-4-6' }, 'Claude Sonnet 4.6'),
    el('option', { value: 'claude-opus-4-6' }, 'Claude Opus 4.6'),
    el('option', { value: 'claude-sonnet-4-5' }, 'Claude Sonnet 4.5'),
    el('option', { value: 'claude-haiku-4-5-20251001' }, 'Claude Haiku 4.5'),
  ]);

  const maxTokensInput = el('input', {
    class: 'input',
    id: 'ai-max-tokens',
    type: 'number',
    value: '2048',
    min: '256',
    max: '8192',
    step: '256',
  });

  // ── Status indicator ──
  const statusMsg = el('div', {
    class: 'status-message',
    id: 'ai-status',
    style: { display: 'none' },
  });

  // ── Action buttons ──
  const testBtn = el('button', {
    class: 'btn btn-secondary',
    id: 'ai-test-btn',
    onclick: handleTestKey,
  }, 'Test API Key');

  const saveBtn = el('button', {
    class: 'btn btn-primary',
    id: 'ai-save-btn',
    onclick: handleSaveSettings,
  }, 'Save Settings');

  const actions = el('div', { class: 'card-actions', style: { justifyContent: 'flex-end' } }, [testBtn, saveBtn]);

  // ── Assemble card ──
  const card = el('div', { class: 'card', id: 'ai-settings-card' }, [
    el('div', { class: 'card-header' }, [
      el('div', { class: 'card-header-left' }, [
        iconEl('chip', 20),
        el('div', {}, [
          el('div', { class: 'card-title' }, 'AI Settings'),
          el('div', { class: 'card-subtitle' }, 'Configure Claude AI for assisted mode'),
        ]),
      ]),
      el('div', { class: 'card-header-right', id: 'ai-badge' }),
    ]),
    el('div', { class: 'card-body' }, [
      el('div', { class: 'field-label' }, 'Anthropic API Key'),
      el('div', { class: 'field-hint' }, 'Required to enable AI-assisted mode. Get one at console.anthropic.com'),
      apiKeyInput,
      el('div', { class: 'field-label', style: { marginTop: '12px' } }, 'Model'),
      modelSelect,
      el('div', { class: 'field-label', style: { marginTop: '12px' } }, 'Max Tokens'),
      el('div', { class: 'field-hint' }, 'Maximum response length (256–8192)'),
      maxTokensInput,
      statusMsg,
      actions,
    ]),
  ]);

  container.appendChild(card);

  // Load saved settings on init
  initFromStorage();
  updateBadge();

  state.on('ai.apiKeyValid', updateBadge);
}

// ─── Handlers ───────────────────────────────────────────────────────────

function _getApiKey() {
  const input = qs('#ai-api-key');
  // If the field still shows the masked value, use the stored key
  return (input._storedKey && input.value.includes('…'))
    ? input._storedKey
    : input.value.trim();
}

async function handleTestKey() {
  const key = _getApiKey();
  if (!key) {
    showStatus('Enter an API key first', 'error');
    return;
  }

  const btn = qs('#ai-test-btn');
  btn.textContent = 'Testing…';
  btn.disabled = true;

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: qs('#ai-model').value,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'Say OK' }],
      }),
    });

    if (resp.ok) {
      state.set('ai.apiKeyValid', true);
      showStatus('API key is valid!', 'success');
    } else {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${resp.status}`);
    }
  } catch (err) {
    state.set('ai.apiKeyValid', false);
    showStatus(`Test failed: ${err.message}`, 'error');
  } finally {
    btn.textContent = 'Test API Key';
    btn.disabled = false;
  }
}

async function handleSaveSettings() {
  const newKey = _getApiKey();

  // Guard: don't overwrite a stored key with an empty field
  if (!newKey) {
    const existing = await loadAiSettings();
    if (existing.apiKey) {
      showStatus('API key field is empty — keeping existing key. Clear it explicitly to remove.', 'error');
      return;
    }
  }

  const settings = {
    apiKey: newKey,
    model: qs('#ai-model').value,
    maxTokens: parseInt(qs('#ai-max-tokens').value) || 2048,
  };

  const btn = qs('#ai-save-btn');
  btn.textContent = 'Saving…';
  btn.disabled = true;

  try {
    await saveAiSettings(settings);

    state.batch({
      'ai.apiKey': settings.apiKey,
      'ai.model': settings.model,
      'ai.maxTokens': settings.maxTokens,
    });

    // If no key, mark as invalid
    if (!settings.apiKey) {
      state.set('ai.apiKeyValid', false);
    }

    showStatus('Settings saved!', 'success');
  } catch (e) {
    showStatus(`Save failed: ${e.message}`, 'error');
  } finally {
    btn.textContent = 'Save Settings';
    btn.disabled = false;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────

async function initFromStorage() {
  const settings = await loadAiSettings();
  if (settings.apiKey) {
    // Show masked key so it's clear a key is stored
    // (type=text avoids the ambiguous password dots vs placeholder confusion)
    const masked = settings.apiKey.substring(0, 12) + '…' + settings.apiKey.slice(-4);
    const input = qs('#ai-api-key');
    input.value = masked;
    input._storedKey = settings.apiKey; // Keep real key for test/save
    // On focus, reveal the real key for editing
    input.addEventListener('focus', function onFocus() {
      if (input._storedKey && input.value === masked) {
        input.value = input._storedKey;
      }
    }, { once: true });
    qs('#ai-model').value = settings.model || 'claude-sonnet-4-6';
    qs('#ai-max-tokens').value = settings.maxTokens || 2048;
    // If we have a stored key, trust it as valid (matches app.js boot logic).
    // The user can re-test if needed; this prevents the "NOT CONFIGURED"
    // badge from flashing while async boot code is still running.
    if (!state.get('ai.apiKeyValid')) {
      state.set('ai.apiKeyValid', true);
    }
  }
}

function showStatus(msg, type) {
  const statusEl = qs('#ai-status');
  if (!msg) {
    statusEl.style.display = 'none';
    return;
  }
  statusEl.style.display = '';
  statusEl.textContent = msg;
  statusEl.className = `status-message status-${type}`;
}

function updateBadge() {
  const badge = qs('#ai-badge');
  if (!badge) return;

  badge.innerHTML = '';

  const isValid = state.get('ai.apiKeyValid');
  if (isValid) {
    badge.appendChild(el('span', { class: 'badge badge-success' }, 'Configured'));
  } else {
    badge.appendChild(el('span', { class: 'badge badge-warning' }, 'Not configured'));
  }
}
