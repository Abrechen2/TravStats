import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * API surface for the autoCreateTrips column (board item
 * trip-auto-creation-not-switchable): a column-backed top-level settings
 * field like baseCurrency — GET reports it, PUT persists it, and leaving it
 * out of a PUT must not reset a stored `false` back to the default.
 */
describe("settings — autoCreateTrips", () => {
  let cookie: string[];
  let userId: string;

  const clean = async (): Promise<void> => {
    await prisma.userSettings.deleteMany();
    await prisma.user.deleteMany();
  };

  beforeEach(async () => {
    await clean();
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "auto-trips-settings", password: "password123" })
      .expect(201);
    cookie = registration.headers["set-cookie"];
    const user = await prisma.user.findUniqueOrThrow({
      where: { username: "auto-trips-settings" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("defaults to true in the GET response", async () => {
    const res = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(res.body.autoCreateTrips).toBe(true);
  });

  it("PUT false persists the column and echoes it back", async () => {
    const put = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ autoCreateTrips: false })
      .expect(200);
    expect(put.body.autoCreateTrips).toBe(false);

    const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(row.autoCreateTrips).toBe(false);

    const get = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(get.body.autoCreateTrips).toBe(false);
  });

  it("a PUT that does not mention the field leaves a stored false alone", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ autoCreateTrips: false })
      .expect(200);

    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ display: { theme: "dark" } })
      .expect(200);

    const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(row.autoCreateTrips).toBe(false);
  });
});
