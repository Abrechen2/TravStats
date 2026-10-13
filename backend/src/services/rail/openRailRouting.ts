import { z } from "zod";
import { calculateDistance } from "../../utils/geo";
import { railRouteCache, railRouteCacheKey } from "./railRouteCache";

import { getInstanceSettings } from "../instanceSettingsService";
import { simplifyDegrees } from "../schematicRouter";
import logger from "../../utils/logger";
import { railUserAgent } from "./lookup/railHttp";
import { densifyLine, isTracedShape, type LonLat } from "./railGeometryMath";

/**
 * A self-hosted OpenRailRouting (https://github.com/geofabrik/OpenRailRouting):
 * GraphHopper over the OpenStreetMap rail network. It answers "which tracks
 * connect these stations", which is the line a journey is drawn with when no
 * timetable trace exists (spec 2026-09-25-rail-domain, phase 3).
 *
 * Off unless an admin configures the base URL. Resolved when a journey
 * is saved; successful routes are shared through a bounded disk cache,
 * then frozen on each journey. A failure is a result with a reason, never an
 * exception and never a straight line wearing the name `openrailrouting`.
 */

/**
 * The profile asked for. OpenRailRouting's default configuration and the
 * public instance both carry `all_tracks` (every standard, narrow and broad
 * gauge track); the admin test says so when an instance lacks it.
 */
export const RAIL_ROUTING_PROFILE = "all_tracks";

/**
 * A save waits for this at most. The request is part of a user's save, so it
 * must not hang it: long enough for a continental route on a small server,
 * short enough that a dead host costs one visible pause, not a timeout of the
 * whole form (the client allows 10 s for an ordinary call).
 */
export const RAIL_ROUTING_TIMEOUT_MS = 8_000;

/** ~20 m. A routed line has a vertex every few metres; the map needs far fewer. */
const SIMPLIFY_TOLERANCE_DEG = 0.0002;

/**
 * Segments longer than this are split after simplifying, so a long straight
 * stretch never reads as a feed's station-to-station chord
 * (`MAX_PLAUSIBLE_SEGMENT_KM`) and a station can still be found on the line.
 */
const MAX_STORED_SEGMENT_KM = 10;

export type RailRoutingFailure = "unavailable" | "noRoute";

export type RailRoutingResult =
  { ok: true; line: LonLat[] } | { ok: false; reason: RailRoutingFailure };

const routeAnswerSchema = z.object({
  paths: z
    .array(
      z.object({
        distance: z.number().finite().nonnegative(),
        snapped_waypoints: z
          .object({ coordinates: z.array(z.tuple([z.number(), z.number()])) })
          .optional(),
        points: z.object({
          coordinates: z
            .array(
              z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]).rest(z.number())
            )
            .min(2),
        }),
      })
    )
    .min(1),
});

/** The configured base URL, or null when OpenRailRouting is off. */
export async function railRoutingBaseUrl(): Promise<string | null> {
  const { railRoutingUrl } = await getInstanceSettings();
  return railRoutingUrl;
}

function routeUrl(baseUrl: string, points: readonly LonLat[]): string {
  const url = new URL(`${baseUrl}/route`);
  for (const [lon, lat] of points) url.searchParams.append("point", `${lat},${lon}`);
  url.searchParams.set("profile", RAIL_ROUTING_PROFILE);
  url.searchParams.set("points_encoded", "false");
  url.searchParams.set("instructions", "false");
  url.searchParams.set("calc_points", "true");
  return url.toString();
}

