/**
 * Resolve the Immich connection for a request, mirroring `apiKeyResolver.ts`:
 * **User -> Admin-Global -> ENV**.
 *
 * A tier only counts when it yields BOTH a usable base URL and a decryptable
 * key. A half-configured tier falls through to the next one instead of failing
 * the request — otherwise a stray user URL would shadow a working global setup.
 */
import { prisma } from "../../db";
import { decryptApiKey } from "../../utils/encryption";
import logger from "../../utils/logger";
import {
  ImmichConnection,
  ImmichConnectionSource,
  ImmichMode,
  normalizeImmichBaseUrl,
} from "./types";

/** Build a connection from one tier, or null if the tier is incomplete/invalid. */
function buildConnection(
  rawUrl: string | null | undefined,
  rawKey: string | null | undefined,
  source: ImmichConnectionSource,
  decrypt: boolean,
): ImmichConnection | null {
  if (!rawUrl || !rawKey) return null;

  const apiKey = decrypt ? decryptApiKey(rawKey) : rawKey;
  if (!apiKey) {
    logger.warn({
      message: "immich_connection_key_undecryptable",
      context: { source },
    });
    return null;
  }

  try {
    return { baseUrl: normalizeImmichBaseUrl(rawUrl), apiKey, source };
  } catch {
    logger.warn({
      message: "immich_connection_invalid_base_url",
      context: { source },
    });
    return null;
  }
}

export async function getImmichConnection(userId?: string): Promise<ImmichConnection | null> {
  try {
    if (userId) {
      const settings = await prisma.userSettings.findUnique({
        where: { userId },
        select: { immichBaseUrl: true, immichApiKey: true },
      });
      const user = buildConnection(settings?.immichBaseUrl, settings?.immichApiKey, "user", true);
      if (user) return user;
    }

    const admin = await prisma.adminSettings.findFirst();
    const global = buildConnection(
      admin?.globalImmichBaseUrl,
      admin?.globalImmichApiKey,
      "global",
      true,
    );
    if (global) return global;

    return buildConnection(process.env.IMMICH_BASE_URL, process.env.IMMICH_API_KEY, "env", false);
  } catch (error) {
    logger.error({
      message: "immich_connection_resolution_error",
      error,
      context: { userId },
    });
    return null;
  }
}

export async function getImmichDefaultMode(userId: string): Promise<ImmichMode> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { immichDefaultMode: true },
  });
  return settings?.immichDefaultMode === "import" ? "import" : "link";
}
