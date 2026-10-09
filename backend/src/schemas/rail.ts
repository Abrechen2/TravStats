import { z } from "./zod";
import { currencyField } from "./lodging";
import { partialForUpdate } from "./partialUpdate";
import { RAIL_LOOKUP_PROVIDERS } from "../services/rail/lookup/types";

/**
 * Rail journeys — spec docs/superpowers/specs/2026-09-25-rail-domain.md.
 *
 * The WRITE vocabulary is narrower than the stored one on purpose: a client
 * may say "scheduled" (a hint, derived over) or "cancelled" (kept verbatim);
 * `in_progress` and `completed` come from the clock, never from a request.
 */
export const RAIL_STATUSES = ["scheduled", "in_progress", "completed", "cancelled"] as const;
export const RAIL_WRITE_STATUSES = ["scheduled", "cancelled"] as const;
export const RAIL_TRAVEL_CLASSES = ["first", "second", "sleeper", "couchette"] as const;
/**
 * great_circle = the straight line between the stations; user = typed from the
 * ticket; route = the length of the line the row carries — the traced
 * Transitous line, or one routed over the tracks (OpenRailRouting, BRouter);
 * roadtrip = the length of the line a converted roadtrip leg brought along
 * (routed or drawn in the roadtrip, not a timetable's trace).
 */
export const RAIL_DISTANCE_SOURCES = ["great_circle", "user", "route", "roadtrip"] as const;
export type RailTracedDistanceSource = "route" | "roadtrip";
/**
 * Where the map line comes from: the chord, the train's Transitous trace, a
 * line routed over the tracks by the instance's OpenRailRouting, a roadtrip's
 * line (`manual`), or `brouter` — the demo account's lines, routed over the
 * OSM rail network once, offline, by BRouter's rail profile.
 */
export const RAIL_GEOMETRY_SOURCES = [
  "none",
  "straight",
  "transitous",
  "openrailrouting",
  "brouter",
  "manual",
] as const;
/**
 * Why a journey was saved without the line it asked for (the save's
 * `meta.geometry.fallback`). For a Transitous match: switched off by the
 * admin, not answering (or no shape), a station off the traced line, or a
 * "trace" of station-to-station chords. For the instance's OpenRailRouting:
 * not answering (down, timed out, an answer that is no line) or no connection
 * between the stations on its network.
 */
export const RAIL_GEOMETRY_FALLBACK_REASONS = [
  "providerDisabled",
  "providerUnavailable",
  "stationOffLine",
  "untracedShape",
  "railRoutingUnavailable",
  "railRoutingNoRoute",
] as const;
export const RAIL_SORT_FIELDS = ["departure", "distance", "created"] as const;

/**
 * The wall clock at the station, as a ticket prints it: `YYYY-MM-DDTHH:mm`,
 * seconds optional, NO offset. Whose clock it is comes from the station's
 * coordinates on the server; an offset here would be a second answer to the
 * same question.
 */
const WALL_CLOCK = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const wallClock = z
  .string()
  .regex(WALL_CLOCK, "must be a local wall-clock time YYYY-MM-DDTHH:mm without an offset")
  .refine((v) => !Number.isNaN(new Date(`${v}Z`).getTime()), "is not a real date and time");

/**
 * A station's wall clock, or — for a ticket that prints none — its calendar
 * day alone, `YYYY-MM-DD` (forgejo#132 item 17). The day is stored with
 * precision `day`, and every reader that needs a clock abstains on it
 * (`shared/railClock.ts`); it is never read as midnight.
 */
const LOCAL_DAY = /^\d{4}-\d{2}-\d{2}$/;
const wallClockOrDay = z.union([
  wallClock,
  z
    .string()
    .regex(LOCAL_DAY, "must be a local wall-clock time YYYY-MM-DDTHH:mm or a day YYYY-MM-DD")
    // Zod runs a refinement even after the regex failed, so this must not
    // throw on a non-day string ("…T08:15+02:00" used to answer 500).
    .refine((v) => {
      const day = new Date(`${v}T00:00:00Z`);
      return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === v;
    }, "is not a real date"),
]);

