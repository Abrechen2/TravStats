/**
 * Per-user Immich connection. Mounted under `/api/v1/settings/immich`, whose
 * parent router already applies `authenticate` + `requireWriteScope`.
 *
 * The API key is write-only from the client's perspective: it goes in
 * encrypted and never comes back out.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { encryptApiKey } from "../../utils/encryption";
import { immichConnectionSchema, immichTestSchema } from "../../schemas/immich";
import { getImmichConnection } from "../../services/immich/immichResolver";
import { testImmichConnection } from "../../services/immich/immichTester";
import { ImmichError, normalizeImmichBaseUrl } from "../../services/immich/types";
import logger from "../../utils/logger";

const router = Router();

interface ImmichUserUpdateData {
  immichBaseUrl?: string | null;
  immichApiKey?: string | null;
  immichDefaultMode?: string;
}

async function readStatus(userId: string): Promise<Record<string, unknown>> {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: { immichBaseUrl: true, immichApiKey: true, immichDefaultMode: true },
  });
  const conn = await getImmichConnection(userId);

  return {
    baseUrl: settings?.immichBaseUrl ?? null,
    hasKey: Boolean(settings?.immichApiKey),
    defaultMode: settings?.immichDefaultMode === "import" ? "import" : "link",
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
    const payload = immichConnectionSchema.parse(req.body);

    const update: ImmichUserUpdateData = {};

    if (payload.baseUrl !== undefined) {
      if (payload.baseUrl === null) {
        update.immichBaseUrl = null;
      } else {
        try {
          update.immichBaseUrl = normalizeImmichBaseUrl(payload.baseUrl);
        } catch (error) {
          throw new AppError(
            error instanceof ImmichError ? error.message : "Invalid Immich URL",
            400,
          );
        }
      }
    }
    if (payload.apiKey !== undefined) {
      update.immichApiKey = payload.apiKey === null ? null : encryptApiKey(payload.apiKey);
    }
    if (payload.defaultMode !== undefined) {
      update.immichDefaultMode = payload.defaultMode;
    }

    await prisma.userSettings.upsert({
      where: { userId },
      update,
      create: { userId, data: {}, ...update },
    });

    logger.info({
      message: "immich_user_connection_updated",
      context: { userId, fields: Object.keys(update) },
    });

    res.json(await readStatus(userId));
  } catch (error) {
    next(error);
  }
});

router.post("/test", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = immichTestSchema.parse(req.body);

    let baseUrl = body.baseUrl;
    let apiKey = body.apiKey;

    // An empty body means "test whatever is currently resolved for me".
    if (!baseUrl || !apiKey) {
      const stored = await getImmichConnection(req.userId!);
      // Machine-readable failure kind, consistent with the gallery routes.
      if (!stored) throw new AppError("notConfigured", 400);
      baseUrl = baseUrl ?? stored.baseUrl;
      apiKey = apiKey ?? stored.apiKey;
    }

    res.json(await testImmichConnection(baseUrl, apiKey));
  } catch (error) {
    next(error);
  }
});

export default router;
