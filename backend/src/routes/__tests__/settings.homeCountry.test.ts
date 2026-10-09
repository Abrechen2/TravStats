import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * Template engine v2, plan 2026-10-09 P5: the user's home country is a
 * column-backed top-level settings field. It orders booking templates and
 * never filters them; here only its API surface is pinned — GET reports it,
 * PUT persists it, `null` clears it, omission leaves it alone, and anything
 * that is not two upper-case letters is refused at the boundary.
 */
describe("settings — homeCountry", () => {
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
      .send({ username: "home-country-settings", password: "password123" })
      .expect(201);
    cookie = registration.headers["set-cookie"];
    const user = await prisma.user.findUniqueOrThrow({
      where: { username: "home-country-settings" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("is null until chosen", async () => {
    const res = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(res.body.homeCountry).toBeNull();
  });

  it("PUT persists the column and echoes it back", async () => {
    const put = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ homeCountry: "DE" })
      .expect(200);
    expect(put.body.homeCountry).toBe("DE");

    const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(row.homeCountry).toBe("DE");

    const get = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(get.body.homeCountry).toBe("DE");
  });

  it("a PUT that does not mention the field leaves it alone; null clears it", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ homeCountry: "ES" })
      .expect(200);
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ display: { theme: "dark" } })
      .expect(200);
    expect((await prisma.userSettings.findUniqueOrThrow({ where: { userId } })).homeCountry).toBe(
      "ES"
    );

    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ homeCountry: null })
      .expect(200);
    expect(
      (await prisma.userSettings.findUniqueOrThrow({ where: { userId } })).homeCountry
    ).toBeNull();
  });

  it.each(["de", "DEU", "D", "1A", ""])("refuses %j", async (value) => {
    const res = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ homeCountry: value });
    expect(res.status).toBe(400);
  });
});
