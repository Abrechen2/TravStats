import { z } from "./zod";
import { localDateValueSchema, timeValueSchema } from "../shared/time/wire";
import { FLIGHT_PHASES, itineraryViewSchema } from "./shareLinkItinerary";

export { FLIGHT_PHASES };

/**
 * Public share links (forgejo#281, design
 * `docs/superpowers/specs/2026-10-10-share-links-design.md`).
 *
 * Two halves live here. The REQUEST side names the field allow-list per kind —
 * the only things an owner can choose to show. The VIEW side describes the
 * public payload with strict objects in which every member is optional: a field
 * the owner did not choose is ABSENT, and the serializer parses its own output
 * through `publicViewSchema` before it leaves, so a builder that grew a key no
 * schema names fails at home instead of reaching a stranger.
 */

export const SHARE_LINK_KINDS = ["flight", "trip", "wrapped"] as const;
export type ShareLinkKind = (typeof SHARE_LINK_KINDS)[number];

/** The allow-list. A field not listed for a kind cannot be asked for. */
export const SHARE_LINK_FIELDS = {
  flight: ["owner", "flightNumber", "route", "schedule", "progress", "aircraft", "lastPosition"],
  trip: [
    "owner",
    "name",
    "dates",
    "totals",
    "countries",
    "route",
    "costs",
    "companions",
    "photos",
    "notes",
    "itinerary",
  ],
  wrapped: ["owner", "totals", "topAirline", "topRoute"],
} as const satisfies Record<ShareLinkKind, readonly string[]>;

export type ShareLinkField<K extends ShareLinkKind = ShareLinkKind> =
  (typeof SHARE_LINK_FIELDS)[K][number];

/** At most this many photos travel with a trip link. */
export const SHARE_LINK_MAX_PHOTOS = 12;
/** At most this many notes travel with a trip link — only the owner's `shareable` ones. */
export const SHARE_LINK_MAX_NOTES = 50;
/** The furthest a link may be set to expire. */
export const SHARE_LINK_MAX_DAYS = 90;
/** Active links one account may hold at once. */
export const SHARE_LINK_MAX_ACTIVE = 50;
/** How long a flight link outlives the arrival. */
export const SHARE_LINK_FLIGHT_GRACE_MS = 2 * 3_600_000;
/** How long an itinerary link outlives the end of the trip's last local day (forgejo#302). */
export const SHARE_LINK_ITINERARY_GRACE_MS = 24 * 3_600_000;

const targetIdSchema = z.string().trim().min(1).max(100);

const selectionBase = z.strictObject({
  kind: z.enum(SHARE_LINK_KINDS),
  targetId: targetIdSchema.describe(
    'The flight or trip id; for `wrapped` the calendar year, e.g. `"2026"`.'
  ),
  fields: z
    .array(z.string().min(1).max(40))
    .min(1)
    .max(20)
    .describe("The owner's choice from the kind's allow-list; anything else is a 400."),
});

/** `fields` against the kind's allow-list, and a year for `wrapped`. */
function checkSelection(
  value: { kind: ShareLinkKind; targetId: string; fields: string[] },
  ctx: z.RefinementCtx
): void {
  const allowed: readonly string[] = SHARE_LINK_FIELDS[value.kind];
  for (const field of value.fields) {
    if (!allowed.includes(field)) {
      ctx.addIssue({
        code: "custom",
        path: ["fields"],
        message: `"${field}" is not a field of a ${value.kind} link`,
      });
    }
  }
  if (value.kind === "wrapped" && !/^\d{4}$/.test(value.targetId)) {
    ctx.addIssue({ code: "custom", path: ["targetId"], message: "a year, YYYY" });
  }
}

const dedupe = <T extends { fields: string[] }>(value: T): T => ({
  ...value,
  fields: [...new Set(value.fields)],
});

export const shareLinkPreviewSchema = selectionBase.superRefine(checkSelection).transform(dedupe);
export type ShareLinkSelection = z.infer<typeof shareLinkPreviewSchema>;

export const shareLinkCreateSchema = selectionBase
  .extend({
    expiresAt: z
      .string()
      .datetime({ offset: true })
      .optional()
      .describe(
        `When the link stops working, at most ${SHARE_LINK_MAX_DAYS} days ahead. A flight ` +
          "link also ends two hours after the arrival, and a trip link with `itinerary` 24 " +
          "hours after the end of the trip's last day, whichever comes first."
      ),
    expiresInDays: z
      .number()
      .int()
      .min(1)
      .max(SHARE_LINK_MAX_DAYS)
      .optional()
      .describe(
        "Lifetime in days measured by the server clock. Supply exactly one of expiresInDays or expiresAt. Flight links still end two hours after arrival, itinerary links 24 hours after the trip's last day, if earlier."
      ),
  })
  .refine((value) => (value.expiresAt !== undefined) !== (value.expiresInDays !== undefined), {
    message: "Supply exactly one of expiresAt or expiresInDays",
    path: ["expiresInDays"],
  })
  .superRefine(checkSelection)
  .transform(dedupe);

export const shareLinkResolveSchema = z.strictObject({
  token: z.string().max(200).describe("The token from the URL fragment."),
});

export const shareLinkPhotoSchema = z.strictObject({
  token: z.string().max(200),
  index: z
    .number()
    .int()
    .min(0)
    .max(SHARE_LINK_MAX_PHOTOS - 1),
});

// ---------------------------------------------------------------------------
// The public view. Strict at every level: an unknown key is a failure.

const airportView = z.strictObject({
  code: z.string().nullable().describe("IATA, else ICAO"),
  name: z.string().nullable(),
});

