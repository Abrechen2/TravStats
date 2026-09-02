/**
 * Admin-global Dawarich connection (tier 2 of the resolver). Mounted under
 * `/api/v1/admin/dawarich`; the parent applies `authenticate` +
 * `requireAdmin` + `requireWriteScope`.
 *
 * Mirrors `admin/immich.ts`: the stored key is returned masked, and a
 * masked value coming back in a PUT is treated as "unchanged" rather than
 * stored. This mount is deliberately outside the published OpenAPI spec
 * (`UNDOCUMENTED_MOUNTS` in `services/openapi/coverage.ts` excludes the
 * whole `admin` mount) — no entry needed here.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { decryptApiKey, encryptApiKey } from "../../utils/encryption";
import {
  dawarichConnectionSchema,
  dawarichCountryDaySweepSchema,
  dawarichTestSchema,
} from "../../schemas/dawarich";
import { runDawarichCountryDaySweep } from "../../jobs/dawarichCountryDaySweepScheduler";
import { testDawarichConnection } from "../../services/dawarich/dawarichTester";
import { DawarichError, normalizeDawarichBaseUrl } from "../../services/dawarich/errors";
import logger from "../../utils/logger";

const router = Router();

interface DawarichAdminUpdateData {
  globalDawarichBaseUrl?: string | null;
  globalDawarichApiKey?: string | null;
}

function maskKey(encrypted: string | null | undefined): string | null {
  if (!encrypted) return null;
  const plain = decryptApiKey(encrypted);
  if (!plain) return null;
  if (plain.length <= 8) return "****";
  return `${plain.slice(0, 4)}****${plain.slice(-4)}`;
}

/**
 * A value the client echoed back from a masked GET carries no new secret.
 * Also true for an empty string (`!value`) — the write branch below is
 * skipped entirely for one, so it is a no-op, not a wipe. Only an explicit
 * `null` clears the stored field.
 */
function looksMasked(value: string | null | undefined): boolean {
  return !value || value.includes("****");
}

router.get("/", async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const admin = await prisma.adminSettings.findFirst();
    res.json({
      baseUrl: admin?.globalDawarichBaseUrl ?? null,
      apiKey: maskKey(admin?.globalDawarichApiKey),
    });
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = dawarichConnectionSchema.parse(req.body);
    const data: DawarichAdminUpdateData = {};

    if (payload.baseUrl !== undefined) {
      if (payload.baseUrl === null) {
        data.globalDawarichBaseUrl = null;
      } else {
        try {
          data.globalDawarichBaseUrl = normalizeDawarichBaseUrl(payload.baseUrl);
        } catch (error) {
          throw new AppError(
            error instanceof DawarichError ? error.message : "Invalid Dawarich URL",
            400,
          );
        }
      }
    }
    if (payload.apiKey !== undefined && !looksMasked(payload.apiKey)) {
      data.globalDawarichApiKey = payload.apiKey === null ? null : encryptApiKey(payload.apiKey);
    } else if (payload.apiKey === null) {
      data.globalDawarichApiKey = null;
    }

    const existing = await prisma.adminSettings.findFirst();
    if (existing) {
      await prisma.adminSettings.update({ where: { id: existing.id }, data });
    } else {
      await prisma.adminSettings.create({ data });
    }

    logger.info({
      message: "dawarich_global_connection_updated",
      context: { fields: Object.keys(data) },
    });

    const admin = await prisma.adminSettings.findFirst();
    res.json({
      baseUrl: admin?.globalDawarichBaseUrl ?? null,
      apiKey: maskKey(admin?.globalDawarichApiKey),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/test", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = dawarichTestSchema.parse(req.body);
    const admin = await prisma.adminSettings.findFirst();

    const baseUrl = body.baseUrl ?? admin?.globalDawarichBaseUrl ?? null;
    const apiKey =
      body.apiKey && !looksMasked(body.apiKey)
        ? body.apiKey
        : decryptApiKey(admin?.globalDawarichApiKey);

    // Machine-readable failure kind, consistent with the Immich routes.
    if (!baseUrl || !apiKey) throw new AppError("notConfigured", 400);

    res.json(await testDawarichConnection(baseUrl, apiKey));
  } catch (error) {
    next(error);
  }
});

/**
 * Run the country-day sweep now instead of waiting for 04:40 UTC (design §8.4).
 *
 * The nightly job is the normal path; this exists for the two moments a night
 * is too long to wait — somebody has just connected Dawarich and wants to see
 * whether it worked, and somebody is diagnosing a country that should or should
 * not be there.
 *
 * Admin rather than per-user, because the sweep is a background job with a
 * budget rather than a request: it may take minutes and it talks to a machine
 * TravStats does not own. It is still per-ACCOUNT in effect — every account it
 * touches uses that account's own connection, never the caller's.
 */
router.post(
  "/country-days/sweep",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const body = dawarichCountryDaySweepSchema.parse(req.body ?? {});
      const result = await runDawarichCountryDaySweep(body);

      logger.info({
        message: "dawarich_country_day_sweep_triggered",
        context: { triggeredBy: req.userId, ...result },
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  },
);

export default router;
