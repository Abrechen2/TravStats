import { afterAll, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import {
  copyKeyOf,
  makeAccount,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "./sharingFixtures";

/**
 * A cruise's legs are facts of the cruise (`sharing/facts/cruise.ts`), and
 * four routes recompute them without touching the cruise row: a route
 * override saved or cleared, a recording attached or deleted. Each must carry
 * the new legs to the other members' copies — before 2026-10-16 none of them
 * propagated, so Ben kept the distance Anna had corrected away.
 */
describe("trip sharing — a leg recompute reaches the copies", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let portIds: number[] = [];
  let annaCruise: string;
  let benCruise: string;

  beforeAll(async () => {
    const ports = await Promise.all(
      [54, 58].map((lat, i) =>
        prisma.port.create({
          data: { name: `ShareLeg Port ${i}`, lat, lon: 4.5, isUserAdded: true },
        })
      )
    );
    portIds = ports.map((p) => p.id);
  });

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-leg");
    ben = await makeAccount("ben-leg");
    const { full } = await sharedPair(anna, ben);
    annaCruise = full.cruise.id;
    const res = await request(app)
      .patch(`/api/v1/cruises/${annaCruise}`)
      .set("Cookie", anna.cookie)
      .send({ departurePortId: portIds[0], arrivalPortId: portIds[1] });
    expect(res.status).toBe(200);
    const key = await copyKeyOf("cruise", annaCruise);
    benCruise = (await prisma.cruise.findFirstOrThrow({ where: { userId: ben.id, shareKey: key } }))
      .id;
  });

  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.port.deleteMany({ where: { id: { in: portIds } } });
    await prisma.$disconnect();
  });

  const legsOf = async (cruiseId: string) =>
    (await prisma.cruiseLeg.findMany({ where: { cruiseId }, orderBy: { ordinal: "asc" } })).map(
      (l) => ({ ordinal: l.ordinal, distanceKm: l.distanceKm, method: l.method })
    );

  const expectBenFollows = async () => {
    const annas = await legsOf(annaCruise);
    expect(annas.length).toBeGreaterThan(0);
    expect(await legsOf(benCruise)).toEqual(annas);
  };

  const override = {
    fromKind: "port",
    toKind: "port",
    // A detour two degrees east: longer than any sea route between the two.
    waypoints: [
      [4.5, 54],
      [6.5, 56],
      [4.5, 58],
    ],
  };

  it("starts with Ben's legs equal to Anna's", async () => {
    await expectBenFollows();
  });

  it("a saved route override changes Ben's leg too", async () => {
    const before = await legsOf(annaCruise);
    const res = await request(app)
      .put(`/api/v1/cruises/${annaCruise}/route-override`)
      .set("Cookie", anna.cookie)
      .send({ ...override, fromRef: String(portIds[0]), toRef: String(portIds[1]) });
    expect(res.status).toBe(201);
    expect(await legsOf(annaCruise)).not.toEqual(before);
    await expectBenFollows();
  });

  it("a cleared route override restores Ben's leg too", async () => {
    const key = {
      fromKind: "port",
      toKind: "port",
      fromRef: String(portIds[0]),
      toRef: String(portIds[1]),
    };
    await request(app)
      .put(`/api/v1/cruises/${annaCruise}/route-override`)
      .set("Cookie", anna.cookie)
      .send({ ...override, ...key });
    const res = await request(app)
      .delete(`/api/v1/cruises/${annaCruise}/route-override`)
      .query(key)
      .set("Cookie", anna.cookie);
    expect(res.status).toBe(200);
    await expectBenFollows();
  });

  const gpx = () => {
    const start = Date.parse("2025-05-04T08:00:00Z");
    const points = Array.from({ length: 81 }, (_, i) => ({ lat: 54 + i * 0.05, lon: 4.5 }));
    const body = points
      .map(
        (p, i) =>
          `<trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon}"><time>${new Date(start + i * 600_000).toISOString()}</time></trkpt>`
      )
      .join("\n");
    return Buffer.from(
      `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="test"><trk><name>Voyage</name><trkseg>\n${body}\n</trkseg></trk></gpx>`
    );
  };

  it("an attached recording and its deletion reach Ben's leg", async () => {
    const before = await legsOf(annaCruise);
    const up = await request(app)
      .post(`/api/v1/cruises/${annaCruise}/tracks`)
      .set("Cookie", anna.cookie)
      .attach("file", gpx(), "voyage.gpx");
    expect(up.status).toBe(201);
    expect(await legsOf(annaCruise)).not.toEqual(before);
    await expectBenFollows();

    const trackId = (up.body as { data: { id: string } }).data.id;
    const del = await request(app)
      .delete(`/api/v1/cruises/${annaCruise}/tracks/${trackId}`)
      .set("Cookie", anna.cookie);
    expect(del.status).toBe(200);
    await expectBenFollows();
  });
});
