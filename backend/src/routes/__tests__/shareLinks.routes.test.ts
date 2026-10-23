import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import { prisma } from "../../db";
import { setClockForTests } from "../../shared/time/clock";
import { afterDatabaseRestore } from "../../services/backup/backupRestore";
import { updateInstanceSettings } from "../../services/instanceSettingsService";
import { shareTokenHash } from "../../services/shareLinks/token";
import { SHARE_LINK_FIELDS, SHARE_LINK_MAX_ACTIVE } from "../../schemas/shareLinks";
import adminRoutes from "../admin";
import settingsRoutes from "../settings";
import {
  addTripPhoto,
  makeAccount,
  makeFlight,
  makeItineraryTrip,
  makeTrip,
  NEVER_ON_ITINERARY,
  NEVER_PUBLIC,
  shareLinkApp,
  wipeShareLinkAccounts,
  type TestAccount,
} from "./shareLinkFixtures";

/**
 * Public share links (forgejo#281, design 2026-10-10-share-links-design.md).
 *
 * ONE file for everything that needs the instance switch: it is a single
 * admin_settings row, and two suites flipping it in parallel would make each
 * other flaky. Unit-level guards (token, metadata stripper, page, limiter,
 * log redaction) live in their own files and never touch it.
 */

const app = shareLinkApp();
const settingsApp = shareLinkApp((a) => {
  a.use("/api/v1/settings", settingsRoutes);
  a.use("/api/v1/admin", adminRoutes);
});
const NOW = "2030-06-01T10:00:00.000Z";
const IN_A_WEEK = "2030-06-08T10:00:00.000Z";

let previousSwitch = false;
let addressCounter = 1;
/** A fresh client address per public call, so the per-IP limiter never decides a test. */
const nextAddress = () => `198.51.100.${(addressCounter++ % 250) + 1}`;

const setSwitch = async (on: boolean) => {
  const row = await prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
  await prisma.adminSettings.update({ where: { id: row.id }, data: { shareLinksEnabled: on } });
};

const view = (token: unknown) =>
  request(app)
    .post("/api/v1/public/share-links/view")
    .set("X-Forwarded-For", nextAddress())
    .send({ token });
const photo = (token: unknown, index: number) =>
  request(app)
    .post("/api/v1/public/share-links/photo")
    .set("X-Forwarded-For", nextAddress())
    .send({ token, index });

async function create(
  owner: TestAccount,
  body: { kind: string; targetId: string; fields: string[]; expiresAt?: string }
) {
  return request(app)
    .post("/api/v1/share-links")
    .set("Cookie", owner.cookie)
    .send({ expiresAt: IN_A_WEEK, ...body });
}

async function tokenFor(
  owner: TestAccount,
  body: { kind: string; targetId: string; fields: string[]; expiresAt?: string }
): Promise<{ token: string; id: string }> {
  const res = await create(owner, body);
  expect(res.status).toBe(201);
  return { token: res.body.data.token, id: res.body.data.id };
}

let anna: TestAccount;
let eve: TestAccount;

beforeAll(async () => {
  await updateInstanceSettings({}); // the row exists
  const row = await prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
  previousSwitch = row.shareLinksEnabled;
});

beforeEach(async () => {
  setClockForTests(NOW);
  await wipeShareLinkAccounts();
  await setSwitch(true);
  anna = await makeAccount("Anna");
  eve = await makeAccount("Eve");
});

afterEach(() => setClockForTests(null));

afterAll(async () => {
  await wipeShareLinkAccounts();
  await setSwitch(previousSwitch);
  await prisma.$disconnect();
});

