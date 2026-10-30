/**
 * API Key Resolver Service
 *
 * Resolves API keys with priority: User Key > Global Key > ENV Variable
 */

import { prisma } from "../db";
import { decryptApiKey } from "../utils/encryption";
import logger from "../utils/logger";
import { serviceForResolverProvider, getService } from "./externalServices/catalogue";
import { loadPolicy, loadPrefs, type OffReason } from "./externalServices/policy";

export type ApiProvider =
  | "openai"
  | "claude"
  | "airlabs"
  | "aviationstack"
  | "aerodatabox"
  | "aeroapi"
  | "adsbx"
  | "adsblol"
  | "opensky"
  | "logostream"
  | "googlePlaces"
  | "openrouteservice"
  | "graphhopper";

export interface OpenSkyCredentials {
  clientId?: string;
  clientSecret?: string;
  username?: string;
  password?: string;
}

/** Where a resolved key came from — decides whose FlightAware account a call bills. */
export type ApiKeySource = "user" | "global" | "env";
export interface ResolvedApiKey {
  key: string | null;
  source: ApiKeySource | null;
  /** Set when the service is switched off (admin for everyone, or this account) — forgejo#392. */
  off?: OffReason;
}
const NO_KEY: ResolvedApiKey = { key: null, source: null };

/**
 * The external-services policy for one lookup (forgejo#392): is the service
 * off for this caller, and may the caller's own key be used at all? "Off" is
 * decided BEFORE any source is read, so it blocks the account key and the
 * ENV fallback alike — an admin who switches a service off means it.
 */
async function policyFor(
  serviceId: string | undefined,
  userId?: string
): Promise<{ off: OffReason | null; accountKeysAllowed: boolean }> {
  if (!serviceId) return { off: null, accountKeysAllowed: true };
  const policy = await loadPolicy();
  if (policy.disabled.includes(serviceId)) return { off: "admin", accountKeysAllowed: false };
  if (userId && (await loadPrefs(userId)).disabled.includes(serviceId)) {
    return { off: "account", accountKeysAllowed: false };
  }
  return { off: null, accountKeysAllowed: !policy.accountKeysForbidden.includes(serviceId) };
}
const envKey = (value: string | undefined): ResolvedApiKey =>
  value ? { key: value, source: "env" } : NO_KEY;

