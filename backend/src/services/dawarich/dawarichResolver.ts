/**
 * Resolve the Dawarich connection for a request, mirroring
 * `services/immich/immichResolver.ts`: **User -> Admin-Global -> ENV**.
 *
 * `apiKeyResolver.ts` was considered first (per the task-6 brief) but does
 * not fit: it resolves one encrypted string per provider, while a Dawarich
 * connection needs a base URL AND a key together, exactly like Immich. A
 * tier only counts when it yields BOTH a usable base URL and a decryptable
 * key. A half-configured tier falls through to the next one instead of
 * failing the request — otherwise a stray user URL would shadow a working
 * global setup.
 */
import { prisma } from "../../db";
import { decryptApiKey } from "../../utils/encryption";
import logger from "../../utils/logger";
import { DawarichConnection, DawarichConnectionSource, normalizeDawarichBaseUrl } from "./errors";

/** Build a connection from one tier, or null if the tier is incomplete/invalid. */
function buildConnection(
  rawUrl: string | null | undefined,
  rawKey: string | null | undefined,
  source: DawarichConnectionSource,
  decrypt: boolean,
): DawarichConnection | null {
  if (!rawUrl || !rawKey) return null;

  const apiKey = decrypt ? decryptApiKey(rawKey) : rawKey;
  if (!apiKey) {
    logger.warn({
      message: "dawarich_connection_key_undecryptable",
      context: { source },
    });
    return null;
  }

  try {
    return { baseUrl: normalizeDawarichBaseUrl(rawUrl), apiKey, source };
  } catch {
    logger.warn({
      message: "dawarich_connection_invalid_base_url",
      context: { source },
    });
    return null;
  }
}

export async function getDawarichConnection(userId?: string): Promise<DawarichConnection | null> {
  try {
    if (userId) {
      const settings = await prisma.userSettings.findUnique({
        where: { userId },
        select: { dawarichBaseUrl: true, dawarichApiKey: true },
      });
      const user = buildConnection(
        settings?.dawarichBaseUrl,
        settings?.dawarichApiKey,
        "user",
        true,
      );
      if (user) return user;
    }

    const admin = await prisma.adminSettings.findFirst();
    const global = buildConnection(
      admin?.globalDawarichBaseUrl,
      admin?.globalDawarichApiKey,
      "global",
      true,
    );
    if (global) return global;

    return buildConnection(
      process.env.DAWARICH_BASE_URL,
      process.env.DAWARICH_API_KEY,
      "env",
      false,
    );
  } catch (error) {
    logger.error({
      message: "dawarich_connection_resolution_error",
      error,
      context: { userId },
    });
    return null;
  }
}
