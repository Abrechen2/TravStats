import { z } from "zod";

import { LEG_MODES } from "../services/tour/tourDistance";
import { ROUTING_PROVIDER_IDS } from "../services/tour/routing/types";

/**
 * Validation for the tour endpoints.
 *
 * Two DIFFERENT vocabularies, because two DIFFERENT endpoints write this
 * column and they have different capabilities:
 *
 * - `ACCEPTED_LEG_SOURCES` — what `tripRouteLegs.source` may hold at rest:
 *   `straight` (the default chord), `drawn` (a hand-drawn override, phase
 *   1), `routed` (a provider-computed line, phase 3 — written only by
 *   `routes/trips/tourRouting.ts`, never by the manual override endpoint
 *   below), and `track` (phase 3b, task 5 — a leg that adopted a segment
 *   of a recorded `TripRouteTrack`, written only by the manual override
 *   endpoint's `track` branch below via `adoptSegment`).
 * - `MANUAL_LEG_SOURCES` — what the PLAIN (non-track) shape of the manual
 *   leg-override endpoint (`PUT .../legs/{fromStopId}/{toStopId}` in
 *   `routes/trips/tourLegs.ts`) accepts from a caller: `straight` and
 *   `drawn` only. `routed` geometry comes from a provider, not a request
 *   body — a caller cannot hand-supply it, so this endpoint refuses it
 *   with a message pointing at the routing endpoint instead. This is
 *   deliberate, not an oversight: earlier this file let the override
 *   endpoint accept `source: "routed"` too, on the theory that a caller
 *   might resend it unchanged while editing an unrelated field (toll
 *   cost, say). That endpoint's semantics were never built to preserve
 *   stored geometry on a re-submit — an omitted `waypoints` clears the
 *   column for EVERY source — so accepting `routed` there let a caller
 *   produce a leg that claimed `source: "routed"` while holding a plain
 *   straight chord: a false provenance claim, worse than either honest
 *   state. Splitting the vocabulary closes that path: the override
 *   endpoint can no longer put the column into that shape at all.
 *
 *   `track` does NOT join `MANUAL_LEG_SOURCES` even though the override
 *   endpoint now accepts it (see `legOverrideSchema` below): a bare
 *   `{ source: "track" }` with no `trackId` would be a leg claiming track
 *   geometry it does not have — exactly the false-provenance failure the
 *   `routed` split above was created to prevent, one level down. Instead
 *   `legOverrideSchema` is a discriminated union: the `MANUAL_LEG_SOURCES`
 *   shape for `straight`/`drawn`, and a SEPARATE shape for `track` that
 *   requires `trackId`. `ACCEPTED_LEG_SOURCES` still gains `track` because
 *   a stored row may legitimately hold it once adopted.
 *
 * A source the server cannot (yet, or ever, from THIS endpoint) produce is
 * rejected at the boundary instead of being stored and rendered as a lie.
 */

export const ACCEPTED_LEG_SOURCES = ["straight", "drawn", "routed", "track"] as const;

const MANUAL_LEG_SOURCES = ["straight", "drawn"] as const;

/**
 * `TripRouteTrack.source` vocabulary (Phase 3b): `gpx` (task 4 — the upload
 * endpoint in `routes/trips/tourTracks.ts`) and `dawarich` (task 7 — the
 * pull-from-Dawarich endpoint below). Used the same way `acceptedLegSource`
 * guards `TripRouteLeg.source` in `routes/trips/tourRouting.ts`: a
 * write-side boundary check, cheap insurance against a future writer
 * putting the column into a shape this vocabulary doesn't describe.
 */
export const TRACK_SOURCES = ["gpx", "dawarich"] as const;
export type TrackSource = (typeof TRACK_SOURCES)[number];

/**
 * Body for `POST /trips/:id/routes/:routeId/tracks/dawarich` (task 7).
 * Both sides are optional: an omitted side falls back to the section's
 * own date span, derived from its stops (see `resolveDawarichWindow` in
 * `services/tour/tracks/pullDawarichTrack.ts`) — the common case is one
 * click with an empty body. When BOTH sides are given explicitly, an
 * inverted range is rejected right here; a range built from one explicit
 * side and one derived side is checked separately at the route, which is
 * the only place that has the stops to derive the other side from.
 */
export const pullDawarichTrackSchema = z
  .object({
    startedAt: z.coerce.date().optional(),
    endedAt: z.coerce.date().optional(),
  })
  .strict()
  .refine((v) => !v.startedAt || !v.endedAt || v.endedAt.getTime() >= v.startedAt.getTime(), {
    message: "endedAt must not be before startedAt",
    path: ["endedAt"],
  });

export type PullDawarichTrackInput = z.infer<typeof pullDawarichTrackSchema>;

