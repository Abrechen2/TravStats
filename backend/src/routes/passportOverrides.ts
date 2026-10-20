import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";

import { authenticate, requireWriteScope, type AuthRequest } from "../middleware/auth";
import { rejectDemoWrites } from "../middleware/demoGuard";
import { AppError } from "../middleware/errorHandler";
import { patAwareMax, userOrIpKey } from "../middleware/rateLimit";
import { countryOverrideBodySchema, countryOverrideCodeSchema } from "../schemas/countryOverride";
import {
  deleteCountryOverride,
  listCountryOverrides,
  upsertCountryOverride,
} from "../services/stats/countryOverrideStore";
import { knownCountryCodes } from "../utils/continents";

/**
 * `/api/v1/passport/overrides` — the user's own verdict on a passport country
 * (forgejo#308): list, set, remove. What a verdict does to the passport is
 * `services/stats/countryOverrides.ts`.
 *
 * Enveloped (`{success, data}`, ADR 0001): a new router of its own, not a
 * satellite of the frozen bare `stats` router. Writes need a write-scoped
 * token and refuse the shared demo account, whose passport every visitor of
 * a public instance shares.
 */
const router = Router();
router.use(authenticate);

/**
 * Per user, 60 a minute: far above a person correcting countries one by one,
 * and each write re-reads nothing expensive — the passport is rebuilt only
 * when it is next asked for.
 */
const overrideLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: patAwareMax(60),
  message: { error: "Too many requests, please try again later", code: "RATE_LIMITED" },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request): string => `passport-override:${userOrIpKey(req)}`,
});
router.use(overrideLimiter);

type Handler = (req: AuthRequest, res: Response) => Promise<void>;
const handle =
  (fn: Handler) =>
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      await fn(req, res);
    } catch (err) {
      next(err);
    }
  };

/** The path's country, or a 400 with a code the client maps to its own words. */
function countryOf(req: AuthRequest): string {
  const parsed = countryOverrideCodeSchema.safeParse(req.params.countryCode);
  if (!parsed.success) throw new AppError("Unknown country", 400, "COUNTRY_UNKNOWN");
  return parsed.data;
}

router.get(
  "/",
  handle(async (req, res) => {
    const overrides = await listCountryOverrides(req.userId!);
    // The codes a client may offer: exactly the ones a write accepts.
    res.json({ success: true, data: { overrides, knownCountries: knownCountryCodes() } });
  })
);

router.put(
  "/:countryCode",
  requireWriteScope,
  rejectDemoWrites,
  handle(async (req, res) => {
    const countryCode = countryOf(req);
    const body = countryOverrideBodySchema.parse(req.body ?? {});
    const saved = await upsertCountryOverride(req.userId!, countryCode, {
      verdict: body.verdict,
      note: body.note,
      day: body.day ?? null,
    });
    res.json({ success: true, data: saved });
  })
);

router.delete(
  "/:countryCode",
  requireWriteScope,
  rejectDemoWrites,
  handle(async (req, res) => {
    const countryCode = countryOf(req);
    if (!(await deleteCountryOverride(req.userId!, countryCode))) {
      throw new AppError("No override for this country", 404, "COUNTRY_OVERRIDE_NOT_FOUND");
    }
    res.json({ success: true, data: { countryCode } });
  })
);

export default router;
