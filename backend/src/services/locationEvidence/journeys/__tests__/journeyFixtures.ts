import { prisma } from "../../../../db";
import { makeUser, wipeTravTrack } from "../../../travtrack/__tests__/fixtures";
import type { DerivationPoint } from "../../derivationRead";
import { stopDriveStop } from "./journeyPoints";

/**
 * Accounts and stored TravTrack history for the journey suites. Not a test
 * file (no `.test.ts` suffix).
 */

export const H = 3_600_000;
/** "Now" of the journey suites: the 25th, noon UTC; the days asked are the 18th–24th. */
export const NOW = Date.parse("2026-10-25T12:00:00Z");

/** 06:00 Berlin time on `day` (October 2026: UTC+2). */
export const morning = (day: string) => Date.parse(`${day}T04:00:00Z`);

let ref = 0;

/** The points, stored as TravTrack would have stored them. */
export async function storeAll(userId: string, points: readonly DerivationPoint[]): Promise<void> {
  await prisma.travTrackPoint.createMany({
    data: points.map((p) => {
      ref += 1;
      return {
        userId,
        t: new Date(p.atMs),
        tS: Math.floor(p.atMs / 1000),
        lat: p.lat,
        lon: p.lon,
        accuracyM: 5,
        origin: "companion:phone-1",
        originRef: `journey-${ref}`,
        deviceId: "phone-1",
      };
    }),
  });
}

/** One 90-minute drive at 100 km/h between two stops, starting at `t0`. */
export async function storeJourney(userId: string, t0: number, lon = 8): Promise<void> {
  await storeAll(userId, stopDriveStop(t0, 90, 100, 50, lon));
}

/** A TravTrack account with the journey domains switched on. */
export async function makeJourneyUser(
  username: string,
  settings: { locationProvider?: string; enabledDomains?: string[] } = {}
): Promise<string> {
  const userId = await makeUser(username);
  await prisma.userSettings.create({
    data: {
      userId,
      data: { display: { timezone: "Europe/Berlin" } },
      locationProvider: settings.locationProvider ?? "travtrack",
      enabledDomains: settings.enabledDomains ?? ["flight", "rail", "bus", "roadtrip"],
    },
  });
  return userId;
}

export async function resetJourneyUser(userId: string): Promise<void> {
  await wipeTravTrack([userId]);
  await prisma.locationSuggestion.deleteMany({ where: { userId } });
  await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
  await prisma.railJourney.deleteMany({ where: { userId } });
  await prisma.busJourney.deleteMany({ where: { userId } });
  await prisma.tripRoute.deleteMany({ where: { userId } });
}

/** A rail ride (or bus ride) from `from` to `until`. */
export function ride(userId: string, from: number, until: number) {
  return {
    userId,
    depStationName: "Frankfurt",
    depLat: 50,
    depLon: 8,
    arrStationName: "Würzburg",
    arrLat: 50,
    arrLon: 10,
    departureTime: new Date(from),
    arrivalTime: new Date(until),
  };
}
