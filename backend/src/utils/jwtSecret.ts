import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const SECRET_FILE_PATH = process.env.JWT_SECRET_FILE || '/app/data/jwt.secret';
const DATA_DIR = process.env.DATA_DIR || '/app/data';

/**
 * Gets or generates JWT secret silently
 * Priority:
 * 1. JWT_SECRET environment variable (if set)
 * 2. Existing secret file (if exists)
 * 3. Generate new random secret and save to file
 */
export function getJWTSecret(): string {
  // 1. Check environment variable
  if (process.env.JWT_SECRET) {
    return process.env.JWT_SECRET;
  }

  // 2. Check if secret file exists
  if (existsSync(SECRET_FILE_PATH)) {
    try {
      const secret = readFileSync(SECRET_FILE_PATH, 'utf-8').trim();
      if (secret && secret.length >= 32) {
        return secret;
      }
    } catch (error) {
      // Silent fail, will generate new secret
      if (process.env.NODE_ENV === 'development') {
        console.debug('Failed to read JWT secret file:', error);
      }
    }
  }

  // 3. Generate new secret silently
  const newSecret = randomBytes(32).toString('hex');

  // Save to file for persistence
  try {
    // Ensure data directory exists
    if (!existsSync(DATA_DIR)) {
      mkdirSync(DATA_DIR, { recursive: true });
    }

    writeFileSync(SECRET_FILE_PATH, newSecret, { mode: 0o600 });
  } catch (error) {
    // Silent fail - secret will still work, just not persist
    if (process.env.NODE_ENV === 'development') {
      console.debug('Failed to save JWT secret file:', error);
    }
  }

  return newSecret;
}

/**
 * List of known weak/default JWT secrets that should never be used in production
 */
const KNOWN_WEAK_SECRETS = [
  'your-secret-key-change-in-production-MINIMUM-32-chars',
  'changeme-in-production',
  'changeme',
  'secret',
  'jwt-secret',
  'your-secret-key',
];

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
  if (KNOWN_WEAK_SECRETS.includes(secret)) {
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
