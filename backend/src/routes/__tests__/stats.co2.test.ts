import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { resolveMetricEvidence } from "../../services/evidence/metricEvidence";

/**
 * Carbon per mode over a real database (forgejo#395): the tile endpoint, the
 * evidence list under each tile, a ride's own `co2` and a trip's share agree,
 * and a record without a distance is reported as unmeasured, never as 0 kg.
 */
describe("CO2 for every mode of travel", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let tripId: string;
  let railId: string;

  const ends = {
    depStationName: "Frankfurt",
    depLat: 50.11,
    depLon: 8.68,
    arrStationName: "Berlin",
    arrLat: 52.52,
    arrLon: 13.4,
    departureTime: new Date("2025-05-01T08:00:00Z"),
    status: "completed",
  };

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: {
        username: `co2-${stamp}`,
        passwordHash: await hashPassword("test-password"),
        isActive: true,
      },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    const trip = await prisma.trip.create({
      data: {
        userId,
        name: "CO2 trip",
        startDate: new Date("2025-05-01"),
        endDate: new Date("2025-05-05"),
      },
    });
    tripId = trip.id;
    railId = (
      await prisma.railJourney.create({
        data: { userId, tripId, ...ends, distanceKm: 500, transitMode: "rail" },
      })
    ).id;
    // No distance: must be listed as unmeasured, not as 0 kg.
    await prisma.railJourney.create({ data: { userId, ...ends, distanceKm: null } });
    await prisma.busJourney.create({
      data: { userId, tripId, ...ends, distanceKm: 100, rideKind: "intercity" },
    });
    await prisma.ferryJourney.create({
      data: { userId, ...ends, distanceKm: 100, vehicleType: "Car" },
    });
    await prisma.rentalBooking.create({
      data: {
        userId,
        provider: "Sixt",
        pickupStationName: "A",
        pickupLat: 1,
        pickupLon: 1,
        pickupTimezone: "UTC",
        returnStationName: "A",
        returnLat: 1,
        returnLon: 1,
        returnTimezone: "UTC",
        pickupTime: new Date("2025-05-01T09:00:00Z"),
        returnTime: new Date("2025-05-02T09:00:00Z"),
        status: "completed",
        acrissCode: "CDMD",
        odometerOutKm: 1000,
        odometerInKm: 1200,
      },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("totals each mode on its own and says how many records could not be measured", async () => {
    const res = await request(app).get("/api/v1/stats/co2").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const mode = (m: string) => res.body.modes.find((x: { mode: string }) => x.mode === m);
    expect(mode("rail")).toMatchObject({ records: 2, measured: 1, kg: 17.7 });
    expect(mode("bus")).toMatchObject({ records: 1, measured: 1, kg: 2.8 });
    expect(mode("ferry")).toMatchObject({ kg: 12.9 });
    expect(mode("rental")).toMatchObject({ kg: 34.3 });
    // A mode with records and nothing measurable abstains: null, not 0.
    expect(mode("cruise")).toMatchObject({ records: 0, measured: 0, kg: null });
    expect(res.body.totalKg).toBe(67.7);
    expect(res.body.savedVsFlightKg).toBe(90.3 + 105.2);
    expect(res.body.comparedRides).toBe(2);
  });

  it("serves the same estimate on the ride, the evidence list and the trip", async () => {
    const ride = await request(app).get(`/api/v1/rail/${railId}`).set("Cookie", cookie);
    expect(ride.body.data.co2).toMatchObject({ kg: 17.7, savedKg: 90.3 });

    const evidence = await resolveMetricEvidence(
      userId,
      "co2RailKg",
      { period: { kind: "allTime" } },
      { offset: 0, limit: 10 }
    );
    expect(evidence?.measure.value).toBe(18);
    expect(evidence?.entries).toHaveLength(1);
    expect(evidence?.unattributed).toEqual([]);

    const trip = await request(app).get(`/api/v1/trips/${tripId}`).set("Cookie", cookie);
    const co2 = trip.body.trip.co2;
    expect(co2.modes.find((m: { mode: string }) => m.mode === "rail").kg).toBe(17.7);
    expect(co2.modes.find((m: { mode: string }) => m.mode === "ferry").kg).toBeNull();
    expect(co2.totalKg).toBe(20.5);
    expect(trip.body.trip.railJourneys[0].co2.kg).toBe(17.7);
  });

  it("keeps another account's rides out of the figures", async () => {
    const stranger = await prisma.user.create({
      data: { username: `co2-x-${stamp}`, passwordHash: "x", isActive: true },
    });
    try {
      const res = await request(app)
        .get("/api/v1/stats/co2")
        .set("Cookie", `auth_token=${generateToken(stranger.id)}`);
      expect(res.body.totalKg).toBeNull();
    } finally {
      await prisma.user.deleteMany({ where: { id: stranger.id } });
    }
  });
});
