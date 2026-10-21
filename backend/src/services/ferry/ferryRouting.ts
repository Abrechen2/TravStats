import { prisma, type DbTransaction } from "../../db";
import { Prisma } from "../../prisma";
import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
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

/**
 * Keep the sea leg and crossing atomic, without replacing a hand-drawn/recorded line.
 *
 * `onMismatch: "keep"` is the link's reading: a roadtrip stop is a town, rarely
 * the pier, and a leg whose stops are not the crossing's ports keeps the chord
 * it was given instead of refusing the link. An edit that leaves the terminals
 * unchanged reads it the same way, or a crossing linked off its piers could
 * never be edited again. Routing keeps the refusal — there a mismatch means a
 * stop moved under a linked leg.
 */
export async function syncFerryLeg(
  tx: DbTransaction,
  ferry: LinkedCrossing,
  { onMismatch = "refuse" }: { onMismatch?: "refuse" | "keep" } = {}
): Promise<void> {
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
  ) {
    if (onMismatch === "keep") return;
    throw new AppError("Unlink the roadtrip leg before changing terminals", 409);
  }
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
      if (existing.shareKey) await syncCopiesLegs(tx, existing.shareKey, id);
    },
    { timeout: SHARE_TX_TIMEOUT_MS }
  );
  return { outcome: "routed" as const };
}

export type CrossingRouteOutcome = "routed" | "straight" | "unchanged" | "failed";

/**
 * Route a crossing that is still a straight line, after it was saved
 * (forgejo#323). A crossing added by hand, edited onto new terminals or
 * written by a spreadsheet used to stay a chord — Kiel–Oslo across Denmark —
 * until someone pressed the button on its detail page. Best effort on
 * purpose: the crossing is already committed, so a router failure is logged
 * and leaves the chord (drawn faint on the map, with the detail page's button
 * to try again) rather than failing a save that succeeded. No sea route at
 * all — a short hop over open water — is an answer, not a failure.
 */
export async function routeCrossingIfStraight(
  userId: string,
  id: string,
  operation: string
): Promise<CrossingRouteOutcome> {
  try {
    return (await routeFerryJourney(userId, id)).outcome;
  } catch (error) {
    logger.warn(
      {
        operation,
        ferryJourneyId: id,
        err: error instanceof Error ? error.message : String(error),
      },
      "sea route not computed; the crossing stays a straight line"
    );
    return "failed";
  }
}

/**
 * Propagation hands the sea line to every copy, but a member may have linked
 * their copy to a roadtrip leg of their own. That leg follows too — best
 * effort: a member's leg that no longer fits their copy is their private
 * routing and must not block the sharer's write, so it is left as it is.
 */
async function syncCopiesLegs(tx: DbTransaction, shareKey: string, ownId: string): Promise<void> {
  const copies = await tx.ferryJourney.findMany({
    where: {
      shareKey,
      id: { not: ownId },
      roadtripLegId: { not: null },
      geometrySource: "sea_route",
    },
  });
  for (const copy of copies) {
    try {
      await syncFerryLeg(tx, copy);
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      logger.warn(
        { operation: "ferry.route.copyLeg", ferryJourneyId: copy.id, code: error.code },
        "a shared copy's linked leg was left unchanged"
      );
    }
  }
}
