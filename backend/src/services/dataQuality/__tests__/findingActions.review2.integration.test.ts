/**
 * The second and third Codex rounds on C3 (2026-10-26): a run that gathered
 * before a link must not undo it (nor one that lost the create to another
 * pass), an undo must not tear a ride off a roadtrip leg and gets the sharing
 * timeout, a merge must carry timeline stops — and a shared trip's stations —
 * over to the kept copy and re-derive the trip's status, and a ferry with no
 * known arrival day is never offered.
 */
import { describe, it, expect, beforeEach, afterAll, jest } from "@jest/globals";

let afterGather: (() => Promise<void>) | null = null;
jest.mock("../gather", () => {
  const actual = jest.requireActual<typeof import("../gather")>("../gather");
  return {
    ...actual,
    loadAccountSnapshot: async (...args: Parameters<typeof actual.loadAccountSnapshot>) => {
      const snapshot = await actual.loadAccountSnapshot(...args);
      // The window: the run has its records, an answer commits now.
      const hook = afterGather;
      afterGather = null;
      if (hook) await hook();
      return snapshot;
    },
  };
});

const restatusCalls: string[][] = [];
jest.mock("../../trip/restatusTrips", () => {
  const actual = jest.requireActual<typeof import("../../trip/restatusTrips")>(
    "../../trip/restatusTrips"
  );
  return {
    restatusTrips: async (...args: Parameters<typeof actual.restatusTrips>) => {
      restatusCalls.push(args[0].filter((id): id is string => typeof id === "string"));
      return actual.restatusTrips(...args);
    },
  };
});

import { prisma } from "../../../db";
import { runDataQualityChecks } from "../runner";
import { listFlags } from "../flagService";
import { dismissFinding, resolveFinding, undoFinding } from "../findingActions";
import { SHARE_TX_TIMEOUT_MS } from "../../sharing/propagate";
import { shareTrip } from "../../sharing/shareTrip";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "../../../routes/__tests__/sharingFixtures";

const NOW = new Date("2026-10-10T12:00:00Z");
const day = (d: string) => new Date(`${d}T00:00:00Z`);

async function ferryRows(
  userId: string,
  arrivalTime: Date | null = new Date("2026-07-05T12:30:00Z")
) {
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
      arrivalTime,
      status: "completed",
    },
  });
  return { trip, ride };
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

