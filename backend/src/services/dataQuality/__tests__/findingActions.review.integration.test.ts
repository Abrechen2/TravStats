/**
 * The review findings on C3 (Codex, 2026-10-26), each pinned against real
 * Postgres: a merge never loses a recording or a link, re-validates inside the
 * transaction that deletes, a link re-checks its rule, and every write to a
 * flag — an answer, an undo, a run — lands only on the revision it read.
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
import { reconcileExisting, runDataQualityChecks } from "../runner";
import { listFlags } from "../flagService";
import { mergeDuplicates } from "../duplicateMerge";
import { applyFerryLink } from "../ferryLink";
import type { DataQualityFinding } from "../types";

const NOW = new Date("2026-10-10T12:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);

const FLIGHT = {
  airline: "Lufthansa",
  flightNumber: "LH400",
  depIata: "FRA",
  depLat: 50.03,
  depLon: 8.57,
  arrIata: "JFK",
  arrLat: 40.64,
  arrLon: -73.78,
  status: "flown",
  depTimeSemantics: "UTC",
  arrTimeSemantics: "UTC",
  depTimezone: "Europe/Berlin",
  arrTimezone: "America/New_York",
  departureTime: new Date("2026-03-10T08:00:00Z"),
  arrivalTime: new Date("2026-03-10T16:00:00Z"),
};

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

const track = (flightId: string) =>
  prisma.flightTrack.create({
    data: {
      flightId,
      source: "companion",
      uploadId: `up-${flightId}`,
      startedAt: new Date("2026-03-10T08:10:00Z"),
      endedAt: new Date("2026-03-10T15:50:00Z"),
      geometry: { type: "LineString", coordinates: [] },
      segmentStarts: [],
      cumulativeKm: [],
      pointCount: 0,
      distanceKm: 0,
    },
  });

async function flightPair(userId: string) {
  const typed = await prisma.flight.create({
    data: { ...FLIGHT, userId, createdAt: new Date("2026-03-01T00:00:00Z") },
  });
  const mail = await prisma.flight.create({
    data: { ...FLIGHT, userId, createdAt: new Date("2026-03-02T00:00:00Z") },
  });
  return { typed, mail };
}

async function duplicateFlag(userId: string) {
  const [flag] = await listFlags(userId, { kind: "duplicate_candidate" });
  if (!flag) throw new Error("expected a duplicate question");
  return flag;
}

async function ferrySetup(userId: string) {
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Kykladen",
      status: "completed",
      startDay: day("2026-07-01"),
      endDay: day("2026-07-14"),
    },
  });
  const ride = await prisma.ferryJourney.create({
    data: {
      userId,
      depStationName: "Piraeus",
      depLat: 37.94,
      depLon: 23.64,
      depTimezone: "Europe/Athens",
      arrStationName: "Naxos",
      arrLat: 37.1,
      arrLon: 25.37,
      arrTimezone: "Europe/Athens",
      departureTime: new Date("2026-07-05T07:00:00Z"),
      arrivalTime: new Date("2026-07-05T12:30:00Z"),
      status: "completed",
    },
  });
  await runDataQualityChecks(userId, NOW);
  const [flag] = await listFlags(userId, { kind: "ferry_match" });
  if (!flag) throw new Error("expected a ferry match");
  return { trip, ride, flag };
}

describe("C3 review findings", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        username: `dq-review-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

  // P1.1
  it("refuses to merge two copies that each carry a recording, and keeps both", async () => {
    const { typed, mail } = await flightPair(userId);
    await track(typed.id);
    await track(mail.id);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId);

    const res = await post(`/${flag.id}/resolve`, { action: "merge" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "invalidAction", reason: "conflictingRecordings" });
    expect(
      await prisma.flightTrack.count({ where: { flightId: { in: [typed.id, mail.id] } } })
    ).toBe(2);
    expect(await prisma.flight.count({ where: { userId } })).toBe(2);
  });

  it("moves the one recording a removed copy carries onto the kept copy", async () => {
    const { typed, mail } = await flightPair(userId);
    await track(mail.id);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId);

    expect((await post(`/${flag.id}/resolve`, { action: "merge" })).status).toBe(200);
    expect(await prisma.flightTrack.count({ where: { flightId: typed.id } })).toBe(1);
  });

  // P1.2
  it("refuses to merge flights filed under different trips", async () => {
    const { typed, mail } = await flightPair(userId);
    const [a, b] = await Promise.all(
      ["A", "B"].map((name) => prisma.trip.create({ data: { userId, name, status: "completed" } }))
    );
    await prisma.flight.update({ where: { id: typed.id }, data: { tripId: a.id } });
    await prisma.flight.update({ where: { id: mail.id }, data: { tripId: b.id } });
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId);

    const res = await post(`/${flag.id}/resolve`, { action: "merge" });
    expect(res.body).toEqual({ error: "invalidAction", reason: "conflictingLinks" });
    expect(await prisma.flight.count({ where: { userId } })).toBe(2);
  });

  it("refuses to merge stays under different bookings", async () => {
    const lodging = await prisma.lodging.create({ data: { userId, name: "Hotel Roma" } });
    const [b1, b2] = await Promise.all([
      prisma.booking.create({ data: { userId } }),
      prisma.booking.create({ data: { userId } }),
    ]);
    for (const [i, bookingId] of [b1.id, b2.id].entries()) {
      await prisma.lodgingStay.create({
        data: {
          userId,
          lodgingId: lodging.id,
          bookingId,
          createdAt: new Date(`2026-05-0${i + 1}T00:00:00Z`),
          checkIn: day("2026-06-10"),
          checkOut: day("2026-06-13"),
          checkInDate: day("2026-06-10"),
          checkOutDate: day("2026-06-13"),
        },
      });
    }
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId);

    const res = await post(`/${flag.id}/resolve`, { action: "merge" });
    expect(res.body).toEqual({ error: "invalidAction", reason: "conflictingLinks" });
    expect(await prisma.lodgingStay.count({ where: { userId } })).toBe(2);
  });

  // P1.3 — the transaction that deletes is the one that decides.
  it("re-validates inside the merge itself: a copy edited away is not deleted", async () => {
    const { typed, mail } = await flightPair(userId);
    await prisma.flight.update({ where: { id: mail.id }, data: { flightNumber: "LH402" } });

    await expect(
      mergeDuplicates(userId, "flight", typed.id, [mail.id], async () => undefined)
    ).rejects.toMatchObject({ code: "staleFinding" });
    expect(await prisma.flight.count({ where: { userId } })).toBe(2);
  });

  // P2.4
  it("refuses a link once the crossing has left the trip's days", async () => {
    const { ride, flag } = await ferrySetup(userId);
    await prisma.ferryJourney.update({
      where: { id: ride.id },
      data: {
        departureTime: new Date("2026-08-05T07:00:00Z"),
        arrivalTime: new Date("2026-08-05T12:30:00Z"),
      },
    });
    const res = await post(`/${flag.id}/resolve`, { action: "link" });
    expect(res.body).toEqual({ error: "staleFinding" });
    expect(
      (await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } })).tripId
    ).toBeNull();
  });

  it("refuses a link for a cancelled crossing, or when a second trip now holds it", async () => {
    const { ride, flag } = await ferrySetup(userId);
    await prisma.trip.create({
      data: {
        userId,
        name: "Overlap",
        status: "completed",
        startDay: day("2026-07-04"),
        endDay: day("2026-07-06"),
      },
    });
    expect((await post(`/${flag.id}/resolve`, { action: "link" })).body).toEqual({
      error: "staleFinding",
    });
    await prisma.ferryJourney.update({ where: { id: ride.id }, data: { status: "cancelled" } });
    expect((await post(`/${flag.id}/resolve`, { action: "link" })).body).toEqual({
      error: "staleFinding",
    });
  });

  // P2.5 — the write itself is conditional, not the read before it.
  it("does not overwrite a trip set between the read and the write", async () => {
    const { ride, flag } = await ferrySetup(userId);
    const other = await prisma.trip.create({ data: { userId, name: "Other", status: "planned" } });
    await prisma.ferryJourney.update({ where: { id: ride.id }, data: { tripId: other.id } });
    const stored = await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: flag.id } });

    // A transaction whose read still sees the ride on no trip — the window a
    // concurrent edit lands in.
    const result = prisma.$transaction(async (tx) => {
      const lagging = new Proxy(tx, {
        get(target, prop, receiver) {
          if (prop !== "ferryJourney") return Reflect.get(target, prop, receiver);
          const delegate = target.ferryJourney;
          return new Proxy(delegate, {
            get(d, p, r) {
              if (p === "findFirst" || p === "findUnique") {
                return async () => ({ tripId: null, roadtripLegId: null });
              }
              return Reflect.get(d, p, r);
            },
          });
        },
      });
      return applyFerryLink(lagging as typeof tx, stored);
    });
    await expect(result).rejects.toMatchObject({ code: "staleFinding" });
    expect((await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } })).tripId).toBe(
      other.id
    );
  });

  // P2.6
  it("serves a revision, and refuses an answer naming a revision that has moved on", async () => {
    await flightPair(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId);
    expect(typeof flag.revision).toBe("number");

    // The evidence changed after the client read the finding.
    await prisma.dataQualityFlag.update({
      where: { id: flag.id },
      data: { revision: { increment: 1 } },
    });
    const res = await post(`/${flag.id}/resolve`, { action: "keep", revision: flag.revision });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "staleFinding" });
    expect(
      (await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: flag.id } })).status
    ).toBe("open");
  });

  // P2.7
  it("undoing keep leaves a sibling the user has answered since", async () => {
    await flightPair(userId);
    await prisma.flight.create({
      data: { ...FLIGHT, userId, createdAt: new Date("2026-03-03T00:00:00Z") },
    });
    await runDataQualityChecks(userId, NOW);
    const [one, other] = await listFlags(userId, { kind: "duplicate_candidate" });

    await post(`/${one.id}/resolve`, { action: "keep" });
    // The user dismisses the sibling on its own, on purpose.
    await post(`/${other.id}/dismiss`);
    await post(`/${one.id}/undo`);

    const sibling = await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: other.id } });
    expect(sibling.status).toBe("dismissed");
    expect(sibling.undoUntil).not.toBeNull();
  });

  // P2.8
  it("a run that read the flag before an answer does not overwrite the answer", async () => {
    await flightPair(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await duplicateFlag(userId);
    await post(`/${flag.id}/resolve`);
    const readByRun = await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: flag.id } });
    // Meanwhile the user dismisses it.
    await post(`/${flag.id}/dismiss`);

    const finding = {
      entityType: readByRun.entityType,
      entityId: readByRun.entityId,
      kind: readByRun.kind,
      details: readByRun.details,
    } as unknown as DataQualityFinding;
    await reconcileExisting(readByRun, finding);

    const now = await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: flag.id } });
    expect(now.status).toBe("dismissed");
    expect(now.undoUntil).not.toBeNull();
  });
});
