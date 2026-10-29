import { Router, type NextFunction, type Response } from "express";
import { z } from "zod";

import type { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { prisma } from "../../db";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import {
  AEROAPI_COST_MILLI_USD,
  AEROAPI_TIERS,
  getAeroapiUsage,
  readBudgetSettings,
} from "../../services/aeroapiBudget";
import { getLastTrackSweep } from "../../services/aeroapiTrack";

/**
 * FlightAware AeroAPI plan, budget and track switch (forgejo#409). Mounted
 * under `/admin`; bare family like every admin router.
 *
 * - `GET /admin/aeroapi`  the plan, this month's spending and the last track sweep
 * - `PUT /admin/aeroapi`  change the tier, the custom budget or the tracks switch
 */
const router = Router();

const updateSchema = z
  .object({
    tier: z.enum(AEROAPI_TIERS).optional(),
    customBudgetUsd: z.number().min(0).max(100_000).nullable().optional(),
    tracksEnabled: z.boolean().optional(),
  })
  .strict();

async function describe() {
  const [usage, row] = await Promise.all([
    getAeroapiUsage(),
    prisma.adminSettings.findFirst({
      orderBy: { id: "asc" },
      select: { aeroapiTracksEnabled: true },
    }),
  ]);
  return {
    tier: usage.tier,
    customBudgetUsd: usage.customBudgetUsd,
    tracksEnabled: row?.aeroapiTracksEnabled ?? false,
    usage: {
      month: usage.month,
      spentUsd: usage.spentUsd,
      budgetUsd: usage.budgetUsd,
      calls: usage.calls,
      exhausted: usage.exhausted,
    },
    // Unverified until compared with a real invoice (services/aeroapiBudget.ts).
    costUsd: {
      flights: AEROAPI_COST_MILLI_USD.flights / 1000,
      track: AEROAPI_COST_MILLI_USD.track / 1000,
    },
    lastTrackSweep: getLastTrackSweep(),
  };
}

router.get("/aeroapi", async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json(await describe());
  } catch (err) {
    next(err);
  }
});

router.put("/aeroapi", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = updateSchema.parse(req.body);
    const current = await readBudgetSettings();
    const tier = body.tier ?? current.tier;
    const customBudgetUsd =
      body.customBudgetUsd !== undefined ? body.customBudgetUsd : current.customBudgetUsd;
    if (tier === "custom" && (customBudgetUsd === null || customBudgetUsd <= 0)) {
      throw new AppError(
        "A custom AeroAPI tier needs a monthly budget above zero",
        400,
        "AEROAPI_BUDGET_REQUIRED",
        "customBudgetUsd"
      );
    }
    await prisma.adminSettings.update({
      where: { id: await ensureAdminSettingsRow() },
      data: {
        aeroapiTier: tier,
        aeroapiCustomBudgetUsd: tier === "custom" ? customBudgetUsd : null,
        ...(body.tracksEnabled !== undefined ? { aeroapiTracksEnabled: body.tracksEnabled } : {}),
      },
    });
    res.json(await describe());
  } catch (err) {
    next(err);
  }
});

export default router;