const flightView = z.strictObject({
  owner: z.string().nullable().optional(),
  flightNumber: z
    .strictObject({ airline: z.string().nullable(), number: z.string().nullable() })
    .optional(),
  route: z.strictObject({ from: airportView, to: airportView }).optional(),
  schedule: z
    .strictObject({ departure: timeValueSchema.nullable(), arrival: timeValueSchema.nullable() })
    .optional(),
  progress: z
    .strictObject({
      phase: z.enum(FLIGHT_PHASES),
      fraction: z
        .number()
        .min(0)
        .max(1)
        .nullable()
        .describe("Share of the flight behind, by the clock"),
      eta: timeValueSchema.nullable().describe("Arrival — a reported time wins over the schedule"),
      basis: z
        .enum(["schedule", "reported"])
        .describe("Whether the times behind the phase are the schedule or a provider's report"),
    })
    .optional(),
  aircraft: z.string().nullable().optional(),
  lastPosition: z
    .strictObject({
      lat: z.number(),
      lon: z.number(),
      // Null when the privacy cut hid the recording's last fix (TravTrack plan T5).
      recordedAt: z.string().datetime().nullable(),
    })
    .nullable()
    .optional()
    .describe("The last point the phone sent; null when it has sent none"),
});

const tripLeg = z.strictObject({
  mode: z.enum(["flight", "rail", "bus", "cruise"]),
  from: z.string().nullable(),
  to: z.string().nullable(),
});

const tripView = z.strictObject({
  owner: z.string().nullable().optional(),
  name: z.string().optional(),
  dates: z
    .strictObject({ start: localDateValueSchema.nullable(), end: localDateValueSchema.nullable() })
    .optional(),
  totals: z
    .strictObject({
      flights: z.number().int(),
      flightKm: z.number().int().nullable().describe("Great-circle; null without a flight"),
      cruises: z.number().int(),
      railRides: z.number().int(),
      busRides: z.number().int().describe("Bus rides on the trip (forgejo#288 sweep)"),
      countries: z.number().int(),
      days: z.number().int().nullable().describe("Null when the trip has no first or last day"),
    })
    .optional(),
  countries: z.array(z.string()).optional(),
  route: z.array(tripLeg).optional(),
  costs: z
    .strictObject({
      byCurrency: z
        .array(z.strictObject({ currency: z.string(), amount: z.number() }))
        .describe("What was paid, per currency — never summed across currencies"),
      complete: z.boolean().describe("False when some entries carry no price: a lower bound"),
    })
    .nullable()
    .optional()
    .describe("The trip page's own figure; null when the server can state none"),
  companions: z.array(z.string()).optional(),
  photos: z
    .strictObject({ count: z.number().int().min(0).max(SHARE_LINK_MAX_PHOTOS) })
    .optional()
    .describe("Fetch photo i (0 ≤ i < count) through POST /public/share-links/photo"),
  notes: z
    .strictObject({
      items: z
        .array(
          z.strictObject({
            body: z.string(),
            placeName: z
              .string()
              .nullable()
              .describe("Where it was written, as the owner typed it"),
            at: timeValueSchema.describe("On the clock of the zone it was written in"),
            day: localDateValueSchema,
          })
        )
        .max(SHARE_LINK_MAX_NOTES),
      truncated: z.boolean().describe("True when the trip holds more shareable notes than shown"),
    })
    .optional()
    .describe(
      "The owner's notes marked `shareable` whose day falls in the trip, oldest first — " +
        "re-read on every request, so a note made private disappears at once. A private note " +
        "is never listed; no position, photo or id travels."
    ),
  itinerary: itineraryViewSchema.optional(),
});

const wrappedView = z.strictObject({
  owner: z.string().nullable().optional(),
  year: z.number().int(),
  totals: z
    .strictObject({
      flights: z.number().int().nullable(),
      distanceKm: z.number().nullable(),
      earthFactor: z.number().nullable(),
      newCountries: z.number().int(),
      cruises: z.number().int().nullable(),
      railRides: z.number().int().nullable(),
      railKm: z.number().nullable(),
    })
    .optional(),
  topAirline: z
    .strictObject({ name: z.string(), code: z.string().nullable(), flights: z.number().int() })
    .nullable()
    .optional(),
  topRoute: z
    .strictObject({ from: z.string(), to: z.string(), flights: z.number().int() })
    .nullable()
    .optional(),
});

export const publicViewSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("flight"), flight: flightView }),
  z.strictObject({ kind: z.literal("trip"), trip: tripView }),
  z.strictObject({ kind: z.literal("wrapped"), wrapped: wrappedView }),
]);
export type PublicView = z.infer<typeof publicViewSchema>;
export type FlightView = z.infer<typeof flightView>;
export type TripView = z.infer<typeof tripView>;
export type WrappedView = z.infer<typeof wrappedView>;

export const publicShareResponseSchema = z
  .object({
    expiresAt: z.string().datetime().describe("When this link stops working"),
    view: publicViewSchema,
  })
  .openapi("PublicShareView");

export const ownerShareLinkSchema = z
  .object({
    id: z.string(),
    kind: z.enum(SHARE_LINK_KINDS),
    targetId: z.string(),
    fields: z.array(z.string()),
    expiresAt: z.string().datetime().describe("The expiry the owner chose"),
    effectiveExpiresAt: z
      .string()
      .datetime()
      .describe(
        "When it really ends — earlier for a flight that lands first, or a trip itinerary " +
          "whose trip ends first"
      ),
    createdAt: z.string().datetime(),
    viewCount: z.number().int(),
    lastViewedAt: z.string().datetime().nullable(),
  })
  .openapi("ShareLink");
export type OwnerShareLink = z.infer<typeof ownerShareLinkSchema>;
