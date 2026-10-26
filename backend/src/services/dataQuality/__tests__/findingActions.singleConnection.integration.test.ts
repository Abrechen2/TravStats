/**
 * Codex round four on C3: a merge and a link re-validate INSIDE their
 * transaction, and must do so through that transaction. Reading through the
 * global client there takes a second pool connection while the first is held
 * with row locks — enough concurrent answers and every connection waits for
 * another. On a pool of one, that is a self-deadlock until the timeout.
 */
import "./helpers/singleConnection";
import { describe, it, expect, beforeEach, afterEach, afterAll } from "@jest/globals";

import { prisma } from "../../../db";
import { runDataQualityChecks } from "../runner";
import { listFlags } from "../flagService";
import { resolveFinding } from "../findingActions";

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

describe("answers on a pool of one connection", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: { username: `dq-pool1-${Date.now()}-${Math.random()}`, passwordHash: "x" },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("merges a duplicate pair", async () => {
    await prisma.flight.create({
      data: { ...FLIGHT, userId, createdAt: new Date("2026-03-01T00:00:00Z") },
    });
    await prisma.flight.create({
      data: { ...FLIGHT, userId, createdAt: new Date("2026-03-02T00:00:00Z") },
    });
    await runDataQualityChecks(userId, NOW);
    const [flag] = await listFlags(userId, { kind: "duplicate_candidate" });

    await resolveFinding(flag.id, userId, { action: "merge" });
    expect(await prisma.flight.count({ where: { userId } })).toBe(1);
  }, 45_000);

  it("links a ferry crossing to its trip", async () => {
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

    await resolveFinding(flag.id, userId, { action: "link" });
    expect((await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } })).tripId).toBe(
      trip.id
    );
  }, 45_000);
});