describe("owner side", () => {
  it("refuses to create while the instance switch is off, and says so in the list", async () => {
    await setSwitch(false);
    const flight = await makeFlight(anna.id);
    const res = await create(anna, { kind: "flight", targetId: flight.id, fields: ["progress"] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SHARE_LINKS_DISABLED");
    const list = await request(app).get("/api/v1/share-links").set("Cookie", anna.cookie);
    expect(list.body.data).toEqual({ enabled: false, links: [] });
  });

  it("needs a session", async () => {
    await request(app).get("/api/v1/share-links").expect(401);
  });

  it("hands out a fragment URL once and stores only the token's hash", async () => {
    const flight = await makeFlight(anna.id);
    const res = await create(anna, { kind: "flight", targetId: flight.id, fields: ["progress"] });
    expect(res.status).toBe(201);
    const { url, token } = res.body.data;
    expect(token).toMatch(/^ts_share_[A-Za-z0-9_-]{43}$/);
    expect(url).toMatch(/\/share#ts_share_[A-Za-z0-9_-]{43}$/);
    expect(url.endsWith(`#${token}`)).toBe(true);

    const row = await prisma.publicShareLink.findFirstOrThrow({ where: { userId: anna.id } });
    expect(row.tokenHash).toBe(shareTokenHash(token));
    expect(JSON.stringify(row)).not.toContain(token);

    const list = await request(app).get("/api/v1/share-links").set("Cookie", anna.cookie);
    expect(list.body.data.enabled).toBe(true);
    expect(list.body.data.links).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(token);
    expect(JSON.stringify(list.body)).not.toContain(row.tokenHash);
    // A flight link ends two hours after the arrival, before the chosen week.
    expect(list.body.data.links[0].effectiveExpiresAt).toBe("2030-06-01T22:00:00.000Z");
  });

  it("refuses a field outside the kind's allow-list", async () => {
    const flight = await makeFlight(anna.id);
    for (const fields of [["photos"], ["seatNumber"], ["bookingReference"], []]) {
      const res = await create(anna, { kind: "flight", targetId: flight.id, fields });
      expect(res.status).toBe(400);
    }
    expect(await prisma.publicShareLink.count({ where: { userId: anna.id } })).toBe(0);
  });

  it("answers another account's target and link like missing ones", async () => {
    const flight = await makeFlight(anna.id);
    const theirs = await create(eve, { kind: "flight", targetId: flight.id, fields: ["progress"] });
    expect(theirs.status).toBe(404);
    expect(theirs.body.code).toBe("SHARE_LINK_NOT_FOUND");

    const { token, id } = await tokenFor(anna, {
      kind: "flight",
      targetId: flight.id,
      fields: ["progress"],
    });
    await request(app).delete(`/api/v1/share-links/${id}`).set("Cookie", eve.cookie).expect(404);
    expect((await view(token)).status).toBe(200);
  });

  it("refuses an expiry in the past or beyond 90 days", async () => {
    const flight = await makeFlight(anna.id);
    for (const expiresAt of ["2030-06-01T09:00:00Z", "2030-09-01T10:00:00Z"]) {
      const res = await create(anna, {
        kind: "flight",
        targetId: flight.id,
        fields: ["progress"],
        expiresAt,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SHARE_LINK_EXPIRY_INVALID");
    }
  });

  it("uses server time for a 90-day lifetime and caps a next-week flight at arrival plus two hours", async () => {
    const flight = await makeFlight(anna.id);
    // Move the server clock back a week: the fixture is now next week's flight.
    setClockForTests("2030-05-25T10:00:00.000Z");
    // The previous UI used the browser clock. Five minutes ahead crosses the server cap.
    const skewedExpiry = new Date(
      Date.parse("2030-05-25T10:05:00.000Z") + 90 * 86400000
    ).toISOString();
    const skewed = await create(anna, {
      kind: "flight",
      targetId: flight.id,
      fields: ["route"],
      expiresAt: skewedExpiry,
    });
    expect(skewed.status).toBe(400);
    expect(skewed.body.code).toBe("SHARE_LINK_EXPIRY_INVALID");
    const res = await request(app)
      .post("/api/v1/share-links")
      .set("Cookie", anna.cookie)
      .send({ kind: "flight", targetId: flight.id, fields: ["route"], expiresInDays: 90 });
    expect(res.status).toBe(201);
    expect(res.body.data.expiresAt).toBe(
      new Date(Date.parse("2030-05-25T10:00:00.000Z") + 90 * 86400000).toISOString()
    );
    expect(res.body.data.effectiveExpiresAt).toBe("2030-06-01T22:00:00.000Z");
    const row = await prisma.publicShareLink.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.expiresAt.toISOString()).toBe(res.body.data.expiresAt);
  });

  it("rejects missing, conflicting and out-of-range lifetimes", async () => {
    const flight = await makeFlight(anna.id);
    for (const expiry of [
      {},
      { expiresInDays: 0 },
      { expiresInDays: 91 },
      { expiresInDays: 1.5 },
      { expiresInDays: 7, expiresAt: IN_A_WEEK },
    ]) {
      const res = await request(app)
        .post("/api/v1/share-links")
        .set("Cookie", anna.cookie)
        .send({ kind: "flight", targetId: flight.id, fields: ["route"], ...expiry });
      expect(res.status).toBe(400);
    }
  });

  it("refuses a flight that has already landed", async () => {
    const flight = await makeFlight(anna.id);
    setClockForTests("2030-06-01T23:00:00Z");
    const res = await create(anna, { kind: "flight", targetId: flight.id, fields: ["progress"] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SHARE_LINK_FLIGHT_LANDED");
  });

  it(`stops at ${SHARE_LINK_MAX_ACTIVE} live links`, async () => {
    await prisma.publicShareLink.createMany({
      data: Array.from({ length: SHARE_LINK_MAX_ACTIVE }, (_, i) => ({
        userId: anna.id,
        kind: "wrapped",
        year: 2000 + i,
        fields: ["totals"],
        tokenHash: `limit-test-${anna.id}-${i}`,
        expiresAt: new Date(IN_A_WEEK),
        effectiveExpiresAt: new Date(IN_A_WEEK),
      })),
    });
    const trip = await makeTrip(anna.id);
    const res = await create(anna, { kind: "trip", targetId: trip.id, fields: ["name"] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SHARE_LINK_LIMIT");
  });

  it("does not let the shared demo account mint public links", async () => {
    const demo = await makeAccount("Demo", { isDemo: true, username: "demo" });
    const trip = await makeTrip(demo.id);
    const res = await create(demo, { kind: "trip", targetId: trip.id, fields: ["name"] });
    expect(res.status).toBe(403);
  });

  it("previews exactly what the public then sees", async () => {
    const trip = await makeTrip(anna.id);
    await makeFlight(anna.id, trip.id);
    const fields = ["name", "dates", "totals", "route", "countries"];
    const preview = await request(app)
      .post("/api/v1/share-links/preview")
      .set("Cookie", anna.cookie)
      .send({ kind: "trip", targetId: trip.id, fields })
      .expect(200);
    const { token } = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields });
    const pub = await view(token).expect(200);
    expect(pub.body.data.view).toEqual(preview.body.data.view);
  });

  it("revokes at once", async () => {
    const trip = await makeTrip(anna.id);
    const { token, id } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["name"],
    });
    expect((await view(token)).status).toBe(200);
    await request(app).delete(`/api/v1/share-links/${id}`).set("Cookie", anna.cookie).expect(200);
    expect((await view(token)).status).toBe(404);
  });
});

describe("the instance switch", () => {
  it("is read by every user from GET /settings and written by an admin only", async () => {
    await setSwitch(false);
    const read = await request(settingsApp).get("/api/v1/settings").set("Cookie", anna.cookie);
    expect(read.status).toBe(200);
    expect(read.body.shareLinksEnabled).toBe(false);

    await request(settingsApp)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", anna.cookie)
      .send({ shareLinksEnabled: true })
      .expect(403);

    await prisma.user.update({ where: { id: eve.id }, data: { isAdmin: true } });
    const put = await request(settingsApp)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", eve.cookie)
      .send({ shareLinksEnabled: true })
      .expect(200);
    expect(put.body.settings.shareLinksEnabled).toBe(true);
    const again = await request(settingsApp).get("/api/v1/settings").set("Cookie", anna.cookie);
    expect(again.body.shareLinksEnabled).toBe(true);
  });
});

describe("public side — one answer for every failure", () => {
  it("answers malformed, unknown, revoked, expired, switched-off and orphaned links identically", async () => {
    const flight = await makeFlight(anna.id);
    const trip = await makeTrip(anna.id);
    const live = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["name"] });
    const reference = await view("ts_share_" + "A".repeat(43));
    expect(reference.status).toBe(404);
    expect(reference.body).toEqual({ error: "Not found", code: "SHARE_LINK_NOT_FOUND" });

    const cases: Array<[string, () => Promise<request.Response>]> = [
      ["no body", () => request(app).post("/api/v1/public/share-links/view").send()],
      ["a number", () => view(42)],
      ["garbage", () => view("../../etc/passwd")],
      ["too long", () => view("ts_share_" + "A".repeat(500))],
      ["a hash instead of the token", async () => view(shareTokenHash(live.token))],
    ];
    for (const [, call] of cases) {
      const res = await call();
      expect(res.status).toBe(404);
      expect(res.body).toEqual(reference.body);
    }

    // Expired: past the owner's own date.
    const expiring = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["name"],
      expiresAt: "2030-06-01T11:00:00Z",
    });
    setClockForTests("2030-06-01T11:00:01Z");
    expect((await view(expiring.token)).body).toEqual(reference.body);
    setClockForTests(NOW);

    // Orphaned: the flight deleted takes its link with it.
    const flightLink = await tokenFor(anna, {
      kind: "flight",
      targetId: flight.id,
      fields: ["progress"],
    });
    await prisma.flight.delete({ where: { id: flight.id } });
    expect((await view(flightLink.token)).body).toEqual(reference.body);

    // An owner switched inactive.
    await prisma.user.update({ where: { id: anna.id }, data: { isActive: false } });
    expect((await view(live.token)).body).toEqual(reference.body);
    await prisma.user.update({ where: { id: anna.id }, data: { isActive: true } });
    expect((await view(live.token)).status).toBe(200);

    // The instance switch off (set directly: the row survives, the answer does not).
    await setSwitch(false);
    expect((await view(live.token)).body).toEqual(reference.body);
  });

  it("sends no-store, noindex and no-referrer on answers and refusals alike", async () => {
    const trip = await makeTrip(anna.id);
    const { token } = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["name"] });
    for (const res of [await view(token), await view("nope")]) {
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
    }
  });

  it("counts views for the owner, and records nothing about the viewer", async () => {
    const trip = await makeTrip(anna.id);
    const { token } = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["name"] });
    await view(token).expect(200);
    await view(token).expect(200);
    const list = await request(app).get("/api/v1/share-links").set("Cookie", anna.cookie);
    expect(list.body.data.links[0]).toMatchObject({ viewCount: 2, lastViewedAt: NOW });
  });

  it("switching the instance off deletes every link; on again brings none back", async () => {
    const trip = await makeTrip(anna.id);
    const { token } = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["name"] });
    await updateInstanceSettings({ shareLinksEnabled: false });
    expect(await prisma.publicShareLink.count()).toBe(0);
    await updateInstanceSettings({ shareLinksEnabled: true });
    expect((await view(token)).status).toBe(404);
  });

  it("a restored backup starts with no links", async () => {
    const trip = await makeTrip(anna.id);
    const { token } = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["name"] });
    await afterDatabaseRestore(null, "share-link test");
    expect(await prisma.publicShareLink.count()).toBe(0);
    expect((await view(token)).status).toBe(404);
  });

  it("goes with the account and with the trip", async () => {
    const trip = await makeTrip(anna.id);
    await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["name"] });
    await prisma.trip.delete({ where: { id: trip.id } });
    expect(await prisma.publicShareLink.count({ where: { userId: anna.id } })).toBe(0);

    const other = await makeTrip(anna.id);
    await tokenFor(anna, { kind: "trip", targetId: other.id, fields: ["name"] });
    await prisma.user.delete({ where: { id: anna.id } });
    expect(await prisma.publicShareLink.count({ where: { userId: anna.id } })).toBe(0);
  });
});

