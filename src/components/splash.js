import { el } from '../core/dom.js';
import state from '../core/state.js';

/**
 * Creates the splash screen shown when no connection is established.
 * Matches the original DocGen prototype splash with Tacton branding,
 * gradient background, decorative rings, and "Connect to Tacton" CTA.
 *
 * When config is locked, clicking "Connect to Tacton" triggers
 * auto-connect using saved configuration (no manual setup needed).
 */
export function createSplash() {
  const splash = el('div', { class: 'splash', id: 'splash-screen' }, [
    // Decorative rings
    el('div', { class: 'splash-ring splash-ring-1' }),
    el('div', { class: 'splash-ring splash-ring-2' }),
    el('div', { class: 'splash-ring splash-ring-3' }),
    el('div', { class: 'splash-ring splash-ring-4' }),

    // Content
    el('div', { class: 'splash-inner' }, [
      el('img', {
        class: 'splash-logo',
        src: 'assets/icons/tacton-logo.svg',
        alt: 'Tacton',
      }),
      el('div', { class: 'splash-product' }, 'DocGen'),
      el('div', { class: 'splash-subtitle' }, 'Word Add-in'),
      el('div', { class: 'splash-divider' }),
      el('div', { class: 'splash-tagline' },
        'Generate structured documents from your Tacton configuration directly in Word.'
      ),
      el('button', {
        class: 'splash-cta',
        id: 'splash-connect-btn',
        onclick: handleSplashConnect,
      }, 'Connect to Tacton'),
      el('div', { class: 'splash-version' }, 'v2.0'),
    ]),
  ]);

  return splash;
}

function handleSplashConnect() {
  hideSplash();
  state.set('activeZone', 'setup');

  // If config is locked, signal connection-card to auto-connect
  if (state.get('config.locked')) {
    state.set('config.autoConnectPending', true);
  }
}

/** Hide splash and show the main app zones */
export function hideSplash() {
  const splash = document.getElementById('splash-screen');
  if (splash) splash.style.display = 'none';

  const mainApp = document.getElementById('main-app');
  if (mainApp) mainApp.style.display = '';
}

/** Show splash and hide the main app zones */
export function showSplash() {
  const splash = document.getElementById('splash-screen');
  if (splash) splash.style.display = '';

  const mainApp = document.getElementById('main-app');
  if (mainApp) mainApp.style.display = 'none';
}
