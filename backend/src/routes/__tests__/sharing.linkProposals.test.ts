import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import {
  linkWithConsent,
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * Local link proposals (Codex P1, 2026-11-27), mirroring an offer from another server: Anna
 * proposes her trip; Ben matches, previews and decides in his own inbox, the bulk link pairs his
 * open proposals with his trips; Anna learns only pending/linked/declined, never Ben's trips.
 */
const LINE = Array.from({ length: 40 }, (_, i) => [10.1 + i * 0.01, 54.3 + i * 0.1]);

async function ferry(owner: TestAccount, tripId: string, drawn: boolean) {
  return prisma.ferryJourney.create({
    data: {
      userId: owner.id,
      tripId,
      operator: "Color Line",
      depStationName: "Kiel",
      depLat: 54.32,
      depLon: 10.14,
      depTimezone: "Europe/Berlin",
      arrStationName: "Oslo",
      arrLat: 59.9,
      arrLon: 10.74,
      arrTimezone: "Europe/Oslo",
      departureTime: new Date("2025-05-02T12:00:00Z"),
      arrivalTime: new Date("2025-05-03T08:00:00Z"),
      geometry: drawn ? LINE : [LINE[0], LINE[LINE.length - 1]],
      geometrySource: drawn ? "manual" : "straight",
    },
  });
}

describe("local link proposals (Codex P1)", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let annas: Awaited<ReturnType<typeof makeFullTrip>>;
  let bens: Awaited<ReturnType<typeof makeFullTrip>>;
  let annasFerry: { id: string };
  let bensFerry: { id: string };

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-lp");
    ben = await makeAccount("ben-lp");
    annas = await makeFullTrip(anna);
    bens = await makeFullTrip(ben);
    await prisma.trip.update({ where: { id: bens.trip.id }, data: { name: "Bens Geheimreise" } });
    annasFerry = await ferry(anna, annas.trip.id, true);
    bensFerry = await ferry(ben, bens.trip.id, false);
    await prisma.flight.update({ where: { id: bens.flight.id }, data: { gate: "C3" } });
    await prisma.flight.update({ where: { id: annas.flight.id }, data: { gate: "B12" } });
    await linkWithConsent(anna, ben); // Ben lets Anna offer him trips.
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  const as = (u: TestAccount) => ({
    get: (url: string) => request(app).get(`/api/v1/sharing${url}`).set("Cookie", u.cookie),
    post: (url: string, body: object = {}) =>
      request(app).post(`/api/v1/sharing${url}`).set("Cookie", u.cookie).send(body),
  });
  const propose = async () =>
    (await as(anna).post(`/trips/${annas.trip.id}/link-proposal`, { userId: ben.id }).expect(200))
      .body.data as { id: string; status: string };

  it("Anna proposes and learns only the status; Ben's trip never reaches her", async () => {
    const sent = await propose();
    expect(sent.status).toBe("pending");
    const list = await as(anna).get("/link-proposals/sent").expect(200);
    expect(JSON.stringify(list.body)).not.toContain("Geheimreise");
    expect(JSON.stringify(list.body)).not.toContain(bens.trip.id);
    // Not Anna's to answer.
    await as(anna).get(`/link-proposals/${sent.id}/candidates`).expect(404);
    await as(anna)
      .post(`/link-proposals/${sent.id}/preview`, { tripId: annas.trip.id })
      .expect(404);
  });

  it("Ben matches, previews and links with his own choices; nothing is linked before that", async () => {
    const sent = await propose();
    expect(
      (await prisma.trip.findUniqueOrThrow({ where: { id: bens.trip.id } })).shareGroupId
    ).toBeNull();
    const inbox = await as(ben).get("/link-proposals/received").expect(200);
    expect(inbox.body.data).toEqual([
      expect.objectContaining({
        id: sent.id,
        trip: expect.objectContaining({ id: annas.trip.id }),
      }),
    ]);
    const candidates = await as(ben).get(`/link-proposals/${sent.id}/candidates`).expect(200);
    expect(candidates.body.data.candidates[0]).toMatchObject({
      id: bens.trip.id,
      reason: "period",
    });
    const preview = await as(ben)
      .post(`/link-proposals/${sent.id}/preview`, { tripId: bens.trip.id })
      .expect(200);
    const flight = preview.body.data.matched.find((m: { entity: string }) => m.entity === "flight");
    expect(flight.conflicts.map((c: { field: string }) => c.field)).toContain("gate");

    // Ben keeps his gate (both), and the better drawn line comes to him by the rule.
    await as(ben)
      .post(`/link-proposals/${sent.id}/link`, {
        tripId: bens.trip.id,
        decision: "both",
        choices: {},
      })
      .expect(200);
    const bensFlight = await prisma.flight.findUniqueOrThrow({ where: { id: bens.flight.id } });
    const annasFlight = await prisma.flight.findUniqueOrThrow({ where: { id: annas.flight.id } });
    expect(bensFlight.shareKey).toBe(annasFlight.shareKey);
    expect(bensFlight.gate).toBe("C3");
    expect(annasFlight.gate).toBe("B12");
    const status = await as(anna).get("/link-proposals/sent").expect(200);
    expect(status.body.data[0].status).toBe("linked");
    // A repeat finds the proposal taken.
    await as(ben)
      .post(`/link-proposals/${sent.id}/link`, { tripId: bens.trip.id, decision: "both" })
      .expect(404);
  });

  it("Ben's 'mine' never pushes his straight line over Anna's drawn one (UAT B1)", async () => {
    const sent = await propose();
    await as(ben)
      .post(`/link-proposals/${sent.id}/link`, { tripId: bens.trip.id, decision: "mine" })
      .expect(200);
    expect(
      (await prisma.ferryJourney.findUniqueOrThrow({ where: { id: annasFerry.id } })).geometrySource
    ).toBe("manual");
    expect(
      (await prisma.ferryJourney.findUniqueOrThrow({ where: { id: bensFerry.id } })).geometrySource
    ).toBe("manual");
  });

  it("Ben's bulk pairs his open proposals with his trips, and declining tells Anna 'declined'", async () => {
    const sent = await propose();
    const bulk = await as(ben).get("/link-proposals/bulk").expect(200);
    expect(bulk.body.data.pairs).toEqual([
      expect.objectContaining({ id: sent.id, trip: expect.objectContaining({ id: bens.trip.id }) }),
    ]);
    // Anna cannot read Ben's bulk list: hers holds nothing of his.
    const hers = await as(anna).get("/link-proposals/bulk").expect(200);
    expect(hers.body.data.pairs).toEqual([]);
    await as(ben).post(`/link-proposals/${sent.id}/decline`).expect(200);
    expect((await as(anna).get("/link-proposals/sent")).body.data[0].status).toBe("declined");
    expect((await as(ben).get("/link-proposals/received")).body.data).toEqual([]);
  });

  it("without Ben's offer consent Anna cannot propose, and a withdrawn consent hides the proposal", async () => {
    const sent = await propose();
    await prisma.shareConsent.updateMany({
      where: { requesterId: anna.id, targetId: ben.id },
      data: { status: "withdrawn" },
    });
    expect((await as(ben).get("/link-proposals/received")).body.data).toEqual([]);
    await as(ben).get(`/link-proposals/${sent.id}/candidates`).expect(404);
    await as(anna).post(`/trips/${annas.trip.id}/link-proposal`, { userId: ben.id }).expect(403);
  });
});
