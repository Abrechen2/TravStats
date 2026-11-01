import request from "supertest";

import app from "../../../index";
import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { generateToken } from "../../../utils/jwt";
import * as distance from "../../cruiseDistance";
import { precomputeLegDistancesForCruise } from "../../cruiseDistance/cruiseLegService";

/**
 * forgejo#346. Sea routing ran once per leg INSIDE the interactive transaction
 * that rewrites a cruise (default timeout 5 s), so a long itinerary with
 * uncached port pairs could fail the save with "Transaction already closed".
 * Tests switch the router off, so no suite saw it; here the measurement itself
 * is spied and asked "is a transaction open right now?".
 */
describe("cruise writes measure their legs before the transaction (forgejo#346)", () => {
  let cookie: string;
  let userId: string;
  let portIds: number[];
  let txOpen = false;
  const measuredInsideTx: boolean[] = [];

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "legsoutsidetx" } });
    const u = await prisma.user.create({
      data: { username: "legsoutsidetx", passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const ports = await prisma.port.findMany({ where: { isUserAdded: false }, take: 4 });
    if (ports.length < 4) throw new Error("need four seeded ports");
    portIds = ports.map((p) => p.id);

    const realTx = prisma.$transaction.bind(prisma) as (...a: unknown[]) => Promise<unknown>;
    jest.spyOn(prisma, "$transaction").mockImplementation(((fn: unknown, opts: unknown) => {
      if (typeof fn !== "function") return realTx(fn, opts);
      return realTx(async (tx: unknown) => {
        txOpen = true;
        try {
          return await (fn as (t: unknown) => Promise<unknown>)(tx);
        } finally {
          txOpen = false;
        }
      }, opts);
    }) as never);
    const real = distance.computeLegDistance;
    jest.spyOn(distance, "computeLegDistance").mockImplementation(async (...args) => {
      measuredInsideTx.push(txOpen);
      return real(...args);
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.user.deleteMany({ where: { username: "legsoutsidetx" } });
    await prisma.$disconnect();
  });

  const body = (stopPorts: number[]) => ({
    name: "Outside tx",
    startDate: "2026-01-01",
    endDate: "2026-01-10",
    status: "scheduled",
    departurePortId: portIds[0],
    arrivalPortId: portIds[3],
    stops: stopPorts.map((portId, i) => ({ portId, dayNumber: i + 2, isAtSea: false })),
  });

  it("creating a cruise routes every leg outside the transaction", async () => {
    measuredInsideTx.length = 0;
    const res = await request(app)
      .post("/api/v1/cruises")
      .set("Cookie", cookie)
      .send(body([portIds[1], portIds[2]]));
    expect(res.status).toBe(201);
    expect(measuredInsideTx.length).toBeGreaterThanOrEqual(3);
    expect(measuredInsideTx.every((inside) => !inside)).toBe(true);
    const id = (res.body.data ?? res.body).id as string;
    expect(await prisma.cruiseLeg.count({ where: { cruiseId: id } })).toBe(3);

    // An edit of the stops does the same, and still stores one leg per pair.
    measuredInsideTx.length = 0;
    const upd = await request(app)
      .patch(`/api/v1/cruises/${id}`)
      .set("Cookie", cookie)
      .send({ stops: body([portIds[2], portIds[1]]).stops });
    expect(upd.status).toBe(200);
    expect(measuredInsideTx.length).toBeGreaterThanOrEqual(3);
    expect(measuredInsideTx.every((inside) => !inside)).toBe(true);
    expect(await prisma.cruiseLeg.count({ where: { cruiseId: id } })).toBe(3);
  });

  it("does not route a leg a hand-drawn line already decides", async () => {
    const cruise = await prisma.cruise.create({
      data: {
        userId,
        notes: "Covered leg",
        startDate: new Date("2026-02-01"),
        endDate: new Date("2026-02-10"),
        status: "scheduled",
        departurePortId: portIds[0],
        arrivalPortId: portIds[2],
        stops: { create: [{ portId: portIds[1], dayNumber: 2, isAtSea: false }] },
      },
    });
    await prisma.cruiseLegRoute.create({
      data: {
        cruiseId: cruise.id,
        fromKind: "port",
        fromRef: String(portIds[0]),
        toKind: "port",
        toRef: String(portIds[1]),
        waypoints: [
          [0, 0],
          [1, 1],
        ],
      },
    });
    measuredInsideTx.length = 0;
    const cache = await precomputeLegDistancesForCruise(cruise.id);
    expect(cache.size).toBe(1);
    expect(measuredInsideTx).toHaveLength(1);
  });
});
