import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { distanceM } from "../../services/travtrack/classify";
import { deleteTravTrackRange } from "../../services/travtrack/deleteRange";
import { segmentCrossesZone, type LonLat } from "../../services/travtrack/privacyCut";
import { createZone } from "../../services/travtrack/zones";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  makeFlight,
  makeTrip,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../services/travtrack/__tests__/fixtures";

/**
 * A shared trip carries only a route snapshot (TravTrack plan T7, review
 * focus 9 and 15): built when the owner asks, geometry only, nothing near
 * home, nothing inside a zone, nothing outside the trip — and re-filtered in
 * the same transaction by every range delete and every zone change.
 */

const PREFIX = "travtrack-share-snapshot-";
const MIN = 60_000;
// The Seoul fixture trip runs 11–14 Oct on Asia/Seoul: 10 Oct 15:00Z to 14 Oct 15:00Z.
const T0 = Date.parse("2026-10-12T03:00:00Z");
const HOME = { lat: 37.5, lon: 127.0 };

type Geometry = LonLat[][];

const vertices = (g: Geometry) => g.flat();
const near = (g: Geometry, c: { lat: number; lon: number }, m: number) =>
  vertices(g).some((p) => distanceM({ lon: p[0], lat: p[1] }, c) <= m);
const crosses = (g: Geometry, circle: { lat: number; lon: number; radiusM: number }) =>
  g.some((line) => line.some((p, k) => k > 0 && segmentCrossesZone(line[k - 1], p, circle)));

