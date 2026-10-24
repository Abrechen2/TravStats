import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * Home place and passport expiry on the server (Companion audit 2026-10-23):
 * GET reports them, PUT sets or clears each one, and `onlyIfEmpty` — the
 * Companion's one-time upload of what it kept on the phone — never overwrites
 * a value the server already holds.
 */
describe("settings — personal", () => {
  let cookie: string[];
  const home = { name: "Bergen", lat: 60.39, lon: 5.32, zone: "Europe/Oslo" };

  const clean = async (): Promise<void> => {
    await prisma.userSettings.deleteMany();
    await prisma.user.deleteMany();
  };

  beforeEach(async () => {
    await clean();
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "personal-settings", password: "password123" })
      .expect(201);
    cookie = [res.headers["set-cookie"]].flat();
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  const get = () => request(app).get("/api/v1/settings/personal").set("Cookie", cookie).expect(200);
  const put = (body: object) =>
    request(app).put("/api/v1/settings/personal").set("Cookie", cookie).send(body);

  it("is empty until set", async () => {
    expect((await get()).body).toEqual({ homePlace: null, passportExpiry: null });
  });

  it("stores both, leaves an unnamed one alone and clears with null", async () => {
    const set = await put({ homePlace: home, passportExpiry: "2031-04-30" }).expect(200);
    expect(set.body).toEqual({ homePlace: home, passportExpiry: "2031-04-30" });

    await put({ passportExpiry: "2032-01-15" }).expect(200);
    expect((await get()).body).toEqual({ homePlace: home, passportExpiry: "2032-01-15" });

    await put({ homePlace: null }).expect(200);
    expect((await get()).body).toEqual({ homePlace: null, passportExpiry: "2032-01-15" });
  });

  it("onlyIfEmpty writes a field only where the server holds none", async () => {
    await put({ passportExpiry: "2031-04-30" }).expect(200);
    const migrated = await put({
      homePlace: home,
      passportExpiry: "2029-01-01",
      onlyIfEmpty: true,
    }).expect(200);
    expect(migrated.body).toEqual({ homePlace: home, passportExpiry: "2031-04-30" });
  });

  it("refuses a malformed day, a place off the globe and unknown fields", async () => {
    const day = await put({ passportExpiry: "2031-02-30" }).expect(400);
    expect(day.body.code).toBe("PERSONAL_SETTINGS_INVALID");
    await put({ homePlace: { ...home, lat: 91 } }).expect(400);
    await put({ birthday: "1990-01-01" }).expect(400);
  });
});