describe("flight links", () => {
  it("a landed flight's link leaves the active count, and the count and the list agree", async () => {
    await prisma.publicShareLink.createMany({
      data: Array.from({ length: SHARE_LINK_MAX_ACTIVE - 1 }, (_, i) => ({
        userId: anna.id,
        kind: "wrapped",
        year: 2000 + i,
        fields: ["totals"],
        tokenHash: `landed-test-${anna.id}-${i}`,
        expiresAt: new Date("2030-06-20T10:00:00Z"),
        effectiveExpiresAt: new Date("2030-06-20T10:00:00Z"),
      })),
    });
    const flight = await makeFlight(anna.id);
    await tokenFor(anna, { kind: "flight", targetId: flight.id, fields: ["progress"] });

    setClockForTests("2030-06-02T10:00:00Z");
    const list = await request(app).get("/api/v1/share-links").set("Cookie", anna.cookie);
    expect(list.body.data.links).toHaveLength(SHARE_LINK_MAX_ACTIVE - 1);
    const trip = await makeTrip(anna.id);
    expect((await create(anna, { kind: "trip", targetId: trip.id, fields: ["name"] })).status).toBe(
      201
    );
  });

  it("an ended flight link never comes back when the flight is moved later", async () => {
    const flight = await makeFlight(anna.id);
    const { token } = await tokenFor(anna, {
      kind: "flight",
      targetId: flight.id,
      fields: ["progress"],
    });
    setClockForTests("2030-06-02T10:00:00Z");
    await prisma.flight.update({
      where: { id: flight.id },
      data: {
        departureTime: new Date("2030-06-05T12:00:00Z"),
        arrivalTime: new Date("2030-06-05T20:00:00Z"),
      },
    });
    expect((await view(token)).status).toBe(404);
  });

  it("shows the phase and ETA from the schedule and ends two hours after landing", async () => {
    const flight = await makeFlight(anna.id);
    const { token } = await tokenFor(anna, {
      kind: "flight",
      targetId: flight.id,
      fields: ["progress"],
    });
    expect((await view(token)).body.data.view.flight.progress).toMatchObject({
      phase: "scheduled",
      basis: "schedule",
    });

    setClockForTests("2030-06-01T16:00:00Z");
    const mid = (await view(token)).body.data.view.flight.progress;
    expect(mid.phase).toBe("inFlight");
    expect(mid.fraction).toBeCloseTo(0.5, 2);
    // 20:00Z is 16:00 on the arrival airport's clock (EDT).
    expect(mid.eta).toMatchObject({ zone: "America/New_York", local: "2030-06-01T16:00:00" });

    setClockForTests("2030-06-01T21:00:00Z");
    expect((await view(token)).body.data.view.flight.progress.phase).toBe("landed");

    setClockForTests("2030-06-01T22:00:01Z");
    expect((await view(token)).status).toBe(404);
  });

  it("shows a position only when chosen, and only one the phone actually sent", async () => {
    const flight = await makeFlight(anna.id);
    const withPosition = await tokenFor(anna, {
      kind: "flight",
      targetId: flight.id,
      fields: ["lastPosition"],
    });
    const without = await tokenFor(anna, {
      kind: "flight",
      targetId: flight.id,
      fields: ["progress"],
    });
    expect((await view(withPosition.token)).body.data.view.flight).toEqual({ lastPosition: null });

    await prisma.flightTrack.create({
      data: {
        flightId: flight.id,
        source: "companion",
        uploadId: "sharelink-test-upload",
        startedAt: new Date("2030-06-01T12:05:00Z"),
        endedAt: new Date("2030-06-01T13:30:00Z"),
        geometry: [
          [8.56, 50.03],
          [-20.5, 55.25],
        ],
        segmentStarts: [0],
        cumulativeKm: [0, 2000],
        pointCount: 2,
        distanceKm: 2000,
      },
    });
    expect((await view(withPosition.token)).body.data.view.flight.lastPosition).toEqual({
      lat: 55.25,
      lon: -20.5,
      recordedAt: "2030-06-01T13:30:00.000Z",
    });
    const plain = (await view(without.token)).body.data.view.flight;
    expect(plain).not.toHaveProperty("lastPosition");
    expect(JSON.stringify(plain)).not.toContain("55.25");
  });
});

