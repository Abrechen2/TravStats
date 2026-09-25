import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { createOAuthState } from "../../services/strava/stravaConnection";
import { ensureAdminSettingsRow } from "../../services/adminSettingsRow";
import { encryptApiKey } from "../../utils/encryption";

/**
 * Strava (2.7): the consent round trip, the activity list and the import —
 * against a stubbed `fetch`, so no test ever talks to Strava.
 */

const USER = "stravauser";
const ORIGIN = "http://localhost:3000";
const CALLBACK = `${ORIGIN}/integrations/strava/callback`;

const realFetch = global.fetch;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Strava as the tests need it: tokens, one activity with a route, its streams. */
function stravaStub(url: string, init?: RequestInit): Response {
  if (url.endsWith("/oauth/token")) {
    const body = JSON.parse(String(init?.body ?? "{}")) as { grant_type: string };
    return json({
      access_token: body.grant_type === "refresh_token" ? "access-2" : "access-1",
      refresh_token: "refresh-1",
      expires_at: Math.floor(Date.now() / 1000) + 6 * 3600,
      athlete: { id: 4242 },
      scope: "read,activity:read_all",
    });
  }
  if (url.includes("/athlete/activities")) {
    return json([
      {
        id: 111,
        name: "Preikestolen",
        sport_type: "Hike",
        start_date: "2026-07-15T08:40:00Z",
        distance: 8100,
        moving_time: 10080,
        total_elevation_gain: 502,
        map: { summary_polyline: "abc" },
      },
      {
        id: 222,
        name: "Laufband",
        sport_type: "Run",
        start_date: "2026-07-16T07:00:00Z",
        distance: 5000,
        moving_time: 1500,
        map: { summary_polyline: null },
      },
    ]);
  }
  if (url.includes("/activities/111/streams")) {
    return json({
      latlng: {
        data: [
          [58.986, 6.19],
          [58.9869, 6.19],
          [58.9878, 6.19],
          [58.9887, 6.19],
        ],
      },
      time: { data: [0, 60, 120, 180] },
      altitude: { data: [270, 350, 480, 604] },
    });
  }
  if (url.endsWith("/activities/111")) {
    return json({
      id: 111,
      name: "Preikestolen",
      sport_type: "Hike",
      start_date: "2026-07-15T08:40:00Z",
      elapsed_time: 180,
    });
  }
  if (url.includes("/activities/222/streams")) return json({});
  if (url.endsWith("/activities/222")) {
    return json({
      id: 222,
      name: "Laufband",
      sport_type: "Run",
      start_date: "2026-07-16T07:00:00Z",
    });
  }
  if (url.endsWith("/oauth/deauthorize")) return json({});
  return json({ message: "not found" }, 404);
}

