/**
 * Database configuration utility
 * Builds DATABASE_URL from individual components or uses provided URL
 */

export function getDatabaseURL(): string {
  // If DATABASE_URL is explicitly set, use it
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  // Otherwise, build from individual components
  const dbHost = process.env.DB_HOST || 'localhost';
  const dbPort = process.env.DB_PORT || '5432';
  const dbName = process.env.DB_NAME || 'flights';
  const dbUser = process.env.DB_USER || 'flights';
  const dbPassword = process.env.DB_PASSWORD;
  if (!dbPassword) {
    throw new Error('DB_PASSWORD environment variable is required when DATABASE_URL is not set');
  }

  return `postgresql://${dbUser}:${dbPassword}@${dbHost}:${dbPort}/${dbName}`;
}

export const DATABASE_URL = getDatabaseURL();
