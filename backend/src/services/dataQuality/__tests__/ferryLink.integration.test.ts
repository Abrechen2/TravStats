/**
 * The ferry match (spec 2026-10-25 C3) against real Postgres, through the
 * router: raised for a crossing inside one trip, answered with `link`, and
 * taken back with `undo` — unless the ride moved meanwhile.
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

const NOW = new Date("2026-10-10T12:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);

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

async function seed(userId: string) {
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
  return { trip, ride };
}

async function ferryFlag(userId: string) {
  const [flag] = await listFlags(userId, { kind: "ferry_match" });
  if (!flag) throw new Error("expected a ferry match");
  return flag;
}

describe("ferry match (spec C3)", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        username: `dq-ferry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

  it("raises the question on the ride, named and linkable, with link as its answer", async () => {
    const { trip, ride } = await seed(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await ferryFlag(userId);

    expect(flag).toMatchObject({
      entityType: "ferry_journey",
      entityId: ride.id,
      actions: ["link"],
      subject: { entityType: "ferry_journey", label: "Piraeus → Naxos", tripId: null },
      evidence: { ferryId: ride.id, candidateTripId: trip.id, candidateTripName: "Kykladen" },
    });
  });

  it("link puts the ride on the trip; undo takes it off and re-opens the question", async () => {
    const { trip, ride } = await seed(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await ferryFlag(userId);

    const linked = await post(`/${flag.id}/resolve`, { action: "link" });
    expect(linked.status).toBe(200);
    expect(linked.body.data).toMatchObject({ status: "resolved" });
    expect(linked.body.data.undoUntil).not.toBeNull();
    expect((await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } })).tripId).toBe(
      trip.id
    );
    // Linked, the ride is on a trip: nothing left to ask.
    expect(await runDataQualityChecks(userId, NOW)).toMatchObject({ opened: 0, reopened: 0 });

    const undone = await post(`/${flag.id}/undo`);
    expect(undone.status).toBe(200);
    expect(undone.body.data.status).toBe("open");
    expect(
      (await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } })).tripId
    ).toBeNull();
  });

  it("refuses an undo with staleFinding when the ride was moved to another trip meanwhile", async () => {
    const { ride } = await seed(userId);
    const other = await prisma.trip.create({ data: { userId, name: "Other", status: "planned" } });
    await runDataQualityChecks(userId, NOW);
    const flag = await ferryFlag(userId);
    await post(`/${flag.id}/resolve`, { action: "link" });
    await prisma.ferryJourney.update({ where: { id: ride.id }, data: { tripId: other.id } });

    const res = await post(`/${flag.id}/undo`);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "staleFinding" });
    expect((await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } })).tripId).toBe(
      other.id
    );
  });

  it("refuses a link with staleFinding when the ride is on a trip already, and changes nothing", async () => {
    const { ride } = await seed(userId);
    await runDataQualityChecks(userId, NOW);
    const flag = await ferryFlag(userId);
    const other = await prisma.trip.create({ data: { userId, name: "Other", status: "planned" } });
    await prisma.ferryJourney.update({ where: { id: ride.id }, data: { tripId: other.id } });

    const res = await post(`/${flag.id}/resolve`, { action: "link" });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: "staleFinding" });
    expect(
      (await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: flag.id } })).status
    ).toBe("open");
  });
});
