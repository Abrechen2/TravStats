import { prisma } from "../db";
import { recomputeLegs, type StopCoords } from "../services/tour/legRecompute";
import type { StoryTour } from "./stories";

/**
 * One tour section with its stops in order. Legs come from the same
 * `recomputeLegs` the tour routes use, so they are `straight` legs with a
 * great-circle distance until someone asks the app for a road route.
 */
export async function seedTour(tripId: string, tour: StoryTour, orderIdx: number): Promise<string> {
  const route = await prisma.tripRoute.create({
    data: { tripId, name: tour.name, mode: tour.mode, color: tour.color, orderIdx },
  });
  const stops: StopCoords[] = [];
  for (const [index, point] of tour.stops.entries()) {
    stops.push(
      await prisma.tripStop.create({
        data: {
          tripId,
          title: point.name,
          lat: point.lat,
          lon: point.lon,
          orderIdx: index,
          routeId: route.id,
          routeOrderIdx: index,
        },
        select: { id: true, lat: true, lon: true },
      })
    );
  }
  await prisma.$transaction((tx) => recomputeLegs(tx, route.id, tour.mode, stops), {
    timeout: 30_000,
  });
  return route.id;
}
