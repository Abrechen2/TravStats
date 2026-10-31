import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import { prisma } from "../../db";
import { REMINDER_USER_SELECT } from "../../services/reminders/prefs";
import { applySettings, domainsInput, domainsView } from "../../services/reminders/settingsApi";
import { pushStatusFor } from "../../services/push/deviceStatus";

const router = Router();

const notificationPrefsSchema = z.object({
  notificationEmail: z.string().email().optional().nullable(),
  notifyBefore24h: z.boolean().optional(),
  notifyBefore2h: z.boolean().optional(),
  domains: domainsInput.optional(),
});

/**
 * The legacy fields (`notificationEmail`, `notifyBefore24h`, `notifyBefore2h`)
 * stay exactly as old clients know them; `domains`, `mail` and `push` are
 * additive. `push` describes the CALLING device (see services/push/deviceStatus).
 */
async function view(req: AuthRequest, userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: REMINDER_USER_SELECT.select,
  });
  if (!user) return null;
  return {
    notificationEmail: user.notificationEmail,
    notifyBefore24h: user.notifyBefore24h,
    notifyBefore2h: user.notifyBefore2h,
    domains: domainsView(user),
    mail:
      user.notificationEmail !== null
        ? { available: true, reason: null }
        : { available: false, reason: "no_email" },
    push: await pushStatusFor(userId, req.apiToken?.id),
  };
}

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const body = await view(req, userId);
    if (!body) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(body);
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { domains, ...legacy } = notificationPrefsSchema.parse(req.body);
    await applySettings(userId, legacy, domains);
    const body = await view(req, userId);
    if (!body) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    res.json(body);
  } catch (error) {
    next(error);
  }
});

export default router;