/** Resolve a provider key with its source. Priority: User Key > Global Key > ENV Variable. */
export async function resolveApiKey(
  provider: ApiProvider,
  userId?: string
): Promise<ResolvedApiKey> {
  try {
    const gate = await policyFor(serviceForResolverProvider(provider)?.id, userId);
    if (gate.off) return { ...NO_KEY, off: gate.off };

    // 1. Try user-specific key (unless the admin forbade account keys for this service)
    if (userId && gate.accountKeysAllowed) {
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId },
        select: {
          openaiApiKey: true,
          claudeApiKey: true,
          airlabsApiKey: true,
          aviationstackApiKey: true,
          aerodataboxApiKey: true,
          aeroapiApiKey: true,
          adsbxApiKey: true,
          adsblolApiKey: true,
          openrouteserviceApiKey: true,
          graphhopperApiKey: true,
        },
      });

      if (userSettings) {
        let userKey: string | null = null;

        switch (provider) {
          case "openai":
            userKey = userSettings.openaiApiKey;
            break;
          case "claude":
            userKey = userSettings.claudeApiKey;
            break;
          case "airlabs":
            userKey = userSettings.airlabsApiKey;
            break;
          case "aviationstack":
            userKey = userSettings.aviationstackApiKey;
            break;
          case "aerodatabox":
            userKey = userSettings.aerodataboxApiKey;
            break;
          case "aeroapi":
            userKey = userSettings.aeroapiApiKey;
            break;
          case "adsbx":
            userKey = userSettings.adsbxApiKey;
            break;
          case "adsblol":
            userKey = userSettings.adsblolApiKey;
            break;
          case "openrouteservice":
            userKey = userSettings.openrouteserviceApiKey;
            break;
          case "graphhopper":
            userKey = userSettings.graphhopperApiKey;
            break;
        }

        if (userKey) {
          const decrypted = decryptApiKey(userKey);
          if (decrypted) {
            return { key: decrypted, source: "user" };
          }
        }
      }
    }

    // 2. Try global admin key
    const adminSettings = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    if (adminSettings) {
      let globalKey: string | null = null;

      switch (provider) {
        case "openai":
          globalKey = adminSettings.globalOpenaiApiKey;
          break;
        case "claude":
          globalKey = adminSettings.globalClaudeApiKey;
          break;
        case "airlabs":
          globalKey = adminSettings.globalAirlabsApiKey;
          break;
        case "aviationstack":
          globalKey = adminSettings.globalAviationstackApiKey;
          break;
        case "aerodatabox":
          globalKey = adminSettings.globalAerodataboxApiKey;
          break;
        case "aeroapi":
          globalKey = adminSettings.globalAeroapiApiKey;
          break;
        case "adsbx":
          globalKey = adminSettings.globalAdsbxApiKey;
          break;
        case "adsblol":
          globalKey = adminSettings.globalAdsblolApiKey;
          break;
        // No user-level key for logostream — logos are instance-wide assets,
        // so resolution is global → env only.
        case "logostream":
          globalKey = adminSettings.globalLogostreamApiKey;
          break;
        // Instance-wide like logostream: a map pin is a property of the place,
        // not of who looked it up, so there is no per-user tier.
        case "googlePlaces":
          globalKey = adminSettings.globalGooglePlacesApiKey;
          break;
        case "openrouteservice":
          globalKey = adminSettings.globalOpenrouteserviceApiKey;
          break;
        case "graphhopper":
          globalKey = adminSettings.globalGraphhopperApiKey;
          break;
      }

      if (globalKey) {
        const decrypted = decryptApiKey(globalKey);
        if (decrypted) {
          return { key: decrypted, source: "global" };
        }
      }
    }

    // 3. Fallback to ENV variable
    switch (provider) {
      case "openai":
        return envKey(process.env.OPENAI_API_KEY);
      case "claude":
        return envKey(process.env.CLAUDE_API_KEY);
      case "airlabs":
        return envKey(process.env.AIRLABS_API_KEY);
      case "aviationstack":
        return envKey(process.env.AVIATIONSTACK_API_KEY);
      case "aerodatabox":
        return envKey(process.env.AERODATABOX_API_KEY);
      case "aeroapi":
        return envKey(process.env.AEROAPI_API_KEY);
      case "adsbx":
        return envKey(process.env.ADSBX_RAPIDAPI_KEY);
      case "adsblol":
        return envKey(process.env.ADSBLOL_API_KEY);
      case "logostream":
        return envKey(process.env.LOGOSTREAM_API_KEY);
      case "googlePlaces":
        return envKey(process.env.GOOGLE_PLACES_API_KEY);
      case "openrouteservice":
        return envKey(process.env.OPENROUTESERVICE_API_KEY);
      case "graphhopper":
        return envKey(process.env.GRAPHHOPPER_API_KEY);
      default:
        return NO_KEY;
    }
  } catch (error) {
    logger.error({
      operation: "api_key_resolution_error",
      message: "Failed to resolve API key",
      context: {
        provider,
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
    return NO_KEY;
  }
}

/**
 * The key for a provider, as a string. Priority: User Key > Global Key > ENV.
 * A caller that must act on WHERE the key came from uses `resolveApiKey` and
 * the key and its source from that ONE resolution — a second read could see
 * a different key.
 */
export async function getApiKey(provider: ApiProvider, userId?: string): Promise<string | null> {
  return (await resolveApiKey(provider, userId)).key;
}

/**
 * Get OpenSky credentials with priority resolution
 * Priority: User Credentials > Global Credentials > ENV Variables
 */
export async function getOpenSkyCredentials(userId?: string): Promise<OpenSkyCredentials | null> {
  try {
    const gate = await policyFor(getService("opensky")?.id, userId);
    if (gate.off) return null;

    // 1. Try user-specific credentials (unless the admin forbade account keys)
    if (userId && gate.accountKeysAllowed) {
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
        const hasUserCredentials = userSettings.openskyClientId || userSettings.openskyUsername;

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
    const adminSettings = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    if (adminSettings) {
      const hasGlobalCredentials =
        adminSettings.globalOpenskyClientId || adminSettings.globalOpenskyUsername;

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
            operation: "opensky_credentials_undecryptable",
            message:
              "OpenSky credentials exist in admin_settings but no usable pair could be decrypted — treating as unconfigured",
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
      operation: "opensky_credentials_resolution_error",
      message: "Failed to resolve OpenSky credentials",
      context: {
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
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
    const gate = await policyFor(serviceForResolverProvider(provider)?.id, userId);
    if (gate.off) return { hasAccess: false, isShared: false };

    // Check user key
    if (userId && gate.accountKeysAllowed) {
      const userSettings = await prisma.userSettings.findUnique({
        where: { userId },
        select: {
          openaiApiKey: true,
          claudeApiKey: true,
          airlabsApiKey: true,
          aviationstackApiKey: true,
          aerodataboxApiKey: true,
          aeroapiApiKey: true,
          adsbxApiKey: true,
          adsblolApiKey: true,
          openrouteserviceApiKey: true,
          graphhopperApiKey: true,
        },
      });

      if (userSettings) {
        let hasUserKey = false;
        switch (provider) {
          case "openai":
            hasUserKey = !!decryptApiKey(userSettings.openaiApiKey);
            break;
          case "claude":
            hasUserKey = !!decryptApiKey(userSettings.claudeApiKey);
            break;
          case "airlabs":
            hasUserKey = !!decryptApiKey(userSettings.airlabsApiKey);
            break;
          case "aviationstack":
            hasUserKey = !!decryptApiKey(userSettings.aviationstackApiKey);
            break;
          case "aerodatabox":
            hasUserKey = !!decryptApiKey(userSettings.aerodataboxApiKey);
            break;
          case "aeroapi":
            hasUserKey = !!decryptApiKey(userSettings.aeroapiApiKey);
            break;
          case "adsbx":
            hasUserKey = !!decryptApiKey(userSettings.adsbxApiKey);
            break;
          case "adsblol":
            hasUserKey = !!decryptApiKey(userSettings.adsblolApiKey);
            break;
          case "openrouteservice":
            hasUserKey = !!decryptApiKey(userSettings.openrouteserviceApiKey);
            break;
          case "graphhopper":
            hasUserKey = !!decryptApiKey(userSettings.graphhopperApiKey);
            break;
        }

        if (hasUserKey) {
          return { hasAccess: true, isShared: false };
        }
      }
    }

    // Check global key. A key counts only if it decrypts: a stored ciphertext
    // this instance cannot read serves nobody, and reporting it as "for
    // everyone" contradicted the admin view, which cannot mask it either.
    const adminSettings = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    if (adminSettings) {
      let hasGlobalKey = false;
      try {
        switch (provider) {
          case "openai":
            hasGlobalKey = !!decryptApiKey(adminSettings.globalOpenaiApiKey);
            break;
          case "claude":
            hasGlobalKey = !!decryptApiKey(adminSettings.globalClaudeApiKey);
            break;
          case "airlabs":
            hasGlobalKey = !!decryptApiKey(adminSettings.globalAirlabsApiKey);
            break;
          case "aviationstack":
            hasGlobalKey = !!decryptApiKey(adminSettings.globalAviationstackApiKey);
            break;
          case "aerodatabox":
            hasGlobalKey = !!decryptApiKey(adminSettings.globalAerodataboxApiKey);
            break;
          case "aeroapi":
            hasGlobalKey = !!decryptApiKey(adminSettings.globalAeroapiApiKey);
            break;
          case "adsbx":
            hasGlobalKey = !!decryptApiKey(adminSettings.globalAdsbxApiKey);
            break;
          case "adsblol":
            hasGlobalKey = !!decryptApiKey(adminSettings.globalAdsblolApiKey);
            break;
          case "openrouteservice":
            hasGlobalKey = !!decryptApiKey(adminSettings.globalOpenrouteserviceApiKey);
            break;
          case "graphhopper":
            hasGlobalKey = !!decryptApiKey(adminSettings.globalGraphhopperApiKey);
            break;
        }
      } catch (error: unknown) {
        // Field might not exist in database yet
        logger.warn({
          operation: "api_key_access_check_field_error",
          message: "Field might not exist in database",
          provider,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }

      if (hasGlobalKey) {
        return { hasAccess: true, isShared: true };
      }
    }

    // Check ENV variable
    let hasEnvKey = false;
    switch (provider) {
      case "openai":
        hasEnvKey = !!process.env.OPENAI_API_KEY;
        break;
      case "claude":
        hasEnvKey = !!process.env.CLAUDE_API_KEY;
        break;
      case "airlabs":
        hasEnvKey = !!process.env.AIRLABS_API_KEY;
        break;
      case "aviationstack":
        hasEnvKey = !!process.env.AVIATIONSTACK_API_KEY;
        break;
      case "aerodatabox":
        hasEnvKey = !!process.env.AERODATABOX_API_KEY;
        break;
      case "aeroapi":
        hasEnvKey = !!process.env.AEROAPI_API_KEY;
        break;
      case "adsbx":
        hasEnvKey = !!process.env.ADSBX_RAPIDAPI_KEY;
        break;
      case "adsblol":
        hasEnvKey = !!process.env.ADSBLOL_API_KEY;
        break;
      case "openrouteservice":
        hasEnvKey = !!process.env.OPENROUTESERVICE_API_KEY;
        break;
      case "graphhopper":
        hasEnvKey = !!process.env.GRAPHHOPPER_API_KEY;
        break;
    }

    return { hasAccess: hasEnvKey, isShared: false };
  } catch (error) {
    logger.error({
      operation: "api_key_access_check_error",
      message: "Failed to check API key access",
      context: {
        provider,
        userId,
        error: error instanceof Error ? error.message : "Unknown error",
      },
    });
    return { hasAccess: false, isShared: false };
  }
}
