import { NextFunction, Response, Router } from "express";
import { z } from "zod";

import { prisma } from "../db";
import { authenticate, AuthRequest, requireWriteScope } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { serverPushEnabled } from "../services/push/devices";

/**
 * /api/v1/devices/me/push — the calling phone's push registration
 * (Companion spec §3.2, TravStats#156).
 *
 * Only a paired device (an API token) has a "me"; a browser session gets 400.
 * The push token and the public key go in and never come back out: GET
 * answers with the switches only. Registering while the admin has not
 * switched push on is allowed — the phone is ready the moment they do — but
 * nothing is sent until then (`serverPushEnabled` tells the phone why).
 * `mutedTripIds` is the phone's per-trip reminder switch (forgejo#286), applied
 * by the dispatcher to reminders only.
 */
export const devicePushBody = z
  .object({
    platform: z.enum(["ios", "android"]),
    token: z.string().regex(/^[A-Za-z0-9:_\-.]{16,4096}$/),
    apnsEnvironment: z.enum(["production", "sandbox"]).optional(),
    publicKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .refine((key) => Buffer.from(key, "base64url").length === 32, "publicKey must be 32 bytes"),
    flightChanges: z.boolean().default(true),
    reminders: z.boolean().default(true),
    locale: z.enum(["de", "en"]).default("de"),
    // Per-trip reminder mute (forgejo#286). Optional on purpose: a phone that
    // re-registers (token rotation) without it keeps its list.
    mutedTripIds: z.array(z.string().min(1).max(64)).max(500).optional(),
  })
  .strict();

const router = Router();
router.use(authenticate);
// PUT/DELETE change the registration; a read-only token may only GET it.
router.use(requireWriteScope);

function deviceTokenId(req: AuthRequest): string {
  if (!req.apiToken)
    throw new AppError("This route is for a paired device, not a browser session", 400);
  return req.apiToken.id;
}

router.put("/me/push", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const apiTokenId = deviceTokenId(req);
    const parsed = devicePushBody.safeParse(req.body);
    if (!parsed.success) throw new AppError("Invalid push registration", 400);
    const { mutedTripIds, ...fields } = parsed.data;
    const muted = mutedTripIds === undefined ? undefined : [...new Set(mutedTripIds)];
    const data = {
      ...fields,
      // An Android phone has no APNs environment; never store a stray one.
      apnsEnvironment:
        parsed.data.platform === "ios" ? (parsed.data.apnsEnvironment ?? "production") : null,
    };
    await prisma.devicePush.upsert({
      where: { apiTokenId },
      create: { apiTokenId, userId: req.userId!, ...data, mutedTripIds: muted ?? [] },
      update: { ...data, ...(muted !== undefined && { mutedTripIds: muted }) },
    });
    res.json({ registered: true, serverPushEnabled: await serverPushEnabled() });
  } catch (err) {
    next(err);
  }
});

router.get("/me/push", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const apiTokenId = deviceTokenId(req);
    const [row, enabled] = await Promise.all([
      prisma.devicePush.findUnique({
        where: { apiTokenId },
        select: {
          platform: true,
          flightChanges: true,
          reminders: true,
          locale: true,
          mutedTripIds: true,
        },
      }),
      serverPushEnabled(),
    ]);
    if (!row) {
      res.status(404).json({ error: "not_registered", serverPushEnabled: enabled });
      return;
    }
    res.json({ ...row, serverPushEnabled: enabled });
  } catch (err) {
    next(err);
  }
});

router.delete("/me/push", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const apiTokenId = deviceTokenId(req);
    await prisma.devicePush.deleteMany({ where: { apiTokenId } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

export default router;
