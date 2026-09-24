import { Prisma } from "../../../prisma";
import type { IngestedTrack } from "./ingestTrack";

/**
 * The columns every stored track takes from an ingested recording, whatever
 * brought it in — a file upload, a Dawarich pull, a Strava import. One
 * mapping, so a new measured figure reaches every writer at once instead of
 * the one someone remembered (a fix on one write path is not a fix).
 */
export function ingestedTrackColumns(ingested: IngestedTrack): {
  startedAt: Date;
  endedAt: Date;
  geometry: Prisma.InputJsonValue;
  segmentStarts: Prisma.InputJsonValue;
  cumulativeKm: Prisma.InputJsonValue;
  pointCount: number;
  distanceKm: number;
  elevations: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  ascentM: number | null;
  descentM: number | null;
  movingSeconds: number | null;
} {
  return {
    startedAt: ingested.startedAt,
    endedAt: ingested.endedAt,
    geometry: ingested.geometry as unknown as Prisma.InputJsonValue,
    // The two things the geometry alone cannot say: where the recording
    // stopped, and how far the RAW track had run at each kept vertex
    // (AUD-033, AUD-034).
    segmentStarts: ingested.segmentStarts as unknown as Prisma.InputJsonValue,
    cumulativeKm: ingested.cumulativeKm as unknown as Prisma.InputJsonValue,
    pointCount: ingested.pointCount,
    distanceKm: ingested.distanceKm,
    // The column holds the PROFILE, `[km, metres]` pairs (see schema.prisma).
    elevations:
      ingested.elevationProfile === null
        ? Prisma.JsonNull
        : (ingested.elevationProfile as unknown as Prisma.InputJsonValue),
    ascentM: ingested.ascentM,
    descentM: ingested.descentM,
    movingSeconds: ingested.movingSeconds,
  };
}

/**
 * P2002 on `[routeId, externalRef]` — the same source record (a HealthKit
 * workout, a Strava activity) imported into the same route a second time.
 */
export function isDuplicateExternalRef(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002" &&
    JSON.stringify(error.meta ?? {}).includes("external_ref")
  );
}
