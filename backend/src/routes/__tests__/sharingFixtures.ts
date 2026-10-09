/**
 * Test helpers for the trip-sharing suites: accounts with a session cookie,
 * and a trip carrying one entry of every shareable type — each with private
 * fields set, so a suite can prove they did NOT travel.
 */
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";

export const SHARE_TEST_PREFIX = "share-test-";

export interface TestAccount {
  id: string;
  username: string;
  cookie: string;
}

export async function makeAccount(name: string): Promise<TestAccount> {
  const user = await prisma.user.create({
    data: { username: `${SHARE_TEST_PREFIX}${name}`, passwordHash: "x", firstName: name },
  });
  return { id: user.id, username: user.username, cookie: `auth_token=${generateToken(user.id)}` };
}

export async function wipeShareTestAccounts(): Promise<void> {
  await prisma.user.deleteMany({ where: { username: { startsWith: SHARE_TEST_PREFIX } } });
}

/** An accepted consent from `target` for `requester`, and a companion of `requester` linked to `target`. */
export async function linkWithConsent(requester: TestAccount, target: TestAccount) {
  await prisma.shareConsent.create({
    data: {
      requesterId: requester.id,
      targetId: target.id,
      status: "accepted",
      decidedAt: new Date(),
    },
  });
  return prisma.companion.create({
    data: {
      userId: requester.id,
      canonicalName: target.username,
      displayName: target.username,
      searchName: target.username,
      linkedUserId: target.id,
    },
  });
}

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

