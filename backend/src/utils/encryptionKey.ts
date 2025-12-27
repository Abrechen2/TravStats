/**
 * Encryption Key Management
 * Automatically generates and persists ENCRYPTION_KEY if not set
 */

import crypto from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import logger from './logger';

const SECRETS_DIR = process.env.SECRETS_DIR || '/app/secrets';
const ENCRYPTION_KEY_FILE = join(SECRETS_DIR, 'encryption.key');
const KEY_LENGTH = 32; // 32 bytes = 64 hex characters

/**
 * Ensure secrets directory exists
 */
function ensureSecretsDirectory(): void {
  if (!existsSync(SECRETS_DIR)) {
    try {
      mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
      logger.info({
        operation: 'encryption_key_dir_created',
        message: `Created secrets directory: ${SECRETS_DIR}`,
      });
    } catch (error) {
      logger.warn({
        operation: 'encryption_key_dir_error',
        message: `Failed to create secrets directory: ${SECRETS_DIR}`,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }
}

/**
 * Read persisted encryption key from file
 */
function readPersistedKey(): string | null {
  if (!existsSync(ENCRYPTION_KEY_FILE)) {
    return null;
  }

  try {
    const key = readFileSync(ENCRYPTION_KEY_FILE, 'utf-8').trim();
    // Validate key format (64 hex characters)
    if (key && key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
      return key;
    }
    logger.warn({
      operation: 'encryption_key_invalid_file',
      message: 'Invalid encryption key in file, will generate new one',
    });
    return null;
  } catch (error) {
    logger.warn({
      operation: 'encryption_key_read_error',
      message: 'Failed to read encryption key file',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return null;
  }
}

/**
 * Persist encryption key to file
 */
function persistKey(key: string): void {
  try {
    ensureSecretsDirectory();
    writeFileSync(ENCRYPTION_KEY_FILE, key, { mode: 0o600, flag: 'w' });
    logger.info({
      operation: 'encryption_key_persisted',
      message: 'Encryption key persisted to file',
    });
  } catch (error) {
    logger.warn({
      operation: 'encryption_key_persist_error',
      message: 'Failed to persist encryption key to file',
      error: error instanceof Error ? error.message : 'Unknown error',
      hint: 'Key will be regenerated on next restart',
    });
  }
}

/**
 * Generate a secure random encryption key
 */
function generateKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('hex');
}

/**
 * Initialize encryption key - generates and persists if not set
 * Should be called once at application startup
 */
export function initializeEncryptionKey(): string {
  // 1. Check environment variable first
  const envKey = process.env.ENCRYPTION_KEY;
  if (envKey) {
    // Validate key format
    if (envKey.length === 64 && /^[0-9a-fA-F]+$/.test(envKey)) {
      logger.info({
        operation: 'encryption_key_loaded',
        message: 'Encryption key loaded from environment variable',
      });
      return envKey;
    } else {
      logger.warn({
        operation: 'encryption_key_invalid_env',
        message: 'ENCRYPTION_KEY in environment has invalid format, will use persisted or generate new',
      });
    }
  }

  // 2. Try to read from persisted file
  const persistedKey = readPersistedKey();
  if (persistedKey) {
    // Set it in environment for this process
    process.env.ENCRYPTION_KEY = persistedKey;
    logger.info({
      operation: 'encryption_key_loaded',
      message: 'Encryption key loaded from persisted file',
    });
    return persistedKey;
  }

  // 3. Generate new key and persist it
  const newKey = generateKey();
  persistKey(newKey);
  process.env.ENCRYPTION_KEY = newKey;
  logger.info({
    operation: 'encryption_key_generated',
    message: 'New encryption key generated and persisted',
    hint: 'Key has been saved to file and will be reused on next restart',
  });

  return newKey;
}

