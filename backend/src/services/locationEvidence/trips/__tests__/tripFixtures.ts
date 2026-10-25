import { prisma } from "../../../../db";
import { makeUser, wipeTravTrack } from "../../../travtrack/__tests__/fixtures";
import type { HomePeriod } from "../../../../utils/homeAirport";

/**
 * Accounts, homes and stored TravTrack history for the trip-inference suites
 * (TravTrack plan L4). Not a test file (no `.test.ts` suffix).
 */

export const H = 3_600_000;
const MIN = 60_000;
/** "Now" of the trip suites: the 25th, noon UTC; yesterday is the 24th. */
export const NOW = Date.parse("2026-10-25T12:00:00Z");

/** Frankfurt — the confirmed home of the suites. */
export const HOME = { lat: 50.11, lon: 8.68 };
/** Munich: about 300 km from home. */
export const AWAY = { lat: 48.14, lon: 11.58 };
/** Vienna: abroad. */
export const ABROAD = { lat: 48.21, lon: 16.37 };

export const HOME_PERIOD: HomePeriod = {
  fromDate: "2020-01-01",
  toDate: null,
  residence: { name: "Frankfurt", ...HOME },
  residenceConfirmed: true,
  airports: [{ code: "FRA", primary: true }],
};

let ref = 0;

/** Stored fixes at `at` every 20 minutes over `[fromMs, untilMs]`. */
export async function storeSpan(
  userId: string,
  fromMs: number,
  untilMs: number,
  at: { lat: number; lon: number }
): Promise<void> {
  const data = [];
  for (let t = fromMs; t <= untilMs; t += 20 * MIN) {
    ref += 1;
    data.push({
      userId,
      t: new Date(t),
      tS: Math.floor(t / 1000),
      lat: at.lat,
      lon: at.lon,
      accuracyM: 5,
      origin: "companion:phone-1",
      originRef: `trip-${ref}`,
      deviceId: "phone-1",
    });
  }
  await prisma.travTrackPoint.createMany({ data });
}

/** A whole local (Berlin, October: UTC+2) day spent at `at`, 06:00–23:00. */
export async function storeDay(userId: string, day: string, at: { lat: number; lon: number }) {
  const start = Date.parse(`${day}T04:00:00Z`);
  await storeSpan(userId, start, start + 17 * H, at);
}

/** A TravTrack account with a confirmed home in Frankfurt (or none). */
export async function makeTripUser(
  username: string,
  opts: { home?: HomePeriod[] | null; locationProvider?: string } = {}
): Promise<string> {
  const userId = await makeUser(username);
  const homes = opts.home === undefined ? [HOME_PERIOD] : opts.home;
  await prisma.userSettings.create({
    data: {
      userId,
      data: {
        display: { timezone: "Europe/Berlin" },
        ...(homes ? { homePeriods: homes } : {}),
      } as object,
      locationProvider: opts.locationProvider ?? "travtrack",
    },
  });
  return userId;
}

export async function setHomes(userId: string, homes: HomePeriod[]): Promise<void> {
  await prisma.userSettings.update({
    where: { userId },
    data: { data: { display: { timezone: "Europe/Berlin" }, homePeriods: homes } as object },
  });
}

export async function resetTripUser(userId: string): Promise<void> {
  await wipeTravTrack([userId]);
  await prisma.locationSuggestion.deleteMany({ where: { userId } });
  await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
  await setHomes(userId, [HOME_PERIOD]);
}

/** A trip of the account over `[from, to]`, typed days. */
export async function makeDatedTrip(userId: string, from: string, to: string, name = "Urlaub") {
  return prisma.trip.create({
    data: {
      userId,
      name,
      startDate: new Date(`${from}T00:00:00Z`),
      endDate: new Date(`${to}T00:00:00Z`),
      startDay: new Date(`${from}T00:00:00Z`),
      endDay: new Date(`${to}T00:00:00Z`),
    },
  });
}
