import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { AuthRequest } from "../../middleware/auth";
import {
  applyLegacyEdit,
  applyLegacyMove,
  legacyHistoryOf,
  sortPeriods,
  type HomePeriod,
} from "../../utils/homeAirport";
import { homePeriodsBodySchema, nearbyHomeAirportsQuerySchema } from "../../schemas/home";
import {
  loadAirportsForHome,
  loadHomePeriods,
  saveHomePeriods,
} from "../../services/home/homeStore";
import { findNearbyHomeAirports } from "../../services/home/nearbyAirports";
import { triggerDataQualityChecks } from "../../services/dataQualityTrigger";
import { todayIn } from "../../shared/time/clock";
import { profileZoneOf } from "../../shared/time/profileZone";

/**
 * `/settings/home-airports` — "Zuhause": residence plus home airports, by date
 * (`utils/homeAirport.ts`). Bare family, like the rest of `/settings`.
 *
 * Every answer carries BOTH shapes: `periods` (the model) and `history` (the
 * old one-airport list, one entry per period, its primary airport). The
 * Companion reads `history` from `GET /` and must keep working until it learns
 * `periods`. The old writes — POST a move, PATCH/DELETE by index — still work
 * and are converted onto the periods; the index is the period's position,
 * which is the same list in the same order.
 */

const router = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const moveSchema = z.object({
  iata: z
    .string()
    .min(2)
    .max(4)
    .transform((v) => v.trim().toUpperCase()),
  /** Date of the move. Optional — defaults to today in the profile zone. */
  fromDate: z.string().regex(ISO_DATE).optional(),
});

const editSchema = z.object({
  iata: z
    .string()
    .min(2)
    .max(4)
    .transform((v) => v.trim().toUpperCase())
    .optional(),
  fromDate: z.string().regex(ISO_DATE).optional(),
  toDate: z.string().regex(ISO_DATE).nullable().optional(),
});

function view(periods: readonly HomePeriod[]) {
  return { history: legacyHistoryOf(periods), periods };
}

/** Store, then let the inbox re-ask or close its question about the residence. */
async function save(userId: string, periods: readonly HomePeriod[]): Promise<void> {
  await saveHomePeriods(userId, periods);
  void triggerDataQualityChecks(userId, { trigger: "home_settings" });
}

async function airportFor(code: string) {
  return (await loadAirportsForHome([code])).get(code) ?? null;
}

// GET / — both shapes, oldest period first.
router.get("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json(view(await loadHomePeriods(req.userId!)));
  } catch (error) {
    next(error);
  }
});

// GET /nearby?lat&lon — the airports the settings page offers for a residence.
router.get(
  "/nearby",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = nearbyHomeAirportsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        res.status(400).json({ error: "HOME_NEARBY_INVALID", issues: parsed.error.issues });
        return;
      }
      res.json({
        airports: await findNearbyHomeAirports(req.userId!, parsed.data.lat, parsed.data.lon),
      });
    } catch (error) {
      next(error);
    }
  }
);

// PUT /periods — the whole list, validated, replaced at once.
router.put(
  "/periods",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = homePeriodsBodySchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "HOME_PERIODS_INVALID", issues: parsed.error.issues });
        return;
      }
      const periods = sortPeriods(parsed.data.periods);
      // A choice must carry its data: every airport has to be one the
      // catalogue knows, or the statistics would silently skip it.
      const codes = [...new Set(periods.flatMap((p) => p.airports.map((a) => a.code)))];
      const known = await loadAirportsForHome(codes);
      const unknown = codes.filter((c) => !known.has(c));
      if (unknown.length > 0) {
        res.status(400).json({ error: "HOME_AIRPORT_UNKNOWN", codes: unknown });
        return;
      }
      await save(req.userId!, periods);
      res.json(view(periods));
    } catch (error) {
      next(error);
    }
  }
);

// POST / — old shape: "I moved". Closes the running period, opens a new one.
router.post("/", async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { iata, fromDate } = moveSchema.parse(req.body);
    const moveDate = fromDate || todayIn((await profileZoneOf(req.userId!)).zone);
    const periods = await loadHomePeriods(req.userId!);
    const updated = applyLegacyMove(periods, iata, moveDate, await airportFor(iata));
    await save(req.userId!, updated);
    res.json(view(updated));
  } catch (error) {
    next(error);
  }
});

// PATCH /:index — old shape: correct one period (its primary airport or dates).
router.patch(
  "/:index",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idx = Number(req.params.index);
      if (!Number.isInteger(idx) || idx < 0) {
        res.status(400).json({ error: "Invalid index" });
        return;
      }
      const patch = editSchema.parse(req.body);
      const periods = await loadHomePeriods(req.userId!);
      if (idx >= periods.length) {
        res.status(404).json({ error: "Entry not found" });
        return;
      }
      const airport = patch.iata ? await airportFor(patch.iata) : null;
      const edited = applyLegacyEdit(periods[idx], patch, airport);
      const sorted = sortPeriods(periods.map((p, i) => (i === idx ? edited : p)));
      await save(req.userId!, sorted);
      res.json(view(sorted));
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:index — remove one period entirely (e.g. accidentally added).
router.delete(
  "/:index",
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idx = Number(req.params.index);
      if (!Number.isInteger(idx) || idx < 0) {
        res.status(400).json({ error: "Invalid index" });
        return;
      }
      const periods = await loadHomePeriods(req.userId!);
      if (idx >= periods.length) {
        res.status(404).json({ error: "Entry not found" });
        return;
      }
      const updated = periods.filter((_, i) => i !== idx);
      await save(req.userId!, updated);
      res.json(view(updated));
    } catch (error) {
      next(error);
    }
  }
);

export default router;
