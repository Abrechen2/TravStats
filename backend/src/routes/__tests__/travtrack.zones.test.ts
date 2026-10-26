import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { generateApiToken } from "../../utils/apiTokens";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * TravTrack's privacy-zone API (TravTrack plan T3, ported from the archived
 * `/location/zones` suite). The rules themselves are pinned at service level
 * (`services/travtrack/__tests__/zones.test.ts`); here: who may read and
 * write, the 409 round trip on the wire, and the gate tiers.
 */

const PREFIX = "travtrack-zone-api-";
const HOME = { lat: 37.5665, lon: 126.978 };
const AT_2KM = { lat: 37.5845, lon: 126.978 };

describe("TravTrack — /travtrack/zones", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherUserId: string;
  let cookie: string;
  let otherCookie: string;
  let phone: string;
  let readOnly: string;

  async function token(uid: string, deviceId: string, scope: "write" | "read" = "write") {
    const t = await generateApiToken();
    await prisma.apiToken.create({
      data: {
        userId: uid,
        label: "Companion",
        lookupHash: t.lookupHash,
        hash: t.hash,
        scope,
        deviceId,
        platform: "ios",
      },
    });
    return `Bearer ${t.plaintext}`;
  }

  const as = (r: request.Test, auth: string) =>
    auth.startsWith("Bearer") ? r.set("Authorization", auth) : r.set("Cookie", auth);
  const createZone = (body: object, auth = cookie) =>
    as(request(app).post("/api/v1/travtrack/zones"), auth).send(body);
  const upload = (uploadId: string, points: { id: string; lat: number; lon: number }[]) =>
    request(app)
      .post("/api/v1/travtrack/points")
      .set("Authorization", phone)
      .send({
        uploadId,
        points: points.map((p, i) => ({ ...p, t: `2026-10-12T01:00:0${i}Z` })),
      });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    const u = await prisma.user.create({ data: { username: `${PREFIX}a`, passwordHash: "x" } });
    const o = await prisma.user.create({ data: { username: `${PREFIX}b`, passwordHash: "x" } });
    userId = u.id;
    otherUserId = o.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    otherCookie = `auth_token=${generateToken(o.id)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    const users = { userId: { in: [userId, otherUserId] } };
    await wipeTravTrack([userId, otherUserId]);
    await prisma.apiToken.deleteMany({ where: users });
    phone = await token(userId, "phone-1");
    readOnly = await token(userId, "phone-2", "read");
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("asks on the wire before a new zone deletes stored points, then deletes them", async () => {
    await upload("u1", [
      { id: "home", ...HOME },
      { id: "far", ...AT_2KM },
    ]);
    const asked = await createZone({ name: "Zuhause", ...HOME, radiusM: 250 });
    expect(asked.status).toBe(409);
    expect(asked.body).toMatchObject({ code: "LOCATION_ZONE_HOLDS_POINTS", pointsInside: 1 });
    const done = await createZone({
      name: "Zuhause",
      ...HOME,
      radiusM: 250,
      deleteStoredPoints: true,
    });
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ deleted: 1, zone: { name: "Zuhause", radiusM: 250 } });

    const id = done.body.zone.id;
    const patch = (body: object) =>
      request(app).patch(`/api/v1/travtrack/zones/${id}`).set("Cookie", cookie).send(body);
    expect((await patch({ name: "Daheim" })).status).toBe(200);
    expect((await patch({ lat: 1 })).status).toBe(400);
  });

  it("lets the paired phone read and write zones, but not a read-only token", async () => {
    expect((await createZone({ name: "Arbeit", ...AT_2KM, radiusM: 100 }, readOnly)).status).toBe(
      403
    );
    expect((await createZone({ name: "Arbeit", ...AT_2KM, radiusM: 100 }, phone)).status).toBe(201);
    const listed = await request(app).get("/api/v1/travtrack/zones").set("Authorization", readOnly);
    expect(listed.status).toBe(200);
    expect(listed.body.zones).toHaveLength(1);
    expect(listed.body.zones[0]).toMatchObject({
      name: "Arbeit",
      lat: AT_2KM.lat,
      lon: AT_2KM.lon,
    });
  });

  it("keeps zones to their owner", async () => {
    const created = await createZone({ name: "Zuhause", ...HOME, radiusM: 250 });
    const id = created.body.zone.id;
    const theirs = await request(app).get("/api/v1/travtrack/zones").set("Cookie", otherCookie);
    expect(theirs.status).toBe(200);
    expect(theirs.body.zones).toEqual([]);
    const notTheirs = await request(app)
      .delete(`/api/v1/travtrack/zones/${id}`)
      .set("Cookie", otherCookie);
    expect(notTheirs.status).toBe(404);
    expect(notTheirs.body.code).toBe("LOCATION_ZONE_NOT_FOUND");
    expect(
      (await request(app).delete(`/api/v1/travtrack/zones/${id}`).set("Cookie", cookie)).status
    ).toBe(204);
  });

  it("refuses a bad circle", async () => {
    expect((await createZone({ name: "x", ...HOME, radiusM: 10 })).status).toBe(400);
    expect((await createZone({ name: "", ...HOME, radiusM: 100 })).status).toBe(400);
    expect((await createZone({ name: "x", lat: 91, lon: 0, radiusM: 100 })).status).toBe(400);
  });

  it("with TravTrack off, an account holding data lists and deletes a zone but cannot add one", async () => {
    const created = await createZone({ name: "Zuhause", ...HOME, radiusM: 250 });
    await switches.set({ beta: true, config: false });

    const listed = await request(app).get("/api/v1/travtrack/zones").set("Cookie", cookie);
    expect(listed.status).toBe(200);
    expect(listed.body.zones).toHaveLength(1);

    const added = await createZone({ name: "Arbeit", ...AT_2KM, radiusM: 100 });
    expect(added.status).toBe(403);
    expect(added.body.code).toBe("TRAVTRACK_DISABLED");
    const moved = await request(app)
      .patch(`/api/v1/travtrack/zones/${created.body.zone.id}`)
      .set("Cookie", cookie)
      .send({ radiusM: 500 });
    expect(moved.status).toBe(403);

    const removed = await request(app)
      .delete(`/api/v1/travtrack/zones/${created.body.zone.id}`)
      .set("Cookie", cookie);
    expect(removed.status).toBe(204);
    expect(await prisma.travTrackPrivacyZone.count({ where: { userId } })).toBe(0);
  });
});
