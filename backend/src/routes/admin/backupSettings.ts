import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import { prisma } from "../../db";
import { updateSchedule } from "../../services/backupScheduler";
import logger from "../../utils/logger";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import { backupZone, hostBackupZone } from "../../shared/time/schedulerZone";
import { isValidZone } from "../../shared/time/zonedParts";

/**
 * Automatic backups cannot be switched off any more (settings v3 S6, Part A):
 * only the rhythm, the retention and the zone are choices. The field stays in
 * the answers, always true, and a `backupEnabled` in a request is ignored, so
 * a client that still sends it keeps working.
 */
const AUTO_BACKUP_ALWAYS_ON = true;

const backupSettingsSchema = z.object({
  backupCloudRetention: z.boolean().optional(),
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
      backupEnabled: AUTO_BACKUP_ALWAYS_ON,
      backupInterval: adminSettings?.backupInterval ?? "weekly",
      backupRetentionDays: adminSettings?.backupRetentionDays ?? 30,
      backupCloudRetention: adminSettings?.backupCloudRetention ?? false,
      ...zoneFields(adminSettings?.backupZone),
    });
  } catch (error) {
    next(error);
  }
});

router.put("/backup-settings", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      backupInterval,
      backupRetentionDays,
      backupCloudRetention,
      backupZone: zone,
    } = backupSettingsSchema.parse(req.body);

    let adminSettings = await prisma.adminSettings.findFirst({ orderBy: { id: "asc" } });

    const updateData: {
      backupInterval?: string;
      backupRetentionDays?: number;
      backupCloudRetention?: boolean;
      backupZone?: string | null;
    } = {};

    if (backupInterval !== undefined) updateData.backupInterval = backupInterval;
    if (backupCloudRetention !== undefined) updateData.backupCloudRetention = backupCloudRetention;
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
      backupEnabled: AUTO_BACKUP_ALWAYS_ON,
      backupInterval: adminSettings.backupInterval,
      backupRetentionDays: adminSettings.backupRetentionDays,
      backupCloudRetention: adminSettings.backupCloudRetention,
      ...zoneFields(adminSettings.backupZone),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