describe("the field allow-list decides the payload", () => {
  async function wrappedYear(ownerId: string) {
    await prisma.flight.create({
      data: {
        userId: ownerId,
        airline: "Lufthansa",
        flightNumber: "LH401",
        depIata: "FRA",
        depLat: 50.0379,
        depLon: 8.5622,
        arrIata: "JFK",
        arrLat: 40.6413,
        arrLon: -73.7781,
        departureTime: new Date("2029-05-01T10:00:00Z"),
        arrivalTime: new Date("2029-05-01T18:00:00Z"),
        status: "flown",
        seatNumber: "SEAT-14C",
        bookingReference: "PNR-XYZ123",
        price: 987.65,
        notes: "PRIVATE flight note",
      },
    });
  }

  const targets = async (owner: TestAccount) => {
    const trip = await makeTrip(owner.id);
    const flight = await makeFlight(owner.id, trip.id);
    await addTripPhoto(trip.id, 0);
    await wrappedYear(owner.id);
    return { flight: flight.id, trip: trip.id, wrapped: "2029" } as const;
  };

  it.each(["flight", "trip", "wrapped"] as const)(
    "a %s link carries each chosen field and nothing else",
    async (kind) => {
      const ids = await targets(anna);
      for (const field of SHARE_LINK_FIELDS[kind]) {
        const { token } = await tokenFor(anna, { kind, targetId: ids[kind], fields: [field] });
        const res = await view(token).expect(200);
        const payload = res.body.data.view[kind];
        const expected = kind === "wrapped" ? ["year", field].sort() : [field];
        expect(Object.keys(payload).sort()).toEqual(expected);
        await prisma.publicShareLink.deleteMany({ where: { userId: anna.id } });
      }
    }
  );

  it.each(["flight", "trip", "wrapped"] as const)(
    "a %s link with every field still carries no private value, id or surname",
    async (kind) => {
      const ids = await targets(anna);
      const { token } = await tokenFor(anna, {
        kind,
        targetId: ids[kind],
        fields: [...SHARE_LINK_FIELDS[kind]],
      });
      const body = JSON.stringify((await view(token).expect(200)).body);
      for (const secret of NEVER_PUBLIC) expect(body).not.toContain(secret);
      for (const id of [anna.id, ids.flight, ids.trip]) expect(body).not.toContain(id);
      expect(body).toContain('"owner":"Anna"');
    }
  );

  it("counts no cancelled rail ride, bus ride or cruise in the totals or the route", async () => {
    const trip = await makeTrip(anna.id);
    const ride = (status: string, name: string) => ({
      userId: anna.id,
      tripId: trip.id,
      depStationName: `${name} A`,
      depLat: 50,
      depLon: 8,
      arrStationName: `${name} B`,
      arrLat: 51,
      arrLon: 9,
      departureTime: new Date("2030-06-03T09:00:00Z"),
      status,
    });
    await prisma.railJourney.create({ data: ride("completed", "Rail kept") });
    await prisma.railJourney.create({ data: ride("cancelled", "Rail cancelled") });
    // A tram ride kept as a journey is on the route but is no train ride (2026-10-23).
    await prisma.railJourney.create({
      data: {
        ...ride("completed", "Tram"),
        transitMode: "tram",
        departureTime: new Date("2030-06-03T12:00:00Z"),
      },
    });
    await prisma.busJourney.create({ data: ride("cancelled", "Bus cancelled") });
    await prisma.cruise.create({
      data: {
        userId: anna.id,
        tripId: trip.id,
        startDate: new Date("2030-06-04T00:00:00Z"),
        endDate: new Date("2030-06-06T00:00:00Z"),
        status: "cancelled",
      },
    });
    const { token } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["totals", "route"],
    });
    const { trip: shown } = (await view(token).expect(200)).body.data.view;
    expect(shown.totals).toMatchObject({ railRides: 1, busRides: 0, cruises: 0 });
    expect(shown.route).toEqual([
      { mode: "rail", from: "Rail kept A", to: "Rail kept B" },
      { mode: "rail", from: "Tram A", to: "Tram B" },
    ]);
  });

  it("names cost and companions only when they were chosen", async () => {
    const ids = await targets(anna);
    const bare = await tokenFor(anna, {
      kind: "trip",
      targetId: ids.trip,
      fields: ["name", "totals", "route"],
    });
    const body = JSON.stringify((await view(bare.token)).body);
    expect(body).not.toContain("987.65");
    expect(body).not.toContain("Gina Guest");

    const full = await tokenFor(anna, {
      kind: "trip",
      targetId: ids.trip,
      fields: ["costs", "companions"],
    });
    const trip = (await view(full.token)).body.data.view.trip;
    expect(trip.companions).toEqual(["Gina Guest"]);
    expect(trip.costs).not.toBeNull();
  });
});

