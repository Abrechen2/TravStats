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
 * A roadtrip over a shared trip may hold the trip's own timeline stops as
 * stations. Those stay timeline stops: an edit through the station editor is
 * the same fact change the timeline editor propagates, and a station the
 * roadtrip lets go is an ordinary stop of the shared trip again. Until
 * 2026-10-16 both station writers were exempt as "roadtrip stations — not
 * shared", which held for the roadtrip's own stations only.
 */
describe("trip sharing — the roadtrip station writers", () => {
  let anna: TestAccount;
  let ben: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-rt");
    ben = await makeAccount("ben-rt");
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  /** Anna's shared trip with a roadtrip holding Belém (copied) and Sintra (never was). */
  const roadtripOverSharedTrip = async () => {
    const { full, memberTrip } = await sharedPair(anna, ben);
    const route = await prisma.tripRoute.create({
      data: {
        userId: anna.id,
        tripId: full.trip.id,
        name: "Küste",
        mode: "road",
        kind: "roadtrip",
        vehicle: "car",
      },
    });
    const belem = await prisma.tripStop.update({
      where: { id: full.stops[1].id },
      data: { routeId: route.id, routeOrderIdx: 0 },
    });
    const sintra = await prisma.tripStop.create({
      data: {
        tripId: full.trip.id,
        orderIdx: 2,
        title: "Sintra",
        lat: 38.7975,
        lon: -9.3906,
        routeId: route.id,
        routeOrderIdx: 1,
      },
    });
    const benTitles = async () =>
      (
        await prisma.tripStop.findMany({
          where: { tripId: memberTrip.id },
          select: { title: true },
          orderBy: { title: "asc" },
        })
      ).map((s) => s.title);
    return { routeId: route.id, belem, sintra, benTitles };
  };

  const station = (s: { id: string; title: string; lat: number | null; lon: number | null }) => ({
    id: s.id,
    title: s.title,
    lat: s.lat,
    lon: s.lon,
    night: { kind: "free" },
  });

  it("a timeline stop renamed in the station editor is renamed in Ben's copy", async () => {
    const { routeId, belem, sintra, benTitles } = await roadtripOverSharedTrip();
    const res = await request(app)
      .put(`/api/v1/roadtrips/${routeId}/stations`)
      .set("Cookie", anna.cookie)
      .send({
        stations: [station({ ...belem, title: "Torre de Belém" }), station(sintra)],
      });
    expect(res.status).toBe(200);
    expect(await benTitles()).toEqual(["FRA → LIS", "Torre de Belém"]);
  });

  it("a timeline stop dropped from the station list reaches Ben", async () => {
    const { routeId, belem, benTitles } = await roadtripOverSharedTrip();
    const res = await request(app)
      .put(`/api/v1/roadtrips/${routeId}/stations`)
      .set("Cookie", anna.cookie)
      .send({ stations: [station(belem)] });
    expect(res.status).toBe(200);
    expect(await benTitles()).toEqual(["Belém", "FRA → LIS", "Sintra"]);
  });

  it("a timeline stop the phone takes off the roadtrip reaches Ben", async () => {
    const { routeId, sintra, benTitles } = await roadtripOverSharedTrip();
    const res = await request(app)
      .delete(`/api/v1/roadtrips/${routeId}/stations/${sintra.id}`)
      .set("Cookie", anna.cookie);
    expect(res.status).toBe(200);
    expect((res.body as { removed: { released: boolean } }).removed.released).toBe(true);
    expect(await benTitles()).toEqual(["Belém", "FRA → LIS", "Sintra"]);
  });
});
