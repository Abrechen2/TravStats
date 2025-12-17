import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import logger from './logger';

const PROJECT_CWD = process.cwd();
const DEV_DATA_DIR = join(PROJECT_CWD, '.travstats-data');
const RESOLVED_DATA_DIR =
  process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/app/data' : DEV_DATA_DIR);
const RESOLVED_SECRET_FILE =
  process.env.JWT_SECRET_FILE || join(RESOLVED_DATA_DIR, 'jwt.secret');

/**
 * List of known weak/default JWT secrets that should never be used in production
 */
const KNOWN_WEAK_SECRETS = new Set(
  [
    'change-this-in-production-use-openssl-rand-hex-32',
    'your-secret-key-change-in-production',
    'your-secret-key-change-in-production-MINIMUM-32-chars',
    'changeme-in-production',
    'changeme',
    'secret',
    'jwt-secret',
    'your-secret-key',
  ].map((secret) => secret.toLowerCase()),
);

/**
 * Validates JWT secret strength
 * @returns {object} validation result with isValid and message
 */
export function validateJWTSecret(secret: string): { isValid: boolean; message: string } {
  // Check minimum length
  if (secret.length < 32) {
    return {
      isValid: false,
      message: `JWT_SECRET is only ${secret.length} characters. Minimum 32 characters required.`,
    };
  }

  // Check against known weak secrets
  if (KNOWN_WEAK_SECRETS.has(secret.toLowerCase())) {
    return {
      isValid: false,
      message: 'JWT_SECRET is using a known default value. Generate a strong secret with: openssl rand -hex 32',
    };
  }

  // Check for low entropy (e.g., repeated characters)
  const uniqueChars = new Set(secret).size;
  if (uniqueChars < 16) {
    return {
      isValid: false,
      message: `JWT_SECRET has low entropy (only ${uniqueChars} unique characters). Use a cryptographically random secret.`,
    };
  }

  return { isValid: true, message: 'JWT_SECRET is valid' };
}

function ensureDataDirectoryExists(directory: string) {
  if (!existsSync(directory)) {
    mkdirSync(directory, { recursive: true });
  }
}

function readPersistedSecret(secretFilePath: string): string | null {
  if (!existsSync(secretFilePath)) {
    return null;
  }

  try {
    const secret = readFileSync(secretFilePath, 'utf-8').trim();
    if (!secret || secret.length < 32) {
      return null;
    }
    // Validate that the persisted secret is strong
    const validation = validateJWTSecret(secret);
    if (!validation.isValid) {
      logger.warn({
        operation: 'jwt_secret_weak_file',
        message: 'Ignoring weak JWT_SECRET from file, will generate new one',
        context: { reason: validation.message },
      });
      return null;
    }
    return secret;
  } catch (error) {
    logger.debug({
      operation: 'jwt_secret_read_error',
      message: 'Failed to read JWT secret file',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return null;
  }
}

function persistSecret(secretFilePath: string, secret: string) {
  try {
    ensureDataDirectoryExists(dirname(secretFilePath));
    writeFileSync(secretFilePath, secret, { mode: 0o600 });
  } catch (error) {
    logger.debug({
      operation: 'jwt_secret_save_error',
      message: 'Failed to save JWT secret file',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
    });
  }
}

/**
 * Gets or generates JWT secret silently
 * Priority:
 * 1. JWT_SECRET environment variable (if set)
 * 2. Existing secret file (if exists)
 * 3. Generate new random secret and save to file
 */
export function getJWTSecret(): string {
  const envSecret = process.env.JWT_SECRET?.trim();
  if (envSecret) {
    const validation = validateJWTSecret(envSecret);
    if (validation.isValid) {
      return envSecret;
    }

    // Weak secret detected - remove it from environment to prevent reuse
    delete process.env.JWT_SECRET;
    logger.warn({
      operation: 'jwt_secret_weak_env',
      message: 'Ignoring weak JWT_SECRET from environment',
      context: { reason: validation.message },
    });
  }

  const persistedSecret = readPersistedSecret(RESOLVED_SECRET_FILE);
  if (persistedSecret) {
    process.env.JWT_SECRET = persistedSecret;
    return persistedSecret;
  }

  const newSecret = randomBytes(32).toString('hex');
  persistSecret(RESOLVED_SECRET_FILE, newSecret);
  process.env.JWT_SECRET = newSecret;
  return newSecret;
}

// Initialize JWT secret on module load
// getJWTSecret() will automatically generate a strong secret if none is available
let JWT_SECRET = getJWTSecret();

// Validate secret strength and regenerate if needed (should never be needed, but safety first)
let validation = validateJWTSecret(JWT_SECRET);
let retryCount = 0;
const maxRetries = 3;

while (!validation.isValid && retryCount < maxRetries) {
  logger.warn({
    operation: 'jwt_secret_regeneration',
    message: 'Generated JWT secret failed validation, regenerating...',
    context: { reason: validation.message, attempt: retryCount + 1 },
  });
  
  // Force generation of new secret by clearing environment and file
  delete process.env.JWT_SECRET;
  try {
    if (existsSync(RESOLVED_SECRET_FILE)) {
      require('fs').unlinkSync(RESOLVED_SECRET_FILE);
    }
  } catch {
    // Ignore errors deleting old secret file
  }
  
  // Generate new secret
  JWT_SECRET = getJWTSecret();
  validation = validateJWTSecret(JWT_SECRET);
  retryCount++;
}

if (!validation.isValid) {
  // This should never happen after retries, but if it does, it's critical
  const errorMessage = `
╔═══════════════════════════════════════════════════════════════╗
║  🚨 CRITICAL SECURITY ERROR: WEAK JWT_SECRET DETECTED 🚨      ║
╠═══════════════════════════════════════════════════════════════╣
║  ${validation.message.padEnd(61)}║
║                                                               ║
║  Failed to generate a valid secret after ${maxRetries} attempts. ║
║  This indicates a critical system error.                      ║
║                                                               ║
║  FIX:                                                         ║
║  1. Generate a strong secret: openssl rand -hex 32           ║
║  2. Set JWT_SECRET environment variable                       ║
║     OR                                                        ║
║  3. Delete /app/data/jwt.secret and restart (will auto-gen)   ║
║                                                               ║
║  Current secret source: ${(process.env.JWT_SECRET ? 'JWT_SECRET env var' : 'Auto-generated').padEnd(36)}║
╚═══════════════════════════════════════════════════════════════╝
`;

  console.error(errorMessage);
  console.error('⛔ SERVER START BLOCKED - This is a critical error');
  logger.error({
    operation: 'jwt_secret_validation_failed',
    message: 'JWT_SECRET validation failed - server start blocked',
    context: { reason: validation.message },
  });
  process.exit(1);
} else if (process.env.NODE_ENV === 'production') {
  if (retryCount > 0) {
    console.log(`✅ JWT_SECRET validation passed (regenerated ${retryCount} time(s))`);
  } else {
    console.log('✅ JWT_SECRET validation passed');
  }
  logger.info({
    operation: 'jwt_secret_validation_passed',
    message: 'JWT_SECRET validation passed',
  });
}

// Export the validated secret
export { JWT_SECRET };
export default JWT_SECRET;