describe("Strava integration", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      stravaStub(String(input), init)
    ) as typeof fetch;
  });

  afterAll(async () => {
    global.fetch = realFetch;
    const id = await ensureAdminSettingsRow();
    await prisma.adminSettings.update({
      where: { id },
      data: { stravaClientId: null, stravaClientSecret: null },
    });
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it("says Strava is not configured before the operator registers an app", async () => {
    const status = await request(app)
      .get("/api/v1/integrations/strava/status")
      .set("Cookie", cookie);
    expect(status.body).toEqual({ configured: false, connected: false, athleteId: null });
    const authorize = await request(app)
      .post("/api/v1/integrations/strava/authorize")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN)
      .send({ redirectUri: CALLBACK });
    expect(authorize.status).toBe(409);
    expect(authorize.body.kind).toBe("notConfigured");
  });

  it("builds the consent URL only for this instance's own callback page", async () => {
    const id = await ensureAdminSettingsRow();
    await prisma.adminSettings.update({
      where: { id },
      data: { stravaClientId: "12345", stravaClientSecret: encryptApiKey("s3cret-client-secret") },
    });

    const good = await request(app)
      .post("/api/v1/integrations/strava/authorize")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN)
      .send({ redirectUri: CALLBACK });
    expect(good.status).toBe(200);
    const url = new URL(good.body.url);
    expect(url.origin).toBe("https://www.strava.com");
    expect(url.searchParams.get("client_id")).toBe("12345");
    expect(url.searchParams.get("scope")).toBe("activity:read_all");
    expect(url.searchParams.get("state")).toBeTruthy();

    const elsewhere = await request(app)
      .post("/api/v1/integrations/strava/authorize")
      .set("Cookie", cookie)
      .set("Origin", ORIGIN)
      .send({ redirectUri: "https://evil.example/integrations/strava/callback" });
    expect(elsewhere.status).toBe(400);
  });

  it("refuses a code whose state was made for someone else", async () => {
    const res = await request(app)
      .post("/api/v1/integrations/strava/exchange")
      .set("Cookie", cookie)
      .send({ code: "abc", state: createOAuthState("00000000-0000-4000-8000-000000000000") });
    expect(res.status).toBe(400);
  });

  it("refuses a consent that did not grant reading activities", async () => {
    const res = await request(app)
      .post("/api/v1/integrations/strava/exchange")
      .set("Cookie", cookie)
      .send({ code: "abc", state: createOAuthState(userId), scope: "read" });
    expect(res.status).toBe(401);
    expect(res.body.kind).toBe("auth");
  });

  it("connects, stores the tokens encrypted, and reports the athlete", async () => {
    const res = await request(app)
      .post("/api/v1/integrations/strava/exchange")
      .set("Cookie", cookie)
      .send({ code: "abc", state: createOAuthState(userId), scope: "read,activity:read_all" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, connected: true, athleteId: "4242" });
    const row = await prisma.userSettings.findUnique({ where: { userId } });
    expect(row?.stravaAccessToken).not.toBe("access-1");
    expect(row?.stravaRefreshToken).not.toBe("refresh-1");
  });

  it("lists activities and says which have no route to import", async () => {
    const res = await request(app)
      .get("/api/v1/integrations/strava/activities")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.activities).toEqual([
      expect.objectContaining({ id: "111", sportType: "Hike", hasRoute: true, distanceKm: 8.1 }),
      expect.objectContaining({ id: "222", hasRoute: false }),
    ]);
  });

  it("makes a day tour from an activity, with its climb, and refuses it a second time", async () => {
    const res = await request(app)
      .post("/api/v1/tours/import/strava")
      .set("Cookie", cookie)
      .send({ activityId: "111" });
    expect(res.status).toBe(201);
    const route = await prisma.tripRoute.findUniqueOrThrow({
      where: { id: res.body.routeId },
      include: { tracks: true },
    });
    expect(route).toMatchObject({
      kind: "tour",
      activity: "hike",
      mode: "foot",
      name: "Preikestolen",
    });
    expect(route.tracks[0]).toMatchObject({
      source: "strava",
      externalRef: "strava:111",
      ascentM: 334,
    });

    const again = await request(app)
      .post(`/api/v1/tours/${route.id}/tracks/strava`)
      .set("Cookie", cookie)
      .send({ activityId: "111" });
    expect(again.status).toBe(409);
  });

  it("leaves no empty tour behind when the activity has no route", async () => {
    const before = await prisma.tripRoute.count({ where: { userId } });
    const res = await request(app)
      .post("/api/v1/tours/import/strava")
      .set("Cookie", cookie)
      .send({ activityId: "222" });
    expect(res.status).toBe(502);
    expect(res.body.kind).toBe("protocol");
    expect(await prisma.tripRoute.count({ where: { userId } })).toBe(before);
  });

  it("disconnects and forgets the tokens", async () => {
    const res = await request(app).delete("/api/v1/integrations/strava").set("Cookie", cookie);
    expect(res.status).toBe(204);
    const status = await request(app)
      .get("/api/v1/integrations/strava/status")
      .set("Cookie", cookie);
    expect(status.body.connected).toBe(false);
  });
});
