import { z } from "./zod";

import { LEG_MODES } from "../services/tour/tourDistance";
import { ROADTRIP_VEHICLES, ROUTE_KINDS, TOUR_ACTIVITIES } from "../shared/tour/roadtrip";

/**
 * Validation for the roadtrip endpoints and for the kind-specific fields a
 * tour gained (design 2026-09-24). A roadtrip is a `TripRoute` row, so the
 * leg, track and geometry endpoints under `/tours/:routeId` stay the ones
 * that validate those; this file covers only what is new.
 */

const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const odometer = z.number().int().min(0).max(10_000_000);

export const createRoadtripSchema = z.object({
  name: z.string().trim().min(1).max(200),
  /** Default mode for new legs; a roadtrip is on the road unless it says so. */
  mode: z.enum(LEG_MODES).default("road"),
  vehicle: z.enum(ROADTRIP_VEHICLES).nullish(),
  vehicleName: z.string().trim().min(1).max(120).nullish(),
  color: hexColor.optional(),
  notes: z.string().max(20000).optional(),
  startOdometerKm: odometer.optional(),
  endOdometerKm: odometer.optional(),
  tripId: z.string().uuid().nullish(),
});

/**
 * One station of the full ordered list. Its night is a discriminated union
 * so the three states cannot be mixed: a `stay` without a stay id, or a
 * `pass` that claims one, is refused at the boundary.
 */
const stationNight = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("stay"), lodgingStayId: z.string().uuid() }).strict(),
  // `.strict()`: a free or pass night that names a stay is a contradiction,
  // refused rather than silently stripped into something the caller did not say.
  z.object({ kind: z.literal("free") }).strict(),
  z.object({ kind: z.literal("pass") }).strict(),
]);

const station = z
  .object({
    /** Omitted for a new station; kept so its legs survive a reorder. */
    id: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(200),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    startDate: z.coerce.date().nullish(),
    endDate: z.coerce.date().nullish(),
    notes: z.string().max(5000).nullish(),
    night: stationNight,
  })
  .refine((s) => !s.startDate || !s.endDate || s.endDate.getTime() >= s.startDate.getTime(), {
    message: "A station cannot end before it starts",
    path: ["endDate"],
  });

/** The complete, ordered station list; replaces whatever was there. */
export const stationsSchema = z.object({
  stations: z.array(station).max(300),
});

/** Move a row between the tour and roadtrip pages. */
export const kindSwitchSchema = z.object({
  kind: z.enum(ROUTE_KINDS),
  activity: z.enum(TOUR_ACTIVITIES).nullish(),
  vehicle: z.enum(ROADTRIP_VEHICLES).nullish(),
});

/** The kind-specific fields PATCH `/tours/:routeId` accepts beside the general ones. */
export const kindFieldsSchema = z.object({
  activity: z.enum(TOUR_ACTIVITIES).nullable().optional(),
  vehicle: z.enum(ROADTRIP_VEHICLES).nullable().optional(),
  vehicleName: z.string().trim().min(1).max(120).nullable().optional(),
  /** Tour only: the roadtrip station the day trip set out from. */
  anchorStopId: z.string().uuid().nullable().optional(),
  /** Attach to a trip, move to another, or detach (null). */
  tripId: z.string().uuid().nullable().optional(),
});

export const listToursQuerySchema = z.object({
  kind: z.enum(ROUTE_KINDS).optional(),
});

export type CreateRoadtripInput = z.infer<typeof createRoadtripSchema>;
export type StationsInput = z.infer<typeof stationsSchema>;
export type KindSwitchInput = z.infer<typeof kindSwitchSchema>;
export type KindFieldsInput = z.infer<typeof kindFieldsSchema>;
