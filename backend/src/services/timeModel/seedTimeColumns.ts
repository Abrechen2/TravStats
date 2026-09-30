import { prisma } from "../../db";
import { zoneOf } from "../../shared/time/zoneOf";
import { dbDayOf, dbDayOrNull } from "./dayColumns";
import { cruiseDayColumns, portZones, stopColumnsFromLegacy } from "./cruiseColumns";
import { stayTimeColumns } from "./stayColumns";
import { stationTimeColumns, typedTripDays } from "./tripColumns";
import { visitColumnsFromFakeUtc } from "./visitColumns";
import { precisionOf } from "../../routes/flights/timeInput";
import { instantOfFakeUtc } from "../../shared/time/resolveInput";

/**
 * The time-model columns of a SEEDED account (ADR 0002 phase 2).
 *
 * The seeders write the legacy columns directly through Prisma, in the
 * meanings the web always used: flights as real instants, visits, port calls
 * and trip stops as the place's wall clock in fake UTC, days as UTC midnight.
 * Those meanings are KNOWN for a seed — unlike an account's history, which is
 * phase 3b's business — so the new columns are derived here, through
 * `shared/time`, right after the seed writes. A fresh demo is then never a
 * backfill case. Only rows whose new columns are still empty are touched, so a
 * second run changes nothing.
 */
export async function fillSeededTimeColumns(userId: string): Promise<void> {
  await flights(userId);
  await rail(userId);
  await stays(userId);
  await visits(userId);
  await cruises(userId);
  await trips(userId);
  await birthday(userId);
}

async function flights(userId: string): Promise<void> {
  const rows = await prisma.flight.findMany({
    where: { userId, depTimezone: null },
    select: {
      id: true,
      depLat: true,
      depLon: true,
      arrLat: true,
      arrLon: true,
      departureTime: true,
      arrivalTime: true,
      depTimeSemantics: true,
      arrTimeSemantics: true,
    },
  });
  for (const f of rows) {
    await prisma.flight.update({
      where: { id: f.id },
      data: {
        depTimezone: zoneOf({ lat: f.depLat, lon: f.depLon }),
        arrTimezone: zoneOf({ lat: f.arrLat, lon: f.arrLon }),
        depPrecision: precisionOf(f.depTimeSemantics, f.departureTime !== null),
        arrPrecision: precisionOf(f.arrTimeSemantics, f.arrivalTime !== null),
      },
    });
  }
}

async function rail(userId: string): Promise<void> {
  await prisma.railJourney.updateMany({
    where: { userId, depPrecision: null },
    data: { depPrecision: "minute" },
  });
  await prisma.railJourney.updateMany({
    where: { userId, arrPrecision: null, arrivalTime: { not: null } },
    data: { arrPrecision: "minute" },
  });
}

async function stays(userId: string): Promise<void> {
  const rows = await prisma.lodgingStay.findMany({
    where: { userId, checkInDate: null, checkIn: { not: null } },
    select: {
      id: true,
      checkIn: true,
      checkOut: true,
      checkInTime: true,
      checkOutTime: true,
      lodging: { select: { lat: true, lon: true } },
    },
  });
  for (const s of rows) {
    const zone = zoneOf({ lat: s.lodging.lat, lon: s.lodging.lon });
    await prisma.lodgingStay.update({
      where: { id: s.id },
      data: stayTimeColumns(s, zone, "machine"),
    });
  }
}

async function visits(userId: string): Promise<void> {
  const rows = await prisma.placeVisit.findMany({
    where: { userId, visitedAtUtc: null, visitedAt: { not: null } },
    select: { id: true, visitedAt: true, place: { select: { lat: true, lon: true } } },
  });
  for (const v of rows) {
    await prisma.placeVisit.update({
      where: { id: v.id },
      data: { ...visitColumnsFromFakeUtc(v.visitedAt, v.place), writtenVia: "import" },
    });
  }
}

async function cruises(userId: string): Promise<void> {
  const rows = await prisma.cruise.findMany({
    where: { userId },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      startDay: true,
      departurePortId: true,
      arrivalPortId: true,
      stops: {
        where: { timePrecision: null },
        select: { id: true, portId: true, date: true, arrivalTime: true, departureTime: true },
      },
    },
  });
  for (const c of rows) {
    if (c.startDay === null && (c.startDate || c.endDate)) {
      await prisma.cruise.update({ where: { id: c.id }, data: await cruiseDayColumns(c) });
    }
    const zones = await portZones(c.stops.map((s) => s.portId));
    for (const s of c.stops) {
      const zone = s.portId ? (zones.get(s.portId) ?? null) : null;
      const {
        date: _d,
        arrivalTime: _a,
        departureTime: _dep,
        ...columns
      } = stopColumnsFromLegacy(s, zone);
      await prisma.cruiseStop.update({ where: { id: s.id }, data: columns });
    }
  }
}

async function trips(userId: string): Promise<void> {
  const tripRows = await prisma.trip.findMany({
    where: {
      userId,
      startDay: null,
      OR: [{ startDate: { not: null } }, { endDate: { not: null } }],
    },
    select: { id: true, startDate: true, endDate: true },
  });
  for (const t of tripRows) {
    await prisma.trip.update({ where: { id: t.id }, data: typedTripDays(t) });
  }

  const journal = await prisma.tripJournalEntry.findMany({
    where: { trip: { userId }, day: null },
    select: { id: true, date: true },
  });
  for (const j of journal) {
    await prisma.tripJournalEntry.update({ where: { id: j.id }, data: { day: dbDayOf(j.date) } });
  }

  const stops = await prisma.tripStop.findMany({
    where: {
      precision: null,
      OR: [{ startDate: { not: null } }, { endDate: { not: null } }],
      AND: [{ OR: [{ trip: { userId } }, { route: { userId } }] }],
    },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      lat: true,
      lon: true,
      routeId: true,
      domain: true,
    },
  });
  for (const s of stops) {
    // A roadtrip station is dated by DAYS; any other stop by its wall clock.
    if (s.domain === "roadtrip") {
      await prisma.tripStop.update({ where: { id: s.id }, data: stationTimeColumns(s) });
      continue;
    }
    const zone = zoneOf({ lat: s.lat, lon: s.lon });
    await prisma.tripStop.update({
      where: { id: s.id },
      data: {
        startUtc: zone && s.startDate ? instantOfFakeUtc(s.startDate, zone) : null,
        endUtc: zone && s.endDate ? instantOfFakeUtc(s.endDate, zone) : null,
        stopZone: zone,
        precision: zone ? "minute" : "unknown",
      },
    });
  }
}

async function birthday(userId: string): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { birthdate: true, birthDay: true },
  });
  if (!user?.birthdate || user.birthDay) return;
  await prisma.user.update({
    where: { id: userId },
    data: { birthDay: dbDayOrNull(user.birthdate), birthPrecision: "day" },
  });
}
