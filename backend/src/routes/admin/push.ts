/**
 * Admin push-relay settings: the consent switch, the relay address and the
 * registration state. Mounted under `/api/v1/admin/push`; the parent applies
 * `authenticate` + `requireAdmin` + `requireWriteScope`. Outside the published
 * OpenAPI spec (`UNDOCUMENTED_MOUNTS` excludes the whole `admin` mount).
 *
 * Until the admin switches push on, this server never contacts the relay
 * (owner decision 2026-10-01); `services/push/relayClient.ts` reads these
 * columns on every call, so nothing here needs to invalidate a cache. Turning
 * push off, changing the relay address or resetting clears the instance
 * credentials, which makes the next push register the instance anew.
 */
import { Router, Response, NextFunction } from "express";
import { prisma } from "../../db";
import { AuthRequest } from "../../middleware/auth";
import { pushSettingsUpdateSchema } from "../../schemas/pushAdmin";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";

const router = Router();

const CLEARED_CREDENTIALS = { pushInstanceId: null, pushInstanceSecret: null } as const;

async function readState(id: number) {
  const row = await prisma.adminSettings.findUniqueOrThrow({
    where: { id },
    select: {
      pushEnabled: true,
      pushRelayUrl: true,
      pushInstanceId: true,
      pushInstanceSecret: true,
      pushPausedUntil: true,
      pushConsentAt: true,
    },
  });
  // The secret (or its ciphertext) never leaves the server: only whether it exists.
  return {
    pushEnabled: row.pushEnabled,
    pushRelayUrl: row.pushRelayUrl,
    registered: Boolean(row.pushInstanceId && row.pushInstanceSecret),
    pausedUntil: row.pushPausedUntil,
    consentAt: row.pushConsentAt,
  };
}

router.get("/", async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(await readState(await ensureAdminSettingsRow()));
  } catch (error) {
    next(error);
  }
});

router.put("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const payload = pushSettingsUpdateSchema.parse(req.body);
    const id = await ensureAdminSettingsRow();
    const current = await prisma.adminSettings.findUniqueOrThrow({
      where: { id },
      select: { pushEnabled: true, pushRelayUrl: true },
    });

    const data: Record<string, unknown> = {};
    if (payload.pushEnabled === true && !current.pushEnabled) {
      data.pushEnabled = true;
      data.pushConsentAt = new Date();
    } else if (payload.pushEnabled === false) {
      // Withdrawal: no consent on record, nothing registered at the relay.
      Object.assign(data, { pushEnabled: false, pushConsentAt: null, ...CLEARED_CREDENTIALS });
    }
    if (payload.pushRelayUrl !== undefined && payload.pushRelayUrl !== current.pushRelayUrl) {
      // Credentials belong to the relay that issued them.
      Object.assign(data, { pushRelayUrl: payload.pushRelayUrl, ...CLEARED_CREDENTIALS });
    }

    if (Object.keys(data).length > 0) {
      await prisma.adminSettings.update({ where: { id }, data });
    }
    res.json(await readState(id));
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/admin/push/reset — forget the registration; the next push registers anew.
router.post(
  "/reset",
  async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const id = await ensureAdminSettingsRow();
      await prisma.adminSettings.update({
        where: { id },
        data: { ...CLEARED_CREDENTIALS, pushPausedUntil: null },
      });
      res.json(await readState(id));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
