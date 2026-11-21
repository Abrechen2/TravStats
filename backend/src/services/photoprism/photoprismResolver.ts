/**
 * Resolve the PhotoPrism connection for a request: **User -> Admin-Global**,
 * the same tiers and the same rules as `immich/immichResolver.ts` (a half
 * configured tier falls through only when it is empty, a stored URL this
 * account may no longer reach stays its connection and is refused per request,
 * the shared demo account resolves nothing, and the external-services switch
 * for `photoprism` blocks every tier).
 *
 * The connection type is Immich's on purpose: `apiKey` carries the app
 * password, and the egress policy (`allowPrivate`) means the same thing.
 */
import { prisma } from "../../db";
import { decryptApiKey } from "../../utils/encryption";
import { isSharedDemoAccount } from "../../utils/sharedDemo";
import logger from "../../utils/logger";
import { connectionGate } from "../externalServices/policy";
import {
  normalizeImmichBaseUrl,
  type ImmichConnection,
  type ImmichConnectionSource,
} from "../immich/types";

export const PHOTOPRISM_SERVICE_ID = "photoprism";

function buildConnection(
  rawUrl: string | null | undefined,
  rawToken: string | null | undefined,
  source: ImmichConnectionSource,
  allowPrivate: boolean
): ImmichConnection | null {
  if (!rawUrl || !rawToken) return null;
  const apiKey = decryptApiKey(rawToken);
  if (!apiKey) {
    logger.warn({ message: "photoprism_connection_token_undecryptable", context: { source } });
    return null;
  }
  try {
    // Syntax only: egress is re-checked on every request (forgejo#411).
    return {
      baseUrl: normalizeImmichBaseUrl(rawUrl, { allowPrivate: true }, "PhotoPrism"),
      apiKey,
      source,
      allowPrivate,
    };
  } catch {
    logger.warn({ message: "photoprism_connection_invalid_base_url", context: { source } });
    return null;
  }
}

export async function getPhotoprismConnection(userId?: string): Promise<ImmichConnection | null> {
  try {
    const gate = await connectionGate(PHOTOPRISM_SERVICE_ID, userId);
    if (gate.off) return null;
    if (userId) {
      const caller = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          isDemo: true,
          isAdmin: true,
          username: true,
          settings: { select: { photoprismBaseUrl: true, photoprismToken: true } },
        },
      });
      if (caller && isSharedDemoAccount(caller)) return null;
      const own = buildConnection(
        caller?.settings?.photoprismBaseUrl,
        caller?.settings?.photoprismToken,
        "user",
        caller?.isAdmin === true
      );
      if (own && gate.accountMayConnect) return own;
    }
    const admin = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    return buildConnection(
      admin?.globalPhotoprismBaseUrl,
      admin?.globalPhotoprismToken,
      "global",
      true
    );
  } catch (error) {
    logger.error({ message: "photoprism_connection_resolution_error", error, context: { userId } });
    return null;
  }
}
