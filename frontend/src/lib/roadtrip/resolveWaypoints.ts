import { searchPlaces } from "../api/geo";
import { logger } from "../logger";
import type { MapsLinkWaypoint, StartPoint } from "./startSources";

export type ResolveResult =
  | { ok: true; points: StartPoint[] }
  /** `name` is the first stop that could not be placed; `unavailable`: the geocoder itself failed. */
  | { ok: false; reason: "notFound" | "unavailable"; name: string };

/**
 * Gives every named stop of a Maps link a point, by the same place search the
 * station form uses. The first stop that cannot be placed ends it with its
 * name and WHY — the geocoder being down is not the same as the place being
 * unknown, and a roadtrip started with a stop silently dropped would be a
 * wrong route.
 */
export async function resolveWaypoints(
  waypoints: readonly MapsLinkWaypoint[],
  lang: string | undefined
): Promise<ResolveResult> {
  const points: StartPoint[] = [];
  for (const w of waypoints) {
    if ("lat" in w) {
      points.push(w);
      continue;
    }
    try {
      const found = await searchPlaces(w.name, lang);
      if (found.degraded) return { ok: false, reason: "unavailable", name: w.name };
      const hit = found.results[0];
      if (!hit) return { ok: false, reason: "notFound", name: w.name };
      points.push({ title: w.name, lat: hit.lat, lon: hit.lon });
    } catch (err) {
      logger.warn("Placing a Maps link stop failed", err);
      return { ok: false, reason: "unavailable", name: w.name };
    }
  }
  return { ok: true, points };
}
