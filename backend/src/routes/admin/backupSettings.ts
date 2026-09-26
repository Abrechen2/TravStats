import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import { prisma } from "../../db";
import { updateSchedule } from "../../services/backupScheduler";
import logger from "../../utils/logger";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import { backupZone, hostBackupZone } from "../../shared/time/schedulerZone";
import { isValidZone } from "../../shared/time/zonedParts";

const backupSettingsSchema = z.object({
  backupEnabled: z.boolean().optional(),
  backupInterval: z.enum(["daily", "weekly", "monthly"]).optional(),
  backupRetentionDays: z.number().int().min(1).max(365).optional(),
  /**
   * IANA zone the backup hour is read in; null = the host's zone, which is
   * what every instance ran in before this setting existed (ADR 0002).
   */
  backupZone: z
    .string()
    .refine((zone) => isValidZone(zone), "ZONE_UNKNOWN")
    .nullable()
    .optional(),
});

/** The zone fields every backup-settings answer carries. */
function zoneFields(stored: string | null | undefined): {
  backupZone: string | null;
  backupZoneEffective: string;
  hostZone: string;
} {
  return {
    backupZone: stored ?? null,
    backupZoneEffective: backupZone().zone,
    hostZone: hostBackupZone().zone,
  };
}

const router = Router();

router.get("/backup-settings", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const adminSettings = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });
    res.json({
      backupEnabled: adminSettings?.backupEnabled ?? false,
      backupInterval: adminSettings?.backupInterval ?? "weekly",
      backupRetentionDays: adminSettings?.backupRetentionDays ?? 30,
      ...zoneFields(adminSettings?.backupZone),
    });
  } catch (error) {
    next(error);
  }
});

router.put("/backup-settings", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      backupEnabled,
      backupInterval,
      backupRetentionDays,
      backupZone: zone,
    } = backupSettingsSchema.parse(req.body);

    let adminSettings = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });

    const updateData: {
      backupEnabled?: boolean;
      backupInterval?: string;
      backupRetentionDays?: number;
      backupZone?: string | null;
    } = {};

    if (backupEnabled !== undefined) updateData.backupEnabled = backupEnabled;
    if (backupInterval !== undefined) updateData.backupInterval = backupInterval;
    if (backupRetentionDays !== undefined) updateData.backupRetentionDays = backupRetentionDays;
    if (zone !== undefined) updateData.backupZone = zone;

    adminSettings = await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: updateData,
    });

    // Re-schedules with the new zone too: a changed zone moves the next run
    // at once, it does not wait for a restart.
    await updateSchedule();

    logger.info({ operation: "backup_settings_updated", context: updateData });

    res.json({
      message: "Backup settings updated",
      backupEnabled: adminSettings.backupEnabled,
      backupInterval: adminSettings.backupInterval,
      backupRetentionDays: adminSettings.backupRetentionDays,
      ...zoneFields(adminSettings.backupZone),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
