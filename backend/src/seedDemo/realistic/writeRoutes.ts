import { prisma } from "../../db";
import { recomputeLegs, type StopCoords } from "../../services/tour/legRecompute";
import { applyRoutedLeg } from "../../services/tour/routing/autoRouteLegs";
import { adoptSegment } from "../../services/tour/tracks/adoptTrack";
import { ingestTrack } from "../../services/tour/tracks/ingestTrack";
import { ingestedTrackColumns } from "../../services/tour/tracks/trackRow";
import type { Prisma } from "../../prisma";
import { ROADTRIPS, TOURS, roadtripLegKey, type TourSpec, type TrackSpec } from "./data/routeSpecs";
import {
  LEGS_FILE,
  TRACKS_FILE,
  decodeLine,
  readGeometryFile,
  type StoredLeg,
  type StoredTrack,
} from "./geometryFile";
import type { SeedContext } from "./context";
import { stayKey, type StayIndex } from "./writeGround";
import { addDays, localInstant } from "./time";

/**
 * Roadtrips and tours, with the geometry generated once by
 * `scripts/demo/generateDemoGeometry.ts`. Nothing here asks a router: a
 * driven leg takes its stored route through `applyRoutedLeg` (the very write
 * the routing endpoints use), a tour leg takes its slice of the day's
 * recording through `adoptSegment` (the very cut the "use this track" button
 * makes). No leg is left a straight line.
 */

let legs: Record<string, StoredLeg> | null = null;
let tracks: Record<string, StoredTrack> | null = null;

function storedLeg(key: string): StoredLeg {
  legs ??= readGeometryFile<StoredLeg>(LEGS_FILE);
  const leg = legs[key];
  if (!leg) throw new Error(`Demo seed: no stored geometry for roadtrip leg ${key}`);
  return leg;
}

function storedTrack(key: string): StoredTrack {
  tracks ??= readGeometryFile<StoredTrack>(TRACKS_FILE);
  const track = tracks[key];
  if (!track) throw new Error(`Demo seed: no stored recording for ${key}`);
  return track;
}

async function orderedLegs(routeId: string, stops: readonly StopCoords[]) {
  const rows = await prisma.tripRouteLeg.findMany({ where: { routeId } });
  return stops.slice(0, -1).map((from, i) => {
    const leg = rows.find((r) => r.fromStopId === from.id && r.toStopId === stops[i + 1].id);
    if (!leg) throw new Error(`Demo seed: leg ${i} of route ${routeId} was not planned`);
    return leg;
  });
}

export async function writeRoadtrip(
  ctx: SeedContext,
  key: string,
  tripId: string,
  day: Date,
  stays: StayIndex
): Promise<string> {
  const spec = ROADTRIPS.find((r) => r.key === key);
  if (!spec) throw new Error(`Demo seed: unknown roadtrip ${key}`);
  const route = await prisma.tripRoute.create({
    data: {
      userId: ctx.userId,
      tripId,
      kind: "roadtrip",
      name: spec.name,
      mode: "road",
      vehicle: spec.vehicle,
      vehicleName: spec.vehicleName,
      color: spec.color,
      startOdometerKm: spec.startOdometerKm,
    },
  });
  const stops: StopCoords[] = [];
  for (const [index, station] of spec.stations.entries()) {
    const night = station.night;
    const stayId =
      typeof night === "object" ? stays.get(stayKey(night.lodging, station.day)) : undefined;
    if (typeof night === "object" && !stayId) {
      throw new Error(
        `Demo seed: ${key} station ${station.title} names a stay the trip does not have`
      );
    }
    stops.push(
      await prisma.tripStop.create({
        data: {
          tripId: null,
          domain: "roadtrip",
          title: station.title,
          lat: station.lat,
          lon: station.lon,
          startDate: addDays(day, station.day),
          endDate: station.untilDay === undefined ? null : addDays(day, station.untilDay),
          routeId: route.id,
          routeOrderIdx: index,
          overnight: night !== "pass",
          lodgingStayId: stayId ?? null,
        },
        select: { id: true, lat: true, lon: true },
      })
    );
  }
  await prisma.$transaction((tx) => recomputeLegs(tx, route.id, "road", stops), {
    timeout: 30_000,
  });

  for (const [i, leg] of (await orderedLegs(route.id, stops)).entries()) {
    const stored = storedLeg(roadtripLegKey(key, i));
    const waypoints = decodeLine(stored.w);
    if (stored.src === "drawn") {
      // A ferry: not routable, drawn through the crossing and marked as such.
      await prisma.tripRouteLeg.update({
        where: { id: leg.id },
        data: {
          source: "drawn",
          mode: "ferry",
          confidence: "high",
          waypoints: waypoints as unknown as Prisma.InputJsonValue,
          distanceKm: stored.km,
        },
      });
      continue;
    }
    await applyRoutedLeg(leg.id, {
      source: "routed",
      confidence: "high",
      waypoints,
      distanceKm: stored.km,
      drivingMinutes: stored.min,
      fallbackReason: null,
    });
  }
  ctx.stationIdsByRoadtrip.set(
    key,
    stops.map((s) => s.id)
  );
  return route.id;
}

