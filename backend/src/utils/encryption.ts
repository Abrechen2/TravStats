/**
 * Encryption utility for sensitive data (API keys, etc.)
 * Uses AES-256-GCM for authenticated encryption
 */

import crypto from 'crypto';
import logger from './logger';
import { SECURITY } from '../config/constants';
import { initializeEncryptionKey } from './encryptionKey';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 128 bits
const SALT_LENGTH = 64; // 512 bits
const TAG_LENGTH = 16; // 128 bits
const KEY_LENGTH = 32; // 256 bits
const ITERATIONS = SECURITY.PBKDF2_ITERATIONS;

// Track failed decryption attempts to avoid spam in logs
const failedDecryptionCache = new Set<string>();
const DECRYPTION_WARN_INTERVAL = 5 * 60 * 1000; // 5 minutes
let lastDecryptionWarning = 0;

// Initialize encryption key on module load (automatically generates if not set)
let ENCRYPTION_KEY_INITIALIZED = false;

/**
 * Get encryption key from environment variable or generate one
 * Automatically initializes the key on first call if not set
 */
function getEncryptionKey(): Buffer {
  // Initialize encryption key on first call (only once)
  if (!ENCRYPTION_KEY_INITIALIZED) {
    initializeEncryptionKey();
    ENCRYPTION_KEY_INITIALIZED = true;
  }

  const envKey = process.env.ENCRYPTION_KEY;

  if (envKey) {
    // Validate key length (should be 64 hex characters = 32 bytes)
    if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
      return Buffer.from(envKey, 'hex');
    } else {
      logger.warn({
        operation: 'encryption_key_invalid',
        message: 'ENCRYPTION_KEY has invalid format, using fallback',
      });
    }
  }

  // Fallback: Use JWT_SECRET as base for encryption key (should not happen after initialization)
  const fallbackSecret = process.env.JWT_SECRET;
  if (!fallbackSecret) {
    throw new Error('Neither ENCRYPTION_KEY nor JWT_SECRET is set. Cannot derive encryption key.');
  }
  return crypto.pbkdf2Sync(fallbackSecret, 'encryption-salt', ITERATIONS, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a string value
 * @param text Plain text to encrypt
 * @returns Encrypted string (base64 encoded: salt:iv:tag:ciphertext)
 */
export function encrypt(text: string): string {
  if (!text) {
    return text;
  }

  try {
    const key = getEncryptionKey();
    const salt = crypto.randomBytes(SALT_LENGTH);
    const iv = crypto.randomBytes(IV_LENGTH);

    // Derive key from master key and salt
    const derivedKey = crypto.pbkdf2Sync(key, salt, ITERATIONS, KEY_LENGTH, 'sha256');

    const cipher = crypto.createCipheriv(ALGORITHM, derivedKey, iv);
    cipher.setAAD(Buffer.from('travstats-api-key', 'utf8')); // Additional authenticated data

    let encrypted = cipher.update(text, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    const tag = cipher.getAuthTag();

    // Combine salt:iv:tag:encrypted
    const combined = Buffer.concat([salt, iv, tag, encrypted]);
    return combined.toString('base64');
  } catch (error) {
    logger.error({
      operation: 'encryption_error',
      message: 'Failed to encrypt value',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    throw new Error('Encryption failed');
  }
}

/**
 * Decrypt an encrypted string
 * @param encryptedText Encrypted string (base64 encoded: salt:iv:tag:ciphertext)
 * @returns Decrypted plain text
 * @internal This function throws errors - use decryptApiKey for API keys which handles errors gracefully
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) {
    return encryptedText;
  }

  try {
    const key = getEncryptionKey();
    const combined = Buffer.from(encryptedText, 'base64');

    // Extract components
    const salt = combined.subarray(0, SALT_LENGTH);
    const iv = combined.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
    const tag = combined.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + TAG_LENGTH);
    const encrypted = combined.subarray(SALT_LENGTH + IV_LENGTH + TAG_LENGTH);

    // Derive key from master key and salt
    const derivedKey = crypto.pbkdf2Sync(key, salt, ITERATIONS, KEY_LENGTH, 'sha256');

    const decipher = crypto.createDecipheriv(ALGORITHM, derivedKey, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from('travstats-api-key', 'utf8'));

    let decrypted = decipher.update(encrypted);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString('utf8');
  } catch (_error) {
    // Don't log here - let the caller (decryptApiKey) handle logging
    // This prevents duplicate log entries
    throw new Error('Decryption failed - value may be corrupted or encrypted with different key');
  }
}

/**
 * Check if a string is encrypted (heuristic check)
 * @param text String to check
 * @returns true if string appears to be encrypted
 */
export function isEncrypted(text: string): boolean {
  if (!text) {
    return false;
  }

  try {
    // AES-256-GCM ciphertext is the SAME length as its plaintext, so the
    // honest minimum is salt (64) + iv (16) + tag (16) + at least 1 byte of
    // ciphertext = 97 bytes, which base64-encodes to ~132 chars. A secret of
    // any length >= 1 therefore lands here; the old `+ 16` bound (112 bytes)
    // silently classified every secret shorter than 16 bytes as plaintext,
    // so `decryptApiKey` returned the ciphertext verbatim (smoke-test S2).
    // The `< 100` fast-reject stays safe: no ciphertext we produce is < 132
    // chars, so it never rejects a real encrypted value.
    if (text.length < 100) {
      return false;
    }

    // Try to decode as base64
    const decoded = Buffer.from(text, 'base64');
    // Check if it has the expected structure (salt + iv + tag + >= 1 byte data)
    return decoded.length >= SALT_LENGTH + IV_LENGTH + TAG_LENGTH + 1;
  } catch {
    return false;
  }
}

/**
 * Encrypt API key if not already encrypted
 * @param apiKey API key to encrypt
 * @returns Encrypted API key
 */
export function encryptApiKey(apiKey: string | null | undefined): string | null {
  if (!apiKey) {
    return null;
  }

  // If already encrypted, return as-is
  if (isEncrypted(apiKey)) {
    return apiKey;
  }

  return encrypt(apiKey);
}

/**
 * Decrypt API key if encrypted, otherwise return as-is
 * @param encryptedApiKey Encrypted or plain API key
 * @returns Decrypted API key
 */
export function decryptApiKey(encryptedApiKey: string | null | undefined): string | null {
  if (!encryptedApiKey) {
    return null;
  }

  // If not encrypted, return as-is (for backward compatibility)
  if (!isEncrypted(encryptedApiKey)) {
    return encryptedApiKey;
  }

  try {
    return decrypt(encryptedApiKey);
  } catch (error) {
    // Only log warning if we haven't seen this specific encrypted value before
    // or if enough time has passed since last warning
    const now = Date.now();
    const shouldWarn = !failedDecryptionCache.has(encryptedApiKey) ||
                       (now - lastDecryptionWarning) > DECRYPTION_WARN_INTERVAL;

    if (shouldWarn) {
      failedDecryptionCache.add(encryptedApiKey);
      lastDecryptionWarning = now;

      logger.warn({
        operation: 'api_key_decryption_error',
        message: 'Failed to decrypt API key - value may be corrupted or encrypted with different key',
        hint: 'User may need to re-enter their API keys in settings',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // Return null on decryption failure rather than throwing
    // This allows the system to continue functioning
    return null;
  }
}