/**
 * `z.enum`'s default "Invalid enum value" message doesn't tell a caller
 * WHY `routed` in particular is refused, or where to go instead — so
 * `routed` specifically gets a message naming the routing endpoint.
 *
 * `track` used to fall into "everything else" here and get zod's normal
 * message. That is no longer true, and not merely because `track` is
 * valid now: `legOverrideSchema` below wraps this enum inside a
 * `z.discriminatedUnion("source", ...)`, and a discriminated union picks
 * a member by matching `source` against each member's OWN literal values
 * BEFORE handing the rest of the body to that member's schema. `track`
 * matches the OTHER member (`trackLegSource`, not this enum), so a
 * `track` request never reaches this errorMap at all — same as it never
 * reaches the two `.refine()` calls below. `ROUTED_REDIRECT_MESSAGE` is
 * shared with the union-level errorMap for exactly the opposite reason:
 * `routed` matches NEITHER member, so the union itself has to produce
 * this message — this enum's own copy only fires if something calls
 * `manualLegSource` directly, outside the union.
 */
const ROUTED_REDIRECT_MESSAGE =
  "This endpoint only accepts \"straight\", \"drawn\", or \"track\" — routing a leg " +
  "through the configured provider is done via POST " +
  ".../legs/{fromStopId}/{toStopId}/route or POST .../route-all, not this one.";

const manualLegSource = z.enum(MANUAL_LEG_SOURCES, {
  errorMap: (issue, ctx) => {
    if (issue.code === z.ZodIssueCode.invalid_enum_value && issue.received === "routed") {
      return { message: ROUTED_REDIRECT_MESSAGE };
    }
    return { message: ctx.defaultError };
  },
});

/** The `source: "track"` half of `legOverrideSchema`'s discriminated union. */
const trackLegSource = z.literal("track");

const coordinate = z
  .tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)])
  .describe("[lon, lat] in GeoJSON order");

export const createRouteSchema = z.object({
  name: z.string().min(1).max(200),
  mode: z.enum(LEG_MODES),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  notes: z.string().max(20000).optional(),
  startOdometerKm: z.number().int().min(0).max(10_000_000).optional(),
  endOdometerKm: z.number().int().min(0).max(10_000_000).optional(),
});

export const updateRouteSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  mode: z.enum(LEG_MODES).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional(),
  notes: z.string().max(20000).nullable().optional(),
  orderIdx: z.number().int().min(0).max(10000).optional(),
  startOdometerKm: z.number().int().min(0).max(10_000_000).nullable().optional(),
  endOdometerKm: z.number().int().min(0).max(10_000_000).nullable().optional(),
});

/**
 * The complete ordered stop list of one section, replacing whatever was
 * there. The cap is a denial-of-service bound, not a product limit.
 *
 * A stop id may NOT repeat. `routeOrderIdx` is one Int per stop under
 * `@@unique([routeId, routeOrderIdx])` — a stop cannot hold two positions
 * at once. A loop is therefore modelled as two DISTINCT stops at the same
 * coordinates (e.g. "Gjendesheim, Start" / "Gjendesheim, zurück"), never
 * one stop listed twice; the return visit gets its own date and notes for
 * free that way, and `routeOrderIdx` stays contiguous as the schema
 * requires.
 */
export const assignStopsSchema = z.object({
  stopIds: z.array(z.string().uuid()).max(512),
}).refine((v) => new Set(v.stopIds).size === v.stopIds.length, {
  message: "A stop may appear only once in a route; model a loop as two distinct stops at the same place",
  path: ["stopIds"],
});

/**
 * `straight` / `drawn` — the hand-corrected shape. `waypoints` stays
 * REQUIRED-shaped for `drawn` and forbidden for `straight` via the two
 * `.refine()` calls below, applied to the UNION rather than to this
 * member alone: `z.discriminatedUnion` requires each option to be a plain
 * `ZodObject` (it inspects `.shape` to collect discriminator literals), so
 * a `.refine()`'d member — a `ZodEffects` wrapper — is rejected at
 * construction time. Refining the union afterwards, instead, is exactly
 * how the pre-union version of this schema worked, just moved one level
 * up.
 */
const manualLegShape = z.object({
  source: manualLegSource,
  mode: z.enum(LEG_MODES).optional(),
  waypoints: z.array(coordinate).min(2).max(256).optional(),
  drivingMinutes: z.number().int().min(0).max(100_000).nullable().optional(),
  tollCost: z.number().min(0).max(1_000_000).nullable().optional(),
  currency: z.string().length(3).nullable().optional(),
});