describe("trip notes (forgejo#146)", () => {
  const shareableNote = (userId: string, body: string, utc: string) =>
    prisma.note.create({
      data: {
        userId,
        body,
        occurredAt: new Date(utc),
        occurredZone: "America/New_York",
        placeName: "Brooklyn Bridge",
        lat: 40.7061,
        lon: -73.9969,
        visibility: "shareable",
      },
    });

  it("carries the owner's shareable notes on the trip's days — never a private one", async () => {
    const trip = await makeTrip(anna.id);
    await shareableNote(anna.id, "Sunset on the bridge", "2030-06-04T23:30:00Z");
    // After the trip on its own clock (the 9th in New York), and Eve's note.
    await shareableNote(anna.id, "Back home", "2030-06-09T14:00:00Z");
    await shareableNote(eve.id, "Eve's shareable line", "2030-06-04T12:00:00Z");

    const { token } = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["notes"] });
    const res = await view(token).expect(200);
    const notes = res.body.data.view.trip.notes;
    expect(notes.truncated).toBe(false);
    expect(notes.items).toEqual([
      {
        body: "Sunset on the bridge",
        placeName: "Brooklyn Bridge",
        at: expect.objectContaining({ local: "2030-06-04T19:30:00", zone: "America/New_York" }),
        day: { date: "2030-06-04", zone: "America/New_York", precision: "day" },
      },
    ]);
    const body = JSON.stringify(res.body);
    for (const absent of [
      "PRIVATE standalone note",
      "Back home",
      "Eve's shareable line",
      "40.7061",
    ]) {
      expect(body).not.toContain(absent);
    }
  });

  it("re-reads the flag on every view: a note made private disappears at once", async () => {
    const trip = await makeTrip(anna.id);
    const shared = await shareableNote(anna.id, "Was shareable", "2030-06-04T16:00:00Z");
    const { token } = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["notes"] });
    expect((await view(token)).body.data.view.trip.notes.items).toHaveLength(1);
    await prisma.note.update({ where: { id: shared.id }, data: { visibility: "private" } });
    expect((await view(token)).body.data.view.trip.notes.items).toEqual([]);
  });

  it("names no note when notes were not chosen", async () => {
    const trip = await makeTrip(anna.id);
    await shareableNote(anna.id, "Sunset on the bridge", "2030-06-04T23:30:00Z");
    const { token } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["name", "dates"],
    });
    expect(JSON.stringify((await view(token)).body)).not.toContain("Sunset on the bridge");
  });
});

