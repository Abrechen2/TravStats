import { Router, type NextFunction, type Response } from "express";
import { type ZodType } from "zod";

import { authenticate, requireWriteScope, type AuthRequest } from "../../middleware/auth";
import { rejectDemo } from "../../middleware/demoGuard";
import { AppError } from "../../middleware/errorHandler";
import {
  fixedPlaceBodySchema,
  homePlaceBodySchema,
  lodgingPlaceBodySchema,
} from "../../schemas/travtrackPlaces";
import {
  createPlace,
  deletePlace,
  HOME_ID,
  listPlaces,
  setLodgingSetting,
  updateHome,
  updatePlace,
} from "../../services/travtrack/places/places";
import logger from "../../utils/logger";
import { travTrackTier } from "./gate";

/**
 * TravTrack's fixed places (spec 2026-11-05-travtrack-fixed-places, S2): any
 * number of `work` and `custom` circles, plus a `home` entry that is derived
 * from the home the server already knows — only its radius and window are
 * written here. Bare (ADR 0001), like the zones beside it. Tiers as the zones':
 * reading and deleting stay `held`, writing is `on`.
 *
 * A bad body answers 400 `{error: "validation", code: "VALIDATION_FAILED"}`;
 * the contract's two words live in `error`, the machine code beside them.
 */

const router = Router();

function route(fn: (req: AuthRequest, res: Response) => Promise<void>) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };
}

const homeIsDerived = () => new AppError("homeIsDerived", 400, "TRAVTRACK_HOME_IS_DERIVED");

function parse<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(
      "validation",
      400,
      "VALIDATION_FAILED",
      result.error.issues[0]?.path.join(".")
    );
  }
  return result.data;
}

/** A work or custom place; `home` is refused with its own answer. */
function placeBody(body: unknown) {
  const parsed = parse(fixedPlaceBodySchema, body);
  if (parsed.kind === "home") throw homeIsDerived();
  return { ...parsed, kind: parsed.kind };
}

router.get(
  "/travtrack/places",
  authenticate,
  travTrackTier("held"),
  route(async (req, res) => {
    res.json(await listPlaces(req.userId!));
  })
);

// Registered before `/:id`, which would read "lodging" as an id.
router.put(
  "/travtrack/places/lodging",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    res.json(await setLodgingSetting(req.userId!, parse(lodgingPlaceBodySchema, req.body)));
  })
);

router.post(
  "/travtrack/places",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    const place = await createPlace(req.userId!, placeBody(req.body));
    logger.info({ operation: "travtrack.places.create", kind: place.kind });
    res.status(201).json(place);
  })
);

router.put(
  "/travtrack/places/:id",
  authenticate,
  travTrackTier("on"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    const id = String(req.params.id);
    if (id === HOME_ID) {
      res.json(await updateHome(req.userId!, parse(homePlaceBodySchema, req.body)));
      return;
    }
    res.json(await updatePlace(req.userId!, id, placeBody(req.body)));
  })
);

router.delete(
  "/travtrack/places/:id",
  authenticate,
  travTrackTier("held"),
  requireWriteScope,
  rejectDemo,
  route(async (req, res) => {
    const id = String(req.params.id);
    if (id === HOME_ID) throw homeIsDerived();
    await deletePlace(req.userId!, id);
    res.status(204).end();
  })
);

export default router;
