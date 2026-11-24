/**
 * Encryption Key Management
 * Automatically generates and persists ENCRYPTION_KEY if not set
 */

import crypto from "crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from "fs";
import { join } from "path";
import logger from "./logger";

function resolveSecretsDir(): string {
  if (process.env.SECRETS_DIR) return process.env.SECRETS_DIR;
  const LEGACY = "/app/secrets";
  const CURRENT = "/app/data/secrets";
  if (existsSync(join(LEGACY, "jwt.secret")) || existsSync(join(LEGACY, "encryption.key"))) {
    return LEGACY;
  }
  return CURRENT;
}
const SECRETS_DIR = resolveSecretsDir();
const ENCRYPTION_KEY_FILE = join(SECRETS_DIR, "encryption.key");
const KEY_LENGTH = 32; // 32 bytes = 64 hex characters

/**
 * Ensure secrets directory exists
 */
function ensureSecretsDirectory(): void {
  if (!existsSync(SECRETS_DIR)) {
    try {
      mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
      logger.info({
        operation: "encryption_key_dir_created",
        message: `Created secrets directory: ${SECRETS_DIR}`,
      });
    } catch (error) {
      logger.warn({
        operation: "encryption_key_dir_error",
        message: `Failed to create secrets directory: ${SECRETS_DIR}`,
        error: error instanceof Error ? error.message : "Unknown error",
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
    const key = readFileSync(ENCRYPTION_KEY_FILE, "utf-8").trim();
    // Validate key format (64 hex characters)
    if (key && key.length === 64 && /^[0-9a-fA-F]+$/.test(key)) {
      return key;
    }
    logger.warn({
      operation: "encryption_key_invalid_file",
      message: "Invalid encryption key in file, will generate new one",
    });
    return null;
  } catch (error) {
    logger.warn({
      operation: "encryption_key_read_error",
      message: "Failed to read encryption key file",
      error: error instanceof Error ? error.message : "Unknown error",
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
    writeFileSync(ENCRYPTION_KEY_FILE, key, { mode: 0o600, flag: "w" });
    logger.info({
      operation: "encryption_key_persisted",
      message: "Encryption key persisted to file",
    });
  } catch (error) {
    logger.warn({
      operation: "encryption_key_persist_error",
      message: "Failed to persist encryption key to file",
      error: error instanceof Error ? error.message : "Unknown error",
      hint: "Key will be regenerated on next restart",
    });
  }
}

/**
 * Generate a secure random encryption key
 */
function generateKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString("hex");
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
      // Only the FIRST call can tell a real environment variable apart: every
      // later one finds the value the file branch below put there.
      keySource ??= "env";
      logger.info({
        operation: "encryption_key_loaded",
        message: "Encryption key loaded from environment variable",
      });
      return envKey;
    } else {
      logger.warn({
        operation: "encryption_key_invalid_env",
        message:
          "ENCRYPTION_KEY in environment has invalid format, will use persisted or generate new",
      });
    }
  }

  // 2. Try to read from persisted file
  const persistedKey = readPersistedKey();
  if (persistedKey) {
    // Set it in environment for this process
    process.env.ENCRYPTION_KEY = persistedKey;
    keySource ??= "file";
    logger.info({
      operation: "encryption_key_loaded",
      message: "Encryption key loaded from persisted file",
    });
    return persistedKey;
  }

  // 3. Generate new key and persist it
  const newKey = generateKey();
  persistKey(newKey);
  process.env.ENCRYPTION_KEY = newKey;
  keySource ??= "file";
  logger.info({
    operation: "encryption_key_generated",
    message: "New encryption key generated and persisted",
    hint: "Key has been saved to file and will be reused on next restart",
  });

  return newKey;
}

/** Where the running key came from; set once, by the first initialisation. */
let keySource: "env" | "file" | null = null;
/** Raised by every `installEncryptionKey`; caches of derived secrets compare against it. */
let keyGeneration = 0;

/** The instance key now in force (64 hex characters). Never log or return it
 *  anywhere but the recovery-key reveal. */
export function activeEncryptionKeyHex(): string {
  if (keySource === null) initializeEncryptionKey();
  const key = process.env.ENCRYPTION_KEY;
  if (!key || !/^[0-9a-fA-F]{64}$/.test(key)) throw new Error("no usable encryption key");
  return key.toLowerCase();
}

/** True when the key comes from the ENCRYPTION_KEY environment variable, which
 *  wins over the secrets file on every start — a key written to the file would
 *  be silently replaced again by the next restart. */
export function encryptionKeyPinnedByEnv(): boolean {
  if (keySource === null) initializeEncryptionKey();
  return keySource === "env";
}

/** Changes whenever the key is replaced at runtime; a cache of something derived
 *  from the key keeps the generation it was built under and rebuilds on a change. */
export function encryptionKeyGeneration(): number {
  return keyGeneration;
}

export function encryptionKeyFilePath(): string {
  return ENCRYPTION_KEY_FILE;
}

/**
 * Replace the instance key at runtime: the secrets file first (0600, written to
 * a temporary name and renamed, so a crash cannot leave half a key), then the
 * process. Used by a restore that was handed the recovery key of the archive's
 * instance. Throws when the file cannot be written — a key that lives only in
 * memory would be gone at the next restart, together with every credential
 * the restore just brought back.
 */
export function installEncryptionKey(keyHex: string): void {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("instance key must be 64 hex characters");
  if (encryptionKeyPinnedByEnv()) {
    throw new Error("the encryption key is set by the ENCRYPTION_KEY environment variable");
  }
  const key = keyHex.toLowerCase();
  if (!existsSync(SECRETS_DIR)) mkdirSync(SECRETS_DIR, { recursive: true, mode: 0o700 });
  const temp = `${ENCRYPTION_KEY_FILE}.${process.pid}.tmp`;
  writeFileSync(temp, key, { mode: 0o600, flag: "w" });
  renameSync(temp, ENCRYPTION_KEY_FILE);
  process.env.ENCRYPTION_KEY = key;
  instanceKeyHex = key;
  keyGeneration += 1;
  logger.info({ operation: "encryption_key_installed", message: "Encryption key replaced" });
}

let instanceKeyHex: string | null = null;

/**
 * A secret for one purpose, derived from the instance key with HKDF-SHA256
 * under `label` — never the instance key itself, so a leaked subkey opens
 * nothing else. Deterministic per instance and label: a value keyed with it
 * stays comparable across restarts. Never log or return what this gives.
 */
export function deriveInstanceSecret(label: string, length = 32): Buffer {
  instanceKeyHex ??= initializeEncryptionKey();
  return deriveSecretFrom(instanceKeyHex, label, length);
}

/** `deriveInstanceSecret` for a given instance key (64 hex characters). */
export function deriveSecretFrom(keyHex: string, label: string, length = 32): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) throw new Error("instance key must be 64 hex characters");
  return Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(keyHex, "hex"), Buffer.alloc(0), label, length)
  );
}
