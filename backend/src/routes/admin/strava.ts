import { Router, Response, NextFunction } from "express";
import { z } from "zod";

import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { encryptApiKey } from "../../utils/encryption";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import logger from "../../utils/logger";

/**
 * The operator's own Strava API application (2.7). Mounted under
 * `/admin`, behind the admin router's authenticate + requireAdmin.
 *
 * The secret is write-only: GET says whether one is set, never what it is.
 * `null` clears a field; omitting it leaves it as it was.
 */
const router = Router();

const stravaAdminSchema = z
  .object({
    clientId: z
      .string()
      .trim()
      .regex(/^\d{1,20}$/, "A Strava client id is a number")
      .nullable(),
    clientSecret: z.string().trim().min(10).max(200).nullable(),
  })
  .partial();

router.get("/", async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const row = await prisma.adminSettings.findFirst({
      orderBy: { id: "asc" },
      select: { stravaClientId: true, stravaClientSecret: true },
    });
    res.json({
      clientId: row?.stravaClientId ?? null,
      secretSet: Boolean(row?.stravaClientSecret),
      envConfigured: Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET),
    });
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parsed = stravaAdminSchema.safeParse(req.body);
    if (!parsed.success) throw new AppError(parsed.error.message, 400);
    const id = await ensureAdminSettingsRow();
    const data: { stravaClientId?: string | null; stravaClientSecret?: string | null } = {};
    if (parsed.data.clientId !== undefined) data.stravaClientId = parsed.data.clientId;
    if (parsed.data.clientSecret !== undefined) {
      data.stravaClientSecret =
        parsed.data.clientSecret === null ? null : encryptApiKey(parsed.data.clientSecret);
    }
    const row = await prisma.adminSettings.update({
      where: { id },
      data,
      select: { stravaClientId: true, stravaClientSecret: true },
    });
    logger.info({ message: "strava_client_updated", context: { fields: Object.keys(data) } });
    res.json({
      clientId: row.stravaClientId,
      secretSet: Boolean(row.stravaClientSecret),
      envConfigured: Boolean(process.env.STRAVA_CLIENT_ID && process.env.STRAVA_CLIENT_SECRET),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