describe("TravTrack — a shared trip's route snapshot", () => {
  const switches = travTrackSwitches();
  let owner: string;
  let recipient: string;
  let stranger: string;
  let ownerCookie: string;
  let recipientCookie: string;
  let tripId: string;
  let copyId: string;

  const as = (cookie: string) => ({
    put: (path: string) => request(app).put(path).set("Cookie", cookie),
    get: (path: string) => request(app).get(path).set("Cookie", cookie),
    del: (path: string) => request(app).delete(path).set("Cookie", cookie),
    patch: (path: string) => request(app).patch(path).set("Cookie", cookie),
  });

  /** A straight walk east along 37.5° N, one fix a minute, through home at 127.0° E. */
  const walk = async (fromLon = 126.95, toLon = 127.06, startMs = T0) => {
    const steps = Math.round((toLon - fromLon) / 0.002);
    for (let i = 0; i <= steps; i++) {
      await storePoint(owner, { t: startMs + i * MIN, lat: 37.5, lon: fromLon + i * 0.002 });
    }
  };

  const share = async () => {
    const res = await as(ownerCookie).put(`/api/v1/trips/${tripId}/share-snapshot`);
    expect(res.status).toBe(200);
    return res.body.snapshot as { version: number; geometry: Geometry; pointCount: number };
  };

  const stored = async () =>
    prisma.travTrackShareSnapshot.findUnique({
      where: { tripId },
      select: { version: true, geometry: true },
    });

  beforeAll(async () => {
    owner = await makeUser(`${PREFIX}owner`);
    recipient = await makeUser(`${PREFIX}recipient`);
    stranger = await makeUser(`${PREFIX}stranger`);
    ownerCookie = `auth_token=${generateToken(owner)}`;
    recipientCookie = `auth_token=${generateToken(recipient)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([owner, recipient, stranger]);
    await prisma.trip.deleteMany({ where: { userId: { in: [owner, recipient, stranger] } } });
    await prisma.shareConsent.deleteMany({
      where: { OR: [{ requesterId: owner }, { targetId: owner }] },
    });
    await prisma.userSettings.deleteMany({ where: { userId: owner } });
    // Without the `zone` the settings form writes: the route keeps away from it all the same.
    await prisma.userSettings.create({
      data: { userId: owner, data: {}, homePlace: { name: "Zuhause", ...HOME } },
    });
    tripId = await makeTrip(owner);
    copyId = await makeTrip(recipient);
    const group = await prisma.tripShareGroup.create({ data: { createdById: owner } });
    await prisma.trip.updateMany({
      where: { id: { in: [tripId, copyId] } },
      data: { shareGroupId: group.id },
    });
    await prisma.shareConsent.create({
      data: { requesterId: owner, targetId: recipient, status: "accepted" },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("no snapshot exists until the owner shares the route", async () => {
    await walk();
    const own = await as(ownerCookie).get(`/api/v1/trips/${tripId}/share-snapshot`);
    expect(own.body).toEqual({ snapshot: null });
    const read = await as(recipientCookie).get(`/api/v1/trips/${copyId}/shared-route`);
    expect(read.status).toBe(404);
    expect(read.body.code).toBe("SHARED_ROUTE_NOT_FOUND");
    expect(await prisma.travTrackShareSnapshot.count({ where: { userId: owner } })).toBe(0);
  });

  it("a snapshot holds geometry only, nothing near home, nothing inside a zone, nothing outside the trip", async () => {
    await walk();
    // A fix two days after the trip, far away.
    await storePoint(owner, { t: Date.parse("2026-10-17T03:00:00Z"), lat: 35.1, lon: 129.0 });
    const zone = { lat: 37.5, lon: 126.96, radiusM: 300 };
    await prisma.travTrackPrivacyZone.create({ data: { userId: owner, name: "Büro", ...zone } });
    const snapshot = await share();
    expect(Object.keys(snapshot).sort()).toEqual([
      "createdAt",
      "geometry",
      "pointCount",
      "version",
    ]);
    expect(snapshot.pointCount).toBe(vertices(snapshot.geometry).length);
    const text = JSON.stringify(snapshot.geometry);
    expect(text).not.toMatch(/2026-10/);
    expect(near(snapshot.geometry, HOME, 1000)).toBe(false);
    expect(crosses(snapshot.geometry, { ...HOME, radiusM: 1000 })).toBe(false);
    expect(near(snapshot.geometry, zone, zone.radiusM)).toBe(false);
    expect(text).not.toContain("129");
    // Something on either side of home is still shared.
    expect(vertices(snapshot.geometry).some((p) => p[0] < 126.99)).toBe(true);
    expect(vertices(snapshot.geometry).some((p) => p[0] > 127.02)).toBe(true);
  });

  it("refuses a route of which nothing may be shown", async () => {
    // Every fix within a kilometre of home.
    await walk(126.995, 127.005);
    const res = await as(ownerCookie).put(`/api/v1/trips/${tripId}/share-snapshot`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TRAVTRACK_ROUTE_EMPTY");
  });

  it("a rebuild raises the version", async () => {
    await walk();
    expect((await share()).version).toBe(1);
    expect((await share()).version).toBe(2);
  });

  it("a recipient reads the snapshot, never the points; a stranger reads nothing", async () => {
    await walk();
    const snapshot = await share();
    const read = await as(recipientCookie).get(`/api/v1/trips/${copyId}/shared-route`);
    expect(read.status).toBe(200);
    expect(read.body).toEqual({ routes: [{ version: 1, geometry: snapshot.geometry }] });
    // The owner's own endpoints answer the recipient with nothing of the owner's.
    const own = await as(recipientCookie).get(`/api/v1/trips/${tripId}/share-snapshot`);
    expect(own.body).toEqual({ snapshot: null });
    const points = await as(recipientCookie)
      .get("/api/v1/travtrack/points")
      .query({
        from: new Date(T0 - 3_600_000).toISOString(),
        to: new Date(T0 + 86_400_000).toISOString(),
      });
    expect(points.body.points).toEqual([]);
    // Without an accepted consent the route does not reach a member.
    await prisma.shareConsent.updateMany({
      where: { requesterId: owner, targetId: recipient },
      data: { status: "withdrawn" },
    });
    const after = await as(recipientCookie).get(`/api/v1/trips/${copyId}/shared-route`);
    expect(after.status).toBe(404);
    const strangerTrip = await makeTrip(stranger);
    const foreign = await request(app)
      .get(`/api/v1/trips/${strangerTrip}/shared-route`)
      .set("Cookie", `auth_token=${generateToken(stranger)}`);
    expect(foreign.status).toBe(404);
  });

  it("revoking removes it for every recipient", async () => {
    await walk();
    await share();
    const res = await as(ownerCookie).del(`/api/v1/trips/${tripId}/share-snapshot`);
    expect(res.status).toBe(204);
    expect(await stored()).toBeNull();
    const read = await as(recipientCookie).get(`/api/v1/trips/${copyId}/shared-route`);
    expect(read.status).toBe(404);
  });

  it("revoking works with TravTrack switched off", async () => {
    await walk();
    await share();
    await switches.set({ beta: true, config: false });
    const res = await as(ownerCookie).del(`/api/v1/trips/${tripId}/share-snapshot`);
    expect(res.status).toBe(204);
    expect(await stored()).toBeNull();
  });

  it("deleting a range over the trip rebuilds the snapshot without it, and removes it when nothing is left", async () => {
    await walk();
    const before = await share();
    expect(vertices(before.geometry).some((p) => p[0] < 126.97)).toBe(true);
    // The first ten minutes: the stretch west of 126.97.
    await deleteTravTrackRange(owner, new Date(T0), new Date(T0 + 10 * MIN));
    const after = await stored();
    expect(after?.version).toBe(2);
    const geometry = after?.geometry as Geometry;
    expect(vertices(geometry).some((p) => p[0] < 126.969)).toBe(false);
    await deleteTravTrackRange(owner, new Date(T0 - 86_400_000), new Date(T0 + 86_400_000));
    expect(await stored()).toBeNull();
  });

  it("a range delete outside the trip leaves the snapshot as it was", async () => {
    await walk();
    await share();
    await deleteTravTrackRange(
      owner,
      new Date("2026-11-01T00:00:00Z"),
      new Date("2026-11-02T00:00:00Z")
    );
    expect((await stored())?.version).toBe(1);
  });

  it("a new zone over a shared route rebuilds the snapshot without that part", async () => {
    await walk();
    await share();
    const zone = { lat: 37.5, lon: 127.04, radiusM: 400 };
    await createZone(owner, { name: "Freunde", ...zone }, true);
    const after = await stored();
    expect(after?.version).toBe(2);
    expect(near(after?.geometry as Geometry, zone, zone.radiusM)).toBe(false);
    expect(crosses(after?.geometry as Geometry, zone)).toBe(false);
  });

  it("a zone that holds no stored point but lies under a chord of the snapshot still breaks it", async () => {
    // Two fixes 2 km apart, a minute apart: one chord, no point between them.
    await storePoint(owner, { t: T0, lat: 37.6, lon: 127.1 });
    await storePoint(owner, { t: T0 + MIN, lat: 37.6, lon: 127.122 });
    await storePoint(owner, { t: T0 + 2 * MIN, lat: 37.6, lon: 127.124 });
    await share();
    const zone = { lat: 37.6, lon: 127.111, radiusM: 100 };
    const result = await createZone(owner, { name: "Unterwegs", ...zone }, false);
    expect(result.deleted).toBe(0);
    const after = await stored();
    // What is left is the short stretch beyond the zone, or nothing at all.
    if (after) {
      expect(crosses(after.geometry as Geometry, zone)).toBe(false);
      expect(after.version).toBe(2);
    }
  });

  it("simplification never leaves a chord across a zone", async () => {
    // A tight arc around a 5 m circle: every raw chord passes outside it, the
    // simplified chord across the arc would pass through it.
    const centre = { lat: 37.55, lon: 127.05 };
    await prisma.travTrackPrivacyZone.create({
      data: { userId: owner, name: "Klein", ...centre, radiusM: 5 },
    });
    const r = 8 / 111_320;
    for (let i = 0; i <= 12; i++) {
      const a = Math.PI * (i / 12);
      await storePoint(owner, {
        t: T0 + i * MIN,
        lat: centre.lat + r * Math.sin(a),
        lon: centre.lon + (r * Math.cos(a)) / Math.cos((centre.lat * Math.PI) / 180),
      });
    }
    const res = await as(ownerCookie).put(`/api/v1/trips/${tripId}/share-snapshot`);
    if (res.status === 200) {
      expect(crosses(res.body.snapshot.geometry, { ...centre, radiusM: 5 })).toBe(false);
    } else {
      expect(res.body.code).toBe("TRAVTRACK_ROUTE_EMPTY");
    }
  });

  const recipientRead = async (): Promise<Geometry | null> => {
    const res = await as(recipientCookie).get(`/api/v1/trips/${copyId}/shared-route`);
    if (res.status === 404) return null;
    expect(res.status).toBe(200);
    return (res.body.routes as Array<{ geometry: Geometry }>).flatMap((r) => r.geometry);
  };

  it("a moved home re-filters the stored copy and the recipient's read", async () => {
    await walk();
    await share();
    const moved = { lat: 37.5, lon: 127.04 };
    const res = await as(ownerCookie)
      .put("/api/v1/settings/personal")
      .send({ homePlace: { name: "Neu", ...moved, zone: null } });
    expect(res.status).toBe(200);
    const after = await stored();
    expect(after?.version).toBe(2);
    expect(near(after?.geometry as Geometry, moved, 1000)).toBe(false);
    expect(crosses(after?.geometry as Geometry, { ...moved, radiusM: 1000 })).toBe(false);
    const read = (await recipientRead()) ?? [];
    expect(near(read, moved, 1000)).toBe(false);
    expect(crosses(read, { ...moved, radiusM: 1000 })).toBe(false);
  });

  it("a moved home keeps the former home hidden as well", async () => {
    // Security review: a rebuild with only the new home would uncover the old one.
    await walk();
    await share();
    const moved = { lat: 37.5, lon: 127.04 };
    await as(ownerCookie)
      .put("/api/v1/settings/personal")
      .send({ homePlace: { name: "Neu", ...moved, zone: null } })
      .expect(200);
    const read = (await recipientRead()) ?? [];
    const storedGeometry = (await stored())?.geometry as Geometry;
    for (const g of [read, storedGeometry]) {
      for (const home of [HOME, moved]) {
        expect(near(g, home, 1000)).toBe(false);
        expect(crosses(g, { ...home, radiusM: 1000 })).toBe(false);
      }
    }
  });

  it("widened trip dates do not extend the shared route until the owner shares again", async () => {
    await walk();
    // Two days after the trip's last day, recorded before the route was shared.
    const later = Date.parse("2026-10-16T03:00:00Z");
    await storePoint(owner, { t: later, lat: 37.7, lon: 127.2 });
    await storePoint(owner, { t: later + MIN, lat: 37.701, lon: 127.2 });
    await share();
    const north = (g: Geometry) => vertices(g).some((p) => p[1] > 37.65);
    await as(ownerCookie)
      .patch(`/api/v1/trips/${tripId}`)
      .send({ startDate: "2026-10-11", endDate: "2026-10-17" })
      .expect(200);
    expect(north((await recipientRead()) ?? [])).toBe(false);
    expect(north((await stored())?.geometry as Geometry)).toBe(false);
    await share();
    expect(north((await recipientRead()) ?? [])).toBe(true);
  });

  it("the recipient's read applies the current home even where the stored copy missed it", async () => {
    await walk();
    await share();
    const moved = { lat: 37.5, lon: 127.04 };
    // Written past every hook: only the read-time rebuild stands between.
    await prisma.userSettings.update({
      where: { userId: owner },
      data: { homePlace: { name: "Neu", ...moved } },
    });
    // The stored line still runs through the new home's circle.
    expect(crosses((await stored())?.geometry as Geometry, { ...moved, radiusM: 1000 })).toBe(true);
    const read = await recipientRead();
    expect(read).not.toBeNull();
    expect(near(read ?? [], moved, 1000)).toBe(false);
    expect(crosses(read ?? [], { ...moved, radiusM: 1000 })).toBe(false);
  });

  it("a flight added to the trip later hides its hours from the recipient", async () => {
    // 01:30Z onwards; the fixture flight's recorder window runs to 02:00Z.
    await walk(126.95, 127.06, Date.parse("2026-10-12T01:30:00Z"));
    await share();
    const west = (g: Geometry) => vertices(g).some((p) => p[0] < 126.985);
    expect(west((await recipientRead()) ?? [])).toBe(true);
    const flightId = await makeFlight(owner);
    await prisma.flight.update({ where: { id: flightId }, data: { tripId } });
    expect(west((await recipientRead()) ?? [])).toBe(false);
  });

  it("a recording made after sharing reaches the recipient only once the owner rebuilds", async () => {
    await walk();
    await share();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await storePoint(owner, { t: T0 + 600 * MIN, lat: 37.65, lon: 127.2 });
    await storePoint(owner, { t: T0 + 601 * MIN, lat: 37.651, lon: 127.2 });
    const north = (g: Geometry) => vertices(g).some((p) => p[1] > 37.6);
    expect(north((await recipientRead()) ?? [])).toBe(false);
    // A re-filter the owner did not ask for takes nothing new in either.
    await deleteTravTrackRange(owner, new Date(T0), new Date(T0 + MIN));
    expect(north((await stored())?.geometry as Geometry)).toBe(false);
    await share();
    expect(north((await recipientRead()) ?? [])).toBe(true);
  });

  it("moving the trip's dates away from the route removes the shared copy", async () => {
    await walk();
    await share();
    const res = await as(ownerCookie)
      .patch(`/api/v1/trips/${tripId}`)
      .send({ startDate: "2026-11-01", endDate: "2026-11-03" });
    expect(res.status).toBe(200);
    expect(await stored()).toBeNull();
    expect(await recipientRead()).toBeNull();
  });

  it("building needs TravTrack on", async () => {
    await walk();
    await switches.set({ beta: true, config: false });
    const res = await as(ownerCookie).put(`/api/v1/trips/${tripId}/share-snapshot`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
  });
});
