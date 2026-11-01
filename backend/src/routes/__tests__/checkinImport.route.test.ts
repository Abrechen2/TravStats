import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { hashPassword } from "../../utils/password";

/** POST /checkin-import — request validation and the dry-run default (forgejo#401). */
describe("POST /checkin-import", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "checkin-route-user" } });
    const user = await prisma.user.create({
      data: {
        username: "checkin-route-user",
        passwordHash: await hashPassword("password123"),
        isActive: true,
      },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("requires a login", async () => {
    const res = await request(app).post("/api/v1/checkin-import").send({});
    expect(res.status).toBe(401);
  });

  it("rejects an unknown source", async () => {
    const res = await request(app)
      .post("/api/v1/checkin-import")
      .set("Cookie", cookie)
      .send({ source: "tripit", content: "x" });
    expect(res.status).toBe(400);
  });

  it("answers an unreadable file with an error row, not a 200 with nothing in it", async () => {
    const res = await request(app)
      .post("/api/v1/checkin-import")
      .set("Cookie", cookie)
      .send({ source: "travelynx", content: "not json" });
    expect(res.status).toBe(200);
    expect(res.body.data.dryRun).toBe(true);
    expect(res.body.data.clean).toBe(false);
    expect(res.body.data.sheets[0].rows[0]).toMatchObject({
      action: "error",
      message: "invalid_file",
    });
  });
});
