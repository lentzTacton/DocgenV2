/**
 * Crypto — Application-level encryption for sensitive IndexedDB values.
 *
 * Uses Web Crypto API (AES-GCM 256-bit) with a key derived via PBKDF2
 * from a stable application identifier. This prevents casual inspection
 * of IndexedDB contents — it is NOT a substitute for OS-level encryption
 * or hardware-backed key stores.
 *
 * Encrypted payloads are stored as base64 strings prefixed with "enc:"
 * so we can distinguish them from legacy plaintext values.
 */

const ALGO = 'AES-GCM';
const KEY_LENGTH = 256;
const IV_LENGTH = 12;
const SALT = new TextEncoder().encode('TactonDocGen-v1');
const ITERATIONS = 100_000;
const PREFIX = 'enc:';

let _cryptoKey = null;

/**
 * Derive a stable CryptoKey from a fixed application passphrase.
 *
 * The passphrase incorporates the origin so different hosts
 * get different keys. This isn't a user password — it's a
 * machine-bound obfuscation layer that stops raw DB dumps from
 * revealing tokens in plaintext.
 */
async function getKey() {
  if (_cryptoKey) return _cryptoKey;

  const passphrase = `TactonDocGen::${location.origin}::office-addin-encryption-key`;
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  _cryptoKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: ALGO, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );

  return _cryptoKey;
}

/**
 * Encrypt a string value.
 * @param {string} plaintext
 * @returns {Promise<string>} base64-encoded ciphertext prefixed with "enc:"
 */
export async function encrypt(plaintext) {
  if (plaintext == null || plaintext === '') return plaintext;

  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);

  const cipherBuffer = await crypto.subtle.encrypt(
    { name: ALGO, iv },
    key,
    encoded,
  );

  const combined = new Uint8Array(IV_LENGTH + cipherBuffer.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipherBuffer), IV_LENGTH);

  return PREFIX + btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a value previously encrypted by encrypt().
 * Returns plaintext as-is if it doesn't carry the "enc:" prefix
 * (graceful handling of legacy unencrypted data).
 *
 * @param {string} stored
 * @returns {Promise<string>}
 */
export async function decrypt(stored) {
  if (stored == null || stored === '') return stored;
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return stored;

  try {
    const key = await getKey();
    const raw = atob(stored.slice(PREFIX.length));
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);

    const iv = bytes.slice(0, IV_LENGTH);
    const ciphertext = bytes.slice(IV_LENGTH);

    const decrypted = await crypto.subtle.decrypt(
      { name: ALGO, iv },
      key,
      ciphertext,
    );

    return new TextDecoder().decode(decrypted);
  } catch (e) {
    console.warn('[crypto] Decrypt failed — returning raw value. Possibly legacy or corrupted:', e.message);
    return stored;
  }
}

/**
 * Check whether a stored value is already encrypted.
 * @param {string} value
 * @returns {boolean}
 */
export function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}
