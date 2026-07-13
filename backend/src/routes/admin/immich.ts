/**
 * Admin-global Immich connection (tier 2 of the resolver). Mounted under
 * `/api/v1/admin/immich`; the parent applies `authenticate` + `requireAdmin`
 * + `requireWriteScope`.
 *
 * Mirrors `admin/apiKeys.ts`: the stored key is returned masked, and a masked
 * value coming back in a PUT is treated as "unchanged" rather than stored.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { decryptApiKey, encryptApiKey } from "../../utils/encryption";
import { immichConnectionSchema, immichTestSchema } from "../../schemas/immich";
import { testImmichConnection } from "../../services/immich/immichTester";
import { ImmichError, normalizeImmichBaseUrl } from "../../services/immich/types";
import logger from "../../utils/logger";

const router = Router();

interface ImmichAdminUpdateData {
  globalImmichBaseUrl?: string | null;
  globalImmichApiKey?: string | null;
}

function maskKey(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  const plain = decryptApiKey(encrypted);
  if (!plain) return null;
  if (plain.length <= 8) return "****";
  return `${plain.slice(0, 4)}****${plain.slice(-4)}`;
}

/**
 * A value the client echoed back from a masked GET carries no new secret. Also
 * true for an empty string (`!value`) — the write branch below is skipped
 * entirely for one, so it is a no-op, not a wipe. Only an explicit `null`
 * clears the stored field.
 */
function looksMasked(value: string | null | undefined): boolean {
  return !value || value.includes("****");
}

router.get("/", async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const admin = await prisma.adminSettings.findFirst();
    res.json({
      baseUrl: admin?.globalImmichBaseUrl ?? null,
      apiKey: maskKey(admin?.globalImmichApiKey),
    });
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = immichConnectionSchema.parse(req.body);
    const data: ImmichAdminUpdateData = {};

    if (payload.baseUrl !== undefined) {
      if (payload.baseUrl === null) {
        data.globalImmichBaseUrl = null;
      } else {
        try {
          data.globalImmichBaseUrl = normalizeImmichBaseUrl(payload.baseUrl);
        } catch (error) {
          throw new AppError(
            error instanceof ImmichError ? error.message : "Invalid Immich URL",
            400,
          );
        }
      }
    }
    if (payload.apiKey !== undefined && !looksMasked(payload.apiKey)) {
      data.globalImmichApiKey = payload.apiKey === null ? null : encryptApiKey(payload.apiKey);
    } else if (payload.apiKey === null) {
      data.globalImmichApiKey = null;
    }

    const existing = await prisma.adminSettings.findFirst();
    if (existing) {
      await prisma.adminSettings.update({ where: { id: existing.id }, data });
    } else {
      await prisma.adminSettings.create({ data });
    }

    logger.info({
      message: "immich_global_connection_updated",
      context: { fields: Object.keys(data) },
    });

    const admin = await prisma.adminSettings.findFirst();
    res.json({
      baseUrl: admin?.globalImmichBaseUrl ?? null,
      apiKey: maskKey(admin?.globalImmichApiKey),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/test", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = immichTestSchema.parse(req.body);
    const admin = await prisma.adminSettings.findFirst();

    const baseUrl = body.baseUrl ?? admin?.globalImmichBaseUrl ?? null;
    const apiKey =
      body.apiKey && !looksMasked(body.apiKey)
        ? body.apiKey
        : decryptApiKey(admin?.globalImmichApiKey);

    // Machine-readable failure kind, consistent with the gallery routes.
    if (!baseUrl || !apiKey) throw new AppError("notConfigured", 400);

    res.json(await testImmichConnection(baseUrl, apiKey));
  } catch (error) {
    next(error);
  }
});

export default router;
