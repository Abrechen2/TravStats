/**
 * API Key Resolver Service
 *
 * Resolves API keys with priority: User Key > Global Key > ENV Variable
 */

import { prisma } from '../db';
import { decryptApiKey } from '../utils/encryption';
import logger from '../utils/logger';

export type ApiProvider =
  | 'openai'
  | 'claude'
  | 'airlabs'
  | 'aviationstack'
  | 'aerodatabox'
  | 'opensky'
  | 'logostream';

export interface OpenSkyCredentials {
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
}

/**
 * Get API key for a provider with priority resolution
 * Priority: User Key > Global Key > ENV Variable
 */
export async function getApiKey(
  provider: ApiProvider,
  userId?: string
): Promise<string | null> {
  try {
    // 1. Try user-specific key
    if (userId) {
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId },
        select: {
          openaiApiKey: true,
          claudeApiKey: true,
          airlabsApiKey: true,
          aviationstackApiKey: true,
          aerodataboxApiKey: true,
        },
      });

      if (userSettings) {
        let userKey: string | null = null;

        switch (provider) {
          case 'openai':
            userKey = userSettings.openaiApiKey;
            break;
          case 'claude':
            userKey = userSettings.claudeApiKey;
            break;
          case 'airlabs':
            userKey = userSettings.airlabsApiKey;
            break;
          case 'aviationstack':
            userKey = userSettings.aviationstackApiKey;
            break;
          case 'aerodatabox':
            userKey = userSettings.aerodataboxApiKey;
            break;
        }

        if (userKey) {
          const decrypted = decryptApiKey(userKey);
          if (decrypted) {
            return decrypted;
          }
        }
      }
    }

    // 2. Try global admin key
    const adminSettings = await prisma.adminSettings.findFirst();
    if (adminSettings) {
      let globalKey: string | null = null;

      switch (provider) {
        case 'openai':
          globalKey = adminSettings.globalOpenaiApiKey;
          break;
        case 'claude':
          globalKey = adminSettings.globalClaudeApiKey;
          break;
        case 'airlabs':
          globalKey = adminSettings.globalAirlabsApiKey;
          break;
        case 'aviationstack':
          globalKey = adminSettings.globalAviationstackApiKey;
          break;
        case 'aerodatabox':
          globalKey = adminSettings.globalAerodataboxApiKey;
          break;
        // No user-level key for logostream — logos are instance-wide assets,
        // so resolution is global → env only.
        case 'logostream':
          globalKey = adminSettings.globalLogostreamApiKey;
          break;
      }

      if (globalKey) {
        const decrypted = decryptApiKey(globalKey);
        if (decrypted) {
          return decrypted;
        }
      }
    }

    // 3. Fallback to ENV variable
    switch (provider) {
      case 'openai':
        return process.env.OPENAI_API_KEY || null;
      case 'claude':
        return process.env.CLAUDE_API_KEY || null;
      case 'airlabs':
        return process.env.AIRLABS_API_KEY || null;
      case 'aviationstack':
        return process.env.AVIATIONSTACK_API_KEY || null;
      case 'aerodatabox':
        return process.env.AERODATABOX_API_KEY || null;
      case 'logostream':
        return process.env.LOGOSTREAM_API_KEY || null;
      default:
        return null;
    }
  } catch (error) {
    logger.error({
      operation: 'api_key_resolution_error',
      message: 'Failed to resolve API key',
      context: {
        provider,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return null;
  }
}

/**
 * Get OpenSky credentials with priority resolution
 * Priority: User Credentials > Global Credentials > ENV Variables
 */
export async function getOpenSkyCredentials(
  userId?: string
): Promise<OpenSkyCredentials | null> {
  try {
    // 1. Try user-specific credentials
    if (userId) {
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId },
        select: {
          openskyClientId: true,
          openskyClientSecret: true,
          openskyUsername: true,
          openskyPassword: true,
        },
      });

      if (userSettings) {
        const hasUserCredentials =
          userSettings.openskyClientId ||
          userSettings.openskyUsername;

        if (hasUserCredentials) {
          return {
            clientId: userSettings.openskyClientId
              ? decryptApiKey(userSettings.openskyClientId) || undefined
              : undefined,
            clientSecret: userSettings.openskyClientSecret
              ? decryptApiKey(userSettings.openskyClientSecret) || undefined
              : undefined,
            username: userSettings.openskyUsername
              ? decryptApiKey(userSettings.openskyUsername) || undefined
              : undefined,
            password: userSettings.openskyPassword
              ? decryptApiKey(userSettings.openskyPassword) || undefined
              : undefined,
          };
        }
      }
    }

    // 2. Try global admin credentials
    const adminSettings = await prisma.adminSettings.findFirst();
    if (adminSettings) {
      const hasGlobalCredentials =
        adminSettings.globalOpenskyClientId ||
        adminSettings.globalOpenskyUsername;

      if (hasGlobalCredentials) {
        const creds: OpenSkyCredentials = {
          clientId: adminSettings.globalOpenskyClientId
            ? decryptApiKey(adminSettings.globalOpenskyClientId) || undefined
            : undefined,
          clientSecret: adminSettings.globalOpenskyClientSecret
            ? decryptApiKey(adminSettings.globalOpenskyClientSecret) || undefined
            : undefined,
          username: adminSettings.globalOpenskyUsername
            ? decryptApiKey(adminSettings.globalOpenskyUsername) || undefined
            : undefined,
          password: adminSettings.globalOpenskyPassword
            ? decryptApiKey(adminSettings.globalOpenskyPassword) || undefined
            : undefined,
        };

        // OpenSky accepts either a full OAuth2 client-credentials pair OR a
        // legacy username+password pair. If nothing survived decryption (e.g.
        // encrypted with a lost key), treat as not configured so downstream
        // logs don't lie about readiness.
        const oauthUsable = !!creds.clientId && !!creds.clientSecret;
        const basicUsable = !!creds.username && !!creds.password;
        if (!oauthUsable && !basicUsable) {
          logger.warn({
            operation: 'opensky_credentials_undecryptable',
            message:
              'OpenSky credentials exist in admin_settings but no usable pair could be decrypted — treating as unconfigured',
          });
          return null;
        }
        return creds;
      }
    }

    // 3. Fallback to ENV variables
    const envClientId = process.env.OPENSKY_CLIENT_ID;
    const envClientSecret = process.env.OPENSKY_CLIENT_SECRET;
    const envUsername = process.env.OPENSKY_USERNAME;
    const envPassword = process.env.OPENSKY_PASSWORD;

    if (envClientId || envUsername) {
      return {
        clientId: envClientId || undefined,
        clientSecret: envClientSecret || undefined,
        username: envUsername || undefined,
        password: envPassword || undefined,
      };
    }

    return null;
  } catch (error) {
    logger.error({
      operation: 'opensky_credentials_resolution_error',
      message: 'Failed to resolve OpenSky credentials',
      context: {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return null;
  }
}

/**
 * Check if user has access to a specific API key (either own or shared)
 */
export async function hasApiKeyAccess(
  provider: ApiProvider,
  userId?: string
): Promise<{ hasAccess: boolean; isShared: boolean }> {
  try {
    // Check user key
    if (userId) {
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId },
        select: {
          openaiApiKey: true,
          claudeApiKey: true,
          airlabsApiKey: true,
          aviationstackApiKey: true,
          aerodataboxApiKey: true,
        },
      });

      if (userSettings) {
        let hasUserKey = false;
        switch (provider) {
          case 'openai':
            hasUserKey = !!userSettings.openaiApiKey;
            break;
          case 'claude':
            hasUserKey = !!userSettings.claudeApiKey;
            break;
          case 'airlabs':
            hasUserKey = !!userSettings.airlabsApiKey;
            break;
          case 'aviationstack':
            hasUserKey = !!userSettings.aviationstackApiKey;
            break;
          case 'aerodatabox':
            hasUserKey = !!userSettings.aerodataboxApiKey;
            break;
        }

        if (hasUserKey) {
          return { hasAccess: true, isShared: false };
        }
      }
    }

    // Check global key
    const adminSettings = await prisma.adminSettings.findFirst();
    if (adminSettings) {
      let hasGlobalKey = false;
      try {
        switch (provider) {
          case 'openai':
            hasGlobalKey = !!adminSettings.globalOpenaiApiKey;
            break;
          case 'claude':
            hasGlobalKey = !!adminSettings.globalClaudeApiKey;
            break;
          case 'airlabs':
            hasGlobalKey = !!adminSettings.globalAirlabsApiKey;
            break;
          case 'aviationstack':
            hasGlobalKey = !!adminSettings.globalAviationstackApiKey;
            break;
          case 'aerodatabox':
            hasGlobalKey = !!adminSettings.globalAerodataboxApiKey;
            break;
        }
      } catch (error: unknown) {
        // Field might not exist in database yet
        logger.warn({
          operation: 'api_key_access_check_field_error',
          message: 'Field might not exist in database',
          provider,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      if (hasGlobalKey) {
        return { hasAccess: true, isShared: true };
      }
    }

    // Check ENV variable
    let hasEnvKey = false;
    switch (provider) {
      case 'openai':
        hasEnvKey = !!process.env.OPENAI_API_KEY;
        break;
      case 'claude':
        hasEnvKey = !!process.env.CLAUDE_API_KEY;
        break;
      case 'airlabs':
        hasEnvKey = !!process.env.AIRLABS_API_KEY;
        break;
      case 'aviationstack':
        hasEnvKey = !!process.env.AVIATIONSTACK_API_KEY;
        break;
      case 'aerodatabox':
        hasEnvKey = !!process.env.AERODATABOX_API_KEY;
        break;
    }

    return { hasAccess: hasEnvKey, isShared: false };
  } catch (error) {
    logger.error({
      operation: 'api_key_access_check_error',
      message: 'Failed to check API key access',
      context: {
        provider,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
    });
    return { hasAccess: false, isShared: false };
  }
}
