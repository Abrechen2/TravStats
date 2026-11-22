import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "@jest/globals";
import request from "supertest";

import { prisma } from "../../db";
import { setClockForTests } from "../../shared/time/clock";
import { afterDatabaseRestore } from "../../services/backup/backupRestore";
import { updateInstanceSettings } from "../../services/instanceSettingsService";
import { generateShareToken, shareTokenHash } from "../../services/shareLinks/token";
import {
  SHARE_LINK_FIELDS,
  SHARE_LINK_ITINERARY_SECTIONS,
  SHARE_LINK_MAX_ACTIVE,
} from "../../schemas/shareLinks";
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
    const trip = await makeTrip(anna.id);
    const res = await create(anna, { kind: "trip", targetId: trip.id, fields: ["name"] });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SHARE_LINKS_DISABLED");
    const list = await request(app).get("/api/v1/share-links").set("Cookie", anna.cookie);
    expect(list.body.data).toEqual({ enabled: false, links: [] });
  });

  it("needs a session", async () => {
    await request(app).get("/api/v1/share-links").expect(401);
  });

  it("hands out a fragment URL once and stores only the token's hash", async () => {
    const trip = await makeTrip(anna.id);
    const res = await create(anna, { kind: "trip", targetId: trip.id, fields: ["name"] });
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
    // Without an itinerary nothing shortens the owner's own week.
    expect(list.body.data.links[0].effectiveExpiresAt).toBe(IN_A_WEEK);
    expect(list.body.data.links[0].retired).toBe(false);
  });

  it("refuses a field outside the kind's allow-list", async () => {
    const trip = await makeTrip(anna.id);
    for (const fields of [["progress"], ["seatNumber"], ["bookingReference"], []]) {
      const res = await create(anna, { kind: "trip", targetId: trip.id, fields });
      expect(res.status).toBe(400);
    }
    expect(await prisma.publicShareLink.count({ where: { userId: anna.id } })).toBe(0);
  });

  it("refuses a new flight, cruise, stay or visit link — those kinds are retired (2026-11-22)", async () => {
    const flight = await makeFlight(anna.id);
    const { ids } = await makeItineraryTrip(anna.id);
    const targets = { flight: flight.id, stay: ids[4], cruise: ids[9], visit: ids[11] };
    for (const [kind, targetId] of Object.entries(targets)) {
      for (const path of ["/api/v1/share-links", "/api/v1/share-links/preview"]) {
        const res = await request(app)
          .post(path)
          .set("Cookie", anna.cookie)
          .send({ kind, targetId, fields: ["owner"], expiresAt: IN_A_WEEK });
        expect(res.status).toBe(400);
      }
    }
    expect(await prisma.publicShareLink.count({ where: { userId: anna.id } })).toBe(0);
  });

  it("accepts the retired trip fields an installed app still offers, and stores none of them", async () => {
    const trip = await makeTrip(anna.id);
    await makeFlight(anna.id, trip.id);
    const res = await create(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["name", "costs", "companions", "notes"],
    });
    expect(res.status).toBe(201);
    const row = await prisma.publicShareLink.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.fields).toEqual(["name"]);
    const body = JSON.stringify((await view(res.body.data.token).expect(200)).body);
    for (const absent of ["987.65", "Gina Guest", "PRIVATE trip note", '"costs"', '"notes"']) {
      expect(body).not.toContain(absent);
    }
  });

  it("answers another account's target and link like missing ones", async () => {
    const trip = await makeTrip(anna.id);
    const theirs = await create(eve, { kind: "trip", targetId: trip.id, fields: ["name"] });
    expect(theirs.status).toBe(404);
    expect(theirs.body.code).toBe("SHARE_LINK_NOT_FOUND");

    const { token, id } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["name"],
    });
    await request(app).delete(`/api/v1/share-links/${id}`).set("Cookie", eve.cookie).expect(404);
    expect((await view(token)).status).toBe(200);
  });

  it("refuses an expiry in the past or beyond 90 days", async () => {
    const trip = await makeTrip(anna.id);
    for (const expiresAt of ["2030-06-01T09:00:00Z", "2030-09-01T10:00:00Z"]) {
      const res = await create(anna, {
        kind: "trip",
        targetId: trip.id,
        fields: ["name"],
        expiresAt,
      });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("SHARE_LINK_EXPIRY_INVALID");
    }
  });

  it("uses server time for a 90-day lifetime and caps an itinerary a week after the trip", async () => {
    const trip = await makeTrip(anna.id);
    // Move the server clock back a week: the fixture is now next week's trip.
    setClockForTests("2030-05-25T10:00:00.000Z");
    // The previous UI used the browser clock. Five minutes ahead crosses the server cap.
    const skewedExpiry = new Date(
      Date.parse("2030-05-25T10:05:00.000Z") + 90 * 86400000
    ).toISOString();
    const skewed = await create(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["flights"],
      expiresAt: skewedExpiry,
    });
    expect(skewed.status).toBe(400);
    expect(skewed.body.code).toBe("SHARE_LINK_EXPIRY_INVALID");
    const res = await request(app)
      .post("/api/v1/share-links")
      .set("Cookie", anna.cookie)
      .send({ kind: "trip", targetId: trip.id, fields: ["flights"], expiresInDays: 90 });
    expect(res.status).toBe(201);
    expect(res.body.data.expiresAt).toBe(
      new Date(Date.parse("2030-05-25T10:00:00.000Z") + 90 * 86400000).toISOString()
    );
    // Last day 8 June in New York ends at 9 June 04:00Z; plus seven days.
    expect(res.body.data.effectiveExpiresAt).toBe("2030-06-16T04:00:00.000Z");
    const row = await prisma.publicShareLink.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.expiresAt.toISOString()).toBe(res.body.data.expiresAt);
  });

  it("rejects missing, conflicting and out-of-range lifetimes", async () => {
    const trip = await makeTrip(anna.id);
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
        .send({ kind: "trip", targetId: trip.id, fields: ["route"], ...expiry });
      expect(res.status).toBe(400);
    }
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
  it("tells an admin how many links and accounts switching off would delete (the confirmation names the amount)", async () => {
    await prisma.user.update({ where: { id: eve.id }, data: { isAdmin: true } });
    const get = () =>
      request(settingsApp).get("/api/v1/admin/instance-settings").set("Cookie", eve.cookie);
    expect((await get()).body.shareLinkStats).toEqual({ links: 0, accounts: 0 });
    const a1 = await makeTrip(anna.id);
    const a2 = await makeTrip(anna.id);
    const e1 = await makeTrip(eve.id);
    for (const [owner, trip] of [
      [anna, a1],
      [anna, a2],
      [eve, e1],
    ] as const) {
      await tokenFor(owner, { kind: "trip", targetId: trip.id, fields: ["name"] });
    }
    expect((await get()).body.shareLinkStats).toEqual({ links: 3, accounts: 2 });
    await request(settingsApp)
      .put("/api/v1/admin/instance-settings")
      .set("Cookie", eve.cookie)
      .send({ shareLinksEnabled: false })
      .expect(200);
    expect((await get()).body.shareLinkStats).toEqual({ links: 0, accounts: 0 });
  });

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

    // Orphaned: the flight deleted takes its (retired) link with it — a 404, not a 410.
    const flightLink = await retiredLink(anna.id, { kind: "flight", flightId: flight.id });
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

/** A link of a retired kind as it was stored before 2026-11-22 — creation now refuses one. */
async function retiredLink(
  userId: string,
  target: {
    kind: "flight" | "cruise" | "stay" | "visit";
    flightId?: string;
    cruiseId?: string;
    lodgingStayId?: string;
    placeVisitId?: string;
  },
  expiresAt = IN_A_WEEK
): Promise<{ token: string; id: string }> {
  const { token, tokenHash } = generateShareToken();
  const row = await prisma.publicShareLink.create({
    data: {
      userId,
      ...target,
      fields: ["owner"],
      tokenHash,
      expiresAt: new Date(expiresAt),
      effectiveExpiresAt: new Date(expiresAt),
    },
  });
  return { token, id: row.id };
}

describe("retired kinds: flight, cruise, stay, visit (owner decision 2026-11-22)", () => {
  const oldLinks = async () => {
    const flight = await makeFlight(anna.id);
    const { ids } = await makeItineraryTrip(anna.id);
    return [
      await retiredLink(anna.id, { kind: "flight", flightId: flight.id }),
      await retiredLink(anna.id, { kind: "stay", lodgingStayId: ids[4] }),
      await retiredLink(anna.id, { kind: "cruise", cruiseId: ids[9] }),
      await retiredLink(anna.id, { kind: "visit", placeVisitId: ids[11] }),
    ];
  };

  it("answers a live old link with 410 'no longer available' — no view, no 500", async () => {
    for (const link of await oldLinks()) {
      const res = await view(link.token);
      expect(res.status).toBe(410);
      expect(res.body).toEqual({
        error: "This link is no longer available",
        code: "SHARE_LINK_RETIRED",
      });
      expect(res.headers["cache-control"]).toBe("no-store");
      expect((await photo(link.token, 0)).status).toBe(404);
    }
    const rows = await prisma.publicShareLink.findMany({ where: { userId: anna.id } });
    expect(rows.every((r) => r.viewCount === 0)).toBe(true);
  });

  it("answers an expired old link like any dead link", async () => {
    const flight = await makeFlight(anna.id);
    const link = await retiredLink(
      anna.id,
      { kind: "flight", flightId: flight.id },
      "2030-06-01T11:00:00Z"
    );
    setClockForTests("2030-06-01T11:00:01Z");
    const res = await view(link.token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SHARE_LINK_NOT_FOUND");
  });

  it("still lists old links for their owner, marked retired, and lets the owner delete them", async () => {
    const links = await oldLinks();
    const list = await request(app).get("/api/v1/share-links").set("Cookie", anna.cookie);
    expect(list.status).toBe(200);
    const listed = list.body.data.links as Array<{ id: string; kind: string; retired: boolean }>;
    expect(listed.map((l) => l.kind).sort()).toEqual(["cruise", "flight", "stay", "visit"]);
    expect(listed.every((l) => l.retired)).toBe(true);
    await request(app)
      .delete(`/api/v1/share-links/${links[0].id}`)
      .set("Cookie", anna.cookie)
      .expect(200);
    expect((await view(links[0].token)).status).toBe(404);
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
  const SECTIONS: readonly string[] = SHARE_LINK_ITINERARY_SECTIONS;

  it.each(["trip", "wrapped"] as const)(
    "a %s link carries each chosen field and nothing else",
    async (kind) => {
      const ids = await targets(anna);
      for (const field of SHARE_LINK_FIELDS[kind]) {
        const { token } = await tokenFor(anna, { kind, targetId: ids[kind], fields: [field] });
        const res = await view(token).expect(200);
        const payload = res.body.data.view[kind];
        const shown = field === "itinerary" || SECTIONS.includes(field) ? "itinerary" : field;
        const expected = kind === "wrapped" ? ["year", field].sort() : [shown];
        expect(Object.keys(payload).sort()).toEqual(expected);
        await prisma.publicShareLink.deleteMany({ where: { userId: anna.id } });
      }
    }
  );

  it.each(["trip", "wrapped"] as const)(
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

  it("counts a trip's ferry crossings and rentals in the public totals and route, cancelled ones not (forgejo#396)", async () => {
    const trip = await makeTrip(anna.id);
    const ferry = (status: string, name: string, at: string) => ({
      userId: anna.id,
      tripId: trip.id,
      depStationName: `${name} A`,
      depLat: 54,
      depLon: 10,
      arrStationName: `${name} B`,
      arrLat: 59,
      arrLon: 10,
      departureTime: new Date(at),
      status,
    });
    await prisma.ferryJourney.create({
      data: ferry("completed", "Ferry kept", "2030-06-03T09:00:00Z"),
    });
    await prisma.ferryJourney.create({
      data: ferry("cancelled", "Ferry gone", "2030-06-03T10:00:00Z"),
    });
    const rental = (status: string, name: string, at: string) => ({
      userId: anna.id,
      tripId: trip.id,
      provider: "Hertz",
      pickupStationName: `${name} pick`,
      pickupLat: 59,
      pickupLon: 10,
      pickupTimezone: "Europe/Oslo",
      returnStationName: `${name} drop`,
      returnLat: 59,
      returnLon: 10,
      returnTimezone: "Europe/Oslo",
      pickupTime: new Date(at),
      returnTime: new Date("2030-06-09T12:00:00Z"),
      status,
    });
    await prisma.rentalBooking.create({
      data: rental("completed", "Car kept", "2030-06-04T09:00:00Z"),
    });
    await prisma.rentalBooking.create({
      data: rental("cancelled", "Car gone", "2030-06-04T10:00:00Z"),
    });
    const { token } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["totals", "route"],
    });
    const { trip: shown } = (await view(token).expect(200)).body.data.view;
    expect(shown.totals).toMatchObject({ ferryCrossings: 1, rentals: 1 });
    expect(shown.route).toEqual([
      { mode: "ferry", from: "Ferry kept A", to: "Ferry kept B" },
      { mode: "rental", from: "Car kept pick", to: "Car kept drop" },
    ]);
  });

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

  it("never names a cost or a companion, whatever was chosen (2026-11-22)", async () => {
    const ids = await targets(anna);
    const full = await tokenFor(anna, {
      kind: "trip",
      targetId: ids.trip,
      fields: [...SHARE_LINK_FIELDS.trip, "costs", "companions"],
    });
    const body = JSON.stringify((await view(full.token)).body);
    for (const absent of ["987.65", "Gina Guest", '"costs"', '"companions"']) {
      expect(body).not.toContain(absent);
    }
  });
});

describe("trip notes (forgejo#146, retired 2026-11-22)", () => {
  it("carries no note — not even a shareable one, and not for a link that once chose notes", async () => {
    const trip = await makeTrip(anna.id);
    await prisma.note.create({
      data: {
        userId: anna.id,
        body: "Sunset on the bridge",
        occurredAt: new Date("2030-06-04T23:30:00Z"),
        occurredZone: "America/New_York",
        placeName: "Brooklyn Bridge",
        visibility: "shareable",
      },
    });
    // A link made before the change, with `notes` stored among its fields.
    const old = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["name"] });
    await prisma.publicShareLink.update({
      where: { id: old.id },
      data: { fields: ["name", "notes", "costs", "companions"] },
    });
    const res = await view(old.token).expect(200);
    expect(Object.keys(res.body.data.view.trip)).toEqual(["name"]);
    expect(JSON.stringify(res.body)).not.toContain("Sunset on the bridge");
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

  it("shows only the sections the owner chose (flights, stays, transport, places)", async () => {
    const { trip } = await makeItineraryTrip(anna.id);
    const kindsFor = async (fields: string[]) => {
      const { token } = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields });
      const itinerary = await itineraryOf(token);
      await prisma.publicShareLink.deleteMany({ where: { userId: anna.id } });
      return {
        sections: itinerary.sections,
        kinds: itinerary.items.map((i: { kind: string }) => i.kind),
      };
    };
    expect(await kindsFor(["flights"])).toEqual({ sections: ["flights"], kinds: ["flight"] });
    expect(await kindsFor(["stays"])).toEqual({ sections: ["stays"], kinds: ["stay"] });
    expect(await kindsFor(["transport"])).toEqual({
      sections: ["transport"],
      kinds: ["rail", "bus", "ferry", "rental", "cruise"],
    });
    expect(await kindsFor(["places"])).toEqual({ sections: ["places"], kinds: ["visit", "stop"] });
    // The default of the dialog: flights, stays and transport.
    expect((await kindsFor(["name", "flights", "stays", "transport"])).kinds).toEqual([
      "flight",
      "stay",
      "rail",
      "bus",
      "ferry",
      "rental",
      "cruise",
    ]);
    // A link of before 2026-11-22 names `itinerary` alone: all four sections.
    expect((await kindsFor(["itinerary"])).sections).toEqual([
      "flights",
      "stays",
      "transport",
      "places",
    ]);
    // No section, no itinerary at all.
    const { token } = await tokenFor(anna, { kind: "trip", targetId: trip.id, fields: ["name"] });
    expect((await view(token).expect(200)).body.data.view.trip.itinerary).toBeUndefined();
  });

  it("names a flight's terminal and gate, never its PNR, price, note or document", async () => {
    const { trip, ids } = await makeItineraryTrip(anna.id);
    await prisma.document.create({
      data: {
        userId: anna.id,
        flightId: ids[1],
        storedName: "sharelink-test-boarding.pdf",
        originalName: "PRIVATE-boarding-pass.pdf",
        mimetype: "application/pdf",
        sizeBytes: 1234,
        sha256: "f".repeat(64),
        format: "pdf",
      },
    });
    const { token } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["name", "dates", "flights", "stays", "transport", "places"],
    });
    const res = await view(token).expect(200);
    expect(res.body.data.view.trip.itinerary.items[0]).toMatchObject({
      kind: "flight",
      terminal: "1",
      gate: "B12",
    });
    const body = JSON.stringify(res.body);
    for (const secret of [
      "PNR-XYZ123",
      "987.65",
      "PRIVATE flight note",
      "PRIVATE trip note",
      "PRIVATE-boarding-pass",
      "sharelink-test-boarding",
      "FF-MILES-998877",
      "Coraline Copassenger",
      ...NEVER_ON_ITINERARY,
    ]) {
      expect(body).not.toContain(secret);
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

  it("ends by itself a week after the trip's last local day", async () => {
    const { trip } = await makeItineraryTrip(anna.id);
    const res = await request(app)
      .post("/api/v1/share-links")
      .set("Cookie", anna.cookie)
      .send({ kind: "trip", targetId: trip.id, fields: ["itinerary"], expiresInDays: 90 })
      .expect(201);
    // Last day 8 June in New York ends at 9 June 04:00Z; plus seven days.
    expect(res.body.data.effectiveExpiresAt).toBe("2030-06-16T04:00:00.000Z");
    expect((await view(res.body.data.token).expect(200)).body.data.expiresAt).toBe(
      "2030-06-16T04:00:00.000Z"
    );
    setClockForTests("2030-06-15T12:00:00Z");
    expect((await view(res.body.data.token)).status).toBe(200);
    setClockForTests("2030-06-16T04:00:01Z");
    expect((await view(res.body.data.token)).status).toBe(404);
  });

  it("ends earlier when the trip's end moves earlier, and never comes back", async () => {
    const { trip } = await makeItineraryTrip(anna.id);
    const { token } = await tokenFor(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["itinerary"],
      expiresAt: "2030-08-01T00:00:00Z",
    });
    await prisma.trip.update({
      where: { id: trip.id },
      data: { endDay: new Date("2030-06-02T00:00:00Z") },
    });
    // 2 June in New York ends at 3 June 04:00Z; a week later the link is gone.
    setClockForTests("2030-06-10T05:00:00Z");
    expect((await view(token)).status).toBe(404);
    await prisma.trip.update({
      where: { id: trip.id },
      data: { endDay: new Date("2030-06-30T00:00:00Z") },
    });
    expect((await view(token)).status).toBe(404);
  });

  it("refuses an itinerary for a trip that has ended — a link without one still works", async () => {
    const { trip } = await makeItineraryTrip(anna.id);
    setClockForTests("2030-06-17T00:00:00Z");
    const refused = await create(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["name", "stays"],
      expiresAt: "2030-06-25T00:00:00Z",
    });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("SHARE_LINK_TRIP_ENDED");
    const plain = await create(anna, {
      kind: "trip",
      targetId: trip.id,
      fields: ["name"],
      expiresAt: "2030-06-25T00:00:00Z",
    });
    expect(plain.status).toBe(201);
  });

  describe("a trip without dates of its own (forgejo#317)", () => {
    const undated = { startDay: null, endDay: null, startDate: null, endDate: null };

    it("ends a week after its entries' last local day", async () => {
      const trip = await prisma.trip.create({ data: { userId: anna.id, name: "Undated" } });
      await makeFlight(anna.id, trip.id); // lands 1 June 20:00Z, 16:00 in New York
      const res = await create(anna, {
        kind: "trip",
        targetId: trip.id,
        fields: ["itinerary"],
        expiresAt: "2030-06-20T00:00:00Z",
      });
      expect(res.status).toBe(201);
      // 1 June in New York ends at 2 June 04:00Z; plus seven days.
      expect(res.body.data.effectiveExpiresAt).toBe("2030-06-09T04:00:00.000Z");
    });

    it("refuses an itinerary when every entry lies in the past", async () => {
      const { trip } = await makeItineraryTrip(anna.id);
      await prisma.trip.update({ where: { id: trip.id }, data: undated });
      setClockForTests("2031-01-01T00:00:00Z");
      const res = await create(anna, {
        kind: "trip",
        targetId: trip.id,
        fields: ["itinerary"],
        expiresAt: "2031-01-08T00:00:00Z",
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SHARE_LINK_TRIP_ENDED");
    });

    it("ends a link made before the fix once it is next read", async () => {
      const { trip } = await makeItineraryTrip(anna.id);
      await prisma.trip.update({ where: { id: trip.id }, data: undated });
      const { token, id } = await tokenFor(anna, {
        kind: "trip",
        targetId: trip.id,
        fields: ["itinerary"],
        expiresAt: "2030-08-01T00:00:00Z",
      });
      // What the old rule stored: the owner's own expiry, open past the trip.
      await prisma.publicShareLink.update({
        where: { id },
        data: { effectiveExpiresAt: new Date("2030-08-01T00:00:00Z") },
      });
      setClockForTests("2030-07-01T00:00:00Z");
      expect((await view(token)).status).toBe(404);
    });

    it("ignores a cancelled entry when finding the last day", async () => {
      const trip = await prisma.trip.create({ data: { userId: anna.id, name: "Undated" } });
      await makeFlight(anna.id, trip.id);
      const late = await makeFlight(anna.id, trip.id);
      await prisma.flight.update({
        where: { id: late.id },
        data: {
          status: "cancelled",
          departureTime: new Date("2030-06-15T12:00:00Z"),
          arrivalTime: new Date("2030-06-15T20:00:00Z"),
        },
      });
      const res = await create(anna, {
        kind: "trip",
        targetId: trip.id,
        fields: ["itinerary"],
        expiresAt: "2030-06-20T00:00:00Z",
      });
      expect(res.body.data.effectiveExpiresAt).toBe("2030-06-09T04:00:00.000Z");
    });

    it("with no dated entry either, keeps the owner's own expiry", async () => {
      // Nothing on the trip names a day, so there is no end to derive: the
      // link stays open until the owner's chosen expiry (abstention, not a guess).
      const trip = await prisma.trip.create({ data: { userId: anna.id, name: "Empty" } });
      const res = await create(anna, { kind: "trip", targetId: trip.id, fields: ["flights"] });
      expect(res.status).toBe(201);
      expect(res.body.data.effectiveExpiresAt).toBe(IN_A_WEEK);
    });
  });
});