/**
 * `track` — adopt a segment of an already-uploaded `TripRouteTrack`.
 * `trackId` is REQUIRED (no default, no fallback): a `track` leg with no
 * `trackId` would be a leg claiming geometry it does not have. No
 * `waypoints` field at all — the geometry comes from the track via
 * `adoptSegment` (`services/tour/tracks/adoptTrack.ts`), and accepting a
 * caller-supplied line here too would give the leg two disagreeing
 * sources of truth for the same column.
 */
const trackLegShape = z.object({
  source: trackLegSource,
  trackId: z.string().uuid(),
  mode: z.enum(LEG_MODES).optional(),
});

export const legOverrideSchema = z
  .discriminatedUnion("source", [manualLegShape, trackLegShape], {
    /**
     * `invalid_union_discriminator` fires when `source` matches NEITHER
     * member's literal set (`straight` | `drawn` | `track`) — `routed` is
     * the case that matters here, see `ROUTED_REDIRECT_MESSAGE`'s comment
     * above. `ctx.data` is the whole request body (this errorMap runs
     * before either member is chosen, so there is no narrower object to
     * inspect), which is the only way to tell "routed" apart from any
     * other unknown value at this point.
     */
    errorMap: (issue, ctx) => {
      if (
        issue.code === z.ZodIssueCode.invalid_union_discriminator &&
        ctx.data &&
        typeof ctx.data === "object" &&
        (ctx.data as Record<string, unknown>).source === "routed"
      ) {
        return { message: ROUTED_REDIRECT_MESSAGE };
      }
      return { message: ctx.defaultError };
    },
  })
  .refine((v) => v.source !== "drawn" || (v.waypoints !== undefined && v.waypoints.length >= 2), {
    message: "A drawn leg needs at least two waypoints",
    path: ["waypoints"],
  })
  .refine((v) => v.source !== "straight" || v.waypoints === undefined, {
    message: "A straight leg has no waypoints",
    path: ["waypoints"],
  });

export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;
export type AssignStopsInput = z.infer<typeof assignStopsSchema>;
export type LegOverrideInput = z.infer<typeof legOverrideSchema>;
export type { LegMode, LegSource } from "../services/tour/tourDistance";

/**
 * Validate and canonicalise the operator-supplied "custom" routing base URL
 * (`AdminSettings.routingCustomUrl`, used only when `routingProvider ==
 * "custom"` — a self-hosted OSRM instance, see
 * `services/tour/routing/customOsrm.ts`).
 *
 * DELIBERATE NON-RESTRICTION (SSRF egress): there is intentionally NO block
 * on loopback / link-local / private / RFC1918 hosts here. This mirrors
 * `normalizeImmichBaseUrl` (services/immich/types.ts) exactly, and for the
 * same reason: a self-hosted OSRM instance lives on the operator's LAN by
 * design (often a private RFC1918 or `.local` address), so a private-IP
 * filter would break the primary use case. The URL is admin-supplied, not
 * attacker-chosen, in the single-tenant deployment this targets. An operator
 * who exposes this configuration to untrusted users on a multi-tenant
 * instance MUST restrict egress at the network layer instead. Do not
 * re-flag this without changing that threat model.
 */
export function normalizeRoutingCustomUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    throw new Error("Custom routing URL is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Custom routing URL must use http:// or https://");
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${path}`;
}

/** Zod wrapper around {@link normalizeRoutingCustomUrl} for use at a request boundary. */
const routingCustomUrlSchema = z
  .string()
  .trim()
  .min(1)
  .transform((raw, ctx) => {
    try {
      return normalizeRoutingCustomUrl(raw);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : "Invalid custom routing URL",
      });
      return z.NEVER;
    }
  });

/**
 * Admin-only routing configuration (Phase 3): which provider is active, and
 * — only meaningful when `routingProvider === "custom"` — the self-hosted
 * OSRM base URL. `null` clears the field; `undefined` (the key omitted
 * entirely) leaves it unchanged, matching every other settings PUT in this
 * codebase.
 */
export const routingSettingsSchema = z
  .object({
    routingProvider: z.enum(ROUTING_PROVIDER_IDS).nullable().optional(),
    routingCustomUrl: routingCustomUrlSchema.nullable().optional(),
  })
  .partial();

export type RoutingSettingsInput = z.infer<typeof routingSettingsSchema>;

/**
 * Body for `POST /tours/geometry/batch` (`routes/trips/tourIndex.ts`) —
 * the dashboard-wide map's one round trip for several sections' geometry
 * at once. Same shape and same bounds as `cruises.ts`'s
 * `geometryBatchSchema`: a min of 1 keeps an empty request from being a
 * silent no-op that still costs a round trip, and the max of 100 is a
 * denial-of-service bound, not a product limit.
 */
export const tourGeometryBatchSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
});

export type TourGeometryBatchInput = z.infer<typeof tourGeometryBatchSchema>;
