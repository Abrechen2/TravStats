import { z } from "./zod";
import { currencyField } from "./lodging";
import { partialForUpdate } from "./partialUpdate";
import { CRUISE_SORT_FIELDS } from "../shared/cruiseListOrder";
import {
  instantFieldSchema,
  legacyDayFieldSchema,
  timeFieldSchema,
} from "../shared/time/timeInput";

export const CABIN_TYPES = ["inside", "oceanview", "balcony", "suite"] as const;
const STATUSES = ["scheduled", "flown", "cancelled", "historical"] as const;

/** A port's wall clock, 00:00–23:59 — the shape of an "all aboard" time. */
export const ALL_ABOARD_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * What the list can be FILTERED to — one value wider than what it can be
 * written to.
 *
 * `in_progress` is derived from the dates and stored by the write path and
 * the nightly sweep (spec 2026-07-17-status-from-dates); a client never sends
 * it, so it has no business in the write enum. It is a real stored value
 * though, and the logbook's status dropdown has offered it since
 * "#status-from-dates" — while the filter ran in the browser that cost
 * nothing, and the moment it reaches the server an unlisted value is a 400 on
 * a dropdown entry the app itself drew.
 */
export const CRUISE_QUERY_STATUSES = [...STATUSES, "in_progress"] as const;

// "" and null both mean "clear" on the wire; undefined means "don't change"
// on update. The old empty->undefined transform made clearing impossible:
// the edit modal's blanked field collapsed into "keep the old value".
const emptyToNull = z
  .string()
  .nullable()
  .optional()
  .transform((v) => (v === "" ? null : v));

// An OMITTED field and an explicit "clear this" are different requests, and
// collapsing both to `undefined` made the second impossible: a PATCH with
// `startDate: null` answered 200 and changed nothing, for ever (AUD-089).
// `null` and the empty string both mean the user removed the value — an
// emptied input arrives as "" — so both become an explicit null, and only a
// genuinely absent key stays `undefined`.
const emptyAsNull = (v: unknown): unknown => (v === "" ? null : v);

// Cruise days (start, end, a stop's date) are CALENDAR DAYS at the port (ADR
// 0002 D1): `YYYY-MM-DD`, or an offset-bearing string read as the day it
// writes. They used to be parsed with `new Date(v)`, so an offset-less
// "2026-06-17T08:00" was read in the server's own zone; it is now refused
// with TIME_SHAPE_REQUIRED. Handed on as the UTC-midnight legacy anchor.
const cruiseDay = z.preprocess(emptyAsNull, legacyDayFieldSchema().nullable().optional());

// A port call's arrival/departure: the PORT's wall clock — `{local}` (zone
// from the stop's port), `{local, zone}`, or an offset-bearing instant from a
// token client. The Companion still relays the cruise parser's offset-less
// strings, which are the port's wall clock too; a browser sending one is
// refused (companion#24 moves the app to `{local}`).
const stopTime = z.preprocess(
  emptyAsNull,
  timeFieldSchema({ impliedPlace: true, tokenWallClockString: true }).nullable().optional()
);

export const cruiseStopSchema = z
  .object({
    // The stored stop this one IS, when the client knows it. Stop ids change
    // on every save (a PATCH recreates the list), so it is a matching hint
    // and never written: today only `allAboardTime` uses it to survive a
    // client that does not send that key (`services/cruise/stopCarryOver.ts`).
    id: z
      .string()
      .uuid()
      .optional()
      .describe(
        "The stored stop this one is (a matching hint, never written; ids change on every save)."
      ),
    portId: z.number().int().positive().nullable().optional(),
    dayNumber: z.number().int().min(1).max(365),
    // Calendar date of the stop. Booking confirmations list a date per stop
    // (often without clock times), so this captures it even when arrival/
    // departure times are absent ("2027-10-08" -> "2027-10-08T00:00:00.000Z").
    date: cruiseDay,
    isAtSea: z.boolean().default(false),
    arrivalTime: stopTime,
    departureTime: stopTime,
    excursionNote: z.string().max(500).optional(),
    // "All aboard" at this port (forgejo#223): `HH:mm` on the port's clock,
    // as the ship's daily programme prints it. Only ever the user's entry —
    // nothing derives it from the departure. "" and null clear it; on a PATCH
    // an ABSENT key keeps the matched stored stop's value (stopCarryOver.ts).
    allAboardTime: z
      .preprocess(
        emptyAsNull,
        z.string().regex(ALL_ABOARD_TIME, "allAboardTime must be HH:mm").nullable().optional()
      )
      .describe(
        'HH:mm on the port\'s clock. null or "" clears it. ABSENT on a PATCH keeps the value ' +
          "of the matched stored stop (by id, else same day and port, else the only stop at that " +
          "port); a sea day never has one."
      ),
    // Third stop state: an imported port whose name could not be matched to the
    // catalog. Carried as a name-only stop (no portId, not a sea day) so it is
    // never lost; the user resolves it later via the PortPicker.
    unresolvedPortName: z.string().trim().min(1).max(200).nullable().optional(),
  })
  // 3-state invariant: a stop is valid iff it is a sea day, OR references a
  // port, OR carries an unresolved port name — and never mixes those.
  .superRefine((s, ctx) => {
    const hasPort = s.portId !== null && s.portId !== undefined;
    const hasUnresolved = s.unresolvedPortName !== null && s.unresolvedPortName !== undefined;
    if (!s.isAtSea && !hasPort && !hasUnresolved) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A stop must be at sea, reference a port, or carry an unresolved port name",
        path: ["portId"],
      });
    }
    if (hasPort && hasUnresolved) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A stop cannot be both a matched port and an unresolved port",
        path: ["unresolvedPortName"],
      });
    }
    if (s.isAtSea && (hasPort || hasUnresolved)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A sea day cannot reference a port or an unresolved port name",
        path: ["isAtSea"],
      });
    }
  });

