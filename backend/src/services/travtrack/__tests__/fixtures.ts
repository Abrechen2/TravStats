import { prisma } from "../../../db";

/**
 * Accounts, entries and points for the TravTrack suites. Not a test file
 * (no `.test.ts` suffix).
 */

export async function makeUser(username: string): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  return (await prisma.user.create({ data: { username, passwordHash: "x" } })).id;
}

export async function makeTrip(userId: string, name = "Seoul"): Promise<string> {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name,
      startDate: new Date("2026-10-11T00:00:00Z"),
      endDate: new Date("2026-10-14T00:00:00Z"),
      startDay: new Date("2026-10-11T00:00:00Z"),
      endDay: new Date("2026-10-14T00:00:00Z"),
      startZone: "Asia/Seoul",
      endZone: "Asia/Seoul",
    },
  });
  return trip.id;
}

export async function makeFlight(userId: string): Promise<string> {
  const departure = Date.parse("2026-10-12T00:30:00Z");
  const flight = await prisma.flight.create({
    data: {
      userId,
      depIata: "ICN",
      arrIata: "CJU",
      depLat: 37.469,
      depLon: 126.451,
      arrLat: 33.511,
      arrLon: 126.493,
      flightNumber: "KE1201",
      departureTime: new Date(departure),
      arrivalTime: new Date(departure + 3_600_000),
      status: "flown",
    },
  });
  return flight.id;
}

export const pt = (id: string, t: string, lat = 37.5665, lon = 126.978, extra: object = {}) => ({
  id,
  t,
  lat,
  lon,
  accuracy: 12,
  ...extra,
});

/** Every TravTrack row of these accounts, gone. */
export async function wipeTravTrack(userIds: string[]): Promise<void> {
  const where = { userId: { in: userIds } };
  await prisma.travTrackPointLink.deleteMany({ where });
  await prisma.travTrackPoint.deleteMany({ where });
  await prisma.travTrackUpload.deleteMany({ where });
  await prisma.travTrackDeletedRange.deleteMany({ where });
  await prisma.travTrackPrivacyZone.deleteMany({ where });
  await prisma.travTrackGap.deleteMany({ where });
  await prisma.travTrackZoneTombstone.deleteMany({ where });
}

let refCounter = 0;

/** One stored TravTrack point, optionally linked to entries. */
export async function storePoint(
  userId: string,
  p: {
    t: number;
    lat: number;
    lon: number;
    device?: string;
    accuracyM?: number | null;
    links?: Array<{ kind: "flight" | "trip"; id: string }>;
  }
): Promise<string> {
  refCounter += 1;
  const device = p.device ?? "phone-1";
  const row = await prisma.travTrackPoint.create({
    data: {
      userId,
      t: new Date(p.t),
      tS: Math.floor(p.t / 1000),
      lat: p.lat,
      lon: p.lon,
      accuracyM: p.accuracyM === undefined ? 5 : p.accuracyM,
      origin: `companion:${device}`,
      originRef: `fx-${refCounter}`,
      deviceId: device,
    },
  });
  for (const link of p.links ?? []) {
    await prisma.travTrackPointLink.create({
      data: { userId, pointId: row.id, entryKind: link.kind, entryId: link.id },
    });
  }
  return row.id;
}