describe("C3 review findings, round two", () => {
  let anna: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("a run that gathered before a link does not re-open it or clear its undo", async () => {
    const { flag } = await ferrySetup(anna.id);
    afterGather = () => resolveFinding(flag.id, anna.id, { action: "link" });

    await runDataQualityChecks(anna.id, NOW);

    const row = await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: flag.id } });
    expect(row.status).toBe("resolved");
    expect(row.undoUntil).not.toBeNull();
  });

  it("an undo leaves a ride that was put on a roadtrip leg since", async () => {
    const { trip, ride, flag } = await ferrySetup(anna.id);
    await resolveFinding(flag.id, anna.id, { action: "link" });
    const route = await prisma.tripRoute.create({
      data: { userId: anna.id, tripId: trip.id, name: "Inseln", mode: "drive" },
    });
    const [from, to] = await Promise.all(
      [0, 1].map((i) =>
        prisma.tripStop.create({
          data: { tripId: trip.id, routeId: route.id, routeOrderIdx: i, title: `S${i}` },
        })
      )
    );
    const leg = await prisma.tripRouteLeg.create({
      data: {
        routeId: route.id,
        fromStopId: from.id,
        toStopId: to.id,
        distanceKm: 1,
        source: "straight",
        mode: "ferry",
      },
    });
    await prisma.ferryJourney.update({ where: { id: ride.id }, data: { roadtripLegId: leg.id } });

    await expect(undoFinding(flag.id, anna.id)).rejects.toMatchObject({ code: "staleFinding" });
    const after = await prisma.ferryJourney.findUniqueOrThrow({ where: { id: ride.id } });
    expect(after.tripId).toBe(trip.id);
    expect(after.roadtripLegId).toBe(leg.id);
  });

  it("a merge points a timeline stop that wrapped a removed flight at the kept one", async () => {
    const full = await makeFullTrip(anna);
    // An older copy of the trip's flight, typed in by hand, on no trip.
    const {
      id: _id,
      tripId: _trip,
      createdAt: _c,
      updatedAt: _u,
      durationMinutes: _d,
      ...rest
    } = full.flight;
    const older = await prisma.flight.create({
      data: {
        ...(rest as unknown as Parameters<typeof prisma.flight.create>[0]["data"]),
        createdAt: new Date("2024-01-01T00:00:00Z"),
        shareKey: null,
      },
    });
    await runDataQualityChecks(anna.id, NOW);
    const [flag] = await listFlags(anna.id, { kind: "duplicate_candidate" });
    expect(flag.evidence).toMatchObject({ keptId: older.id });

    await resolveFinding(flag.id, anna.id, { action: "merge" });

    const stop = await prisma.tripStop.findUniqueOrThrow({ where: { id: full.stops[0].id } });
    expect(stop.sourceId).toBe(older.id);
  });

  it("a stay merge on a shared trip keeps the member's station on the stay", async () => {
    const ben = await makeAccount("ben");
    const full = await makeFullTrip(anna);
    const station = await prisma.tripStop.create({
      data: {
        tripId: full.trip.id,
        orderIdx: 5,
        title: "Night in Lisbon",
        lodgingStayId: full.stay.id,
      },
    });
    // An older copy of the stay, on no trip.
    const older = await prisma.lodgingStay.create({
      data: {
        userId: anna.id,
        lodgingId: full.lodging.id,
        createdAt: new Date("2024-01-01T00:00:00Z"),
        checkIn: day("2025-05-01"),
        checkOut: day("2025-05-04"),
        checkInDate: day("2025-05-01"),
        checkOutDate: day("2025-05-04"),
        stayZone: "Europe/Lisbon",
        status: "completed",
      },
    });
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, full.trip.id, companion.id);
    await runDataQualityChecks(anna.id, NOW);
    const flag = (await listFlags(anna.id, { kind: "duplicate_candidate" })).find(
      (f) => f.entityType === "lodging_stay"
    );
    if (!flag) throw new Error("expected the stay question");
    const bensBefore = await prisma.tripStop.findFirstOrThrow({
      where: { trip: { userId: ben.id }, title: "Night in Lisbon" },
    });
    expect(bensBefore.lodgingStayId).not.toBeNull();

    await resolveFinding(flag.id, anna.id, { action: "merge", keptId: older.id });

    expect(
      (await prisma.tripStop.findUniqueOrThrow({ where: { id: station.id } })).lodgingStayId
    ).toBe(older.id);
    const bensStation = await prisma.tripStop.findFirstOrThrow({
      where: { trip: { userId: ben.id }, title: "Night in Lisbon" },
    });
    expect(bensStation.lodgingStayId).not.toBeNull();
  });

  it("a run that lost the create to another pass leaves a link made meanwhile alone", async () => {
    await ferryRows(anna.id);
    afterGather = async () => {
      // The other pass creates the flag; the user links it at once.
      await runDataQualityChecks(anna.id, NOW);
      const [flag] = await listFlags(anna.id, { kind: "ferry_match" });
      await resolveFinding(flag.id, anna.id, { action: "link" });
    };

    await runDataQualityChecks(anna.id, NOW);

    const [row] = await prisma.dataQualityFlag.findMany({
      where: { userId: anna.id, kind: "ferry_match" },
    });
    expect(row.status).toBe("resolved");
    expect(row.undoUntil).not.toBeNull();
  });

  it("undoes a link inside the sharing timeout, like the link itself", async () => {
    const { flag } = await ferrySetup(anna.id);
    await resolveFinding(flag.id, anna.id, { action: "link" });
    const spy = jest.spyOn(prisma, "$transaction");
    try {
      await undoFinding(flag.id, anna.id);
      // The undo's own transaction — the first one it opens.
      expect(spy.mock.calls[0]?.[1]).toMatchObject({ timeout: SHARE_TX_TIMEOUT_MS });
    } finally {
      spy.mockRestore();
    }
  });

  it("never offers a crossing whose arrival day is unknown", async () => {
    await ferryRows(anna.id, null);
    await runDataQualityChecks(anna.id, NOW);
    expect(await listFlags(anna.id, { kind: "ferry_match" })).toEqual([]);
  });

  it("re-derives the trip's status after a merge", async () => {
    const full = await makeFullTrip(anna);
    const {
      id: _id,
      tripId: _trip,
      createdAt: _c,
      updatedAt: _u,
      durationMinutes: _d,
      ...rest
    } = full.flight;
    await prisma.flight.create({
      data: {
        ...(rest as unknown as Parameters<typeof prisma.flight.create>[0]["data"]),
        createdAt: new Date("2024-01-01T00:00:00Z"),
        shareKey: null,
      },
    });
    await runDataQualityChecks(anna.id, NOW);
    const [flag] = await listFlags(anna.id, { kind: "duplicate_candidate" });
    restatusCalls.length = 0;

    await resolveFinding(flag.id, anna.id, { action: "merge" });

    expect(restatusCalls.flat()).toContain(full.trip.id);
  });

  it("a merge does not overwrite a stop the user re-pointed while it ran", async () => {
    const full = await makeFullTrip(anna);
    const {
      id: _id,
      tripId: _trip,
      createdAt: _c,
      updatedAt: _u,
      durationMinutes: _d,
      ...rest
    } = full.flight;
    await prisma.flight.create({
      data: {
        ...(rest as unknown as Parameters<typeof prisma.flight.create>[0]["data"]),
        createdAt: new Date("2024-01-01T00:00:00Z"),
        shareKey: null,
      },
    });
    await runDataQualityChecks(anna.id, NOW);
    const [flag] = await listFlags(anna.id, { kind: "duplicate_candidate" });
    const stopId = full.stops[0].id;

    // The merge's transaction, with a user edit landing right after it found
    // the stops to re-point and before it wrote them.
    const original = prisma.$transaction.bind(prisma);
    let edited = false;
    const spy = jest.spyOn(prisma, "$transaction").mockImplementation(((
      fn: (tx: unknown) => Promise<unknown>,
      opts?: unknown
    ) =>
      original(
        ((tx: Record<string, unknown>) =>
          fn(
            new Proxy(tx, {
              get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver);
                if (prop !== "tripStop") return value;
                return new Proxy(value as Record<string, unknown>, {
                  get(d, p, r) {
                    const inner = Reflect.get(d, p, r) as (...a: unknown[]) => Promise<unknown>;
                    if (p !== "findMany" || edited) return inner;
                    return async (...args: unknown[]) => {
                      const found = await inner.apply(d, args);
                      edited = true;
                      await original((other) =>
                        other.tripStop.update({
                          where: { id: stopId },
                          data: { sourceId: "re-pointed-by-the-user" },
                        })
                      );
                      return found;
                    };
                  },
                });
              },
            })
          )) as never,
        opts as never
      )) as never);
    try {
      await resolveFinding(flag.id, anna.id, { action: "merge" });
    } finally {
      spy.mockRestore();
    }

    expect(edited).toBe(true);
    expect((await prisma.tripStop.findUniqueOrThrow({ where: { id: stopId } })).sourceId).toBe(
      "re-pointed-by-the-user"
    );
  });

  it("keep refuses when another flag over these copies now asks about a different set", async () => {
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
    for (const d of ["01", "02", "03"]) {
      await prisma.flight.create({
        data: { ...FLIGHT, userId: anna.id, createdAt: new Date(`2026-03-${d}T00:00:00Z`) },
      });
    }
    await runDataQualityChecks(anna.id, NOW);
    const [one, other] = await listFlags(anna.id, { kind: "duplicate_candidate" });
    // A run has already moved the sibling on to a set that includes a copy D.
    const details = other.details as { copies: Record<string, unknown>[] };
    await prisma.dataQualityFlag.update({
      where: { id: other.id },
      data: {
        details: {
          ...details,
          copies: [...details.copies, { ...details.copies[0], entityId: "copy-d" }],
        } as never,
        revision: { increment: 1 },
      },
    });

    await expect(resolveFinding(one.id, anna.id, { action: "keep" })).rejects.toMatchObject({
      code: "staleFinding",
    });
    expect(
      (await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: other.id } })).status
    ).toBe("open");
  });

  it("an undo locks the ride before it reads it for propagation", async () => {
    const { flag } = await ferrySetup(anna.id);
    await resolveFinding(flag.id, anna.id, { action: "link" });
    const order: string[] = [];
    const original = prisma.$transaction.bind(prisma);
    const spy = jest.spyOn(prisma, "$transaction").mockImplementation(((
      fn: (tx: unknown) => Promise<unknown>,
      opts?: unknown
    ) =>
      original(
        ((tx: Record<string, unknown>) =>
          fn(
            new Proxy(tx, {
              get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver);
                if (prop === "$queryRaw") {
                  return (...a: unknown[]) => {
                    order.push("lock");
                    return (value as (...x: unknown[]) => unknown).apply(target, a);
                  };
                }
                if (prop !== "ferryJourney") return value;
                return new Proxy(value as Record<string, unknown>, {
                  get(d, p, r) {
                    const inner = Reflect.get(d, p, r) as (...x: unknown[]) => unknown;
                    if (typeof inner !== "function") return inner;
                    return (...a: unknown[]) => {
                      order.push(`ferry.${String(p)}`);
                      return inner.apply(d, a);
                    };
                  },
                });
              },
            })
          )) as never,
        opts as never
      )) as never);
    try {
      await undoFinding(flag.id, anna.id);
    } finally {
      spy.mockRestore();
    }
    expect(order[0]).toBe("lock");
  });

  it("a dismissed ferry match is asked again when another trip now holds the crossing", async () => {
    const { trip, flag } = await ferrySetup(anna.id);
    await prisma.dataQualityFlag.update({
      where: { id: flag.id },
      data: { status: "dismissed", resolvedAt: new Date(), revision: { increment: 1 } },
    });
    // The user rebuilt the holiday as another trip.
    await prisma.trip.delete({ where: { id: trip.id } });
    const other = await prisma.trip.create({
      data: {
        userId: anna.id,
        name: "Naxos",
        status: "completed",
        startDay: day("2026-07-04"),
        endDay: day("2026-07-08"),
      },
    });

    await runDataQualityChecks(anna.id, NOW);

    const row = await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: flag.id } });
    expect(row.status).toBe("open");
    expect(row.details).toMatchObject({ candidateTripId: other.id });
  });

  it("refuses to merge stays when one opted out of the loyalty card another carries", async () => {
    const lodging = await prisma.lodging.create({ data: { userId: anna.id, name: "Hotel Roma" } });
    const card = await prisma.loyaltyMembership.create({
      data: { userId: anna.id, programName: "Bonvoy" },
    });
    const stay = (createdAt: string, extra: object) =>
      prisma.lodgingStay.create({
        data: {
          userId: anna.id,
          lodgingId: lodging.id,
          createdAt: new Date(createdAt),
          checkIn: day("2026-06-10"),
          checkOut: day("2026-06-13"),
          checkInDate: day("2026-06-10"),
          checkOutDate: day("2026-06-13"),
          ...extra,
        },
      });
    await stay("2026-05-01T00:00:00Z", { membershipOptOut: true });
    await stay("2026-05-02T00:00:00Z", { membershipId: card.id });
    await runDataQualityChecks(anna.id, NOW);
    const [flag] = await listFlags(anna.id, { kind: "duplicate_candidate" });

    await expect(resolveFinding(flag.id, anna.id, { action: "merge" })).rejects.toMatchObject({
      code: "invalidAction",
      reason: "conflictingLinks",
    });
    expect(await prisma.lodgingStay.count({ where: { userId: anna.id } })).toBe(2);
  });

  it("a sibling flag created after a keep over the same copies is born answered", async () => {
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
    for (const d of ["01", "02", "03"]) {
      await prisma.flight.create({
        data: { ...FLIGHT, userId: anna.id, createdAt: new Date(`2026-03-${d}T00:00:00Z`) },
      });
    }
    await runDataQualityChecks(anna.id, NOW);
    const [one, other] = await listFlags(anna.id, { kind: "duplicate_candidate" });
    // The run that would write the second flag has not got there yet.
    await prisma.dataQualityFlag.delete({ where: { id: other.id } });
    await resolveFinding(one.id, anna.id, { action: "keep" });

    await runDataQualityChecks(anna.id, NOW);

    const flags = await prisma.dataQualityFlag.findMany({
      where: { userId: anna.id, kind: "duplicate_candidate" },
    });
    expect(flags).toHaveLength(2);
    expect(flags.map((f) => f.status)).toEqual(["dismissed", "dismissed"]);
  });

  it("undoing that keep re-opens the sibling born answered by it too", async () => {
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
    for (const d of ["01", "02", "03"]) {
      await prisma.flight.create({
        data: { ...FLIGHT, userId: anna.id, createdAt: new Date(`2026-03-${d}T00:00:00Z`) },
      });
    }
    await runDataQualityChecks(anna.id, NOW);
    const [one, other] = await listFlags(anna.id, { kind: "duplicate_candidate" });
    await prisma.dataQualityFlag.delete({ where: { id: other.id } });
    await resolveFinding(one.id, anna.id, { action: "keep" });
    await runDataQualityChecks(anna.id, NOW);

    await undoFinding(one.id, anna.id);

    const flags = await prisma.dataQualityFlag.findMany({
      where: { userId: anna.id, kind: "duplicate_candidate" },
    });
    expect(flags.map((f) => f.status)).toEqual(["open", "open"]);
  });

  it("with four copies, a late sibling inherits the answer itself, not another sibling", async () => {
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
    const rows = [];
    for (const d of ["01", "02", "03", "04"]) {
      rows.push(
        await prisma.flight.create({
          data: { ...FLIGHT, userId: anna.id, createdAt: new Date(`2026-03-${d}T00:00:00Z`) },
        })
      );
    }
    await runDataQualityChecks(anna.id, NOW);
    const byEntity = new Map(
      (await prisma.dataQualityFlag.findMany({ where: { userId: anna.id } })).map((f) => [
        f.entityId,
        f,
      ])
    );
    const [, b, c, d] = rows.map((r) => byEntity.get(r.id));
    // D's flag is still being created when the user keeps C.
    await prisma.dataQualityFlag.delete({ where: { id: d!.id } });
    await resolveFinding(c!.id, anna.id, { action: "keep" });
    expect((await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: b!.id } })).status).toBe(
      "dismissed"
    );
    // Which dismissed flag a lookup meets first is the table's physical
    // order; move C's row behind B's so the sibling is met first.
    await prisma.$executeRaw`UPDATE data_quality_flags SET kind = kind WHERE id = ${c!.id}`;
    await runDataQualityChecks(anna.id, NOW);

    await undoFinding(c!.id, anna.id);

    const flags = await prisma.dataQualityFlag.findMany({
      where: { userId: anna.id, kind: "duplicate_candidate" },
    });
    expect(flags).toHaveLength(3);
    expect(flags.every((f) => f.status === "open")).toBe(true);
  });

  it("a run does not re-open a resolved copy flag once a keep has answered its group", async () => {
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
    for (const d of ["01", "02", "03"]) {
      await prisma.flight.create({
        data: { ...FLIGHT, userId: anna.id, createdAt: new Date(`2026-03-${d}T00:00:00Z`) },
      });
    }
    await runDataQualityChecks(anna.id, NOW);
    const [one, other] = await listFlags(anna.id, { kind: "duplicate_candidate" });
    await resolveFinding(other.id, anna.id, {}); // "I corrected it" — the copies stay
    await resolveFinding(one.id, anna.id, { action: "keep" });

    await runDataQualityChecks(anna.id, NOW);
    expect(
      (await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: other.id } })).status
    ).toBe("dismissed");

    await undoFinding(one.id, anna.id);
    expect(
      (await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: other.id } })).status
    ).toBe("open");
  });

  it("a stop created during a merge that names a removed copy ends on the kept one", async () => {
    const full = await makeFullTrip(anna);
    const {
      id: _id,
      tripId: _trip,
      createdAt: _c,
      updatedAt: _u,
      durationMinutes: _d,
      ...rest
    } = full.flight;
    const older = await prisma.flight.create({
      data: {
        ...(rest as unknown as Parameters<typeof prisma.flight.create>[0]["data"]),
        createdAt: new Date("2024-01-01T00:00:00Z"),
        shareKey: null,
      },
    });
    await runDataQualityChecks(anna.id, NOW);
    const [flag] = await listFlags(anna.id, { kind: "duplicate_candidate" });

    const original = prisma.$transaction.bind(prisma);
    let lateStopId: string | null = null;
    const spy = jest.spyOn(prisma, "$transaction").mockImplementation(((
      fn: (tx: unknown) => Promise<unknown>,
      opts?: unknown
    ) =>
      original(
        ((tx: Record<string, unknown>) =>
          fn(
            new Proxy(tx, {
              get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver);
                if (prop !== "flight") return value;
                return new Proxy(value as Record<string, unknown>, {
                  get(d, p, r) {
                    const inner = Reflect.get(d, p, r) as (...a: unknown[]) => Promise<unknown>;
                    if (p !== "deleteMany" || lateStopId) return inner;
                    return async (...args: unknown[]) => {
                      // Another request adds a stop for the copy about to go.
                      const stop = await original((other) =>
                        other.tripStop.create({
                          data: {
                            tripId: full.trip.id,
                            orderIdx: 9,
                            domain: "flight",
                            sourceId: full.flight.id,
                            title: "late",
                          },
                        })
                      );
                      lateStopId = stop.id;
                      return inner.apply(d, args);
                    };
                  },
                });
              },
            })
          )) as never,
        opts as never
      )) as never);
    try {
      await resolveFinding(flag.id, anna.id, { action: "merge" });
    } finally {
      spy.mockRestore();
    }

    expect(lateStopId).not.toBeNull();
    expect(
      (await prisma.tripStop.findUniqueOrThrow({ where: { id: lateStopId as unknown as string } }))
        .sourceId
    ).toBe(older.id);
  });

  it("a plain dismissal answers its own flag only, never the group", async () => {
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
    for (const d of ["01", "02", "03"]) {
      await prisma.flight.create({
        data: { ...FLIGHT, userId: anna.id, createdAt: new Date(`2026-03-${d}T00:00:00Z`) },
      });
    }
    await runDataQualityChecks(anna.id, NOW);
    const [one, other] = await listFlags(anna.id, { kind: "duplicate_candidate" });
    await dismissFinding(one.id, anna.id);
    await resolveFinding(other.id, anna.id, {});

    await runDataQualityChecks(anna.id, NOW);

    expect(
      (await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: other.id } })).status
    ).toBe("open");
  });

  it("undoing a keep takes the duplicate lock before it writes any flag", async () => {
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
    for (const d of ["01", "02"]) {
      await prisma.flight.create({
        data: { ...FLIGHT, userId: anna.id, createdAt: new Date(`2026-03-${d}T00:00:00Z`) },
      });
    }
    await runDataQualityChecks(anna.id, NOW);
    const [flag] = await listFlags(anna.id, { kind: "duplicate_candidate" });
    await resolveFinding(flag.id, anna.id, { action: "keep" });

    const order: string[] = [];
    const original = prisma.$transaction.bind(prisma);
    const spy = jest.spyOn(prisma, "$transaction").mockImplementation(((
      fn: (tx: unknown) => Promise<unknown>,
      opts?: unknown
    ) =>
      original(
        ((tx: Record<string, unknown>) =>
          fn(
            new Proxy(tx, {
              get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver);
                if (prop === "$queryRaw") {
                  return (...a: unknown[]) => {
                    order.push("lock");
                    return (value as (...x: unknown[]) => unknown).apply(target, a);
                  };
                }
                if (prop !== "dataQualityFlag") return value;
                return new Proxy(value as Record<string, unknown>, {
                  get(d, p, r) {
                    const inner = Reflect.get(d, p, r) as (...x: unknown[]) => unknown;
                    if (p !== "updateMany") return inner;
                    return (...a: unknown[]) => {
                      order.push("write");
                      return inner.apply(d, a);
                    };
                  },
                });
              },
            })
          )) as never,
        opts as never
      )) as never);
    try {
      await undoFinding(flag.id, anna.id);
    } finally {
      spy.mockRestore();
    }
    expect(order[0]).toBe("lock");
  });
});
