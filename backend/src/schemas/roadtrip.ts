import { z } from "./zod";
import { legacyDayFieldSchema } from "../shared/time/timeInput";

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
  // A pass-through may name the user's own place it passed (tester
  // 2026-09-26), as a stay night names its stay.
  z.object({ kind: z.literal("pass"), placeId: z.string().uuid().nullish() }).strict(),
  // A route correction (tester 2026-09-26): no night, no stay, no name
  // needed — the route bends through it and nothing counts it.
  z.object({ kind: z.literal("via") }).strict(),
]);

const stationDay = legacyDayFieldSchema().transform((iso) => new Date(iso));

const station = z
  .object({
    /** Omitted for a new station; kept so its legs survive a reorder. */
    id: z.string().uuid().optional(),
    // Required for a station; a via point may leave it empty.
    title: z.string().trim().max(200),
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    // A station is dated by DAYS (ADR 0002 D1): `YYYY-MM-DD`, or an
    // offset-bearing string read as the day it writes. `z.coerce.date()` read
    // an offset-less string in the server's zone; it is refused now.
    startDate: stationDay.nullish(),
    endDate: stationDay.nullish(),
    notes: z.string().max(5000).nullish(),
    night: stationNight,
  })
  .refine((s) => !s.startDate || !s.endDate || s.endDate.getTime() >= s.startDate.getTime(), {
    message: "A station cannot end before it starts",
    path: ["endDate"],
  })
  .refine((s) => s.night.kind === "via" || s.title.length > 0, {
    message: "A station needs a name",
    path: ["title"],
  })
  // A via point is a bend in the line, not a place the traveller was at a
  // time: a date on it would put it into days-away and the timeline.
  .refine((s) => s.night.kind !== "via" || (!s.startDate && !s.endDate), {
    message: "A route correction carries no date",
    path: ["startDate"],
  });

/** The complete, ordered station list; replaces whatever was there. */
export const stationsSchema = z.object({
  stations: z.array(station).max(300),
  /**
   * The ids of the stations the writer last read from the server. A full-list
   * write replaces everything — so a list read before the phone appended a
   * station ("Heute Nacht hier", forgejo#271) would delete that station
   * without anyone deciding to. With this, the write is refused (409
   * `ROADTRIP_STATIONS_CHANGED`) when the stored set is no longer the one the
   * writer saw. Optional: a writer that sends none is served as before.
   */
  expectedStationIds: z
    .array(z.string().uuid())
    .max(600)
    .optional()
    .describe(
      "Ids of the stations as last read. When the stored set differs (a station added or " +
        "removed elsewhere, e.g. by the phone), the write is refused with 409 " +
        "ROADTRIP_STATIONS_CHANGED instead of deleting or overwriting it."
    ),
});

/** Move a row between the tour and roadtrip pages. */
export const kindSwitchSchema = z.object({
  kind: z.enum(ROUTE_KINDS),
  activity: z.enum(TOUR_ACTIVITIES).nullish(),
  vehicle: z.enum(ROADTRIP_VEHICLES).nullish(),
});

/** The kind-specific fields PATCH `/tours/:routeId` accepts beside the general ones. */
/** A calendar day as "YYYY-MM-DD" that exists (no 2026-02-30). */
const calendarDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((d) => new Date(`${d}T00:00:00Z`).toISOString().startsWith(d), "Not a calendar day");

/**
 * A day tour's day and start time (acceptance D2, 2026-09-26) — the place's
 * local day and the time of that day, as the user entered them. See
 * `services/tour/tourDay.ts`.
 */
export const tourDayFields = {
  date: calendarDay.nullable().optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
};

export const kindFieldsSchema = z.object({
  ...tourDayFields,
  activity: z.enum(TOUR_ACTIVITIES).nullable().optional(),
  vehicle: z.enum(ROADTRIP_VEHICLES).nullable().optional(),
  vehicleName: z.string().trim().min(1).max(120).nullable().optional(),
  /** Tour only: the roadtrip station the day trip set out from. */
  anchorStopId: z.string().uuid().nullable().optional(),
  /** Attach to a trip, move to another, or detach (null). */
  tripId: z.string().uuid().nullable().optional(),
  /**
   * With `tripId`: move a roadtrip although its stations hold photos of the
   * trip it leaves, taking those photos off their stations (they stay on
   * their trip). Without it such a move is a 409 (forgejo#139).
   */
  detachStationPhotos: z
    .boolean()
    .optional()
    .describe(
      "With `tripId` only: take this roadtrip's station photos off their stations (they stay " +
        "on their trip) and move it. Without it such a move is 409 ROADTRIP_HAS_TRIP_PHOTOS."
    ),
});

export const listToursQuerySchema = z.object({
  kind: z.enum(ROUTE_KINDS).optional(),
});

export type CreateRoadtripInput = z.infer<typeof createRoadtripSchema>;
export type StationsInput = z.infer<typeof stationsSchema>;
export type KindSwitchInput = z.infer<typeof kindSwitchSchema>;
export type KindFieldsInput = z.infer<typeof kindFieldsSchema>;
