import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";
import { acceptSuggestion } from "../../services/tripSuggestions/accept";
import {
  computeTripSuggestions,
  invalidateTripSuggestions,
} from "../../services/tripSuggestions/engine";

/**
 * forgejo#405: bus rides, ferry crossings and rental cars are members of a trip
 * proposal like trains and flights are — they count toward the entries a new
 * trip needs, and accepting links them to the trip in the same transaction.
 * Before, a trip made of a hotel, a coach and a ferry was never proposed.
 */

const FLORENCE = { lat: 43.7765, lon: 11.2479 };
const FIESOLE = { lat: 43.8067, lon: 11.2936 };
const LIVORNO = { lat: 43.5485, lon: 10.3106 };

describe("trip suggestions — bus, ferry and rental join the trip", () => {
  const stamp = Date.now();
  let userId: string;
  let betaBefore: boolean;

  const stay = async () => {
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Brunelleschi", city: "Florenz", ...FLORENCE },
    });
    return prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lodging.id,
        checkIn: new Date("2025-05-03T00:00:00Z"),
        checkOut: new Date("2025-05-06T00:00:00Z"),
      },
    });
  };

  const ride = {
    depStationName: "Firenze",
    arrStationName: "Fiesole",
    depLat: FLORENCE.lat,
    depLon: FLORENCE.lon,
    arrLat: FIESOLE.lat,
    arrLon: FIESOLE.lon,
    depTimezone: "Europe/Rome",
    arrTimezone: "Europe/Rome",
    depPrecision: "minute",
    arrPrecision: "minute",
    status: "completed",
  };

  const bus = () =>
    prisma.busJourney.create({
      data: {
        userId,
        ...ride,
        departureTime: new Date("2025-05-04T08:00:00Z"),
        arrivalTime: new Date("2025-05-04T09:00:00Z"),
      },
    });
  const ferry = () =>
    prisma.ferryJourney.create({
      data: {
        userId,
        ...ride,
        depStationName: "Livorno",
        depLat: LIVORNO.lat,
        depLon: LIVORNO.lon,
        departureTime: new Date("2025-05-05T08:00:00Z"),
        arrivalTime: new Date("2025-05-05T12:00:00Z"),
      },
    });
  const rental = () =>
    prisma.rentalBooking.create({
      data: {
        userId,
        provider: "Sixt",
        status: "completed",
        pickupStationName: "Firenze Peretola",
        pickupLat: FLORENCE.lat,
        pickupLon: FLORENCE.lon,
        pickupTimezone: "Europe/Rome",
        returnStationName: "Firenze Peretola",
        returnLat: FLORENCE.lat,
        returnLon: FLORENCE.lon,
        returnTimezone: "Europe/Rome",
        pickupTime: new Date("2025-05-04T07:00:00Z"),
        returnTime: new Date("2025-05-05T17:00:00Z"),
      },
    });

  const newTrips = async () => {
    invalidateTripSuggestions(userId);
    const { suggestions } = await computeTripSuggestions(userId);
    return suggestions.filter((s) => s.kind === "new_trip");
  };

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const user = await prisma.user.create({
      data: { username: `ts-ground-${stamp}`, passwordHash: await hashPassword("test-password") },
    });
    userId = user.id;
    await prisma.userSettings.create({
      data: {
        userId,
        enabledDomains: ["flight", "lodging", "bus", "ferry", "rental"],
        data: { homeAirportHistory: [{ iata: "MUC", fromDate: "2000-01-01", toDate: null }] },
      },
    });
  });

  beforeEach(async () => {
    await prisma.tripSuggestionDecision.deleteMany({ where: { userId } });
    await prisma.busJourney.deleteMany({ where: { userId } });
    await prisma.ferryJourney.deleteMany({ where: { userId } });
    await prisma.rentalBooking.deleteMany({ where: { userId } });
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("proposes a trip from a hotel and a coach ride alone", async () => {
    const hotel = await stay();
    const coach = await bus();
    const [proposal] = await newTrips();
    expect(proposal.members.map((m) => m.key).sort()).toEqual(
      [`lodging:${hotel.id}`, `bus:${coach.id}`].sort()
    );
  });

  it("carries bus, ferry and rental as members and links all of them on accept", async () => {
    const hotel = await stay();
    const coach = await bus();
    const boat = await ferry();
    const car = await rental();
    const [proposal] = await newTrips();
    expect(proposal.members.map((m) => m.domain).sort()).toEqual(
      ["bus", "ferry", "lodging", "rental"].sort()
    );

    const result = await acceptSuggestion(userId, proposal, { name: "Florenz" });
    expect(result.linked).toBe(4);
    const tripOf = async (row: Promise<{ tripId: string | null }>) => (await row).tripId;
    expect(await tripOf(prisma.busJourney.findUniqueOrThrow({ where: { id: coach.id } }))).toBe(
      result.tripId
    );
    expect(await tripOf(prisma.ferryJourney.findUniqueOrThrow({ where: { id: boat.id } }))).toBe(
      result.tripId
    );
    expect(await tripOf(prisma.rentalBooking.findUniqueOrThrow({ where: { id: car.id } }))).toBe(
      result.tripId
    );
    expect(await tripOf(prisma.lodgingStay.findUniqueOrThrow({ where: { id: hotel.id } }))).toBe(
      result.tripId
    );
  });

  it("never proposes a cancelled ride or a rental already on a trip", async () => {
    await stay();
    await prisma.busJourney.create({
      data: {
        userId,
        ...ride,
        status: "cancelled",
        departureTime: new Date("2025-05-04T08:00:00Z"),
      },
    });
    const other = await prisma.trip.create({ data: { userId, name: "Toskana 2024" } });
    await prisma.rentalBooking.update({
      where: { id: (await rental()).id },
      data: { tripId: other.id },
    });
    const members = (await newTrips()).flatMap((s) => s.members.map((m) => m.domain));
    expect(members).not.toContain("bus");
    expect(members).not.toContain("rental");
  });

  it("reads none of the three when their domains are switched off", async () => {
    await prisma.userSettings.update({
      where: { userId },
      data: { enabledDomains: ["flight", "lodging"] },
    });
    try {
      await stay();
      await bus();
      await ferry();
      await rental();
      expect(await newTrips()).toEqual([]);
    } finally {
      await prisma.userSettings.update({
        where: { userId },
        data: { enabledDomains: ["flight", "lodging", "bus", "ferry", "rental"] },
      });
    }
  });
});
