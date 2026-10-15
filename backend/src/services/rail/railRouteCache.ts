import { z } from "zod";
import { RouteStore, routeDirectory, routeKey } from "../routing/routeStore";
import { isTracedShape, type LonLat } from "./railGeometryMath";

const lineSchema = z
  .array(z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]))
  .min(2)
  .max(200_000);

export function railRouteCacheKey(
  baseUrl: string,
  profile: string,
  points: readonly LonLat[]
): string {
  return routeKey([2, baseUrl.replace(/\/+$/, ""), profile, points]);
}

/** Successful track geometry has no age limit. Hot-cache eviction keeps its disk copy. */
export class RailRouteCache extends RouteStore<LonLat[]> {
  constructor(directory: string | null) {
    super(directory, (value) => {
      const parsed = lineSchema.safeParse(value);
      return parsed.success && isTracedShape(parsed.data) ? parsed.data : null;
    });
  }
}
export const railRouteCache = new RailRouteCache(routeDirectory("rail"));
