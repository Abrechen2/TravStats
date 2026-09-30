import { z } from "zod";

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
 * Off unless an admin configures the base URL. One request per journey, when
 * it is saved; the answer is frozen on the row, so there is no cache here —
 * the row IS the cache. A failure is a result with a reason, never an
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
        distance: z.number(),
        points: z.object({
          coordinates: z.array(z.tuple([z.number(), z.number()]).rest(z.number())).min(2),
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
  url: string
): Promise<{ status: number; body: unknown } | { status: null; error: string }> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": railUserAgent(), Accept: "application/json" },
      signal: AbortSignal.timeout(RAIL_ROUTING_TIMEOUT_MS),
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
export async function routeRailLine(
  baseUrl: string,
  points: readonly LonLat[]
): Promise<RailRoutingResult> {
  const answer = await getJson(routeUrl(baseUrl, points));
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
  const raw = parsed.data.paths[0].points.coordinates.map(([lon, lat]) => [lon, lat] as LonLat);
  const line = densifyLine(simplifyDegrees(raw, SIMPLIFY_TOLERANCE_DEG), MAX_STORED_SEGMENT_KM);
  if (!isTracedShape(line)) return { ok: false, reason: "unavailable" };
  return { ok: true, line };
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
