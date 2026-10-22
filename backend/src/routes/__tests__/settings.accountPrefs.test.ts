import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { TRIP_COLORS } from "../../schemas/trip";

/**
 * The settings prototype rows of forgejo#321 on `/settings`: the colour of a
 * new trip, whether sea days count, and live tracking. Flat columns, nested
 * in the API; GET answers the defaults (the behaviour from before), PUT writes
 * only what it names, and a value outside the vocabulary is refused.
 */
describe("settings — account preferences (forgejo#321)", () => {
  const username = `account-prefs-${Date.now()}`;
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  it("GET answers the defaults: automatic colour, sea days counted, live tracking on", async () => {
    const res = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(res.body.tripDefaults).toEqual({ color: null });
    expect(res.body.cruiseSeaDays).toEqual({ counted: true });
    expect(res.body.liveTracking).toEqual({ enabled: true });
  });

  it("PUT stores each in its column, echoes it, and leaves the JSON blob alone", async () => {
    const put = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({
        tripDefaults: { color: TRIP_COLORS[3] },
        cruiseSeaDays: { counted: false },
        liveTracking: { enabled: false },
      })
      .expect(200);
    expect(put.body.tripDefaults).toEqual({ color: TRIP_COLORS[3] });
    expect(put.body.cruiseSeaDays).toEqual({ counted: false });
    expect(put.body.liveTracking).toEqual({ enabled: false });
    const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(row).toMatchObject({
      tripDefaultColor: TRIP_COLORS[3],
      cruiseCountSeaDays: false,
      flightLiveTrackingEnabled: false,
    });
    expect(row.data).not.toHaveProperty("tripDefaults");
    expect(row.data).not.toHaveProperty("liveTracking");
  });

  it("a PUT naming one leaves the others, and the cruise slice, alone", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ cruise: { defaultLine: "AIDA" }, liveTracking: { enabled: false } })
      .expect(200);
    const res = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ cruiseSeaDays: { counted: false } })
      .expect(200);
    expect(res.body.liveTracking).toEqual({ enabled: false });
    expect(res.body.cruiseSeaDays).toEqual({ counted: false });
    expect(res.body.cruise).toMatchObject({ defaultLine: "AIDA" });
  });

  it("null puts the trip colour back on automatic", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ tripDefaults: { color: TRIP_COLORS[1] } })
      .expect(200);
    const res = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ tripDefaults: { color: null } })
      .expect(200);
    expect(res.body.tripDefaults).toEqual({ color: null });
  });

  it("refuses a colour outside the trip palette and stores nothing", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ tripDefaults: { color: "#123456" } })
      .expect(400);
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ liveTracking: { enabled: "no" } })
      .expect(400);
    const row = await prisma.userSettings.findUnique({ where: { userId } });
    expect(row?.tripDefaultColor ?? null).toBeNull();
    expect(row?.flightLiveTrackingEnabled ?? true).toBe(true);
  });

  it("a stored colour the palette no longer holds reads as automatic", async () => {
    await prisma.userSettings.create({
      data: { userId, data: {}, tripDefaultColor: "#000000" },
    });
    const res = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(res.body.tripDefaults).toEqual({ color: null });
  });
});
