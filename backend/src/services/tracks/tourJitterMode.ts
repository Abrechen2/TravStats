import { prisma } from "../../db";
import { tourJitterMode, type JitterMode } from "./jitterProfiles";

/**
 * The jitter mode a recording stored on tour section `routeId` is filtered
 * as: the section's activity, else its leg mode (`tourJitterMode`). A section
 * that cannot be read — the caller has already proven it exists — falls back
 * to `mixed`, the profile that assumes least.
 */
export async function jitterModeOfRoute(routeId: string): Promise<JitterMode> {
  const route = await prisma.tripRoute.findUnique({
    where: { id: routeId },
    select: { mode: true, activity: true },
  });
  return route ? tourJitterMode(route) : "mixed";
}
