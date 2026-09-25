import { prisma } from "../db";
import { deriveRailStatus } from "../shared/statusDerivation";
import { greatCircleKm, wallClockToInstant } from "../services/rail/railJourneyWrite";

/**
 * Demo train rides (spec 2026-09-25-rail-domain, phase 2b), so a beta instance
 * with the rail gate on shows a logbook, a map tab and statistics instead of
 * an empty domain. Rail stays behind its beta gate; on an instance with the
 * gate off these rows exist and nothing shows them.
 *
 * Times are the wall clocks on the tickets, converted on each station's own
 * clock exactly as the rail router does, and the status is derived the same
 * way — so a ride dated after "now" is `scheduled`, never a completed ride in
 * the future. Every distance is the straight line (`great_circle`), which is
 * what a ride logged without a traced line honestly has.
 */

interface DemoStation {
  name: string;
  uic: string;
  lat: number;
  lon: number;
  country: string;
  timezone: string;
}

const STATION = {
  frankfurt: {
    name: "Frankfurt (Main) Hbf",
    uic: "8011068",
    lat: 50.107,
    lon: 8.6636,
    country: "DE",
    timezone: "Europe/Berlin",
  },
  berlin: {
    name: "Berlin Hbf",
    uic: "8011160",
    lat: 52.525,
    lon: 13.3694,
    country: "DE",
    timezone: "Europe/Berlin",
  },
  munich: {
    name: "München Hbf",
    uic: "8000261",
    lat: 48.1402,
    lon: 11.5586,
    country: "DE",
    timezone: "Europe/Berlin",
  },
  vienna: {
    name: "Wien Hbf",
    uic: "8103000",
    lat: 48.1852,
    lon: 16.3782,
    country: "AT",
    timezone: "Europe/Vienna",
  },
  zurich: {
    name: "Zürich HB",
    uic: "8503000",
    lat: 47.3782,
    lon: 8.5402,
    country: "CH",
    timezone: "Europe/Zurich",
  },
  paris: {
    name: "Paris Gare de Lyon",
    uic: "8768600",
    lat: 48.8443,
    lon: 2.3743,
    country: "FR",
    timezone: "Europe/Paris",
  },
  marseille: {
    name: "Marseille Saint-Charles",
    uic: "8775100",
    lat: 43.3026,
    lon: 5.3806,
    country: "FR",
    timezone: "Europe/Paris",
  },
} satisfies Record<string, DemoStation>;

export interface DemoRide {
  operator: string;
  trainCategory: string;
  trainNumber: string;
  from: DemoStation;
  to: DemoStation;
  /** Station wall clocks, `YYYY-MM-DDTHH:mm`. */
  departs: string;
  arrives: string;
  travelClass: "first" | "second" | "sleeper" | "couchette";
  price: number;
  delayMinutes: number | null;
  tags: string[];
}

/** `YYYY-MM-DD` a number of days from today — keeps the upcoming ride upcoming. */
function dayFromNow(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function demoRides(): DemoRide[] {
  const upcoming = dayFromNow(40);
  return [
    {
      operator: "DB Fernverkehr",
      trainCategory: "ICE",
      trainNumber: "597",
      from: STATION.frankfurt,
      to: STATION.berlin,
      departs: "2024-05-17T08:52",
      arrives: "2024-05-17T13:03",
      travelClass: "second",
      price: 59.9,
      delayMinutes: 14,
      tags: ["Geschäftlich"],
    },
    {
      operator: "ÖBB",
      trainCategory: "RJX",
      trainNumber: "63",
      from: STATION.munich,
      to: STATION.vienna,
      departs: "2024-08-03T09:27",
      arrives: "2024-08-03T13:30",
      travelClass: "first",
      price: 79.9,
      delayMinutes: 0,
      tags: ["Urlaub"],
    },
    {
      // A night train across a year boundary: filed under the year it left.
      operator: "ÖBB",
      trainCategory: "NJ",
      trainNumber: "466",
      from: STATION.vienna,
      to: STATION.zurich,
      departs: "2024-12-31T21:27",
      arrives: "2025-01-01T08:20",
      travelClass: "sleeper",
      price: 149,
      delayMinutes: null,
      tags: ["Nachtzug", "Silvester"],
    },
    {
      operator: "SNCF",
      trainCategory: "TGV",
      trainNumber: "6105",
      from: STATION.paris,
      to: STATION.marseille,
      departs: `${upcoming}T07:37`,
      arrives: `${upcoming}T10:58`,
      travelClass: "second",
      price: 65,
      delayMinutes: null,
      tags: ["Urlaub"],
    },
  ];
}

/** The row a demo ride becomes — pure, so the seed's shape is testable. */
export function demoRideRow(userId: string, ride: DemoRide, now = new Date()) {
  const departureTime = wallClockToInstant(ride.departs, ride.from.timezone);
  const arrivalTime = wallClockToInstant(ride.arrives, ride.to.timezone);
  const coords = {
    depLat: ride.from.lat,
    depLon: ride.from.lon,
    arrLat: ride.to.lat,
    arrLon: ride.to.lon,
  };
  const status = deriveRailStatus({ departureTime, arrivalTime, current: "scheduled", now });
  return {
    userId,
    operator: ride.operator,
    trainCategory: ride.trainCategory,
    trainNumber: ride.trainNumber,
    depStationName: ride.from.name,
    depStationCode: ride.from.uic,
    depCountry: ride.from.country,
    depTimezone: ride.from.timezone,
    arrStationName: ride.to.name,
    arrStationCode: ride.to.uic,
    arrCountry: ride.to.country,
    arrTimezone: ride.to.timezone,
    ...coords,
    departureTime,
    arrivalTime,
    distanceKm: greatCircleKm(coords),
    distanceSource: "great_circle",
    geometrySource: "straight",
    travelClass: ride.travelClass,
    price: ride.price,
    currency: "EUR",
    status,
    // A delay only for a ride that has happened — an upcoming one has none yet.
    delayMinutes: status === "completed" ? ride.delayMinutes : null,
    tags: ride.tags,
  };
}

/** Idempotent: a user who already has rides keeps them untouched. */
export async function createDemoRail(userId: string): Promise<void> {
  const existing = await prisma.railJourney.count({ where: { userId } });
  if (existing > 0) {
    console.log(`   Found ${existing} existing train rides (skipping)`);
    return;
  }
  const rides = demoRides().map((ride) => demoRideRow(userId, ride));
  await prisma.railJourney.createMany({ data: rides });
  // The user half of the gate; the instance half (`railDomain`) stays the
  // admin's beta switch, so this shows nothing on an instance with it off.
  const settings = await prisma.userSettings.findUnique({ where: { userId } });
  const domains = new Set([...(settings?.enabledDomains ?? ["flight"]), "rail"]);
  await prisma.userSettings.upsert({
    where: { userId },
    update: { enabledDomains: [...domains] },
    create: { userId, enabledDomains: [...domains], data: {} },
  });
  console.log(`   ✅ Created ${rides.length} train rides`);
}