/** True for a day-only value of `departureLocal` / `arrivalLocal`. */
export function isLocalDayInput(value: string | null | undefined): value is string {
  return typeof value === "string" && LOCAL_DAY.test(value);
}

/** "" and null both clear a text field; undefined leaves it alone. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v));

/**
 * A station as the client knows it. Sent whole — a name without its position
 * (or the reverse) is how a map pin ends up in the wrong city.
 */
export const railStationSchema = z.object({
  /**
   * The catalogue row the station was picked from. When set, the server takes
   * the position, code and country from the catalogue; null or absent means a
   * geocoder pick and the fields below are the record.
   */
  stationId: z.number().int().positive().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  /** UIC/EVA code when known. */
  code: optionalText(20),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  /** ISO 3166-1 alpha-2. */
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/)
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
});

const foldField = z.enum(["earlier", "later"]).nullable().optional();

/** The fold keys a rail write understands — see `strayFoldKey`. */
export const RAIL_FOLD_KEYS = ["departureFold", "arrivalFold"] as const;

/**
 * A `…Fold` key the rail schema does not know (`arrivalFolds`, `depFold`).
 * zod strips unknown keys, so a misspelt fold would be dropped without a word
 * and the ride stored at the EARLIER hour the user just said was wrong; the
 * route refuses it instead. Null when there is none.
 */
export function strayFoldKey(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const known: readonly string[] = RAIL_FOLD_KEYS;
  return Object.keys(body).find((key) => /fold/i.test(key) && !known.includes(key)) ?? null;
}

const baseRailSchema = z.object({
  operator: optionalText(100),
  trainCategory: optionalText(20),
  trainNumber: optionalText(20),
  departureStation: railStationSchema,
  arrivalStation: railStationSchema,
  departureLocal: wallClockOrDay,
  arrivalLocal: wallClockOrDay.nullable().optional(),
  /**
   * Which occurrence of a station clock the zone shows twice (the autumn
   * hour): `earlier` by default, `later` for the second (ADR 0002, Q5) — the
   * same choice the flight form offers.
   */
  departureFold: foldField,
  arrivalFold: foldField,
  /**
   * Only for a distance the user read off the ticket. Absent or null means
   * "measure it": the server stores the great-circle distance and says so.
   */
  distanceKm: z.number().positive().max(20000).nullable().optional(),
  travelClass: z.enum(RAIL_TRAVEL_CLASSES).nullable().optional(),
  coach: optionalText(20),
  seat: optionalText(20),
  bookingReference: optionalText(40),
  price: z.number().min(0).nullable().optional(),
  currency: currencyField.optional(),
  status: z.enum(RAIL_WRITE_STATUSES).default("scheduled"),
  /** Arrival delay in minutes; null = not recorded, 0 = on time. */
  delayMinutes: z.number().int().min(-60).max(10000).nullable().optional(),
  /**
   * "The change after this train is tight" — the user's own mark (forgejo#234),
   * on the leg that arrives at the change. Absent leaves it as stored; the
   * form never sends it, so a ride edited there keeps its mark.
   */
  tightConnection: z.boolean().optional(),
  notes: z.string().max(5000).nullable().optional(),
  tags: z.array(z.string().trim().max(40)).max(30).optional(),
  companions: z.array(z.string().max(100)).max(50).optional(),
  tripId: z.string().uuid().nullable().optional(),
  bookingId: z.string().uuid().nullable().optional(),
  /**
   * The timetable trip a lookup matched (GET /rail/lookup). With a Transitous
   * match the server fetches that trip's traced line once and freezes it with
   * the row; null clears the match and the line falls back to straight.
   */
  lookup: z
    .object({
      provider: z.enum(RAIL_LOOKUP_PROVIDERS),
      ref: z.string().trim().min(1).max(300),
    })
    .nullable()
    .optional(),
});

