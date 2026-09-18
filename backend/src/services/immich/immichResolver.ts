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
import { isSharedDemoUser } from "../../utils/sharedDemo";
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
  decrypt: boolean
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
      /**
       * The SHARED demo account resolves nothing (independent review,
       * 2026-09-17, finding A2). The admin-global and ENV tiers below are the
       * operator lending their own server to every account on the instance —
       * fine for the people they invited, a stranger's photo library for the
       * `demo` login whose password is printed on a public login page. `null`
       * rather than a new error on purpose: it is the same answer an account
       * that configured nothing gets, so the album picker, the asset proxy and
       * the importer take their existing `notConfigured` path and the frontend
       * already has words for it.
       *
       * It costs the preview its demo-Immich showcase. The demo also cannot
       * configure a connection of its own — `/settings/immich` refuses it — so
       * this is the whole integration, deliberately.
       */
      if (await isSharedDemoUser(userId)) return null;

      const settings = await prisma.userSettings.findUnique({
        where: { userId },
        select: { immichBaseUrl: true, immichApiKey: true },
      });
      const user = buildConnection(settings?.immichBaseUrl, settings?.immichApiKey, "user", true);
      if (user) return user;
    }

    const admin = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    const global = buildConnection(
      admin?.globalImmichBaseUrl,
      admin?.globalImmichApiKey,
      "global",
      true
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
