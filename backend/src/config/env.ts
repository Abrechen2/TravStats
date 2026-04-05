/**
 * Environment variable validation schema
 * Validates all environment variables at application startup
 */

import { z } from 'zod';
import logger from '../utils/logger';

// Define environment variable schema
const envSchema = z.object({
  // Node environment
  NODE_ENV: z.enum(['development', 'production', 'test']).default('production'),

  // Server configuration
  PORT: z.string().regex(/^\d+$/).transform(Number).default('8000'),
  HOST: z.string().optional().default('0.0.0.0'),

  // Database
  DATABASE_URL: z.string().url().optional(),
  DB_HOST: z.string().optional(),
  DB_PORT: z.string().regex(/^\d+$/).optional(),
  DB_NAME: z.string().optional(),
  DB_USER: z.string().optional(),
  DB_PASSWORD: z.string().optional(),

  // Security
  JWT_SECRET: z.string().min(32).optional(),
  JWT_EXPIRES_IN: z.string().default('7d'),
  ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-fA-F]+$/).optional(),
  COOKIE_SECURE: z.string().transform((val) => val === 'true').default('true'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  FRONTEND_URL: z.string().url().optional(),

  // Instance settings
  INSTANCE_NAME: z.string().default('TravStats'),
  MAX_USERS: z.string().regex(/^\d+$/).transform(Number).default('10'),
  ALLOW_REGISTRATION: z.string().transform((val) => val === 'true').default('false'),

  // Seeding
  SEED_AIRPORTS: z.string().transform((val) => val !== 'false').default('true'),
  CREATE_DEMO_USER: z.string().transform((val) => val === 'true').default('false'),

  // API Keys (optional)
  AIRLABS_API_KEY: z.string().optional(),
  OPENSKY_CLIENT_ID: z.string().optional(),
  OPENSKY_CLIENT_SECRET: z.string().optional(),
  OPENSKY_USERNAME: z.string().optional(),
  OPENSKY_PASSWORD: z.string().optional(),
  AVIATIONSTACK_API_KEY: z.string().optional(),

  // Training Settings
  PYTHON_CMD: z.string().default('python3'),
  DOCKER: z.string().transform((val) => val === 'true').optional(),

  // Backup Settings
  BACKUP_PATH: z.string().default('/app/data/backups'),
  // DEPRECATED: backup toggle/interval/retention now stored in AdminSettings DB.
  // Kept as optional fallback to avoid startup errors on existing deployments.
  BACKUP_RETENTION_DAYS: z.string().regex(/^\d+$/).transform(Number).default('30'),
  AUTO_BACKUP_ENABLED: z.string().transform((val) => val === 'true').default('false'),
  BACKUP_INTERVAL: z.enum(['daily', 'weekly', 'monthly']).default('weekly'),
  DOCKER_DB_CONTAINER: z.string().optional(),

  // WebDAV Sync Settings (optional)
  WEBDAV_SYNC_ENABLED: z.string().transform((val) => val === 'true').default('false'),
  WEBDAV_URL: z.string().url().optional(),
  WEBDAV_USERNAME: z.string().optional(),
  WEBDAV_PASSWORD: z.string().optional(),
  WEBDAV_BACKUP_PATH: z.string().optional(),

  // Data directories
  DATA_DIR: z.string().optional(),
  SECRETS_DIR: z.string().optional(),
  JWT_SECRET_FILE: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

let validatedEnv: EnvConfig | null = null;

/**
 * Validate and parse environment variables
 * @throws Error if validation fails
 */
export function validateEnv(): EnvConfig {
  if (validatedEnv) {
    return validatedEnv;
  }

  try {
    // Check if DATABASE_URL or DB components are set
    if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
      logger.warn({
        operation: 'env_validation_warning',
        message: 'Neither DATABASE_URL nor DB_HOST is set. Database connection may fail.',
      });
    }

    validatedEnv = envSchema.parse(process.env);

    logger.info({
      operation: 'env_validation_success',
      message: 'Environment variables validated successfully',
    });

    return validatedEnv;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const errorMessages = error.errors.map((err) => ({
        path: err.path.join('.'),
        message: err.message,
      }));

      logger.error({
        operation: 'env_validation_failed',
        message: 'Environment variable validation failed',
        errors: errorMessages,
      });

      throw new Error(
        `Environment variable validation failed:\n${errorMessages.map((e) => `  - ${e.path}: ${e.message}`).join('\n')}`
      );
    }

    throw error;
  }
}

/**
 * Get validated environment configuration
 */
export function getEnv(): EnvConfig {
  if (!validatedEnv) {
    return validateEnv();
  }
  return validatedEnv;
}