describe("trip photos", () => {
  it("serves the snapshotted photos by index, without their metadata", async () => {
    const trip = await makeTrip(anna.id);
    await addTripPhoto(trip.id, 0);
    await addTripPhoto(trip.id, 1);
    const { token } = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["photos"] });
    expect((await view(token)).body.data.view.trip.photos).toEqual({ count: 2 });

    const res = await photo(token, 0).buffer(true).expect(200);
    expect(res.headers["content-type"]).toMatch(/^image\/jpeg/);
    expect(res.headers["cache-control"]).toBe("no-store");
    const bytes = Buffer.from(res.body as Buffer).toString("latin1");
    expect(bytes.startsWith("\xff\xd8")).toBe(true);
    for (const secret of ["GPS-SECRET", "CAMERA-SERIAL-SECRET", "IPTC-SECRET"]) {
      expect(bytes).not.toContain(secret);
    }

    expect((await photo(token, 2)).status).toBe(404);
    expect((await photo(token, -1)).status).toBe(404);
  });

  it("takes only photos the page will serve, and tells the owner what stayed out", async () => {
    const trip = await makeTrip(anna.id);
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(16),
    ]);
    await addTripPhoto(trip.id, 0, Buffer.from("RIFF\0\0\0\0WEBPVP8 "), "image/webp");
    await addTripPhoto(trip.id, 1, png); // stored as JPEG, bytes say PNG
    await addTripPhoto(trip.id, 2, null); // the file is gone
    await addTripPhoto(trip.id, 3, Buffer.from("not an image at all"));
    for (let i = 0; i < 13; i++) await addTripPhoto(trip.id, 10 + i);

    const preview = await request(app)
      .post("/api/v1/share-links/preview")
      .set("Cookie", anna.cookie)
      .send({ kind: "trip", targetId: trip.id, fields: ["photos"] })
      .expect(200);
    expect(preview.body.data.view.trip.photos).toEqual({ count: 12 });
    expect(preview.body.data.photosOmitted).toEqual({
      unsupportedType: 1,
      unreadable: 3,
      overLimit: 1,
    });

    const { token } = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["photos"] });
    const row = await prisma.publicShareLink.findFirstOrThrow({ where: { userId: anna.id } });
    const servable = await prisma.tripPhoto.findMany({
      where: { tripId: trip.id, sortIdx: { gte: 10, lt: 22 } },
      orderBy: { sortIdx: "asc" },
    });
    expect(row.photoIds).toEqual(servable.map((p) => p.id));
    // Every index the page will ask for answers with bytes.
    for (let i = 0; i < 12; i++) expect((await photo(token, i)).status).toBe(200);
    // The public view never learns what was left out.
    expect(JSON.stringify((await view(token)).body)).not.toContain("omitted");
  });

  it("does not read another account's trip for a preview", async () => {
    const trip = await makeTrip(anna.id);
    await addTripPhoto(trip.id, 0);
    const res = await request(app)
      .post("/api/v1/share-links/preview")
      .set("Cookie", eve.cookie)
      .send({ kind: "trip", targetId: trip.id, fields: ["photos"] });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SHARE_LINK_NOT_FOUND");
  });

  it("serves no photo when photos were not chosen, and none added after the link", async () => {
    const trip = await makeTrip(anna.id);
    await addTripPhoto(trip.id, 0);
    const named = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["name"] });
    expect((await photo(named.token, 0)).status).toBe(404);

    const withPhotos = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["photos"],
    });
    await addTripPhoto(trip.id, 1);
    expect((await view(withPhotos.token)).body.data.view.trip.photos).toEqual({ count: 1 });
    expect((await photo(withPhotos.token, 1)).status).toBe(404);
  });

  it("forgets a photo deleted or moved to another trip since", async () => {
    const trip = await makeTrip(anna.id);
    const other = await makeTrip(anna.id);
    const first = await addTripPhoto(trip.id, 0);
    await addTripPhoto(trip.id, 1);
    const { token } = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["photos"] });
    await prisma.tripPhoto.update({ where: { id: first.id }, data: { tripId: other.id } });
    expect((await view(token)).body.data.view.trip.photos).toEqual({ count: 1 });
    expect((await photo(token, 1)).status).toBe(404);
  });
});

