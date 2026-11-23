import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { fillEmptyCover, manualCoverData } from "../../services/trip/tripCover";

/** "Titelbilder automatisch wählen": the switch (default on) and its undo. */
describe("settings/auto-cover", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `auto-cover-${stamp}`, passwordHash: await hashPassword("pw-12345678") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
  });
  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("is on by default and can be switched off and on", async () => {
    const get = () => request(app).get("/api/v1/settings/auto-cover").set("Cookie", cookie);
    expect((await get()).body.enabled).toBe(true);
    const off = await request(app)
      .put("/api/v1/settings/auto-cover")
      .set("Cookie", cookie)
      .send({ enabled: false });
    expect(off.status).toBe(200);
    expect((await get()).body.enabled).toBe(false);
    await request(app)
      .put("/api/v1/settings/auto-cover")
      .set("Cookie", cookie)
      .send({ enabled: true });
    expect((await get()).body.enabled).toBe(true);
  });

  it("rejects an unknown field", async () => {
    const res = await request(app)
      .put("/api/v1/settings/auto-cover")
      .set("Cookie", cookie)
      .send({ enabled: true, extra: 1 });
    expect(res.status).toBe(400);
  });

  it("DELETE /covers removes only automatic covers", async () => {
    const auto = await prisma.trip.create({ data: { userId, name: "auto" } });
    await fillEmptyCover(auto.id, "/auto.jpg");
    const manual = await prisma.trip.create({ data: { userId, name: "manual" } });
    await prisma.trip.update({ where: { id: manual.id }, data: manualCoverData("/mine.jpg") });

    const res = await request(app)
      .delete("/api/v1/settings/auto-cover/covers")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.removed).toBe(1);
    const rows = await prisma.trip.findMany({
      where: { userId },
      select: { name: true, coverImageUrl: true },
    });
    expect(Object.fromEntries(rows.map((r) => [r.name, r.coverImageUrl]))).toEqual({
      auto: null,
      manual: "/mine.jpg",
    });
  });
});
