import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { TRIP_COLORS } from "../../schemas/trip";
import { chosenTripColor, tripColorSequence } from "../../services/trip/newTripColor";

/**
 * "Reisefarbe für neue Reisen" (forgejo#321): a trip created without a colour
 * takes the account's chosen palette colour; automatic keeps the rotation
 * every path used before; a colour the request names always wins.
 */
describe("new trip colour", () => {
  const username = `trip-colour-${Date.now()}`;
  let cookie: string;
  let userId: string;

  const choose = (color: string | null) =>
    request(app).put("/api/v1/settings").set("Cookie", cookie).send({ tripDefaults: { color } });

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  it("automatic rotates through the palette, as before the setting", async () => {
    const first = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", cookie)
      .send({ name: "One" })
      .expect(201);
    const second = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", cookie)
      .send({ name: "Two" })
      .expect(201);
    expect(first.body.trip.color).toBe(TRIP_COLORS[0]);
    expect(second.body.trip.color).toBe(TRIP_COLORS[1]);
  });

  it("a chosen colour is what every new trip without a colour gets", async () => {
    await choose(TRIP_COLORS[4]).expect(200);
    for (const name of ["One", "Two"]) {
      const res = await request(app)
        .post("/api/v1/trips")
        .set("Cookie", cookie)
        .send({ name })
        .expect(201);
      expect(res.body.trip.color).toBe(TRIP_COLORS[4]);
    }
  });

  it("a colour the request names wins over the chosen one", async () => {
    await choose(TRIP_COLORS[4]).expect(200);
    const res = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", cookie)
      .send({ name: "Mine", color: TRIP_COLORS[7] })
      .expect(201);
    expect(res.body.trip.color).toBe(TRIP_COLORS[7]);
  });

  it("a batch gets one colour per trip in turn, or the chosen one for all", async () => {
    const rotate = await tripColorSequence(userId);
    expect([0, 1, 2].map(rotate)).toEqual(TRIP_COLORS.slice(0, 3));
    await choose(TRIP_COLORS[9]).expect(200);
    const chosen = await tripColorSequence(userId);
    expect([0, 1, 2].map(chosen)).toEqual([TRIP_COLORS[9], TRIP_COLORS[9], TRIP_COLORS[9]]);
  });

  it("a colour outside the palette, written behind the API's back, is ignored", async () => {
    await prisma.userSettings.create({ data: { userId, data: {}, tripDefaultColor: "#000000" } });
    expect(await chosenTripColor(userId)).toBeNull();
    const res = await request(app)
      .post("/api/v1/trips")
      .set("Cookie", cookie)
      .send({ name: "Fallback" })
      .expect(201);
    expect(res.body.trip.color).toBe(TRIP_COLORS[0]);
  });
});
