import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import { haversineKm, polylineLengthKm } from "../../shared/geo/haversine";
import { propagateWrite, shareSnapshot, SHARE_TX_TIMEOUT_MS } from "../sharing/propagate";
import { computeFerryGeometry, readSeaGeometry, type FerryEnds } from "./ferryGeometry";

interface LinkedCrossing extends FerryEnds {
  userId: string;
  tripId: string | null;
  roadtripLegId: string | null;
  geometry: unknown;
  geometrySource: string;
}

/** Keep the sea leg and crossing atomic, without replacing a hand-drawn/recorded line. */
export async function syncFerryLeg(tx: DbTransaction, ferry: LinkedCrossing): Promise<void> {
  if (!ferry.roadtripLegId) return;
  const leg = await tx.tripRouteLeg.findFirst({
    where: { id: ferry.roadtripLegId, route: { userId: ferry.userId, tripId: ferry.tripId } },
    include: { fromStop: true, toStop: true },
  });
  if (!leg || leg.mode !== "ferry")
    throw new AppError("The linked sea leg changed; reload", 409, "VERSION_CONFLICT");
  if (leg.source === "drawn" || leg.source === "track") return;
  const matches = (stop: { lat: number | null; lon: number | null }, lat: number, lon: number) =>
    stop.lat !== null &&
    stop.lon !== null &&
    haversineKm({ lat: stop.lat, lon: stop.lon }, { lat, lon }) <= 1;
  if (
    !matches(leg.fromStop, ferry.depLat, ferry.depLon) ||
    !matches(leg.toStop, ferry.arrLat, ferry.arrLon)
  )
    throw new AppError("Unlink the roadtrip leg before changing terminals", 409);
  const line = ferry.geometrySource === "sea_route" ? readSeaGeometry(ferry.geometry) : null;
  const distanceKm = line
    ? polylineLengthKm(line.map(([lon, lat]) => ({ lat, lon })))
    : haversineKm(
        { lat: ferry.depLat, lon: ferry.depLon },
        { lat: ferry.arrLat, lon: ferry.arrLon }
      );
  const written = await tx.tripRouteLeg.updateMany({
    where: { id: leg.id, updatedAt: leg.updatedAt, mode: "ferry", source: leg.source },
    data: {
      source: line ? "routed" : "straight",
      confidence: "low", // schematic sea route, not a recording
      waypoints: line ?? Prisma.DbNull,
      distanceKm: Math.round(distanceKm * 10) / 10,
      drivingMinutes: null,
    },
  });
  if (written.count !== 1) throw new AppError("Sea leg changed elsewhere", 409, "VERSION_CONFLICT");
}

export async function routeFerryJourney(userId: string, id: string) {
  const existing = await prisma.ferryJourney.findFirst({ where: { id, userId } });
  if (!existing) throw new AppError("Ferry ride not found", 404);
  if (existing.geometrySource !== "straight") return { outcome: "unchanged" as const };
  const result = await computeFerryGeometry(existing);
  if (!result) return { outcome: "straight" as const };
  await prisma.$transaction(
    async (tx) => {
      // The sea line and its length are shared facts: every copy gets them.
      const before = await shareSnapshot(tx, "ferry", id);
      const saved = await tx.ferryJourney.updateMany({
        where: { id, userId, updatedAt: existing.updatedAt, geometrySource: "straight" },
        data: {
          geometry: result.geometry,
          geometrySource: "sea_route",
          ...(existing.distanceSource !== "user" && {
            distanceKm: result.distanceKm,
            distanceSource: "sea_route",
          }),
        },
      });
      if (saved.count !== 1)
        throw new AppError("Crossing changed elsewhere", 409, "VERSION_CONFLICT");
      await syncFerryLeg(tx, {
        ...existing,
        geometry: result.geometry,
        geometrySource: "sea_route",
      });
      await propagateWrite(tx, userId, "ferry", id, before);
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  return { outcome: "routed" as const };
}
