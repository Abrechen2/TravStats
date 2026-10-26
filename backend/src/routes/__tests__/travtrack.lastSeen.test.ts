import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { makeUser, storePoint, wipeTravTrack } from "../../services/travtrack/__tests__/fixtures";

/**
 * `GET /travtrack/last-seen` (TravTrack plan L2): the owner's own last
 * position, `on` tier, never cached anywhere.
 */

const PREFIX = "travtrack-lastseen-route-";
const T0 = Date.parse("2026-10-12T03:00:00Z");

describe("GET /travtrack/last-seen", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;

  const get = (c = cookie) => request(app).get("/api/v1/travtrack/last-seen").set("Cookie", c);

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([userId, otherId]);
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("the newest point with its device, and no-store", async () => {
    await storePoint(userId, { t: T0, lat: 37.5665, lon: 126.978 });
    await storePoint(userId, { t: T0 + 60_000, lat: 37.5666, lon: 126.978, device: "phone-2" });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      lastSeen: {
        at: new Date(T0 + 60_000).toISOString(),
        lat: 37.5666,
        lon: 126.978,
        accuracyM: 5,
        deviceId: "phone-2",
        deviceLabel: null,
        origin: "companion:phone-2",
      },
    });
  });

  it("no points → null, and another account's points are never read", async () => {
    await storePoint(otherId, { t: T0, lat: 35.68, lon: 139.65 });
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ lastSeen: null });
  });

  it("TravTrack off → 403 TRAVTRACK_DISABLED, even for an account holding data", async () => {
    await storePoint(userId, { t: T0, lat: 37.5665, lon: 126.978 });
    await switches.set({ beta: true, config: false });
    const res = await get();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    expect(JSON.stringify(res.body)).not.toContain("37.5665");
  });

  it("needs a signed-in account", async () => {
    const res = await request(app).get("/api/v1/travtrack/last-seen");
    expect(res.status).toBe(401);
  });
});