const baseCruiseSchema = z.object({
  shipId: z.number().int().positive().nullable().optional(),
  shipNameOverride: emptyToNull,
  cruiseLine: emptyToNull,
  // Official itinerary / route name from the booking confirmation
  // (e.g. "Kanaren mit Marokko"), distinct from the trip's user label.
  routeName: z
    .string()
    .max(120)
    .nullable()
    .optional()
    .transform((v) => (v ? v : v === undefined ? undefined : null)),
  departurePortId: z.number().int().positive().nullable().optional(),
  arrivalPortId: z.number().int().positive().nullable().optional(),
  startDate: cruiseDay,
  endDate: cruiseDay,
  status: z.enum(STATUSES).default("scheduled"),
  cabinNumber: z.string().max(20).nullable().optional(),
  cabinType: z.enum(CABIN_TYPES).nullable().optional(),
  deck: z.number().int().min(1).max(30).nullable().optional(),
  bookingReference: z.string().max(40).nullable().optional(),
  /**
   * Present when this cruise arrives from an import rather than the form.
   * Its presence is what marks the row as imported: the server derives the
   * provenance key from it, so the rule for "same cruise" lives in one place
   * instead of being restated by every client.
   */
  importBatchId: z.string().uuid().nullable().optional(),
  price: z.number().min(0).nullable().optional(),
  currency: currencyField.optional(),
  // Plain-text notes. The frontend renders these as React text (auto-escaped),
  // so no HTML sanitization happens or is needed here. The previous
  // `.replace(/<[^>]*>/g, '')` transform was INCOMPLETE sanitization (trivially
  // bypassable, e.g. nested/unclosed tags) that gave false security confidence
  // without an HTML sink — removed rather than "improved". Bounded to guard
  // against unbounded storage, consistent with the other string fields.
  notes: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().max(40)).max(30).optional(),
  companions: z.array(z.string().max(100)).max(50).optional(),
  tripId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
  // Optional user-selectable map color. `#` prefix is optional to accept
  // both raw hex and the format the color-picker's `<input type="color">`
  // emits. `null` clears back to the auto-derived per-cruise color.
  color: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/)
    .optional()
    .nullable(),
  stops: z.array(cruiseStopSchema).max(60).optional(),
});

/**
 * What a new cruise must carry to exist at all: WHAT sailed — a catalogue
 * ship, a free-text ship name, the itinerary's name, the line or the port it
 * left from — and WHEN it set out. Without it `POST /cruises {}` answered 201 and the list grew a row
 * reading "— | — – — | 0" (acceptance run, 2026-09-26): a cruise nobody could
 * recognise, that counted in no year, and that an import could never match
 * again (`matchCruise` in xlsxImport keys on the start date, so an undated
 * row was re-created on every re-import). The end date stays optional — a
 * booking often knows only the embarkation day.
 */
export function cruiseHasIdentity(data: {
  shipId?: number | null;
  shipNameOverride?: string | null;
  routeName?: string | null;
  cruiseLine?: string | null;
  departurePortId?: number | null;
}): boolean {
  return (
    (data.departurePortId !== null && data.departurePortId !== undefined) ||
    (data.shipId !== null && data.shipId !== undefined) ||
    Boolean(data.shipNameOverride?.trim()) ||
    Boolean(data.routeName?.trim()) ||
    Boolean(data.cruiseLine?.trim())
  );
}

export const createCruiseSchema = baseCruiseSchema
  .refine(
    (data) => {
      if (!data.startDate || !data.endDate) return true;
      return new Date(data.endDate).getTime() >= new Date(data.startDate).getTime();
    },
    { message: "endDate must not precede startDate", path: ["endDate"] }
  )
  .refine(cruiseHasIdentity, {
    message: "A cruise needs a ship, a route name, a cruise line or a departure port",
    path: ["shipId"],
  })
  .refine((data) => Boolean(data.startDate), {
    message: "A cruise needs a start date",
    path: ["startDate"],
  });

