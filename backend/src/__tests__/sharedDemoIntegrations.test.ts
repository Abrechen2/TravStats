import request from "supertest";
import app from "../index";
import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { generateToken } from "../utils/jwt";
import { getImmichConnection } from "../services/immich/immichResolver";
import { getDawarichConnection } from "../services/dawarich/dawarichResolver";

/**
 * Finding A2 of the independent review on 2026-09-17.
 *
 * Both integrations resolve **user -> admin-global -> ENV**, so an operator who
 * configured Immich or Dawarich for the instance handed that connection to
 * EVERY account — including the shared `demo` login, whose password is printed
 * on the login page of a public instance. A visitor could then browse the
 * operator's own photo library and location history.
 *
 * The shared demo therefore resolves NO integration at all: the resolvers
 * answer `null` for it, which is the same answer they give an account that
 * configured nothing, so albums, the asset proxy, imports and track pulls take
 * their normal `notConfigured` path. It cannot configure one of its own either
 * — `/settings/immich` and `/settings/dawarich` already refuse it.
 */
describe("the shared demo account resolves no integration", () => {
  let demoId: string;
  let userId: string;
  let demoCookie: string;
  let demoTripId: string;
  const ids: string[] = [];
  const envBefore = {
    immichBaseUrl: process.env.IMMICH_BASE_URL,
    immichApiKey: process.env.IMMICH_API_KEY,
    dawarichBaseUrl: process.env.DAWARICH_BASE_URL,
    dawarichApiKey: process.env.DAWARICH_API_KEY,
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["demo", "integrationUser"] } } });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      // Flagged as sample data but NOT the shared login — it keeps the
      // instance connection, exactly like the preview's `admin`/`alex`.
      data: {
        username: "integrationUser",
        passwordHash: await hashPassword("password123"),
        isDemo: true,
      },
    });
    demoId = demo.id;
    userId = user.id;
    ids.push(demo.id, user.id);
    demoCookie = `auth_token=${generateToken(demo.id)}`;

    const trip = await prisma.trip.create({
      data: { userId: demo.id, name: "Demo trip", startDate: new Date("2026-01-01") },
      select: { id: true },
    });
    demoTripId = trip.id;

    // An ENV-configured instance is the case the finding is about.
    process.env.IMMICH_BASE_URL = "http://immich.invalid";
    process.env.IMMICH_API_KEY = "instance-immich-key";
    process.env.DAWARICH_BASE_URL = "http://dawarich.invalid";
    process.env.DAWARICH_API_KEY = "instance-dawarich-key";
  });

  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { userId: demoId } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    const restore = (key: string, value: string | undefined): void => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("IMMICH_BASE_URL", envBefore.immichBaseUrl);
    restore("IMMICH_API_KEY", envBefore.immichApiKey);
    restore("DAWARICH_BASE_URL", envBefore.dawarichBaseUrl);
    restore("DAWARICH_API_KEY", envBefore.dawarichApiKey);
  });

  it("gives the shared demo account no Immich connection although the instance has one", async () => {
    await expect(getImmichConnection(demoId)).resolves.toBeNull();
  });

  it("gives the shared demo account no Dawarich connection although the instance has one", async () => {
    await expect(getDawarichConnection(demoId)).resolves.toBeNull();
  });

  it("still resolves the instance connection for every other account", async () => {
    await expect(getImmichConnection(userId)).resolves.toMatchObject({
      baseUrl: "http://immich.invalid",
      source: "env",
    });
    await expect(getDawarichConnection(userId)).resolves.toMatchObject({
      baseUrl: "http://dawarich.invalid",
      source: "env",
    });
  });

  it("still resolves the instance connection when no account is named", async () => {
    // Admin-side probes pass no user id at all; they must keep working.
    await expect(getImmichConnection()).resolves.toMatchObject({ source: "env" });
    await expect(getDawarichConnection()).resolves.toMatchObject({ source: "env" });
  });

  /**
   * Measured for forgejo#94 point 1, before deciding whether the scan needed a
   * demo guard of its own: it does not. `scanPhotoJourneys` resolves the
   * connection as its FIRST statement and returns `no-immich` on null, so for
   * the shared demo the scan reaches no library, asks Nominatim nothing and
   * writes no row — one indexed user lookup and a 200. A second guard would
   * only be a second place to forget.
   *
   * The web reads the same answer through `hasAccess` on `/settings/immich`
   * (`getImmichConnection(userId) !== null`), which is why the inbox shows the
   * demo "no library connected" instead of a button that can only answer this.
   */
  it("answers the photo-journey scan with scanned:false and writes nothing", async () => {
    const res = await request(app)
      .post("/api/v1/photo-journeys/scan")
      .set("Cookie", demoCookie)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { scanned: false, reason: "immich-not-configured" },
    });
    await expect(prisma.photoJourney.count({ where: { userId: demoId } })).resolves.toBe(0);
  });

  it("answers the album picker with the normal notConfigured body, not a new error", async () => {
    const res = await request(app)
      .get(`/api/v1/trips/${demoTripId}/immich/albums`)
      .set("Cookie", demoCookie);
    expect(res.status).toBe(409);
    // The fixed kind vocabulary the frontend's `immichFailureKind()` parses.
    expect(res.body.error).toBe("notConfigured");
  });
});
