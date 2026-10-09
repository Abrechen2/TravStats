import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { collectTrip } from "../../services/trip/exchange/collect";
import {
  makeAccount,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Trip sharing S2 — the boundary (security review of the propagation):
 * propagation reaches rows inside the share group only, never by share key
 * alone; a client can neither set a key nor read one.
 */
describe("sharing — propagation stays inside the group", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let eve: TestAccount;
  let pair: Awaited<ReturnType<typeof sharedPair>>;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna");
    ben = await makeAccount("ben");
    eve = await makeAccount("eve");
    pair = await sharedPair(anna, ben);
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const annasKey = async () =>
    (await prisma.flight.findUniqueOrThrow({ where: { id: pair.full.flight.id } }))
      .shareKey as string;

  it("leaves a foreign row holding the same key untouched", async () => {
    const key = await annasKey();
    // Eve's own trip, in a group of her own, with a flight carrying Anna's key.
    const group = await prisma.tripShareGroup.create({ data: { createdById: eve.id } });
    const trip = await prisma.trip.create({
      data: { userId: eve.id, name: "Eve", shareGroupId: group.id },
    });
    const evesFlight = await prisma.flight.create({
      data: {
        userId: eve.id,
        tripId: trip.id,
        shareKey: key,
        flightNumber: "EVE1",
        depLat: 1,
        depLon: 1,
        arrLat: 2,
        arrLon: 2,
        departureTime: new Date("2025-01-01T10:00:00Z"),
        arrivalTime: new Date("2025-01-01T12:00:00Z"),
      },
    });

    await request(app)
      .put(`/api/v1/flights/${pair.full.flight.id}`)
      .set("Cookie", anna.cookie)
      .send({ gate: "Z9" })
      .expect(200);
    await request(app)
      .delete(`/api/v1/flights/${pair.full.flight.id}`)
      .set("Cookie", anna.cookie)
      .expect(204);

    const after = await prisma.flight.findUniqueOrThrow({ where: { id: evesFlight.id } });
    expect(after.gate).toBeNull();
    expect(after.flightNumber).toBe("EVE1");
    expect(await prisma.shareNotice.count({ where: { userId: eve.id } })).toBe(0);
    // Ben, inside the group, did get both.
    expect(
      await prisma.shareNotice.count({
        where: { userId: ben.id, kind: { in: ["updated", "deleted"] } },
      })
    ).toBe(2);
  });

  it("ignores a share key sent by a client", async () => {
    const key = await annasKey();
    const created = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", eve.cookie)
      .send({
        flightNumber: "EV2",
        departure: { iata: "LIS", lat: 38.7742, lon: -9.1342 },
        arrival: { iata: "FRA", lat: 50.0379, lon: 8.5622 },
        departureLocal: "2025-05-08T13:00",
        arrivalLocal: "2025-05-08T17:00",
        depTimezone: "Europe/Lisbon",
        arrTimezone: "Europe/Berlin",
        shareKey: key,
      })
      .expect(201);
    const row = await prisma.flight.findUniqueOrThrow({ where: { id: created.body.flight.id } });
    expect(row.shareKey).toBeNull();

    await request(app)
      .put(`/api/v1/flights/${row.id}`)
      .set("Cookie", eve.cookie)
      .send({ gate: "1", shareKey: key })
      .expect(200);
    expect((await prisma.flight.findUniqueOrThrow({ where: { id: row.id } })).shareKey).toBeNull();

    const stop = await request(app)
      .post(`/api/v1/trips/${pair.full.trip.id}/stops`)
      .set("Cookie", anna.cookie)
      .send({ title: "Sintra", shareKey: "client-chosen" })
      .expect(201);
    const stopRow = await prisma.tripStop.findUniqueOrThrow({ where: { id: stop.body.stop.id } });
    expect(stopRow.shareKey).not.toBe("client-chosen");
  });

  it("never sends a share key: API responses, notices, trip export", async () => {
    const key = await annasKey();
    const flight = await request(app)
      .get(`/api/v1/flights/${pair.full.flight.id}`)
      .set("Cookie", anna.cookie)
      .expect(200);
    expect(JSON.stringify(flight.body)).not.toContain(key);
    expect(JSON.stringify(flight.body)).not.toContain("shareKey");

    await request(app)
      .put(`/api/v1/flights/${pair.full.flight.id}`)
      .set("Cookie", anna.cookie)
      .send({ gate: "C3" })
      .expect(200);
    const notices = await request(app)
      .get("/api/v1/sharing/notices")
      .set("Cookie", ben.cookie)
      .expect(200);
    const body = JSON.stringify(notices.body);
    expect(body).toContain("updated");
    expect(body).not.toContain(key);

    const collected = await collectTrip(anna.id, pair.full.trip.id, {
      documents: false,
      photos: false,
      private: true,
    });
    expect(JSON.stringify(collected)).not.toContain(key);
  });
});
