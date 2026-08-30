/**
 * Per-user Dawarich connection. Mounted under `/api/v1/settings/dawarich`,
 * whose parent router already applies `authenticate` + `requireWriteScope`.
 *
 * The API key is write-only from the client's perspective: it goes in
 * encrypted and never comes back out. Mirrors `settings/immich.ts` minus
 * the link/import mode toggle — Dawarich has no equivalent, it is pull-only
 * points history, not albums.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { encryptApiKey } from "../../utils/encryption";
import { dawarichConnectionSchema, dawarichTestSchema } from "../../schemas/dawarich";
import { getDawarichConnection } from "../../services/dawarich/dawarichResolver";
import { testDawarichConnection } from "../../services/dawarich/dawarichTester";
import { DawarichError, normalizeDawarichBaseUrl } from "../../services/dawarich/errors";
import logger from "../../utils/logger";

const router = Router();

interface DawarichUserUpdateData {
  dawarichBaseUrl?: string | null;
  dawarichApiKey?: string | null;
}

async function readStatus(userId: string): Promise<Record<string, unknown>> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { dawarichBaseUrl: true, dawarichApiKey: true },
  });
  const conn = await getDawarichConnection(userId);

  return {
    baseUrl: settings?.dawarichBaseUrl ?? null,
    hasKey: Boolean(settings?.dawarichApiKey),
    source: conn?.source ?? null,
    isShared: conn !== null && conn.source !== "user",
    hasAccess: conn !== null,
  };
}

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await readStatus(req.userId!));
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.userId!;
    const payload = dawarichConnectionSchema.parse(req.body);

    const update: DawarichUserUpdateData = {};

    if (payload.baseUrl !== undefined) {
      if (payload.baseUrl === null) {
        update.dawarichBaseUrl = null;
      } else {
        try {
          update.dawarichBaseUrl = normalizeDawarichBaseUrl(payload.baseUrl);
        } catch (error) {
          // Preserve the machine-readable `kind` (always `invalidUrl` here —
          // `normalizeDawarichBaseUrl` never throws any other kind) instead
          // of the earlier prose message, which the frontend's
          // `dawarichFailureKind()` cannot parse and which then fell back to
          // labelling every save failure "Dawarich is unreachable" — telling
          // a user who mistyped their hostname to debug a server that was
          // never contacted.
          throw new AppError(error instanceof DawarichError ? error.kind : "invalidUrl", 400);
        }
      }
    }
    if (payload.apiKey !== undefined) {
      update.dawarichApiKey = payload.apiKey === null ? null : encryptApiKey(payload.apiKey);
    }

    await prisma.userSettings.upsert({
      where: { userId },
      update,
      create: { userId, data: {}, ...update },
    });

    logger.info({
      message: "dawarich_user_connection_updated",
      context: { userId, fields: Object.keys(update) },
    });

    res.json(await readStatus(userId));
  } catch (error) {
    next(error);
  }
});

router.post("/test", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = dawarichTestSchema.parse(req.body);

    let baseUrl = body.baseUrl;
    let apiKey = body.apiKey;

    // An empty body means "test whatever is currently resolved for me".
    if (!baseUrl || !apiKey) {
      const stored = await getDawarichConnection(req.userId!);
      // Machine-readable failure kind, consistent with the Immich routes.
      if (!stored) throw new AppError("notConfigured", 400);
      baseUrl = baseUrl ?? stored.baseUrl;
      apiKey = apiKey ?? stored.apiKey;
    }

    res.json(await testDawarichConnection(baseUrl, apiKey));
  } catch (error) {
    next(error);
  }
});

export default router;