async function getJson(
  url: string,
  init: RequestInit = {},
  signal = AbortSignal.timeout(RAIL_ROUTING_TIMEOUT_MS)
): Promise<{ status: number; body: unknown } | { status: null; error: string }> {
  try {
    const response = await fetch(url, {
      ...init,
      headers: { "User-Agent": railUserAgent(), Accept: "application/json", ...init.headers },
      signal,
    });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  } catch (error) {
    return { status: null, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * The line over the tracks through `points` (the two stations, and any stop
 * between them in order). `noRoute` = the instance answered and knows no
 * connection (a station off its extract, or no tracks between); anything else
 * that is not a usable line is `unavailable`.
 */
async function fetchRailLine(
  baseUrl: string,
  points: readonly LonLat[]
): Promise<RailRoutingResult> {
  const signal = AbortSignal.timeout(RAIL_ROUTING_TIMEOUT_MS);
  let answer = await getJson(routeUrl(baseUrl, points), {}, signal);
  let railOnly = false;
  // At large stations all_tracks can snap to a disconnected tram/subway network.
  // Retry only that failure, on the SAME coordinates, excluding non-rail tracks.
  // The shared signal bounds both requests together to the normal save budget.
  const disconnected = z
    .object({ hints: z.array(z.object({ details: z.string() })) })
    .safeParse(answer.status === 400 ? answer.body : null);
  if (
    disconnected.success &&
    disconnected.data.hints.some(
      (hint) => hint.details === "com.graphhopper.util.exceptions.ConnectionNotFoundException"
    )
  ) {
    railOnly = true;
    answer = await getJson(
      `${baseUrl}/route`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile: RAIL_ROUTING_PROFILE,
          points,
          points_encoded: false,
          instructions: false,
          calc_points: true,
          "ch.disable": true,
          custom_model: { priority: [{ if: "railway_class != RAIL", multiply_by: "0" }] },
        }),
      },
      signal
    );
  }
  if (answer.status === null) {
    logger.warn({ operation: "rail_routing_request", reason: "no_answer", error: answer.error });
    return { ok: false, reason: "unavailable" };
  }
  // GraphHopper answers 400 for "Cannot find point" and "Connection between
  // locations not found" — the instance works, the question has no answer.
  if (answer.status === 400) {
    logger.info({ operation: "rail_routing_request", reason: "no_route" });
    return { ok: false, reason: "noRoute" };
  }
  if (answer.status < 200 || answer.status >= 300) {
    logger.warn({ operation: "rail_routing_request", status: answer.status });
    return { ok: false, reason: "unavailable" };
  }
  const parsed = routeAnswerSchema.safeParse(answer.body);
  if (!parsed.success) {
    logger.warn({ operation: "rail_routing_request", reason: "unexpected_shape" });
    return { ok: false, reason: "unavailable" };
  }
  const snapped = parsed.data.paths[0].snapped_waypoints?.coordinates;
  // Never rescue a route by silently moving a requested station far away.
  if (
    railOnly &&
    (!snapped ||
      snapped.length !== points.length ||
      snapped.some(
        ([lon, lat], i) => calculateDistance(lat, lon, points[i][1], points[i][0]) > 0.5
      ))
  )
    return { ok: false, reason: "noRoute" };
  const raw = parsed.data.paths[0].points.coordinates.map(([lon, lat]) => [lon, lat] as LonLat);
  const line = densifyLine(simplifyDegrees(raw, SIMPLIFY_TOLERANCE_DEG), MAX_STORED_SEGMENT_KM);
  if (!isTracedShape(line)) return { ok: false, reason: "unavailable" };
  return { ok: true, line };
}

const inFlight = new Map<string, Promise<RailRoutingResult>>();

/** Reuse only successful routes; concurrent identical saves make one request. */
export async function routeRailLine(
  baseUrl: string,
  points: readonly LonLat[]
): Promise<RailRoutingResult> {
  baseUrl = baseUrl.replace(/\/+$/, "");
  const key = railRouteCacheKey(baseUrl, RAIL_ROUTING_PROFILE, points);
  const existing = inFlight.get(key);
  if (existing) return structuredClone(await existing);
  const pending = (async (): Promise<RailRoutingResult> => {
    const cached = await railRouteCache.get(key);
    if (cached) return { ok: true, line: cached };
    const result = await fetchRailLine(baseUrl, points);
    if (result.ok) await railRouteCache.put(key, result.line);
    return result;
  })();
  inFlight.set(key, pending);
  try {
    return structuredClone(await pending);
  } finally {
    inFlight.delete(key);
  }
}

export type RailRoutingProbe =
  | { ok: true; profile: string; dataDate: string | null }
  | { ok: false; code: "unreachable" | "notOpenRailRouting" | "profileMissing" };

const infoSchema = z.object({
  profiles: z.array(z.object({ name: z.string() })),
  data_date: z.string().optional(),
});

/**
 * The admin's test button: does this URL answer like an OpenRailRouting with
 * the profile the journeys are routed with? Reads `/info` only, so it works
 * whatever region the instance was built for.
 */
export async function probeRailRouting(baseUrl: string): Promise<RailRoutingProbe> {
  const answer = await getJson(`${baseUrl}/info`);
  if (answer.status === null) return { ok: false, code: "unreachable" };
  if (answer.status < 200 || answer.status >= 300) return { ok: false, code: "unreachable" };
  const parsed = infoSchema.safeParse(answer.body);
  if (!parsed.success) return { ok: false, code: "notOpenRailRouting" };
  if (!parsed.data.profiles.some((p) => p.name === RAIL_ROUTING_PROFILE)) {
    return { ok: false, code: "profileMissing" };
  }
  return { ok: true, profile: RAIL_ROUTING_PROFILE, dataDate: parsed.data.data_date ?? null };
}
