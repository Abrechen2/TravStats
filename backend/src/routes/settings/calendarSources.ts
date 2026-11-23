/**
 * An account's calendar sources (spec 2026-11-23-plugins-and-calendar.md,
 * Part A). Mounted under `/api/v1/settings/calendar-sources`, whose parent
 * already applies `authenticate` + `requireWriteScope` and the demo guard.
 *
 * Secrets go in and never come back: the ICS address is answered by its host,
 * the CalDAV password by `credentialSet`. A failed test or discovery answers
 * 400 with the fixed kind in `error` and the case in `code`.
 */
import { Router, type NextFunction, type Response } from "express";
import rateLimit from "express-rate-limit";
import { z } from "../../schemas/zod";
import type { AuthRequest } from "../../middleware/auth";
import { AppError } from "../../middleware/errorHandler";
import { patAwareMax, userOrIpKey } from "../../middleware/rateLimit";
import {
  caldavDiscoverSchema,
  calendarSourceCreateSchema,
  calendarSourceUpdateSchema,
} from "../../schemas/calendarSources";
import {
  CALENDAR_SERVICE_ID,
  createSource,
  deleteSource,
  listSources,
  normaliseCalendarUrl,
  ownSource,
  policyFor,
  readSourceWindow,
  updateSource,
  viewOf,
} from "../../services/calendar/sources";
import { discoverCollections } from "../../services/calendar/caldav";
import { CalendarError, toCalendarError } from "../../services/calendar/errors";
import { egressBlock, assertEgressAllowed } from "../../services/externalServices/egress";
import { profileZoneOf } from "../../shared/time/profileZone";
import logger from "../../utils/logger";
import {
  calendarRulesPutSchema,
  listRules,
  replaceRules,
  ruleView,
} from "../../services/calendar/rules";

const router = Router();
const TEST_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

/** A test or discovery reaches an outside server: a handful a minute is a person, more is a script. */
const probeLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max: patAwareMax(30),
  keyGenerator: userOrIpKey,
  standardHeaders: true,
  legacyHeaders: false,
});

const failure = (error: unknown): AppError => {
  const f = toCalendarError(error);
  return new AppError(f.kind, 400, f.code ?? undefined);
};

router.get("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await listSources(req.userId!);
    const block = await egressBlock(CALENDAR_SERVICE_ID);
    res.json({ sources: rows.map(viewOf), blocked: block });
  } catch (error) {
    next(error);
  }
});

router.get("/rules", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.json({ rules: (await listRules(req.userId!)).map(ruleView) });
  } catch (error) {
    next(error);
  }
});

/** The whole ordered list at once: the order is what decides which rule wins. */
router.put("/rules", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { rules } = calendarRulesPutSchema.parse(req.body);
    res.json({ rules: (await replaceRules(req.userId!, rules)).map(ruleView) });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const row = await createSource(req.userId!, calendarSourceCreateSchema.parse(req.body));
    logger.info({ operation: "calendar.sourceCreated", userId: req.userId, kind: row.kind });
    res.status(201).json(viewOf(row));
  } catch (error) {
    next(error);
  }
});

router.patch("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const row = await updateSource(req.userId!, id, calendarSourceUpdateSchema.parse(req.body));
    res.json(viewOf(row));
  } catch (error) {
    next(error);
  }
});

router.delete("/:id", async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    await deleteSource(req.userId!, id);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

router.post(
  "/:id/test",
  probeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      z.object({})
        .strict()
        .parse(req.body ?? {});
      const row = await ownSource(req.userId!, id);
      const now = Date.now();
      const window = {
        fromMs: now - TEST_WINDOW_DAYS * DAY_MS,
        untilMs: now + TEST_WINDOW_DAYS * DAY_MS,
      };
      const zone = (await profileZoneOf(req.userId!)).zone;
      try {
        const parsed = await readSourceWindow(row, window, zone);
        res.json({
          ok: true,
          events: parsed.events.length,
          from: new Date(window.fromMs).toISOString(),
          to: new Date(window.untilMs).toISOString(),
          skippedRules: parsed.skippedRules,
        });
      } catch (error) {
        throw failure(error);
      }
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  "/caldav/discover",
  probeLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = caldavDiscoverSchema.parse(req.body);
      const policy = await policyFor(req.userId!);
      const url = normaliseCalendarUrl(body.url, policy);
      try {
        await assertEgressAllowed(CALENDAR_SERVICE_ID);
        const collections = await discoverCollections(
          { url, username: body.username, password: body.password },
          policy
        );
        res.json({ collections });
      } catch (error) {
        if (error instanceof CalendarError || !(error instanceof AppError)) throw failure(error);
        throw error;
      }
    } catch (error) {
      next(error);
    }
  }
);

export default router;
