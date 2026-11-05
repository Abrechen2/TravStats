/**
 * A flight that is a train or bus ride (owner ruling 2026-11-05) against real
 * Postgres, through the router: raised as a question, never converted silently;
 * `convert` files the rail/bus ride and removes the flight; `dismiss` keeps it.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, jest } from "@jest/globals";
import express from "express";
import request from "supertest";

let mockUserId = "";
jest.mock("../../../middleware/auth", () => {
  const actual = jest.requireActual<typeof import("../../../middleware/auth")>(
    "../../../middleware/auth"
  );
  return {
    ...actual,
    authenticate: (req: unknown, _res: unknown, next: () => void) => {
      (req as { userId?: string }).userId = mockUserId;
      next();
    },
  };
});

import { prisma } from "../../../db";
import dataQualityFlagsRouter from "../../../routes/dataQualityFlags";
import { errorHandler } from "../../../middleware/errorHandler";
import { runDataQualityChecks } from "../runner";
import { listFlags } from "../flagService";
import { prepareSurfaceConversion } from "../surfaceConvert";

const NOW = new Date("2026-10-10T12:00:00Z");

function makeApp(): express.Express {
  const app = express();
  app.use(express.json());
  app.use("/api/v1/data-quality-flags", dataQualityFlagsRouter);
  app.use(errorHandler);
  return app;
}

const post = (path: string, body?: object) =>
  request(makeApp())
    .post(`/api/v1/data-quality-flags${path}`)
    .send(body ?? {});

const baseFlight = {
  airline: "Lufthansa",
  depIata: "QKL",
  depName: "Koeln Hbf",
  depLat: 50.943,
  depLon: 6.959,
  arrIata: "FRA",
  arrName: "Frankfurt Airport",
  arrLat: 50.033,
  arrLon: 8.57,
  departureTime: new Date("2026-09-10T05:12:00Z"),
  arrivalTime: new Date("2026-09-10T06:20:00Z"),
  status: "flown",
};

async function seed(userId: string) {
  const trip = await prisma.trip.create({
    data: { userId, name: "NYC", status: "completed" },
  });
  const train = await prisma.flight.create({
    data: {
      ...baseFlight,
      userId,
      flightNumber: "LH8878",
      aircraft: "TRN",
      bookingReference: "ABC123",
      tripId: trip.id,
    },
  });
  const real = await prisma.flight.create({
    data: {
      ...baseFlight,
      userId,
      flightNumber: "LH400",
      aircraft: "Boeing 747-8",
      depIata: "FRA",
      depName: "Frankfurt Airport",
      depLat: 50.033,
      depLon: 8.57,
      arrIata: "JFK",
      arrName: "New York JFK",
      arrLat: 40.64,
      arrLon: -73.78,
      tripId: trip.id,
    },
  });
  return { trip, train, real };
}

async function surfaceFlags(userId: string) {
  return listFlags(userId, { kind: "surface_segment" });
}

describe("flights that are train or bus rides", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        username: `dq-surface-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "x",
      },
    });
    userId = user.id;
    mockUserId = userId;
  });

  afterEach(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("asks about the TRN flight only, offers convert, and changes nothing by itself", async () => {
    const { train, real } = await seed(userId);
    await runDataQualityChecks(userId, NOW);
    const flags = await surfaceFlags(userId);

    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({
      entityId: train.id,
      actions: ["convert"],
      evidence: { mode: "rail", flightNumber: "LH8878" },
    });
    expect(await prisma.flight.count({ where: { userId } })).toBe(2);
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
    expect(flags.some((f) => f.entityId === real.id)).toBe(false);
  });

  it("convert files a rail ride on the same trip and booking, removes the flight and cannot be undone", async () => {
    const { train, real, trip } = await seed(userId);
    await runDataQualityChecks(userId, NOW);
    const [flag] = await surfaceFlags(userId);

    const res = await post(`/${flag.id}/resolve`, { action: "convert" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: "resolved", undoUntil: null });

    // The flight is gone, so flight figures cannot count it; the real one stays.
    expect(await prisma.flight.findUnique({ where: { id: train.id } })).toBeNull();
    expect(await prisma.flight.findUnique({ where: { id: real.id } })).not.toBeNull();
    const rides = await prisma.railJourney.findMany({ where: { userId } });
    expect(rides).toHaveLength(1);
    expect(rides[0]).toMatchObject({
      trainNumber: "LH8878",
      tripId: trip.id,
      bookingReference: "ABC123",
      depStationName: "Koeln Hbf",
      transitMode: "rail",
    });

    const undo = await post(`/${flag.id}/undo`);
    expect(undo.status).toBe(409);
    expect(undo.body).toEqual({ error: "undoExpired" });
  });

  it("moves the originals filed with the flight onto the ride instead of deleting them", async () => {
    const { train } = await seed(userId);
    const doc = await prisma.document.create({
      data: {
        userId,
        storedName: `s-${Date.now()}.pdf`,
        originalName: "ticket.pdf",
        mimetype: "application/pdf",
        sizeBytes: 10,
        sha256: "x".repeat(64),
        format: "pdf",
        flightId: train.id,
      },
    });
    await runDataQualityChecks(userId, NOW);
    const [flag] = await surfaceFlags(userId);
    expect((await post(`/${flag.id}/resolve`, { action: "convert" })).status).toBe(200);

    const ride = await prisma.railJourney.findFirstOrThrow({ where: { userId } });
    const kept = await prisma.document.findUnique({ where: { id: doc.id } });
    expect(kept).toMatchObject({ flightId: null, railJourneyId: ride.id });
  });

  it("a concurrent edit between reading and committing is a 409 with nothing written", async () => {
    const { train } = await seed(userId);
    await runDataQualityChecks(userId, NOW);
    const [flag] = await surfaceFlags(userId);
    const row = await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: flag.id } });

    const prepared = await prepareSurfaceConversion(row);
    await prisma.flight.update({ where: { id: train.id }, data: { notes: "edited meanwhile" } });
    await expect(prisma.$transaction((tx) => prepared.commit(tx))).rejects.toMatchObject({
      code: "staleFinding",
    });

    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: train.id } })).notes).toBe(
      "edited meanwhile"
    );
    // The retry is a fresh read: it carries the edit.
    expect((await post(`/${flag.id}/resolve`, { action: "convert" })).status).toBe(200);
    const rides = await prisma.railJourney.findMany({ where: { userId } });
    expect(rides.map((r) => r.notes)).toEqual(["edited meanwhile"]);
  });

  it("a failure after the ride was written rolls everything back: flight kept, no ride", async () => {
    const { train } = await seed(userId);
    await runDataQualityChecks(userId, NOW);
    const [flag] = await surfaceFlags(userId);
    const row = await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: flag.id } });

    const prepared = await prepareSurfaceConversion(row);
    await expect(
      prisma.$transaction(async (tx) => {
        await prepared.commit(tx);
        throw new Error("boom after commit step");
      })
    ).rejects.toThrow("boom");
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
    expect(await prisma.flight.findUnique({ where: { id: train.id } })).not.toBeNull();
  });

  it("a double submit files one ride", async () => {
    await seed(userId);
    await runDataQualityChecks(userId, NOW);
    const [flag] = await surfaceFlags(userId);
    const [a, b] = await Promise.all([
      post(`/${flag.id}/resolve`, { action: "convert" }),
      post(`/${flag.id}/resolve`, { action: "convert" }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(1);
  });

  it("carries taxes and fees into the ride's total instead of dropping them", async () => {
    const { train } = await seed(userId);
    await prisma.flight.update({
      where: { id: train.id },
      data: { price: 100, taxes: 12, fees: 3, currency: "EUR" },
    });
    await runDataQualityChecks(userId, NOW);
    const [flag] = await surfaceFlags(userId);
    expect((await post(`/${flag.id}/resolve`, { action: "convert" })).status).toBe(200);
    const ride = await prisma.railJourney.findFirstOrThrow({ where: { userId } });
    expect(ride.price).toBe(115);
    expect(ride.notes).toContain("Taxes 12.00");
    expect(ride.notes).toContain("Fees 3.00");
  });

  it("refuses instead of truncating a value longer than the ride's column", async () => {
    const { train } = await seed(userId);
    await prisma.flight.update({
      where: { id: train.id },
      data: { bookingReference: "R".repeat(41) },
    });
    await runDataQualityChecks(userId, NOW);
    const [flag] = await surfaceFlags(userId);
    const res = await post(`/${flag.id}/resolve`, { action: "convert" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalidAction", reason: "valueTooLong" });
    expect(await prisma.flight.findUnique({ where: { id: train.id } })).not.toBeNull();
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
  });

  it("keeps a date-only arrival as that day instead of dropping it", async () => {
    const { train } = await seed(userId);
    await prisma.flight.update({
      where: { id: train.id },
      data: { arrPrecision: "day", arrivalTime: new Date("2026-09-10T12:00:00Z") },
    });
    await runDataQualityChecks(userId, NOW);
    const [flag] = await surfaceFlags(userId);
    expect((await post(`/${flag.id}/resolve`, { action: "convert" })).status).toBe(200);
    const ride = await prisma.railJourney.findFirstOrThrow({ where: { userId } });
    expect(ride.arrivalTime).not.toBeNull();
    expect(ride.arrPrecision).toBe("day");
  });

  it("upserts companions inside the transaction: preparing writes none, a rollback leaves none", async () => {
    const { train } = await seed(userId);
    await prisma.flight.update({ where: { id: train.id }, data: { companions: ["Anna"] } });
    await runDataQualityChecks(userId, NOW);
    const [flag] = await surfaceFlags(userId);
    const row = await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: flag.id } });

    const prepared = await prepareSurfaceConversion(row);
    expect(await prisma.companion.count({ where: { userId } })).toBe(0);
    await expect(
      prisma.$transaction(async (tx) => {
        await prepared.commit(tx);
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    expect(await prisma.companion.count({ where: { userId } })).toBe(0);

    expect((await post(`/${flag.id}/resolve`, { action: "convert" })).status).toBe(200);
    expect(await prisma.companion.count({ where: { userId } })).toBe(1);
    const ride = await prisma.railJourney.findFirstOrThrow({ where: { userId } });
    expect(ride.companions).toEqual(["Anna"]);
  });

  it("files a bus ride for a BUS flight", async () => {
    const { train } = await seed(userId);
    await prisma.flight.update({ where: { id: train.id }, data: { aircraft: "BUS" } });
    await runDataQualityChecks(userId, NOW);
    const [flag] = await surfaceFlags(userId);

    expect((await post(`/${flag.id}/resolve`, { action: "convert" })).status).toBe(200);
    const rides = await prisma.busJourney.findMany({ where: { userId } });
    expect(rides).toHaveLength(1);
    expect(rides[0]).toMatchObject({ lineName: "LH8878", bookingReference: "ABC123" });
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
  });

  it("dismiss keeps the flight a flight, and the question is not asked again", async () => {
    const { train } = await seed(userId);
    await runDataQualityChecks(userId, NOW);
    const [flag] = await surfaceFlags(userId);

    expect((await post(`/${flag.id}/dismiss`)).status).toBe(200);
    await runDataQualityChecks(userId, NOW);
    expect(await prisma.flight.findUnique({ where: { id: train.id } })).not.toBeNull();
    expect(await listFlags(userId, { kind: "surface_segment" })).toHaveLength(0);
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
  });

  it("refuses to convert a flight with no position and says why, keeping the flight", async () => {
    const { train } = await seed(userId);
    await prisma.flight.update({ where: { id: train.id }, data: { depLat: 0, depLon: 0 } });
    await runDataQualityChecks(userId, NOW);
    const [flag] = await surfaceFlags(userId);

    const res = await post(`/${flag.id}/resolve`, { action: "convert" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "invalidAction", reason: "noPosition" });
    expect(await prisma.flight.findUnique({ where: { id: train.id } })).not.toBeNull();
    expect(await prisma.railJourney.count({ where: { userId } })).toBe(0);
  });
});