export const updateCruiseSchema = partialForUpdate(baseCruiseSchema).refine(
  (data) => Object.keys(data).length > 0,
  {
    message: "At least one field must be provided for update",
  }
);

export const cruiseQuerySchema = z.object({
  status: z
    .union([z.enum(CRUISE_QUERY_STATUSES), z.array(z.enum(CRUISE_QUERY_STATUSES))])
    .optional(),
  /** Exact match on the `cruise_line` COLUMN. For the dropdown, see `shipLine`. */
  cruiseLine: z.union([z.string(), z.array(z.string())]).optional(),
  /**
   * The line a cruise BELONGS to — its own `cruiseLine`, or its ship's when
   * it has none. That is the rule the row cell draws and the filter dropdown
   * lists, and `cruiseLine` above is not it: a sailing whose line is known
   * only through its ship appears in the dropdown and matches nothing.
   */
  shipLine: z.string().max(200).optional(),
  /**
   * Free text over the columns a cruise row shows: ship, line, route name,
   * booking reference, and the NAMES of the departure, arrival and called-at
   * ports — including a port the importer could not match to the catalogue.
   *
   * Wider than the search it replaces, which matched ship and line only
   * because those were the two strings the browser had in hand.
   */
  q: z.string().trim().min(1).max(100).optional(),
  /**
   * Calendar year and month of the SAILING'S START, read in UTC.
   *
   * `startDate` is a calendar day carried at UTC midnight, not an instant —
   * `CruiseRow` formats the cell with `timeZone: "UTC"` and says why ("the
   * viewer's own zone would move a sailing by a day"), and `/stats` buckets
   * the cruise series on the stored value unchanged. This is deliberately NOT
   * the flights rule: a flight departure has a clock and an airport, so its
   * day is the airport's; a sailing date has neither, and applying the
   * embarkation port's zone to midnight UTC would move it back a day for
   * every port west of Greenwich.
   */
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  region: z.string().optional(),
  tripId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(CRUISE_SORT_FIELDS).default("date"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

/**
 * A cruise as a client SENDS it (the wire input), which is what the parser
 * hands back for the import preview — not the parsed output, whose times are
 * resolved `TimeFieldInput`s (ADR 0002 phase 2).
 */
export type CruiseInput = z.input<typeof baseCruiseSchema>;
export type CruiseQueryInput = z.infer<typeof cruiseQuerySchema>;

/** One `[lon, lat]` pair, in GeoJSON order. */
const waypointSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

/**
 * A hand-corrected line for one leg.
 *
 * The endpoint refs are strings because the column is `kind` + `ref`, ready for
 * a place id (a uuid) alongside a port id (an integer) — see the model's own
 * doc comment. Today only `port` is written.
 *
 * The 64-point ceiling is a storage guard, not a UX limit: the router emits
 * 3–8 waypoints and a person correcting a line by hand adds a handful more.
 */
export const routeOverrideSchema = z.object({
  fromKind: z.literal("port"),
  fromRef: z.string().min(1).max(64),
  toKind: z.literal("port"),
  toRef: z.string().min(1).max(64),
  waypoints: z.array(waypointSchema).min(2).max(64),
});

export type RouteOverrideInput = z.infer<typeof routeOverrideSchema>;

/** Query form of the endpoint key, for DELETE. */
export const routeOverrideKeySchema = routeOverrideSchema.omit({ waypoints: true });

/**
 * How a cruise recording was captured (2.7). The tour list minus `strava`: a
 * Strava activity is a workout, and its API agreement binds what may be done
 * with it — nothing here imports from it.
 */
export const CRUISE_TRACK_SOURCES = [
  "gpx",
  "tcx",
  "fit",
  "dawarich",
  "healthkit",
  "healthconnect",
] as const;
export type CruiseTrackSource = (typeof CRUISE_TRACK_SOURCES)[number];

/** Form fields beside an uploaded cruise recording — the tour upload's fields. */
export const cruiseTrackUploadFieldsSchema = z.object({
  externalRef: z.string().trim().min(1).max(200).optional(),
  origin: z.enum(["healthkit", "healthconnect"]).optional(),
});

/**
 * Body for `POST /cruises/:id/tracks/dawarich`. `legOrdinal` pulls the window
 * of that one leg; without it the whole cruise is pulled. An explicit side
 * wins over the derived one.
 */
export const pullCruiseDawarichSchema = z
  .object({
    legOrdinal: z.number().int().min(0).max(500).optional(),
    startedAt: instantFieldSchema().optional(),
    endedAt: instantFieldSchema().optional(),
  })
  .strict()
  .refine((v) => !v.startedAt || !v.endedAt || v.endedAt.getTime() >= v.startedAt.getTime(), {
    message: "endedAt must not be before startedAt",
    path: ["endedAt"],
  });
export type PullCruiseDawarichInput = z.infer<typeof pullCruiseDawarichSchema>;
