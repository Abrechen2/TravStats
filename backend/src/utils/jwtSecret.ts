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

// Initialize JWT secret on module load
export const JWT_SECRET = getJWTSecret();

// Validate secret strength (only in development)
if (process.env.NODE_ENV === 'development' && JWT_SECRET.length < 32) {
  console.warn('⚠️  WARNING: JWT_SECRET is less than 32 characters! This is insecure!');
}

// Export for use in other modules
export default JWT_SECRET;
