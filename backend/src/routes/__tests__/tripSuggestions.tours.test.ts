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
 * Owner decision 2026-09-26, "tours join the trip": a single-day tour inside an
 * absence is a MEMBER of the trip proposal — it counts toward the two entries a
 * new trip needs, and accepting links it through the tour's own trip link. A
 * multi-day tour still only says where the user was; a tour that is already on
 * a trip is never moved.
 */

const FLORENCE = { lat: 43.7765, lon: 11.2479 };
const FIESOLE = { lat: 43.8067, lon: 11.2936 };

describe("trip suggestions — tours join the trip", () => {
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

  const tour = (name: string, days: readonly string[], tripId: string | null = null) =>
    prisma.tripRoute.create({
      data: {
        userId,
        tripId,
        kind: "tour",
        name,
        mode: "walk",
        stops: {
          create: days.map((day, i) => ({
            title: `${name} ${i + 1}`,
            startDate: new Date(`${day}T00:00:00Z`),
            routeOrderIdx: i,
            ...(i === 0 ? FLORENCE : FIESOLE),
          })),
        },
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
      data: { username: `ts-tours-${stamp}`, passwordHash: await hashPassword("test-password") },
    });
    userId = user.id;
    await prisma.userSettings.create({
      data: {
        userId,
        enabledDomains: ["flight", "lodging", "roadtrip"],
        data: { homeAirportHistory: [{ iata: "MUC", fromDate: "2000-01-01", toDate: null }] },
      },
    });
  });

  beforeEach(async () => {
    await prisma.tripSuggestionDecision.deleteMany({ where: { userId } });
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.lodgingStay.deleteMany({ where: { userId } });
    await prisma.lodging.deleteMany({ where: { userId } });
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("offers no trip for one stay alone — the threshold the tour has to meet", async () => {
    await stay();
    expect(await newTrips()).toEqual([]);
  });

  it("counts a single-day tour inside the absence as a member of the new trip", async () => {
    const hotel = await stay();
    const hike = await tour("Fiesole", ["2025-05-04", "2025-05-04"]);

    const [proposal] = await newTrips();
    expect(proposal).toBeDefined();
    expect(proposal.members.map((m) => m.key).sort()).toEqual(
      [`lodging:${hotel.id}`, `tour:${hike.id}`].sort()
    );
    expect(proposal.members.find((m) => m.domain === "tour")).toMatchObject({
      label: "Fiesole",
      startDay: "2025-05-04",
      endDay: "2025-05-04",
    });
  });

  it("keeps a multi-day tour as presence only", async () => {
    await stay();
    await tour("Chianti", ["2025-05-04", "2025-05-05"]);
    expect(await newTrips()).toEqual([]);
  });

  it("never offers a tour that already belongs to a trip", async () => {
    await stay();
    const other = await prisma.trip.create({ data: { userId, name: "Toskana 2024" } });
    await tour("Fiesole", ["2025-05-04"], other.id);
    const members = (await newTrips()).flatMap((s) => s.members.map((m) => m.domain));
    expect(members).not.toContain("tour");
  });

  it("links the tour to the new trip in the accept transaction", async () => {
    const hotel = await stay();
    const hike = await tour("Fiesole", ["2025-05-04"]);
    const [proposal] = await newTrips();

    const result = await acceptSuggestion(userId, proposal, { name: "Florenz" });

    expect(result.linked).toBe(2);
    const linkedTour = await prisma.tripRoute.findUniqueOrThrow({ where: { id: hike.id } });
    expect(linkedTour.tripId).toBe(result.tripId);
    expect(linkedTour.kind).toBe("tour");
    expect((await prisma.lodgingStay.findUniqueOrThrow({ where: { id: hotel.id } })).tripId).toBe(
      result.tripId
    );
  });

  it("rolls everything back when the tour moved onto another trip in the meantime", async () => {
    const hotel = await stay();
    const hike = await tour("Fiesole", ["2025-05-04"]);
    const [proposal] = await newTrips();
    const other = await prisma.trip.create({ data: { userId, name: "Elsewhere" } });
    await prisma.tripRoute.update({ where: { id: hike.id }, data: { tripId: other.id } });

    await expect(acceptSuggestion(userId, proposal, {})).rejects.toMatchObject({
      statusCode: 409,
      code: "TRIP_SUGGESTION_STALE",
    });
    expect(await prisma.trip.count({ where: { userId } })).toBe(1);
    expect(
      (await prisma.lodgingStay.findUniqueOrThrow({ where: { id: hotel.id } })).tripId
    ).toBeNull();
    expect((await prisma.tripRoute.findUniqueOrThrow({ where: { id: hike.id } })).tripId).toBe(
      other.id
    );
    expect(await prisma.tripSuggestionDecision.count({ where: { userId } })).toBe(0);
  });

  it("leaves tours out while the instance hides the roadtrip beta", async () => {
    await stay();
    await tour("Fiesole", ["2025-05-04"]);
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    try {
      expect(await newTrips()).toEqual([]);
    } finally {
      await updateInstanceSettings({ betaFeaturesEnabled: true });
    }
  });
});
