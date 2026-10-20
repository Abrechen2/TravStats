import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * forgejo#321: whether the settings page shows the standard or the expert set
 * is stored per account, so it follows the user to another browser. A fresh
 * account starts at `standard`; the migration that put existing accounts on
 * `expert` is pinned by `migration.userSettingsLevel.test.ts`.
 */
describe("settings — settingsLevel", () => {
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
      .send({ username: "settings-level", password: "password123" })
      .expect(201);
    cookie = [registration.headers["set-cookie"]].flat();
    userId = (await prisma.user.findUniqueOrThrow({ where: { username: "settings-level" } })).id;
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("a fresh account reads standard", async () => {
    const res = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(res.body.settingsLevel).toBe("standard");
    const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(row.settingsLevel).toBe("standard");
  });

  it("PUT expert persists the column and round-trips through GET", async () => {
    const put = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ settingsLevel: "expert" })
      .expect(200);
    expect(put.body.settingsLevel).toBe("expert");
    expect((await prisma.userSettings.findUniqueOrThrow({ where: { userId } })).settingsLevel).toBe(
      "expert"
    );

    // A later PUT that does not mention the field leaves it alone.
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ display: { theme: "dark" } })
      .expect(200);
    const get = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(get.body.settingsLevel).toBe("expert");
  });

  it.each(["advanced", "Expert", "", 1, null])("refuses %j with 400", async (value) => {
    const res = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ settingsLevel: value });
    expect(res.status).toBe(400);
  });

  it("answers an unknown stored word as standard", async () => {
    await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    await prisma.userSettings.update({ where: { userId }, data: { settingsLevel: "wizard" } });
    const res = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(res.body.settingsLevel).toBe("standard");
  });
});
