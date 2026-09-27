import { randomUUID } from "crypto";

import { prisma } from "../../../db";

/**
 * Rows written the way the app wrote them BEFORE the time model (ADR 0002
 * phase 3b) — only legacy columns, in each writer's meaning — so the backfill
 * meets what an RC server's prod mirror holds. No prod or beta data: each row
 * imitates one legacy writer, named beside it.
 */

export const d = (iso: string): Date => new Date(iso);

export interface LegacyFixture {
  userId: string;
  ids: Record<string, string>;
  portId: number;
}

export async function createLegacyFixture(username: string): Promise<LegacyFixture> {
  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: "x",
      // Birthday route: always noon UTC.
      birthdate: d("1985-03-14T12:00:00.000Z"),
    },
  });
  const userId = user.id;
  const ids: Record<string, string> = {};

  // The Companion was paired on 2026-09-01.
  await prisma.apiToken.create({
    data: {
      userId,
      label: "Companion",
      lookupHash: randomUUID(),
      hash: "x",
      deviceId: "device-1",
      createdAt: d("2026-09-01T08:00:00.000Z"),
    },
  });

  // ---- flights
  const flight = (data: Record<string, unknown>) =>
    prisma.flight.create({
      data: { userId, depLat: 0, depLon: 0, arrLat: 0, arrLon: 0, ...data },
    });
  ids.flightUtc = (
    await flight({
      depIata: "FRA",
      depLat: 50.03,
      depLon: 8.57,
      arrIata: "JFK",
      arrLat: 40.64,
      arrLon: -73.78,
      departureTime: d("2027-05-02T02:00:00.000Z"),
      arrivalTime: d("2027-05-02T10:00:00.000Z"),
    })
  ).id;
  // The flight a trip's dates were filled from (`fillTripDatesFromSegments`):
  // 22:00 in New York on the 1st, 16:00 in Frankfurt on the 2nd.
  ids.flightJfk = (
    await flight({
      depIata: "JFK",
      depLat: 40.64,
      depLon: -73.78,
      arrIata: "FRA",
      arrLat: 50.03,
      arrLon: 8.57,
      departureTime: d("2027-05-02T02:00:00.000Z"),
      arrivalTime: d("2027-05-02T14:00:00.000Z"),
    })
  ).id;
  ids.flightFake = (
    await flight({
      depIata: "NRT",
      depLat: 35.76,
      depLon: 140.39,
      arrIata: "FRA",
      arrLat: 50.03,
      arrLon: 8.57,
      // 10:00 in Tokyo, 15:00 in Frankfurt, stored as fake UTC.
      departureTime: d("2019-06-01T10:00:00.000Z"),
      arrivalTime: d("2019-06-01T15:00:00.000Z"),
      depTimeSemantics: "LEGACY_FAKE_UTC",
      arrTimeSemantics: "LEGACY_FAKE_UTC",
    })
  ).id;
  // An import that knew no airport: the 0,0 placeholder on both ends.
  ids.flightNoPosition = (
    await flight({ departureTime: d("2018-04-01T09:00:00.000Z"), depName: "Unknown" })
  ).id;
  // A flight with neither a time nor a position: nothing the backfill can
  // write to its columns, so only the ledger stops a second run redoing it.
  ids.flightBare = (await flight({ depName: "?" })).id;
  // A date-only flight from Kiritimati (UTC+14): the noon placeholder is the next local day.
  ids.flightDateOnly = (
    await flight({
      depLat: 1.99,
      depLon: -157.35,
      arrLat: 21.32,
      arrLon: -157.92,
      departureTime: d("2015-08-10T12:00:00.000Z"),
      depTimeSemantics: "DATE_ONLY",
    })
  ).id;
  ids.flightUnknown = (
    await flight({
      depIata: "FRA",
      depLat: 50.03,
      depLon: 8.57,
      arrIata: "JFK",
      arrLat: 40.64,
      arrLon: -73.78,
      departureTime: d("2012-01-05T08:00:00.000Z"),
      depTimeSemantics: "UNKNOWN",
      arrTimeSemantics: "UNKNOWN",
    })
  ).id;

  // ---- rail: one with zones, one stored while the lookup was broken
  const rail = (data: Record<string, unknown>) =>
    prisma.railJourney.create({
      data: {
        userId,
        depStationName: "Frankfurt(Main)Hbf",
        depLat: 50.107,
        depLon: 8.663,
        arrStationName: "Paris Est",
        arrLat: 48.876,
        arrLon: 2.359,
        departureTime: d("2026-07-10T07:00:00.000Z"),
        arrivalTime: d("2026-07-10T11:00:00.000Z"),
        ...data,
      },
    });
  ids.railZoned = (await rail({ depTimezone: "Europe/Berlin", arrTimezone: "Europe/Paris" })).id;
  ids.railUnzoned = (await rail({})).id;

  // ---- place visits
  const place = await prisma.place.create({
    data: { userId, name: "Kolosseum", lat: 41.8902, lon: 12.4922 },
  });
  ids.place = place.id;
  const visit = (visitedAt: string, createdAt: string) =>
    prisma.placeVisit.create({
      data: { userId, placeId: place.id, visitedAt: d(visitedAt), createdAt: d(createdAt) },
    });
  // Web, before the Companion existed: 14:00 Rome as fake UTC.
  ids.visitWeb = (await visit("2026-07-01T14:00:00.000Z", "2026-07-01T20:00:00.000Z")).id;
  // Companion `toISOString()`: a real instant with milliseconds.
  ids.visitCompanion = (await visit("2026-09-12T08:15:42.123Z", "2026-09-12T08:15:43.000Z")).id;
  // A whole minute after the pairing: web or Companion, nobody can say.
  ids.visitUnknown = (await visit("2026-09-13T16:00:00.000Z", "2026-09-13T18:00:00.000Z")).id;

  // ---- lodging: a hotel with a position, one without
  const hotel = await prisma.lodging.create({
    data: { userId, name: "Hotel Adlon", lat: 52.516, lon: 13.3806 },
  });
  const nowhere = await prisma.lodging.create({ data: { userId, name: "Pension ohne Ort" } });
  ids.stayBerlin = (
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: hotel.id,
        // A host at UTC+2 parsed "2026-07-10T00:00": the day is the 10th.
        checkIn: d("2026-07-09T22:00:00.000Z"),
        checkOut: d("2026-07-12T00:00:00.000Z"),
        checkInTime: "15:00",
        checkOutTime: "11:00",
      },
    })
  ).id;
  ids.stayNowhere = (
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: nowhere.id,
        checkIn: d("2026-05-01T00:00:00.000Z"),
        checkOut: d("2026-05-03T00:00:00.000Z"),
        checkInTime: "14:00",
      },
    })
  ).id;

  // ---- cruise: a catalogue-less port with coordinates only, a sea day, an unresolved port
  const port = await prisma.port.create({
    data: { name: "Testhafen Kiel", lat: 54.32, lon: 10.14, isUserAdded: true },
  });
  const cruise = await prisma.cruise.create({
    data: {
      userId,
      departurePortId: port.id,
      arrivalPortId: port.id,
      startDate: d("2026-06-01T12:00:00.000Z"),
      endDate: d("2026-06-08T12:00:00.000Z"),
    },
  });
  ids.cruise = cruise.id;
  const stop = (data: Record<string, unknown>) =>
    prisma.cruiseStop.create({ data: { cruiseId: cruise.id, ...data } as never });
  ids.stopPort = (
    await stop({
      dayNumber: 1,
      portId: port.id,
      date: d("2026-06-01T00:00:00.000Z"),
      departureTime: d("2026-06-01T17:00:00.000Z"),
    })
  ).id;
  ids.stopSeaDay = (
    await stop({ dayNumber: 2, isAtSea: true, date: d("2026-06-02T00:00:00.000Z") })
  ).id;
  ids.stopSeaDayTime = (
    await stop({
      dayNumber: 3,
      isAtSea: true,
      date: d("2026-06-03T00:00:00.000Z"),
      arrivalTime: d("2026-06-03T08:00:00.000Z"),
    })
  ).id;
  ids.stopUnresolved = (
    await stop({
      dayNumber: 4,
      unresolvedPortName: "Skagen",
      date: d("2026-06-04T00:00:00.000Z"),
      arrivalTime: d("2026-06-04T09:00:00.000Z"),
    })
  ).id;

  // ---- trips: one filled from its flight, one typed on a UTC+2 host
  const segmentTrip = await prisma.trip.create({
    data: {
      userId,
      name: "New York",
      startDate: d("2027-05-02T02:00:00.000Z"),
      endDate: d("2027-05-02T14:00:00.000Z"),
      flights: { connect: { id: ids.flightJfk } },
    },
  });
  ids.tripSegment = segmentTrip.id;
  const typedTrip = await prisma.trip.create({
    data: {
      userId,
      name: "Toskana",
      startDate: d("2026-04-30T22:00:00.000Z"),
      endDate: d("2026-05-07T10:30:00.000Z"),
    },
  });
  ids.tripTyped = typedTrip.id;
  ids.journalAmbiguous = (
    await prisma.tripJournalEntry.create({
      data: { tripId: typedTrip.id, date: d("2026-05-02T10:30:00.000Z"), body: "Siena" },
    })
  ).id;

  // ---- trip stops
  ids.tripStopTimed = (
    await prisma.tripStop.create({
      data: {
        tripId: typedTrip.id,
        title: "Uffizien",
        lat: 43.7678,
        lon: 11.2553,
        startDate: d("2026-05-03T10:00:00.000Z"),
        endDate: d("2026-05-03T13:00:00.000Z"),
      },
    })
  ).id;
  ids.tripStopNowhere = (
    await prisma.tripStop.create({
      data: { tripId: typedTrip.id, title: "Irgendwo", startDate: d("2026-05-04T09:00:00.000Z") },
    })
  ).id;

  return { userId, ids, portId: port.id };
}

export async function removeLegacyFixture(fixture: LegacyFixture | null): Promise<void> {
  if (!fixture) return;
  await prisma.user.deleteMany({ where: { id: fixture.userId } });
  await prisma.port.deleteMany({ where: { id: fixture.portId } });
}
