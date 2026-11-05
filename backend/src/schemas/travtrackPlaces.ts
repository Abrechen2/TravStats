import { z } from "zod";

import { WINDOW_TIME } from "../services/travtrack/places/window";

/**
 * TravTrack's fixed places (spec 2026-11-05-travtrack-fixed-places, S2). Every
 * body is strict: a field the contract does not name is refused, so a client
 * that sends a second home point learns it at once.
 */

export const PLACE_RADIUS_MIN_M = 25;
export const PLACE_RADIUS_MAX_M = 2000;
export const PLACE_RADIUS_DEFAULT_M = 150;

const radiusM = z.number().int().min(PLACE_RADIUS_MIN_M).max(PLACE_RADIUS_MAX_M);

const clock = z.string().regex(WINDOW_TIME, "HH:MM");

export const fixedPlaceWindowSchema = z
  .object({
    days: z
      .array(z.number().int().min(1).max(7))
      .min(1)
      .max(7)
      .refine((d) => new Set(d).size === d.length, "days must be distinct"),
    from: clock,
    until: clock,
  })
  .strict()
  .refine((w) => w.from !== w.until, "`from` and `until` must differ");

const placeFields = {
  name: z.string().trim().min(1).max(80),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  radiusM: radiusM.default(PLACE_RADIUS_DEFAULT_M),
  window: fixedPlaceWindowSchema.nullable().default(null),
};

/** `kind: "home"` is parsed (so the route can answer `homeIsDerived`), never accepted. */
export const fixedPlaceBodySchema = z
  .object({ kind: z.enum(["work", "custom", "home"]), ...placeFields })
  .strict();

/** `PUT /travtrack/places/home`: only the circle's size and window; its point is the home setting's. */
export const homePlaceBodySchema = z
  .object({ radiusM, window: fixedPlaceWindowSchema.nullable().default(null) })
  .strict();

export const lodgingPlaceBodySchema = z.object({ enabled: z.boolean(), radiusM }).strict();