/**
 * No arrival-before-departure refine here: two wall clocks in two zones do not
 * compare (Paris 10:00 to London 10:55 is a 1 h 55 min train). The route checks
 * the INSTANTS, after it knows both zones.
 */
export const createRailJourneySchema = baseRailSchema.extend({
  /**
   * "Add a connecting train": the id of the leg this one continues. The server
   * binds both through a booking (creating one on the previous leg when it has
   * none) and files the new leg in the previous leg's trip unless `tripId` is
   * sent. Create-only — an existing leg joins a booking through `bookingId`.
   */
  connectsFrom: z.string().uuid().optional(),
});

export const updateRailJourneySchema = partialForUpdate(baseRailSchema).refine(
  (data) => Object.keys(data).length > 0,
  { message: "At least one field must be provided for update" }
);

export const railQuerySchema = z.object({
  status: z.union([z.enum(RAIL_STATUSES), z.array(z.enum(RAIL_STATUSES))]).optional(),
  /** Free text over operator, train, stations and booking reference. */
  q: z.string().trim().min(1).max(100).optional(),
  /** Calendar year of the departure, on the departure station's calendar. */
  year: z.coerce.number().int().min(1900).max(2200).optional(),
  tripId: z.string().uuid().optional(),
  /** A rail loyalty card: only the rides it counts (the link behind its figures). */
  membershipId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  sort: z.enum(RAIL_SORT_FIELDS).default("departure"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** GET /rail/stations — the catalogue typeahead. */
export const railStationSearchSchema = z.object({
  q: z.string().trim().min(2).max(100),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * GET /rail/lookup — a train by number and day, boarded at a station. The
 * station is required: no open service finds a train by its number alone.
 */
export const railLookupQuerySchema = z
  .object({
    trainNumber: z.string().trim().min(1).max(30),
    category: z
      .string()
      .trim()
      .regex(/^[A-Za-z]{1,10}$/)
      .optional(),
    date: z
      .string()
      .regex(ISO_DAY, "must be YYYY-MM-DD")
      .refine((v) => !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()), "is not a real date"),
    fromStationId: z.coerce.number().int().positive().optional(),
    fromLat: z.coerce.number().min(-90).max(90).optional(),
    fromLon: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine(
    (v) => v.fromStationId !== undefined || (v.fromLat !== undefined && v.fromLon !== undefined),
    { message: "fromStationId or fromLat and fromLon are required" }
  );

export type RailStationInput = z.infer<typeof railStationSchema>;
export type CreateRailJourneyInput = z.infer<typeof createRailJourneySchema>;
export type UpdateRailJourneyInput = z.infer<typeof updateRailJourneySchema>;
export type RailQueryInput = z.infer<typeof railQuerySchema>;

/**
 * The admin's OpenRailRouting base URL: http(s) only, no credentials (the
 * settings answer echoes the URL, so a password in it would be shown to every
 * admin page load), no query or fragment, trailing slash trimmed. Like the
 * custom OSRM URL (`normalizeRoutingCustomUrl`) it may name a LAN host on
 * purpose — the service is self-hosted by design.
 */
export function normalizeRailRoutingUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("must use http:// or https://");
  }
  if (parsed.username || parsed.password) throw new Error("must not carry credentials");
  if (parsed.search || parsed.hash) throw new Error("must not carry a query or fragment");
  return `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`;
}

/** "" clears the setting (null); anything else must normalise. */
export const railRoutingUrlField = z
  .string()
  .trim()
  .max(500)
  .transform((raw, ctx) => {
    if (raw === "") return null;
    try {
      return normalizeRailRoutingUrl(raw);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `OpenRailRouting URL ${error instanceof Error ? error.message : "is not a valid URL"}`,
      });
      return z.NEVER;
    }
  });