describe("trip itinerary (forgejo#302)", () => {
  const itineraryOf = async (token: string) =>
    (await view(token).expect(200)).body.data.view.trip.itinerary;

  it("lists every entry in time order, on each place's clock", async () => {
    const { trip } = await makeItineraryTrip(anna.id);
    const { token } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["itinerary"],
    });
    const itinerary = await itineraryOf(token);
    expect(itinerary.items.map((i: { kind: string }) => i.kind)).toEqual([
      "flight",
      "stay",
      "visit",
      "stop",
      "rail",
      "bus",
      "ferry",
      "rental",
      "cruise",
    ]);
    const [flight, stay, visit, stop, rail, , , rental, cruise] = itinerary.items;
    expect(flight).toMatchObject({
      airline: "Lufthansa",
      flightNumber: "LH400",
      from: { code: "FRA", name: "Frankfurt" },
      to: { code: "JFK", name: "New York JFK" },
      // 12:00Z is 14:00 in Frankfurt (CEST), 20:00Z is 16:00 in New York (EDT).
      departure: { zone: "Europe/Berlin", local: "2030-06-01T14:00:00", precision: "minute" },
      arrival: { zone: "America/New_York", local: "2030-06-01T16:00:00" },
      phase: "scheduled",
    });
    expect(stay).toMatchObject({
      name: "Hotel Hudson View",
      address: "356 W 58th St",
      city: "New York",
      checkIn: { date: "2030-06-01", zone: "America/New_York" },
      checkOut: { date: "2030-06-04" },
      checkInAt: { local: "2030-06-01T18:00:00", zone: "America/New_York" },
    });
    expect(visit).toMatchObject({
      name: "Statue of Liberty",
      at: { local: "2030-06-02T10:00:00" },
    });
    // A stop known to the day keeps its day — no invented midnight clock.
    expect(stop).toMatchObject({ name: "Central Park picnic", start: { precision: "day" } });
    expect(rail).toMatchObject({
      operator: "Amtrak",
      service: "Acela 2151",
      from: "New York Penn Station",
      to: "Washington Union Station",
      departure: { local: "2030-06-04T12:00:00" },
    });
    expect(rental).toMatchObject({
      provider: "Hertz",
      pickup: { station: "Hertz Manhattan West", at: { local: "2030-06-06T11:00:00" } },
      return: { station: "Hertz JFK Airport" },
    });
    expect(cruise).toMatchObject({
      ship: "Harbor Queen",
      start: { date: "2030-06-07" },
      ports: [
        { dayNumber: 1, name: "Pier 83", atSea: false, day: { date: "2030-06-07" } },
        { dayNumber: 2, name: null, atSea: true },
      ],
    });
  });

  it("never carries a booking reference, seat, room or cabin number, price, note, companion or id", async () => {
    const { trip, ids } = await makeItineraryTrip(anna.id);
    const { token } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: [...SHARE_LINK_FIELDS.trip],
    });
    const res = await view(token).expect(200);
    const body = JSON.stringify(res.body);
    expect(body).toContain("Hotel Hudson View");
    for (const secret of [...NEVER_ON_ITINERARY, ...NEVER_PUBLIC]) {
      expect(body).not.toContain(secret);
    }
    for (const id of [anna.id, ...ids]) expect(body).not.toContain(id);
    // No member to fill them into, either (the trip's own `notes` field is elsewhere).
    const itinerary = JSON.stringify(res.body.data.view.trip.itinerary);
    for (const key of ["bookingReference", "seat", "roomNumber", "cabinNumber", "price", "notes"]) {
      expect(itinerary).not.toContain(`"${key}"`);
    }
  });

  it("leaves cancelled entries out", async () => {
    const { trip } = await makeItineraryTrip(anna.id);
    const { token } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["itinerary"],
    });
    const body = JSON.stringify(await itineraryOf(token));
    expect(body).not.toContain("LH999-CANCELLED");
    expect(body).not.toContain("Cancelled Motel");
  });

  it("marks the entry in progress by the plan, else the next one", async () => {
    const { trip } = await makeItineraryTrip(anna.id);
    const { token } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["itinerary"],
      expiresAt: "2030-06-09T00:00:00Z",
    });
    // 10:00Z on 1 June: before the flight.
    expect((await itineraryOf(token)).now).toEqual({ index: 0, state: "next" });
    setClockForTests("2030-06-01T16:00:00Z");
    const inFlight = await itineraryOf(token);
    expect(inFlight.now).toEqual({ index: 0, state: "inProgress" });
    expect(inFlight.items[0].phase).toBe("inFlight");
    // 2 June, afternoon: at the hotel (the visit that morning was a moment, not a span).
    setClockForTests("2030-06-02T19:00:00Z");
    expect((await itineraryOf(token)).now).toEqual({ index: 1, state: "inProgress" });
    // 4 June, 15:30Z: checked out, train not yet gone — the train is next.
    setClockForTests("2030-06-04T15:30:00Z");
    expect((await itineraryOf(token)).now).toEqual({ index: 4, state: "next" });
  });

  it("shows a change to the trip on the next load", async () => {
    const { trip } = await makeItineraryTrip(anna.id);
    const { token } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["itinerary"],
    });
    expect((await itineraryOf(token)).items).toHaveLength(9);
    await prisma.railJourney.updateMany({
      where: { tripId: trip.id },
      data: { status: "cancelled" },
    });
    const after = await itineraryOf(token);
    expect(after.items).toHaveLength(8);
    expect(after.items.some((i: { kind: string }) => i.kind === "rail")).toBe(false);
  });

  it("ends by itself a day after the trip's last local day", async () => {
    const { trip } = await makeItineraryTrip(anna.id);
    const res = await request(app)
      .post("/api/v1/share-links")
      .set("Cookie", anna.cookie)
      .send({ kind: "trip", targetId: trip.id, fields: ["itinerary"], expiresInDays: 90 })
      .expect(201);
    // Last day 8 June in New York ends at 9 June 04:00Z; plus 24 hours.
    expect(res.body.data.effectiveExpiresAt).toBe("2030-06-10T04:00:00.000Z");
    expect((await view(res.body.data.token).expect(200)).body.data.expiresAt).toBe(
      "2030-06-10T04:00:00.000Z"
    );
    setClockForTests("2030-06-10T04:00:01Z");
    expect((await view(res.body.data.token)).status).toBe(404);
  });

  it("ends earlier when the trip's end moves earlier, and never comes back", async () => {
    const { trip } = await makeItineraryTrip(anna.id);
    const { token } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["itinerary"],
    });
    await prisma.trip.update({
      where: { id: trip.id },
      data: { endDay: new Date("2030-06-02T00:00:00Z") },
    });
    setClockForTests("2030-06-04T05:00:00Z");
    expect((await view(token)).status).toBe(404);
    await prisma.trip.update({
      where: { id: trip.id },
      data: { endDay: new Date("2030-06-30T00:00:00Z") },
    });
    expect((await view(token)).status).toBe(404);
  });

  it("refuses an itinerary for a trip that has ended — a link without one still works", async () => {
    const { trip } = await makeItineraryTrip(anna.id);
    setClockForTests("2030-06-11T00:00:00Z");
    const refused = await create(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["name", "itinerary"],
      expiresAt: "2030-06-20T00:00:00Z",
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("SHARE_LINK_TRIP_ENDED");
    const plain = await create(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["name"],
      expiresAt: "2030-06-20T00:00:00Z",
    });
    expect(plain.status).toBe(201);
  });

  it("a trip with no last day keeps the owner's own expiry", async () => {
    const { trip } = await makeItineraryTrip(anna.id);
    await prisma.trip.update({ where: { id: trip.id }, data: { endDay: null, endDate: null } });
    const res = await create(anna, { kind: "trip", targetId: trip.id, fields: ["itinerary"] });
    expect(res.status).toBe(201);
    expect(res.body.data.effectiveExpiresAt).toBe(IN_A_WEEK);
  });
});
