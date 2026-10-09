import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import {
  makeAccount,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Trip sharing S2 — propagation through the flight routes: a fact changed by
 * one member reaches the other's copy with a notice; a private change does
 * not; a delete only notifies; a new flight in the shared trip is copied.
 */
describe("sharing — flight propagation", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let pair: Awaited<ReturnType<typeof sharedPair>>;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    pair = await sharedPair(anna, ben);
    // The first PUT settles what the fixture left underived (distance, CO₂);
    // that is a real fact change and propagates — start from the settled state.
    await request(app)
      .put(`/api/v1/flights/${pair.full.flight.id}`)
      .set("Cookie", anna.cookie)
      .send({ notes: "settle" })
      .expect(200);
    await prisma.shareNotice.deleteMany({ where: { userId: { in: [anna.id, ben.id] } } });
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const bensFlight = async () =>
    prisma.flight.findFirstOrThrow({ where: { userId: ben.id, tripId: pair.memberTrip.id } });
  const notices = (who: TestAccount) =>
    prisma.shareNotice.findMany({
      where: { userId: who.id },
      orderBy: { createdAt: "asc" },
    });

  it("applies a changed fact to the other copy and leaves a notice with before/after", async () => {
    await request(app)
      .put(`/api/v1/flights/${pair.full.flight.id}`)
      .set("Cookie", anna.cookie)
      .send({ gate: "B12" })
      .expect(200);

    const copy = await bensFlight();
    expect(copy.gate).toBe("B12");
    expect(copy.seatNumber).toBeNull();
    const [notice] = await notices(ben);
    expect(notice).toMatchObject({ kind: "updated", entityType: "flight", actorId: anna.id });
    expect(notice.entityKey).toBe(copy.shareKey);
    expect(notice.before).toEqual({ facts: { gate: null }, zones: expect.any(Object) });
    expect(await prisma.shareNotice.count({ where: { userId: ben.id } })).toBe(1);
    expect(notice.after).toMatchObject({ facts: { gate: "B12" }, entryId: copy.id });
    // Nobody tells the writer about their own change.
    expect(await notices(anna)).toHaveLength(0);
  });

  it("propagates nothing for a private-only change", async () => {
    await request(app)
      .put(`/api/v1/flights/${pair.full.flight.id}`)
      .set("Cookie", anna.cookie)
      .send({ seatNumber: "1A", notes: "mine" })
      .expect(200);
    const copy = await bensFlight();
    expect(copy.seatNumber).toBeNull();
    expect(copy.notes).toBeNull();
    expect(await notices(ben)).toHaveLength(0);
  });

  it("works the other way round: the recipient's change reaches the sharer", async () => {
    const copy = await bensFlight();
    await request(app)
      .put(`/api/v1/flights/${copy.id}`)
      .set("Cookie", ben.cookie)
      .send({ terminal: "1" })
      .expect(200);
    const own = await prisma.flight.findUniqueOrThrow({ where: { id: pair.full.flight.id } });
    expect(own.terminal).toBe("1");
    const [notice] = await notices(anna);
    expect(notice).toMatchObject({ kind: "updated", actorId: ben.id });
    // No echo: the propagated write did not propagate back.
    expect(await notices(ben)).toHaveLength(0);
  });

  it("copies a flight created in the shared trip", async () => {
    const res = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", anna.cookie)
      .send({
        flightNumber: "TP1947",
        departure: { iata: "LIS", lat: 38.7742, lon: -9.1342 },
        arrival: { iata: "FRA", lat: 50.0379, lon: 8.5622 },
        departureLocal: "2025-05-08T13:00",
        arrivalLocal: "2025-05-08T17:00",
        depTimezone: "Europe/Lisbon",
        arrTimezone: "Europe/Berlin",
        seatNumber: "3C",
        tripId: pair.full.trip.id,
      })
      .expect(201);
    const own = await prisma.flight.findUniqueOrThrow({ where: { id: res.body.flight.id } });
    expect(own.shareKey).not.toBeNull();
    const copy = await prisma.flight.findFirstOrThrow({
      where: { userId: ben.id, shareKey: own.shareKey },
    });
    expect(copy.tripId).toBe(pair.memberTrip.id);
    expect(copy.flightNumber).toBe(own.flightNumber);
    expect(copy.departureTime).toEqual(own.departureTime);
    expect(copy.seatNumber).toBeNull();
    const [notice] = await notices(ben);
    expect(notice).toMatchObject({
      kind: "created",
      entityType: "flight",
      entityKey: own.shareKey,
    });
  });

  it("never deletes the other copy: a delete is a notice", async () => {
    await request(app)
      .delete(`/api/v1/flights/${pair.full.flight.id}`)
      .set("Cookie", anna.cookie)
      .expect(204);
    const copy = await bensFlight();
    expect(copy).toBeTruthy();
    const [notice] = await notices(ben);
    expect(notice).toMatchObject({ kind: "deleted", entityType: "flight" });
    expect(notice.after).toMatchObject({ reason: "deleted", entryId: copy.id });
  });
});
