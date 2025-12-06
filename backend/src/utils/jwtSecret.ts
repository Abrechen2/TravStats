import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';

const PROJECT_CWD = process.cwd();
const DEV_DATA_DIR = join(PROJECT_CWD, '.travstats-data');
const RESOLVED_DATA_DIR =
  process.env.DATA_DIR || (process.env.NODE_ENV === 'production' ? '/app/data' : DEV_DATA_DIR);
const RESOLVED_SECRET_FILE =
  process.env.JWT_SECRET_FILE || join(RESOLVED_DATA_DIR, 'jwt.secret');

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
    return secret && secret.length >= 32 ? secret : null;
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.debug('Failed to read JWT secret file:', error);
    }
    return null;
  }
}

function persistSecret(secretFilePath: string, secret: string) {
  try {
    ensureDataDirectoryExists(dirname(secretFilePath));
    writeFileSync(secretFilePath, secret, { mode: 0o600 });
  } catch (error) {
    if (process.env.NODE_ENV === 'development') {
      console.debug('Failed to save JWT secret file:', error);
    }
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

    console.warn(`[auth] Ignoring weak JWT_SECRET from environment: ${validation.message}`);
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

// Initialize JWT secret on module load
export const JWT_SECRET = getJWTSecret();

// Validate secret strength
const validation = validateJWTSecret(JWT_SECRET);

if (!validation.isValid) {
  const errorMessage = `
╔═══════════════════════════════════════════════════════════════╗
║  🚨 CRITICAL SECURITY ERROR: WEAK JWT_SECRET DETECTED 🚨      ║
╠═══════════════════════════════════════════════════════════════╣
║  ${validation.message.padEnd(61)}║
║                                                               ║
║  In production, this is a CRITICAL security vulnerability!   ║
║  Your authentication system is compromised.                   ║
║                                                               ║
║  FIX:                                                         ║
║  1. Generate a strong secret: openssl rand -hex 32           ║
║  2. Set JWT_SECRET environment variable                       ║
║     OR                                                        ║
║  3. Let TravStats auto-generate one (will persist to disk)   ║
║                                                               ║
║  Current secret source: ${(process.env.JWT_SECRET ? 'JWT_SECRET env var' : 'Auto-generated').padEnd(36)}║
╚═══════════════════════════════════════════════════════════════╝
`;

  if (process.env.NODE_ENV === 'production') {
    console.error(errorMessage);
    console.error('⛔ SERVER START BLOCKED - Fix JWT_SECRET to continue');
    process.exit(1);
  } else {
    console.warn(errorMessage);
    console.warn('⚠️  Continuing in development mode, but this MUST be fixed before production!');
  }
} else if (process.env.NODE_ENV === 'production') {
  console.log('✅ JWT_SECRET validation passed');
}

// Export for use in other modules
export default JWT_SECRET;
