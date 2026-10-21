/**
 * Whether a user may make the server ask Wikimedia about something (rich map
 * details, 2026-10-21). The endpoints take free text and coordinates, so only
 * what the user's OWN rows record is ever looked up — a vessel, car model or
 * train category one of their journeys names, a point at one of their own
 * stations. Anything else answers "nothing" without a request leaving the
 * instance, and a user can never learn about another user's rows through it.
 */
import { prisma } from "../../db";
import type { SubjectKind } from "./subjectImageLookup";

export const STOP_DOMAINS = ["rail", "bus", "ferry", "rental"] as const;
export type StopDomain = (typeof STOP_DOMAINS)[number];

export async function ownsSubject(
  userId: string,
  kind: SubjectKind,
  name: string
): Promise<boolean> {
  const same = { equals: name, mode: "insensitive" as const };
  switch (kind) {
    case "vessel":
      return (
        (await prisma.ferryJourney.count({ where: { userId, vesselName: same }, take: 1 })) > 0
      );
    case "vehicle":
      return (
        (await prisma.rentalBooking.count({ where: { userId, vehicleExample: same }, take: 1 })) > 0
      );
    case "train":
      return (
        (await prisma.railJourney.count({ where: { userId, trainCategory: same }, take: 1 })) > 0
      );
  }
}

/** ~250 m: the station-dot rule (`endKey` rounds to ~110 m) with room for two spellings. */
const NEAR_DEG = 0.0025;

function near(lat: number, lon: number, latKey: string, lonKey: string) {
  // A degree of longitude shrinks towards the poles; widen the box to match.
  const lonSpan = NEAR_DEG / Math.max(Math.cos((lat * Math.PI) / 180), 0.05);
  return {
    [latKey]: { gte: lat - NEAR_DEG, lte: lat + NEAR_DEG },
    [lonKey]: { gte: lon - lonSpan, lte: lon + lonSpan },
  };
}

/** Whether one of the user's journeys of `domain` starts or ends near the point. */
export async function ownsStop(
  userId: string,
  domain: StopDomain,
  lat: number,
  lon: number
): Promise<boolean> {
  if (domain === "rental") {
    const where = {
      userId,
      OR: [near(lat, lon, "pickupLat", "pickupLon"), near(lat, lon, "returnLat", "returnLon")],
    };
    return (await prisma.rentalBooking.count({ where, take: 1 })) > 0;
  }
  const where = {
    userId,
    OR: [near(lat, lon, "depLat", "depLon"), near(lat, lon, "arrLat", "arrLon")],
  };
  switch (domain) {
    case "rail":
      return (await prisma.railJourney.count({ where, take: 1 })) > 0;
    case "bus":
      return (await prisma.busJourney.count({ where, take: 1 })) > 0;
    case "ferry":
      return (await prisma.ferryJourney.count({ where, take: 1 })) > 0;
  }
}