/** The recording as a parser would hand it over: points, elevations, times. */
function recordedTrack(ctx: SeedContext, spec: TrackSpec, day: Date) {
  const stored = storedTrack(spec.key);
  const points = decodeLine(stored.p);
  const [lat, lon] = spec.via[0];
  const start = localInstant(addDays(day, spec.day), spec.start, { lat, lon }).getTime();
  const times = stored.t.map((s) => start + s * 1000);
  const parsed = {
    points,
    segmentStarts: [0],
    startedAt: new Date(times[0]),
    endedAt: new Date(times[times.length - 1]),
    name: spec.name,
    elevations: stored.e,
    times,
  };
  const ingested = ingestTrack(parsed);
  if (!ingested) throw new Error(`Demo seed: recording ${spec.key} could not be ingested`);
  return ingested;
}

const minuteOfDay = (clock: string): number => {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
};

function tourSpec(key: string): TourSpec {
  const spec = TOURS.find((t) => t.key === key);
  if (!spec) throw new Error(`Demo seed: unknown tour ${key}`);
  return spec;
}

export async function writeTour(
  ctx: SeedContext,
  key: string,
  tripId: string,
  day: Date,
  anchorStopId: string | null
): Promise<{ routeId: string; tracks: number }> {
  const spec = tourSpec(key);
  const firstTrack = spec.tracks[0];
  const route = await prisma.tripRoute.create({
    data: {
      userId: ctx.userId,
      tripId,
      kind: "tour",
      name: spec.name,
      mode: spec.mode,
      activity: spec.activity,
      color: spec.color,
      anchorStopId,
      tourDate: addDays(day, firstTrack.day),
      tourStartMinute: minuteOfDay(firstTrack.start),
    },
  });
  const stops: StopCoords[] = [];
  for (const [index, stop] of spec.stops.entries()) {
    stops.push(
      await prisma.tripStop.create({
        data: {
          tripId,
          title: stop.title,
          lat: stop.lat,
          lon: stop.lon,
          routeId: route.id,
          routeOrderIdx: index,
          orderIdx: index,
        },
        select: { id: true, lat: true, lon: true },
      })
    );
  }
  await prisma.$transaction((tx) => recomputeLegs(tx, route.id, spec.mode, stops), {
    timeout: 30_000,
  });

  const recordings = [];
  for (const track of spec.tracks) {
    const ingested = recordedTrack(ctx, track, day);
    await prisma.tripRouteTrack.create({
      data: {
        routeId: route.id,
        source: "gpx",
        name: track.name,
        ...ingestedTrackColumns(ingested),
        truncated: false,
      },
    });
    recordings.push(ingested);
  }

  const legsInOrder = await orderedLegs(route.id, stops);
  for (const [i, leg] of legsInOrder.entries()) {
    // One recording per day and leg, or one recording for the whole walk.
    const recording = recordings.length === legsInOrder.length ? recordings[i] : recordings[0];
    const from = stops[i];
    const to = stops[i + 1];
    const adoption = adoptSegment(
      recording.geometry,
      { lat: from.lat as number, lon: from.lon as number },
      { lat: to.lat as number, lon: to.lon as number },
      { cumulativeKm: recording.cumulativeKm, segmentStarts: recording.segmentStarts }
    );
    if (!adoption || adoption.spansRecordingGap) {
      throw new Error(`Demo seed: the recording of ${key} does not cover leg ${i}`);
    }
    await prisma.tripRouteLeg.update({
      where: { id: leg.id },
      data: {
        source: "track",
        confidence: "high",
        waypoints: adoption.waypoints as unknown as Prisma.InputJsonValue,
        distanceKm: adoption.distanceKm,
      },
    });
  }
  return { routeId: route.id, tracks: recordings.length };
}
