import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { trackGapMsFor } from "../../services/tripRecording/trackGap";

const PATH = "/api/v1/settings/track-gap";
const USERNAME = "track-gap-route";

describe("settings — track gap", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  beforeEach(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("GET answers the default and the bounds for an account without a settings row", async () => {
    const res = await request(app).get(PATH).set("Cookie", cookie).expect(200);
    expect(res.body).toEqual({ minutes: 120, default: 120, min: 5, max: 720 });
    expect(await trackGapMsFor(userId)).toBe(120 * 60_000);
  });

  it("PUT stores the gap, GET and the reader return it", async () => {
    const put = await request(app)
      .put(PATH)
      .set("Cookie", cookie)
      .send({ minutes: 45 })
      .expect(200);
    expect(put.body.minutes).toBe(45);
    expect((await request(app).get(PATH).set("Cookie", cookie)).body.minutes).toBe(45);
    expect(await trackGapMsFor(userId)).toBe(45 * 60_000);
  });

  it("PUT refuses an out-of-range or fractional value instead of clamping silently", async () => {
    for (const minutes of [0, 4, 721, 30.5, "30"]) {
      const res = await request(app).put(PATH).set("Cookie", cookie).send({ minutes });
      expect(res.status).toBe(400);
    }
    expect(await trackGapMsFor(userId)).toBe(120 * 60_000);
  });
});
