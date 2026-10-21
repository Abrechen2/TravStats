import { Router, Response, NextFunction } from "express";
import { z } from "zod";
import { authenticate, AuthRequest } from "../middleware/auth";
import { airlineLogoLimiter, openDataLimiter } from "../middleware/rateLimit";
import { AppError } from "../middleware/errorHandler";
import {
  assertOpenDataEnabled,
  OpenDataDisabledError,
  OpenDataUnavailableError,
} from "../services/openData/http";
import { WIKI_LANGUAGES } from "../services/openData/wikipedia";
import { ownsStop, ownsSubject, STOP_DOMAINS } from "../services/mapDetails/ownership";
import { SUBJECT_KINDS } from "../services/mapDetails/subjectImageLookup";
import {
  answerSubjectImage,
  type SubjectImageAnswer,
} from "../services/mapDetails/subjectImageService";
import { stopWikipediaSummary } from "../services/mapDetails/stopWikipedia";

/**
 * Rich map details (2026-10-21): a picture of what a journey travelled in, for
 * the hover profile, and the Wikipedia opening of a station / terminal / port
 * / rental branch, for its point card. Fetched here, never by the browser, and
 * only for what the caller's OWN rows record (`mapDetails/ownership.ts`).
 * Enveloped like the operator marks (ADR 0001).
 */
const router = Router();
router.use(authenticate);

const subjectQuery = z.object({
  kind: z.enum(SUBJECT_KINDS),
  name: z.string().trim().min(1).max(120),
});

function parseSubject(query: unknown): z.infer<typeof subjectQuery> {
  const parsed = subjectQuery.safeParse(query);
  if (!parsed.success) throw new AppError("A kind and a name are required", 400);
  return parsed.data;
}

async function subjectFor(req: AuthRequest): Promise<SubjectImageAnswer> {
  const { kind, name } = parseSubject(req.query);
  const userId = req.userId;
  if (!userId || !(await ownsSubject(userId, kind, name))) {
    return { picture: null, pending: false };
  }
  return answerSubjectImage(kind, name, { userId });
}

/** GET /map-details/subject?kind=vessel&name=Color%20Fantasy — whether a picture exists, and its credit. */
router.get(
  "/subject",
  airlineLogoLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { picture, pending } = await subjectFor(req);
      res.setHeader("Cache-Control", pending ? "private, no-store" : "private, max-age=3600").json({
        success: true,
        data: picture
          ? { available: true, pending: false, credit: picture.credit }
          : { available: false, pending, credit: null },
      });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /map-details/subject/image?kind=&name= — the picture bytes (raster), or 404. */
router.get(
  "/subject/image",
  airlineLogoLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { picture, pending } = await subjectFor(req);
      if (!picture) {
        res
          .status(404)
          .setHeader("Cache-Control", pending ? "private, no-store" : "private, max-age=3600")
          .json({ success: false, error: "No picture available" });
        return;
      }
      res
        .setHeader("Content-Type", picture.image.contentType)
        .setHeader("Cache-Control", "private, max-age=604800")
        // Third-party bytes: inert wherever opened, and never re-sniffed.
        .setHeader("Content-Security-Policy", "default-src 'none'; sandbox")
        .setHeader("X-Content-Type-Options", "nosniff")
        .send(picture.image.body);
    } catch (error) {
      next(error);
    }
  }
);

const stopQuery = z.object({
  domain: z.enum(STOP_DOMAINS),
  name: z.string().trim().min(1).max(160),
  lat: z.coerce.number().min(-90).max(90),
  lon: z.coerce.number().min(-180).max(180),
  lang: z.enum(WIKI_LANGUAGES).default("en"),
});

/**
 * GET /map-details/stop?domain=rail&name=&lat=&lon=&lang= — the Wikipedia
 * opening of the article about one of the caller's own stations. 409
 * `openDataDisabled` while the instance's open-data switch is off;
 * `unavailable: true` when Wikipedia did not answer — "could not ask" is not
 * "no article".
 */
router.get(
  "/stop",
  openDataLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsed = stopQuery.safeParse(req.query);
      if (!parsed.success) throw new AppError("A domain, a name and a position are required", 400);
      const { domain, name, lat, lon, lang } = parsed.data;
      await assertOpenDataEnabled();
      if (!(await ownsStop(req.userId!, domain, lat, lon))) {
        res.json({ success: true, data: { summary: null, unavailable: false } });
        return;
      }
      try {
        const summary = await stopWikipediaSummary(domain, name, lat, lon, lang);
        res
          .setHeader("Cache-Control", "private, max-age=3600")
          .json({ success: true, data: { summary, unavailable: false } });
      } catch (error) {
        if (!(error instanceof OpenDataUnavailableError)) throw error;
        res.json({ success: true, data: { summary: null, unavailable: true } });
      }
    } catch (error) {
      if (error instanceof OpenDataDisabledError) {
        res.status(409).json({ success: false, error: "openDataDisabled" });
        return;
      }
      next(error);
    }
  }
);

export default router;
