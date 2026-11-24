import { z } from "./zod";
import { localDateValueSchema } from "../shared/time/wire";
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

export const SHARE_LINK_KINDS = ["flight", "trip", "wrapped", "cruise", "stay", "visit"] as const;
export type ShareLinkKind = (typeof SHARE_LINK_KINDS)[number];

/**
 * The kinds a link can still be made for (owner decision 2026-11-22). Single
 * flights, cruises, stays and visits are no longer shared on their own — the
 * trip itinerary carries them. Their old rows stay listed for the owner to
 * delete, and the public side answers them with "no longer available" (410).
 */
export const SHARE_LINK_CREATABLE_KINDS = ["trip", "wrapped"] as const;
export type CreatableShareLinkKind = (typeof SHARE_LINK_CREATABLE_KINDS)[number];
export const RETIRED_SHARE_LINK_KINDS = ["flight", "cruise", "stay", "visit"] as const;

export function isRetiredShareLinkKind(kind: string): boolean {
  return (RETIRED_SHARE_LINK_KINDS as readonly string[]).includes(kind);
}

/**
 * The itinerary sections an owner can show on a trip link (2026-11-22). A link
 * made before carries the single field `itinerary`, which stands for all four.
 */
export const SHARE_LINK_ITINERARY_SECTIONS = ["flights", "stays", "transport", "places"] as const;
export type ShareLinkItinerarySection = (typeof SHARE_LINK_ITINERARY_SECTIONS)[number];

/** The allow-list. A field not listed for a kind cannot be asked for. */
export const SHARE_LINK_FIELDS = {
  trip: [
    "owner",
    "name",
    "dates",
    "totals",
    "countries",
    "route",
    "photos",
    "itinerary",
    ...SHARE_LINK_ITINERARY_SECTIONS,
  ],
  wrapped: ["owner", "totals", "topAirline", "topRoute"],
} as const satisfies Record<CreatableShareLinkKind, readonly string[]>;

/**
 * Trip fields that no longer travel (owner decision 2026-11-22: never a price,
 * a note or another traveller's name). Installed Companion versions still
 * offer them, so a request naming one is accepted and the field is DROPPED
 * before the link is stored — the preview, built from the stored set, shows
 * the owner that it is not there.
 */
export const SHARE_LINK_RETIRED_TRIP_FIELDS = ["costs", "companions", "notes"] as const;

export type ShareLinkField<K extends CreatableShareLinkKind = CreatableShareLinkKind> =
  (typeof SHARE_LINK_FIELDS)[K][number];

/** At most this many photos travel with a trip link. */
export const SHARE_LINK_MAX_PHOTOS = 12;
/** The furthest a link may be set to expire. */
export const SHARE_LINK_MAX_DAYS = 90;
/** Active links one account may hold at once. */
export const SHARE_LINK_MAX_ACTIVE = 50;
/**
 * How long an itinerary link outlives the end of the trip's last local day
 * (forgejo#302; one week since 2026-11-22 — the owner's default "trip end + 7
 * days" and the latest an itinerary may stay visible).
 */
export const SHARE_LINK_ITINERARY_GRACE_MS = 7 * 24 * 3_600_000;

const targetIdSchema = z.string().trim().min(1).max(100);

const selectionBase = z.strictObject({
  kind: z
    .enum(SHARE_LINK_KINDS)
    .describe(
      "`trip` or `wrapped`. `flight`, `cruise`, `stay` and `visit` are retired (2026-11-22) and answer 400."
    ),
  targetId: targetIdSchema.describe('The trip id; for `wrapped` the calendar year, e.g. `"2026"`.'),
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
  if (isRetiredShareLinkKind(value.kind)) {
    ctx.addIssue({
      code: "custom",
      path: ["kind"],
      message: `${value.kind} links are no longer offered; share the trip instead`,
    });
    return;
  }
  const allowed: readonly string[] = SHARE_LINK_FIELDS[value.kind as CreatableShareLinkKind];
  const retired: readonly string[] = value.kind === "trip" ? SHARE_LINK_RETIRED_TRIP_FIELDS : [];
  for (const field of value.fields) {
    if (!allowed.includes(field) && !retired.includes(field)) {
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

/** De-duplicated, and a retired trip field dropped (it is accepted, never stored). */
const dedupe = <T extends { kind: ShareLinkKind; fields: string[] }>(value: T) => ({
  ...value,
  kind: value.kind as CreatableShareLinkKind,
  fields: [...new Set(value.fields)].filter(
    (field) => !(SHARE_LINK_RETIRED_TRIP_FIELDS as readonly string[]).includes(field)
  ),
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
        `When the link stops working, at most ${SHARE_LINK_MAX_DAYS} days ahead. A trip link ` +
          "showing its itinerary also ends seven days after the end of the trip's last day, " +
          "whichever comes first."
      ),
    expiresInDays: z
      .number()
      .int()
      .min(1)
      .max(SHARE_LINK_MAX_DAYS)
      .optional()
      .describe(
        "Lifetime in days measured by the server clock. Supply exactly one of expiresInDays or expiresAt. Itinerary links still end seven days after the trip's last day, if earlier."
      ),
    afterTripEnd: z
      .boolean()
      .optional()
      .describe(
        "Share the itinerary of a trip that ended more than seven days ago anyway: the link " +
          "then ends seven days after it was made instead of answering SHARE_LINK_TRIP_ENDED."
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

const tripLeg = z.strictObject({
  mode: z.enum(["flight", "rail", "bus", "ferry", "rental", "cruise"]),
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
      ferryCrossings: z.number().int().describe("Ferry crossings on the trip (forgejo#396)"),
      rentals: z.number().int().describe("Rentals on the trip (forgejo#396)"),
      countries: z.number().int(),
      days: z.number().int().nullable().describe("Null when the trip has no first or last day"),
    })
    .optional(),
  countries: z.array(z.string()).optional(),
  route: z.array(tripLeg).optional(),
  photos: z
    .strictObject({ count: z.number().int().min(0).max(SHARE_LINK_MAX_PHOTOS) })
    .optional()
    .describe("Fetch photo i (0 ≤ i < count) through POST /public/share-links/photo"),
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
  z.strictObject({ kind: z.literal("trip"), trip: tripView }),
  z.strictObject({ kind: z.literal("wrapped"), wrapped: wrappedView }),
]);
export type PublicView = z.infer<typeof publicViewSchema>;
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
      .describe("When it really ends — earlier for a trip itinerary whose trip ends first"),
    createdAt: z.string().datetime(),
    retired: z
      .boolean()
      .describe(
        'A kind no longer offered (flight, cruise, stay, visit): the public sees "no longer available"; the owner can only delete it'
      ),
    viewCount: z.number().int(),
    lastViewedAt: z.string().datetime().nullable(),
  })
  .openapi("ShareLink");
export type OwnerShareLink = z.infer<typeof ownerShareLinkSchema>;