/** A finished trip with one of everything, private fields filled in. */
export async function makeFullTrip(owner: TestAccount) {
  const trip = await prisma.trip.create({
    data: {
      userId: owner.id,
      name: "Lissabon 2025",
      startDate: day("2025-05-01"),
      endDate: day("2025-05-08"),
      startDay: day("2025-05-01"),
      endDay: day("2025-05-08"),
      startZone: "Europe/Berlin",
      endZone: "Europe/Lisbon",
      status: "completed",
      notes: "PRIVATE trip note",
      tags: ["private-tag"],
      countries: ["PT"],
    },
  });
  const flight = await prisma.flight.create({
    data: {
      userId: owner.id,
      tripId: trip.id,
      airline: "TAP Air Portugal",
      flightNumber: "TP571",
      depIata: "FRA",
      depLat: 50.0379,
      depLon: 8.5622,
      arrIata: "LIS",
      arrLat: 38.7742,
      arrLon: -9.1342,
      departureTime: new Date("2025-05-01T08:00:00.000Z"),
      arrivalTime: new Date("2025-05-01T11:00:00.000Z"),
      depTimezone: "Europe/Berlin",
      arrTimezone: "Europe/Lisbon",
      depPrecision: "minute",
      arrPrecision: "minute",
      status: "flown",
      routeDistance: 1900,
      seatNumber: "12A",
      seatClass: "business",
      bookingReference: "PNR123",
      price: 300,
      notes: "PRIVATE flight note",
      tags: ["private-tag"],
    },
  });
  const lodging = await prisma.lodging.create({
    data: { userId: owner.id, name: "Hotel Avenida Palace", city: "Lisboa", country: "PT" },
  });
  const stay = await prisma.lodgingStay.create({
    data: {
      userId: owner.id,
      tripId: trip.id,
      lodgingId: lodging.id,
      checkIn: day("2025-05-01"),
      checkOut: day("2025-05-04"),
      checkInDate: day("2025-05-01"),
      checkOutDate: day("2025-05-04"),
      stayZone: "Europe/Lisbon",
      board: "breakfast",
      status: "completed",
      roomNumber: "404",
      totalPrice: 450,
      ratingOverall: 4.5,
      bookingReference: "HOTEL-PRIV",
      notes: "PRIVATE stay note",
    },
  });
  const cruise = await prisma.cruise.create({
    data: {
      userId: owner.id,
      tripId: trip.id,
      cruiseLine: "AIDA",
      routeName: "Atlantik",
      startDate: day("2025-05-04"),
      endDate: day("2025-05-06"),
      status: "completed",
      cabinNumber: "8123",
      price: 1200,
      notes: "PRIVATE cruise note",
      stops: {
        create: [
          { dayNumber: 1, isAtSea: true },
          { dayNumber: 2, unresolvedPortName: "Funchal", excursionNote: "PRIVATE excursion" },
        ],
      },
    },
  });
  const rail = await prisma.railJourney.create({
    data: {
      userId: owner.id,
      tripId: trip.id,
      trainCategory: "AP",
      trainNumber: "123",
      depStationName: "Lisboa Santa Apolónia",
      depLat: 38.7139,
      depLon: -9.1225,
      depTimezone: "Europe/Lisbon",
      arrStationName: "Porto Campanhã",
      arrLat: 41.1488,
      arrLon: -8.5855,
      arrTimezone: "Europe/Lisbon",
      departureTime: new Date("2025-05-06T09:00:00.000Z"),
      arrivalTime: new Date("2025-05-06T11:50:00.000Z"),
      status: "completed",
      seat: "45",
      coach: "3",
      travelClass: "first",
      price: 60,
      notes: "PRIVATE rail note",
    },
  });
  const rental = await prisma.rentalBooking.create({
    data: {
      userId: owner.id,
      tripId: trip.id,
      provider: "Sixt",
      pickupStationName: "Porto Airport",
      pickupLat: 41.2481,
      pickupLon: -8.6814,
      pickupTimezone: "Europe/Lisbon",
      returnStationName: "Lisbon Airport",
      returnLat: 38.7742,
      returnLon: -9.1342,
      returnTimezone: "Europe/Lisbon",
      pickupTime: new Date("2025-05-06T13:00:00.000Z"),
      returnTime: new Date("2025-05-08T10:00:00.000Z"),
      status: "completed",
      licensePlate: "AA-00-BB",
      confirmationNumber: "CONF-PRIV",
      price: 180,
      notes: "PRIVATE rental note",
    },
  });
  const stops = await Promise.all([
    prisma.tripStop.create({
      data: {
        tripId: trip.id,
        orderIdx: 0,
        domain: "flight",
        sourceId: flight.id,
        title: "FRA → LIS",
        notes: "PRIVATE stop note",
      },
    }),
    prisma.tripStop.create({
      data: { tripId: trip.id, orderIdx: 1, title: "Belém", lat: 38.6916, lon: -9.2157 },
    }),
  ]);
  return { trip, flight, lodging, stay, cruise, rail, rental, stops };
}

/**
 * S2: Anna shares a full trip with Ben through the service (the S1 route is
 * covered by its own suite) and both hold a copy.
 */
export async function sharedPair(owner: TestAccount, member: TestAccount) {
  const { shareTrip } = await import("../../services/sharing/shareTrip");
  const full = await makeFullTrip(owner);
  const companion = await linkWithConsent(owner, member);
  await shareTrip(owner.id, full.trip.id, companion.id);
  const memberTrip = await prisma.trip.findFirstOrThrow({
    where: { userId: member.id, shareGroupId: { not: null } },
  });
  return { full, companion, memberTrip, groupId: memberTrip.shareGroupId as string };
}

/** The member's copy of an owner's keyed row, by share key. */
export async function copyKeyOf(
  table: "flight" | "lodgingStay" | "cruise" | "railJourney" | "rentalBooking",
  id: string
): Promise<string> {
  const select = { shareKey: true } as const;
  const where = { id };
  const row =
    table === "flight"
      ? await prisma.flight.findUniqueOrThrow({ where, select })
      : table === "lodgingStay"
        ? await prisma.lodgingStay.findUniqueOrThrow({ where, select })
        : table === "cruise"
          ? await prisma.cruise.findUniqueOrThrow({ where, select })
          : table === "railJourney"
            ? await prisma.railJourney.findUniqueOrThrow({ where, select })
            : await prisma.rentalBooking.findUniqueOrThrow({ where, select });
  return row.shareKey as string;
}
